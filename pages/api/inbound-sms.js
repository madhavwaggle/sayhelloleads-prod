/**
 * /api/inbound-sms
 * Twilio inbound SMS webhook.
 * Twilio sends a POST when someone texts the agent's Twilio number.
 * We match the To number to the agent, then AI responds via SMS.
 * Webhook URL: https://www.sayhelloleads.com/api/inbound-sms
 */

import { saveLead, getLead, getAllLeads } from '../../lib/db';
import { getUserById } from '../../lib/users';
import { getAgentConfig } from '../../lib/agentConfig';
import { notifyAgentNewLead } from '../../lib/notify';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { From, To, Body } = req.body;
  if (!From || !Body) return res.status(400).end();

  // Find agent whose twilioPhone matches the To number
  const agentId = await findAgentByTwilioPhone(To);
  if (!agentId) {
    console.warn('No agent found for Twilio number:', To);
    return res.status(200).send('<Response></Response>');
  }

  const agent = await getUserById(agentId).catch(() => null);
  const cfg = await getAgentConfig(agentId);
  if (!cfg.anthropicKey) return res.status(200).send('<Response></Response>');

  // Find existing open lead from this phone number, or create new
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

  lead.messages.push({ role: 'lead', text: Body });

  const agentName = agent?.name || 'your agent';
  const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });

  const conversationContext = lead.messages
    .slice(-6)
    .map(m => `${m.role === 'ai' ? 'Assistant' : 'Lead'}: ${m.text}`)
    .join('\n');

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 200,
      system: `You are a Say Hello Leads AI assistant for ${agentName}. Responding via SMS — keep replies SHORT (1-3 sentences). Qualify the lead. Sign off as "- ${agentName} (Say Hello Leads AI)" only on first message.`,
      messages: [{ role: 'user', content: conversationContext }],
    });

    const aiReply = resp.content?.[0]?.text || "Thanks for reaching out! I'll have your agent contact you shortly.";
    lead.messages.push({ role: 'ai', text: aiReply });
    lead.updatedAt = new Date().toISOString();
    if (!lead.score) lead.score = 'WARM';
    if (!lead.summary) lead.summary = `${lead.fname} texted about ${lead.property}. Follow up needed.`;

    // Score the lead properly via AI (only on first message)
    const isNew = lead.messages.filter(m => m.role === 'lead').length === 1;
    if (isNew) {
      try {
        const scoreResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514', max_tokens: 150,
          system: 'Real estate lead scoring. Respond ONLY with valid JSON, no markdown fences.',
          messages: [{ role: 'user', content: `Score this lead. HOT=ready <30 days+budget. WARM=interested. COLD=browsing.\nLead phone: ${lead.phone}\nMessage: "${Body}"\nRespond: {"score":"HOT","summary":"2-sentence agent briefing."}` }],
        });
        const raw = scoreResp.content?.[0]?.text?.replace(/\`\`\`json|\`\`\`/g,'').trim() || '{}';
        const parsed = JSON.parse(raw);
        lead.score   = ['HOT','WARM','COLD'].includes(parsed.score) ? parsed.score : 'WARM';
        lead.summary = parsed.summary || `${lead.fname} texted about ${lead.property}. Follow up needed.`;
      } catch {
        lead.score   = 'WARM';
        lead.summary = `SMS lead texted about ${lead.property}. Follow up needed.`;
      }
    }

    await saveLead(lead);

    // Notify agent after scoring so email shows correct score
    if (isNew) {
      const agentEmail = agent?.notifyEmail || agent?.email;
      if (agentEmail) {
        await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
          .catch(e => console.error('SMS notify error:', e.message));
      }
    }

    // Reply via Twilio TwiML
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(`<Response><Message>${aiReply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Message></Response>`);
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
      // Check direct index
      const agentId = await redis.get(`twilio:phone:${phone}`);
      if (agentId) return agentId;
      // Fallback: scan creds
      const ids = await redis.zrange('users:index', 0, -1);
      for (const id of ids) {
        const raw = await redis.get(`creds:${id}`);
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
