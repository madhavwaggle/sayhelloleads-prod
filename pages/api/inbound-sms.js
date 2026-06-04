/**
 * /api/inbound-sms
 * Twilio inbound SMS webhook.
 * Matches the To number to an agent, responds via AI, scores on first message.
 * Webhook URL: https://www.sayhelloleads.com/api/inbound-sms
 */

import { saveLead, getAllLeads } from '../../lib/db';
import { getUserById } from '../../lib/users';
import { getAgentConfig } from '../../lib/agentConfig';
import { notifyAgentNewLead } from '../../lib/notify';
import { buildSMSPrompt, buildScoringPrompt, parseScoreResponse } from '../../lib/aiPrompts';
import { processReply, fallbackReply, validateScore } from '../../lib/guardrails';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { From, To, Body } = req.body;
  if (!From || !Body) return res.status(400).end();

  const agentId = await findAgentByTwilioPhone(To);
  if (!agentId) {
    console.warn('No agent found for Twilio number:', To);
    return res.status(200).send('<Response></Response>');
  }

  const agent     = await getUserById(agentId).catch(() => null);
  const cfg       = await getAgentConfig(agentId);
  const agentName = agent?.name || 'your agent';

  if (!cfg.anthropicKey) return res.status(200).send('<Response></Response>');

  // Find existing lead from this number or create new
  const existingLeads = await getAllLeads({ agentId, limit: 200 });
  let lead = existingLeads.find(l => l.phone === From);

  if (!lead) {
    lead = {
      id: uuidv4(), agentId,
      fname: 'SMS', lname: 'Lead',
      email: '', phone: From,
      property: 'SMS inquiry',
      source: 'SMS / Text',
      messages: [], score: null, summary: '', smsSent: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const isNew = lead.messages.filter(m => m.role === 'lead').length === 0;
  lead.messages.push({ role: 'lead', text: Body });

  const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });

  // Build history for SMS prompt
  const history = lead.messages.slice(-8).map(m => ({
    role:    m.role === 'ai' ? 'assistant' : 'user',
    content: m.text,
  }));

  try {
    // ── 1. SMS reply ─────────────────────────────────────────────────────────
    const smsPrompt = buildSMSPrompt({ agentName, lead, history });
    const resp = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 160,
      system:     smsPrompt.system,
      messages:   smsPrompt.messages,
    });

    const rawReply = resp.content?.[0]?.text || '';
    const { text: cleanedReply, safe, flags } = processReply(rawReply);

    if (flags.length > 0) {
      console.warn(`[guardrails] inbound-sms reply flags for ${From}:`, flags);
    }

    const aiReply = safe
      ? cleanedReply
      : fallbackReply(agentName);

    if (!safe) {
      console.warn(`[guardrails] inbound-sms reply FAILED for ${From} — using fallback. Flags:`, flags);
    }

    lead.messages.push({ role: 'ai', text: aiReply });
    lead.updatedAt = new Date().toISOString();

    // ── 2. Score on first message ────────────────────────────────────────────
    if (isNew) {
      try {
        const scorePrompt = buildScoringPrompt({ lead });
        const scoreResp = await anthropic.messages.create({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 500,
          system:     scorePrompt.system,
          messages:   scorePrompt.messages,
        });
        const scored = parseScoreResponse(scoreResp.content?.[0]?.text);
        if (validateScore(scored)) {
          lead.score      = scored.score;
          lead.confidence = scored.confidence;
          lead.signals    = scored.signals;
          lead.summary    = scored.summary || `SMS lead texted about ${lead.property}.`;
          lead.nextAction = scored.nextAction || 'Follow up to qualify.';
        } else {
          lead.score   = 'WARM';
          lead.summary = `SMS lead texted about ${lead.property}. Follow up needed.`;
        }
      } catch {
        lead.score   = 'WARM';
        lead.summary = `SMS lead texted about ${lead.property}. Follow up needed.`;
      }
    }

    await saveLead(lead);

    // ── 3. Notify agent on first message ─────────────────────────────────────
    if (isNew) {
      const agentEmail = agent?.notifyEmail || agent?.email;
      if (agentEmail) {
        await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
          .catch(e => console.error('SMS notify error:', e.message));
      }
    }

    // ── 4. Reply via Twilio TwiML ─────────────────────────────────────────────
    const safeXml = aiReply
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(`<Response><Message>${safeXml}</Message></Response>`);
  } catch (e) {
    console.error('SMS AI error:', e);
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  }
}

async function findAgentByTwilioPhone(phone) {
  if (!phone) return null;
  try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const { Redis } = await import('@upstash/redis');
      const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
      const agentId = await redis.get(`twilio:phone:${phone}`);
      if (agentId) return agentId;
      const ids = await redis.zrange('users:index', 0, -1);
      for (const id of ids) {
        const raw   = await redis.get(`creds:${id}`);
        const creds = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
        if (creds.twilioPhone === phone) {
          await redis.set(`twilio:phone:${phone}`, id);
          return id;
        }
      }
    }
  } catch (e) { console.error('findAgentByTwilioPhone error:', e); }
  return null;
}

export const config = { api: { bodyParser: { type: 'application/x-www-form-urlencoded' } } };
