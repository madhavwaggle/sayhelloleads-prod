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

import { saveLead } from '../../lib/db';
import { getUserById } from '../../lib/users';
import { getAgentConfig } from '../../lib/agentConfig';
import { notifyAgentNewLead } from '../../lib/notify';
import { triggerAIResponse } from './new-lead';
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
  const lead = parseLeadEmail(fromEmail, subject, textBody, agentId);

  if (!lead.email && !lead.phone) {
    console.log('[inbound-email] no contact info parsed from:', subject);
    return res.status(200).json({ message: 'ignored — not a lead email' });
  }

  lead.id        = uuidv4();
  lead.createdAt = new Date().toISOString();
  lead.updatedAt = new Date().toISOString();

  await saveLead(lead);

  // triggerAIResponse handles all AI reply, guardrails, scoring, and SMS/email
  try {
    await Promise.race([
      triggerAIResponse(lead, agent, cfg),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000)),
    ]);
  } catch (e) { console.error('[inbound-email] AI error:', e.message); }

  // Notify agent — fires after scoring so notification shows HOT/WARM/COLD
  const agentEmail = agent?.notifyEmail || agent?.email;
  if (agentEmail) {
    const agentName = agent?.name || 'your agent';
    await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
      .catch(e => console.error('[inbound-email] notify error:', e.message));
  }

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
 * Sanitize a parsed field before embedding in AI prompts.
 * Lead emails are untrusted — strip prompt-injection characters.
 */
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
  api: { bodyParser: { type: 'application/json' } },
};
