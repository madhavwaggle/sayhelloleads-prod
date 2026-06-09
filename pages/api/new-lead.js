/**
 * /api/new-lead
 * Public endpoint — receives leads from website forms / integrations.
 * Requires x-agent-id header (or agentId in body) to route to correct agent.
 * Optional: x-webhook-secret for security.
 */

import { saveLead, getAllLeads } from '../../lib/db';
import { getUserById } from '../../lib/users';
import { notifyAgentNewLead, notifyOwnerCapExceeded } from '../../lib/notify';
import { getAgentConfig } from '../../lib/agentConfig';
import { buildFirstResponsePrompt, buildScoringPrompt, parseScoreResponse } from '../../lib/aiPrompts';
import { processReply, fallbackReply, validateScore } from '../../lib/guardrails';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import { getRedis } from '../../lib/redis';

const AI_MONTHLY_CAP = 100; // per agent — raise once subscriptions are live

async function checkAndIncrementAICap(agentId) {
  try {
    const store = await getRedis();
    if (!store) return { allowed: true, firstExceedance: false };
    const month = new Date().toISOString().slice(0, 7);
    const key = `ai:usage:${agentId}:${month}`;
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, 60 * 60 * 24 * 35);
    return {
      allowed: count <= AI_MONTHLY_CAP,
      firstExceedance: count === AI_MONTHLY_CAP + 1, // exactly one over = first time
    };
  } catch (e) {
    console.error('AI cap check error:', e.message);
    return { allowed: true, firstExceedance: false };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const agentId = req.headers['x-agent-id'] || req.body.agentId || process.env.DEFAULT_AGENT_ID;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  const cfg = await getAgentConfig(agentId);

  // Webhook secret check (optional)
  const secret = req.headers['x-webhook-secret'] || req.body.secret;
  if (cfg.webhookSecret && secret !== cfg.webhookSecret) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { fname, lname, email, phone, property, message, source } = req.body;
  if (!email && !phone) return res.status(400).json({ error: 'email or phone required' });

  const agent = await getUserById(agentId).catch(() => null);

  const id = uuidv4();
  const lead = {
    id, agentId,
    fname: fname || 'Unknown', lname: lname || '',
    email: email || '', phone: phone || '',
    property: property || 'property inquiry',
    source: source || 'Website',
    messages: [{ role: 'lead', text: message || 'Inquiry received' }],
    score: null, summary: '', smsSent: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveLead(lead);

  try {
    await Promise.race([
      triggerAIResponse(lead, agent, cfg),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 25000)),
    ]);
  } catch (e) { console.error('AI error:', e.message); }

  return res.status(200).json({ id, message: 'Lead received' });
}

export async function triggerAIResponse(lead, agent, cfg) {
  if (!cfg) cfg = await getAgentConfig(lead.agentId);
  if (!cfg.anthropicKey) {
    console.warn('No Anthropic key for agent', lead.agentId);
    lead.score   = 'WARM';
    lead.summary = `${lead.fname} inquired about ${lead.property}. Follow up to schedule a showing.`;
    await saveLead(lead);
    return;
  }

  const agentName  = agent?.name || 'your agent';
  const agencyName = agent?.agencyName || '';
  const anthropic  = new Anthropic({ apiKey: cfg.anthropicKey });

  // ── Monthly AI cap ─────────────────────────────────────────────────────
  const { allowed: withinCap, firstExceedance } = await checkAndIncrementAICap(lead.agentId);
  if (!withinCap) {
    console.warn(`[ai-cap] Agent ${lead.agentId} has exceeded ${AI_MONTHLY_CAP} AI responses this month — saving lead and notifying agent without AI.`);
    lead.score   = 'WARM';
    lead.summary = `New lead from ${lead.fname || 'someone'} about ${lead.property}. AI limit reached for this month — follow up manually.`;
    await saveLead(lead);
    const agentEmail = agent?.notifyEmail || agent?.email;
    if (agentEmail) {
      await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
        .catch(e => console.error('[ai-cap] notify error:', e.message));
    }
    // Alert owner once — on the exact call that tips over the cap
    if (firstExceedance) {
      await notifyOwnerCapExceeded(agent || { id: lead.agentId })
        .catch(e => console.error('[ai-cap] owner alert error:', e.message));
    }
    return;
  }

  try {
    // ── 1. First response ──────────────────────────────────────────────────
    const replyPrompt = buildFirstResponsePrompt({ agentName, agencyName, lead });
    const replyResp = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 250,
      system:     replyPrompt.system,
      messages:   replyPrompt.messages,
    });

    const rawReply = replyResp.content?.[0]?.text || '';
    const { text: aiReply, safe, flags } = processReply(rawReply);

    if (flags.length > 0) {
      console.warn(`[guardrails] new-lead reply flags for lead ${lead.id}:`, flags);
    }

    const finalReply = safe ? aiReply : fallbackReply(agentName);
    if (!safe) {
      console.warn(`[guardrails] new-lead reply FAILED for lead ${lead.id} — using fallback. Flags:`, flags);
    }

    if (finalReply) {
      lead.messages.push({ role: 'ai', text: finalReply });
      lead.updatedAt = new Date().toISOString();
    }

    // ── 2. Score ───────────────────────────────────────────────────────────
    const scorePrompt = buildScoringPrompt({ lead });
    const scoreResp = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001', // Haiku is sufficient for structured JSON scoring
      max_tokens: 500,
      system:     scorePrompt.system,
      messages:   scorePrompt.messages,
    });

    const scored = parseScoreResponse(scoreResp.content?.[0]?.text);
    if (validateScore(scored)) {
      lead.score              = scored.score;
      lead.confidence         = scored.confidence;
      lead.signals            = scored.signals;
      lead.summary            = scored.summary || `${lead.fname} inquired about ${lead.property}.`;
      lead.nextAction         = scored.nextAction || 'Follow up to schedule a showing.';
      if (scored.signals?.triggerWords)       lead.triggerWords       = scored.signals.triggerWords;
      if (scored.signals?.responseEngagement) lead.responseEngagement = scored.signals.responseEngagement;
    } else {
      console.warn(`[guardrails] invalid score for lead ${lead.id} — using defaults`);
      lead.score   = 'WARM';
      lead.summary = `${lead.fname} inquired about ${lead.property}. Follow up needed.`;
    }

    await saveLead(lead);

    // ── 3. SMS lead if Twilio connected ────────────────────────────────────
    if (finalReply && lead.phone && cfg.twilioSid && cfg.twilioPhone) {
      try {
        const twilio = (await import('twilio')).default;
        await twilio(cfg.twilioSid, cfg.twilioToken).messages.create({
          to: lead.phone, from: cfg.twilioPhone, body: finalReply.slice(0, 1600),
        });
        lead.smsSent = true;
        await saveLead(lead);
      } catch (e) { console.error('SMS error:', e.message); }
    }

    // ── 4. Email lead if Postmark connected ────────────────────────────────
    if (finalReply && lead.email && cfg.postmarkToken) {
      try {
        const { ServerClient } = await import('postmark');
        await new ServerClient(cfg.postmarkToken).sendEmail({
          From:     cfg.emailFrom || `${agentName} <noreply@sayhelloleads.com>`,
          To:       lead.email,
          Subject:  `Re: ${lead.property}`,
          TextBody: finalReply,
          HtmlBody: `<div style="font-family:sans-serif;max-width:600px;padding:1.5rem;line-height:1.6;">${finalReply.replace(/\n/g, '<br>')}</div>`,
        });
      } catch (e) { console.error('Postmark error:', e.message); }
    }

    // ── 5. Notify agent ────────────────────────────────────────────────────
    const agentEmail = agent?.notifyEmail || agent?.email;
    if (agent?.agentNotifyPhone) lead.agentNotifyPhone = agent.agentNotifyPhone;
    if (agentEmail) {
      lead.agentPhotoUrl = agent?.photoUrl || '';
      await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
        .catch(e => console.error('Notify error:', e.message));
    }
  } catch (e) {
    console.error('AI trigger error:', e);
  }
}

export const config = { maxDuration: 30 };
