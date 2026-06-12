/**
 * /api/inbound-email
 * Postmark inbound webhook — receives forwarded lead emails from Zillow,
 * Homes.com, Realtor.com etc. and creates a lead for the correct agent.
 *
 * Setup in Postmark:
 *   Inbound webhook URL → https://www.sayhelloleads.com/api/inbound-email
 *   Inbound domain      → inbound.sayhelloleads.com
 *
 * Each agent's unique forwarding address:
 *   <agentId>@inbound.sayhelloleads.com
 *   e.g. c49cbb55-b2c7-4ab0-9e60-39cd0306b3c3@inbound.sayhelloleads.com
 */

import { saveLead, findLeadByContact } from '../../lib/db';
import { getUserById } from '../../lib/users';
import { getAgentConfig } from '../../lib/agentConfig';
import { triggerAIResponse } from './new-lead';
import { buildScoringPrompt, parseScoreResponse } from '../../lib/aiPrompts';
import { validateScore } from '../../lib/guardrails';
import { detectCallIntent, notifyAgentCallRequest, notifyAgentNewLead } from '../../lib/notify';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const payload   = req.body;
  const fromEmail = payload?.From || payload?.FromFull?.Email || '';
  const subject   = payload?.Subject || '';
  const textBody  = payload?.TextBody || payload?.StrippedTextReply || payload?.HtmlBody || '';

  // Log raw recipient fields in dev so you can see exactly what Postmark sends
  if (process.env.NODE_ENV !== 'production') {
    console.log('[inbound-email] To:', payload?.To);
    console.log('[inbound-email] OriginalRecipient:', payload?.OriginalRecipient);
    console.log('[inbound-email] ToFull:', JSON.stringify(payload?.ToFull));
  }

  // Try every possible field Postmark might use for the recipient address.
  // OriginalRecipient is most reliable for forwarded emails — it reflects
  // the actual address the message was delivered to, not a rewritten envelope.
  const candidateAddresses = [
    payload?.OriginalRecipient,
    payload?.To,
    ...(payload?.ToFull || []).map(t => t?.Email || t?.MailboxHash || ''),
    payload?.Cc,
    ...(payload?.CcFull || []).map(t => t?.Email || ''),
  ].filter(Boolean);

  let agentId = null;
  for (const addr of candidateAddresses) {
    agentId = extractAgentId(addr);
    if (agentId) break;
  }

  if (!agentId) {
    console.warn('[inbound-email] could not resolve agentId. Candidates:', candidateAddresses);
    return res.status(200).json({ message: 'ignored — no agent found' });
  }

  const agent = await getUserById(agentId).catch(() => null);

  if (!agent) {
    console.warn('[inbound-email] agentId extracted but no user found:', agentId);
    return res.status(200).json({ message: 'ignored — agent not found' });
  }

  const cfg  = await getAgentConfig(agentId);

  // ── Extract the sender's email directly from the From header ─────────────
  // This is reliable for dedup — the From header is always the actual sender.
  // Don't use body-parsed email for dedup as it can match quoted thread addresses.
  const senderEmail = (fromEmail.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/) || [])[0]?.toLowerCase().trim() || '';

  const parsed = parseLeadEmail(fromEmail, subject, textBody, agentId);

  if (!parsed.email && !parsed.phone && !senderEmail) {
    console.log('[inbound-email] no contact info parsed from:', subject);
    return res.status(200).json({ message: 'ignored — not a lead email' });
  }

  // ── Dedup: check for existing lead using sender email first, then parsed ──
  // Using senderEmail (From header) is more reliable than body-parsed email
  // because the body may contain quoted thread addresses like leads@sayhelloleads.com
  const existing = await findLeadByContact(agentId, {
    email: senderEmail || parsed.email,
    phone: parsed.phone,
    subject,
  });

  let lead;
  if (existing) {
    console.log('[inbound-email] matched existing lead:', existing.id, '| sender:', senderEmail);
    // Strip quoted reply thread before saving — email clients append the
    // original message thread which we don't want in the conversation.
    const rawReply = parsed.messages?.[0]?.text || textBody?.trim() || '';
    const replyText = stripQuotedEmailThread(rawReply).slice(0, 500);
    if (replyText) {
      existing.messages = [...(existing.messages || []), { role: 'lead', text: replyText }];
      existing.updatedAt = new Date().toISOString();
    }
    lead = existing;
    console.log('[inbound-email] reply appended to existing lead:', existing.id);
  } else {
    console.log('[inbound-email] no existing lead found for sender:', senderEmail, '| parsed email:', parsed.email, '| phone:', parsed.phone, '— creating new lead');
    lead = parsed;
    lead.id        = uuidv4();
    lead.createdAt = new Date().toISOString();
    lead.updatedAt = new Date().toISOString();
  }

  await saveLead(lead);

  // ── For replies to existing leads: re-score + call intent + AI reply ──────
  if (existing) {
    try {
      if (cfg.anthropicKey) {
        const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });
        // Re-score with updated conversation
        const scorePrompt = buildScoringPrompt({ lead });
        const scoreResp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: scorePrompt.system,
          messages: scorePrompt.messages,
        });
        const scored = parseScoreResponse(scoreResp.content?.[0]?.text);
        if (validateScore(scored)) {
          lead.score      = scored.score;
          lead.confidence = scored.confidence;
          lead.signals    = scored.signals;
          lead.summary    = scored.summary || lead.summary;
          lead.nextAction = scored.nextAction || lead.nextAction;
          await saveLead(lead);
        }
        // Check for call intent — if detected, notify agent urgently
        const lastLeadMsg = lead.messages.filter(m => m.role === 'lead').slice(-1)[0]?.text || '';
        if (detectCallIntent(lastLeadMsg)) {
          const agentEmail = agent?.notifyEmail || agent?.email;
          const agentName  = agent?.name || 'Agent';
          if (agentEmail) {
            await notifyAgentCallRequest(lead, agentEmail, agentName, cfg.resendKey)
              .catch(e => console.error('[inbound-email] call alert error:', e.message));
          }
        }
      }
      // ── Generate conversation-aware reply (NOT first-response) ────────────
      // Use buildConversationPrompt so it reads the full history, knows what's
      // already been asked, and doesn't repeat timeline/budget questions.
      const { buildConversationPrompt } = await import('../../lib/aiPrompts');
      const { processReply, fallbackReply } = await import('../../lib/guardrails');

      const agentName  = agent?.name || 'Agent';
      const conversationHistory = (lead.messages || []).map(m => ({
        role:    m.role === 'ai' ? 'assistant' : 'user',
        content: m.text,
      }));

      const prompt = buildConversationPrompt({
        agentName,
        lead,
        conversationHistory,
        calendlyUrl: cfg.calendlyUrl || '',
      });

      const replyResp = await anthropic.messages.create({
        model:    'claude-sonnet-4-20250514',
        max_tokens: 250,
        system:   prompt.system,
        messages: prompt.messages.length > 0 ? prompt.messages : [{ role: 'user', content: 'Hello' }],
      });

      const rawReply = replyResp.content?.[0]?.text?.trim() || '';
      const reply    = processReply(rawReply) || fallbackReply(agentName);

      // Save AI reply to conversation
      lead.messages.push({ role: 'ai', text: reply });
      lead.updatedAt = new Date().toISOString();
      await saveLead(lead);

      // Send reply back to lead via email
      if (lead.email && cfg.postmarkToken) {
        try {
          const { ServerClient } = await import('postmark');
          const displayName = cfg.displayName || agentName;
          const fromEmail   = process.env.POSTMARK_FROM_EMAIL || 'leads@sayhelloleads.com';
          await new ServerClient(cfg.postmarkToken).sendEmail({
            From:     `${displayName} <${fromEmail}>`,
            ReplyTo:  `${lead.agentId}@inbound.sayhelloleads.com`,
            To:       lead.email,
            Subject:  lead.property ? `Re: ${lead.property}` : `Re: your inquiry`,
            TextBody: reply,
            HtmlBody: `<div style="font-family:sans-serif;max-width:600px;line-height:1.6;">${reply.replace(/\n/g, '<br>')}</div>`,
          });
        } catch (e) { console.error('[inbound-email] reply send error:', e.message); }
      }

      // Notify agent
      const agentEmail = agent?.notifyEmail || agent?.email;
      if (agent?.agentNotifyPhone) lead.agentNotifyPhone = agent.agentNotifyPhone;
      if (agentEmail) {
        notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
          .catch(e => console.error('[inbound-email] notify error:', e.message));
      }
    } catch (e) { console.error('[inbound-email] reply AI error:', e.message); }
    return res.status(200).json({ id: lead.id, message: 'Reply processed' });
  }

  // ── New lead: full AI pipeline ────────────────────────────────────────────
  try {
    await Promise.race([
      triggerAIResponse(lead, agent, cfg),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000)),
    ]);
  } catch (e) { console.error('[inbound-email] AI error:', e.message); }

  return res.status(200).json({ id: lead.id, message: 'Lead captured' });
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Extract the agent's UUID from an email address string.
 *
 * Handles all of:
 *   c49cbb55-b2c7-4ab0-9e60-39cd0306b3c3@inbound.sayhelloleads.com
 *   "Display Name <c49cbb55-b2c7-4ab0-9e60-39cd0306b3c3@inbound.sayhelloleads.com>"
 *   de191c21614fd790df6cfed9ddc80851@inbound.postmarkapp.com  (32-char hex, no hyphens)
 *
 * Key fixes vs old version:
 *   1. No `^` anchor — UUID can appear anywhere in the string, not just position 0.
 *      Postmark often wraps addresses as "Name <uuid@domain>" so ^ always failed.
 *   2. Two separate patterns — one for standard UUID (with hyphens), one for
 *      32-char hex (without hyphens). The old single pattern was ambiguous.
 */
function extractAgentId(toAddress) {
  if (!toAddress || typeof toAddress !== 'string') return null;

  // Standard UUID with hyphens — anywhere in the string
  const m1 = toAddress.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i);
  if (m1) return m1[1];

  // 32-char hex without hyphens (e.g. Postmark master address)
  const m2 = toAddress.match(/([0-9a-f]{32})@/i);
  if (m2) return m2[1];

  // inbound+<id>@sayhelloleads.com style
  const m3 = toAddress.match(/inbound\+([^@]+)@/i);
  if (m3) return m3[1];

  return null;
}

/**
 * Strip quoted email thread content from a reply body.
 * Removes: "On [date], [name] wrote:", "-----Original Message-----",
 * "> quoted lines", and everything after them.
 */
function stripQuotedEmailThread(text) {
  if (!text) return '';
  // Split into lines and drop everything from the first quote marker onwards
  const lines = text.split('\n');
  const cutPatterns = [
    /^On .+wrote:/i,
    /^[-_]{3,}/,
    /^From:/i,
    /^Sent:/i,
    /^To:/i,
    /^Subject:/i,
    /^>{1}/,
    /wrote:\s*$/i,
    /^_{3,}/,
  ];
  let cutAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (cutPatterns.some(p => p.test(lines[i].trim()))) {
      cutAt = i;
      break;
    }
  }
  return lines.slice(0, cutAt).join('\n').trim();
}

function sanitizeField(str, maxLen = 120) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[`<>]/g, '')
    .replace(/\n|\r/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function parseLeadEmail(fromEmail, subject, body, agentId) {
  const lead = {
    agentId,
    fname: '', lname: '', email: '', phone: '',
    property: '', source: 'Email',
    messages: [], score: null, summary: '', smsSent: false,
  };

  // Detect source from sender or subject
  const combined = (fromEmail + ' ' + subject + ' ' + body).toLowerCase();
  if (combined.includes('zillow'))           lead.source = 'Zillow';
  else if (combined.includes('homes.com'))   lead.source = 'Homes.com';
  else if (combined.includes('realtor.com')) lead.source = 'Realtor.com';
  else if (combined.includes('redfin'))      lead.source = 'Redfin';
  else if (combined.includes('trulia'))      lead.source = 'Trulia';

  // ── Name ──────────────────────────────────────────────────────────────────
  const namePatterns = [
    /(?:Name|Buyer|Lead|Contact|From)[:\s]+([A-Z][a-z]+)\s+([A-Z][a-z]+)/,
    /^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(?:is interested|has inquired|sent you)/m,
    /New lead from\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i,
  ];
  for (const p of namePatterns) {
    const m = body.match(p) || subject.match(p);
    if (m) {
      lead.fname = sanitizeField(m[1], 50);
      lead.lname = sanitizeField(m[2], 50);
      break;
    }
  }

  // ── Email ──────────────────────────────────────────────────────────────────
  const emailMatch = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    const skip = ['zillow', 'homes.com', 'realtor.com', 'redfin', 'trulia', 'postmark', 'sayhelloleads'];
    if (!skip.some(s => emailMatch[0].includes(s))) lead.email = emailMatch[0].slice(0, 200);
  }

  // ── Phone ──────────────────────────────────────────────────────────────────
  const phoneMatch = body.match(/(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/);
  if (phoneMatch) lead.phone = phoneMatch[0].replace(/\s/g, '').slice(0, 20);

  // ── Property ───────────────────────────────────────────────────────────────
  const propPatterns = [
    /(?:property|address|listing|home)[:\s]+([^\n]{10,100})/i,
    /interested in\s+([^\n]{10,100})/i,
    /inquired about\s+([^\n]{10,100})/i,
    /(\d+\s+[A-Z][a-z]+\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)[^\n]{0,60})/,
  ];
  for (const p of propPatterns) {
    const m = body.match(p) || subject.match(p);
    if (m) { lead.property = sanitizeField(m[1], 120); break; }
  }
  if (!lead.property) {
    lead.property = sanitizeField(subject.replace(/^(fwd|re|fw):\s*/i, ''), 80);
  }

  // ── Message — cap at 500 chars and sanitize before going into AI prompts ───
  lead.messages = [{
    role: 'lead',
    text: body.replace(/[`<>]/g, '').trim().slice(0, 500),
  }];

  return lead;
}

export const config = {
  api: { bodyParser: { type: 'application/json', sizeLimit: '5mb' } },
};
