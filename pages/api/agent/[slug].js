/**
 * pages/api/agent/[slug].js
 *
 * GET  /api/agent/:slug  → returns public agent profile (name, agency)
 * POST /api/agent/:slug  → submits a buyer inquiry as a lead for that agent
 *
 * The slug is derived from the agent's name: "Jane Smith" → "jane-smith"
 * It is stored on the user object as `slug` when the account is created
 * (or lazily generated on first lookup from their name).
 */

import { getUserByEmail } from '../../../lib/users';
import { saveLead } from '../../../lib/db';
import { notifyAgentNewLead } from '../../../lib/notify';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Convert a display name to a URL slug, e.g. "Jane Smith" → "jane-smith" */
function nameToSlug(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

/**
 * Find an agent by slug.
 * We scan the user index stored in Redis (or the in-memory map).
 * This keeps the lookup self-contained without adding a new Redis key pattern.
 */
async function getAgentBySlug(slug) {
  // Redis path
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    // Check slug index first (fast path, populated on registration or profile save)
    const agentId = await redis.get(`agent:slug:${slug}`);
    if (agentId) {
      const raw = await redis.get(`user:${agentId}`);
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }

    // Fallback: scan users:index and compute slug from name (slow path, once per new user)
    const ids = await redis.zrange('users:index', 0, -1);
    for (const id of ids) {
      const raw = await redis.get(`user:${id}`);
      const user = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      if (user && nameToSlug(user.name) === slug) {
        // Cache it for next time
        await redis.set(`agent:slug:${slug}`, id);
        return user;
      }
    }
    return null;
  }

  // In-memory fallback (local dev)
  const { _memMap } = await import('../../../lib/users');
  if (_memMap) {
    for (const [key, val] of _memMap.entries()) {
      if (key.startsWith('user:') && !key.includes(':email:')) {
        if (nameToSlug(val?.name) === slug) return val;
      }
    }
  }
  return null;
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  // ── GET: resolve slug → public agent profile ──────────────────────────────
  if (req.method === 'GET') {
    const agent = await getAgentBySlug(slug).catch(() => null);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Return only public-safe fields
    return res.status(200).json({
      id: agent.id,
      name: agent.name,
      agencyName: agent.agencyName || '',
      slug,
    });
  }

  // ── POST: submit buyer inquiry ────────────────────────────────────────────
  if (req.method === 'POST') {
    const agent = await getAgentBySlug(slug).catch(() => null);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { fname, lname, email, phone, property, message, source } = req.body;
    if (!fname || !email) return res.status(400).json({ error: 'Name and email are required.' });

    const id = uuidv4();
    const lead = {
      id,
      agentId: agent.id,
      fname: fname.trim(),
      lname: (lname || '').trim(),
      email: email.trim().toLowerCase(),
      phone: (phone || '').trim(),
      property: (property || 'property inquiry').trim(),
      source: source || 'Agent Page',
      messages: [{ role: 'lead', text: message || 'Inquiry received via agent page.' }],
      score: null,
      summary: '',
      smsSent: false,
      publicSlug: slug,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveLead(lead);

    // Trigger AI response + scoring async (don't block buyer)
    triggerAIResponse(lead, agent).catch(console.error);

    return res.status(200).json({ id, message: 'Inquiry sent!' });
  }

  return res.status(405).end();
}

// ─── AI RESPONSE TRIGGER ─────────────────────────────────────────────────────

async function triggerAIResponse(lead, agent) {
  const agentName = agent.name || 'your agent';
  const agencyName = agent.agencyName || '';

  const systemPrompt = `You are a Say Hello Leads AI real estate assistant responding on behalf of ${agentName}${agencyName ? ` at ${agencyName}` : ''}.

A buyer just submitted an inquiry. Respond warmly and personally — reference the property by name if given. Ask ONE qualifying question (timeline, budget, or pre-approval status). Keep it under 4 sentences. Sign off as "${agentName} (via Say Hello Leads)".`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: lead.messages[0].text || `I'm interested in ${lead.property}.` }],
    });

    const aiReply = resp.content?.[0]?.text || '';
    if (!aiReply) return;

    lead.messages.push({ role: 'ai', text: aiReply });
    lead.updatedAt = new Date().toISOString();

    // Score
    const scoreResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: 'You are a lead scoring assistant. Respond ONLY with valid JSON, no markdown.',
      messages: [{
        role: 'user',
        content: `Score this real estate lead. HOT=ready <30 days with budget. WARM=interested but vague. COLD=just browsing.\n\nLead: ${lead.fname} ${lead.lname}\nMessage: ${lead.messages[0].text}\nProperty: ${lead.property}\n\nRespond: {"score":"HOT","summary":"2-sentence agent briefing."}`,
      }],
    });

    try {
      const parsed = JSON.parse(scoreResp.content?.[0]?.text?.replace(/```json|```/g, '').trim());
      lead.score = parsed.score || 'WARM';
      lead.summary = parsed.summary || '';
    } catch {
      lead.score = 'WARM';
      lead.summary = `${lead.fname} inquired about ${lead.property}. Follow up to schedule a showing.`;
    }

    await saveLead(lead);

    // SMS the lead if Twilio configured
    if (lead.phone && process.env.TWILIO_ACCOUNT_SID) {
      try {
        const twilio = (await import('twilio')).default;
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({ to: lead.phone, from: process.env.TWILIO_PHONE_NUMBER, body: aiReply.slice(0, 1600) });
        lead.smsSent = true;
        await saveLead(lead);
      } catch (e) { console.error('SMS error:', e); }
    }

    // Email the buyer if Postmark configured
    if (lead.email && process.env.POSTMARK_SERVER_TOKEN) {
      try {
        const postmark = await import('postmark');
        const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
        await client.sendEmail({
          From: process.env.EMAIL_FROM || `${agentName} via Say Hello Leads <noreply@sayhelloleads.com>`,
          To: lead.email,
          Subject: `Re: ${lead.property}`,
          TextBody: aiReply,
          HtmlBody: `<div style="font-family:sans-serif;max-width:600px;padding:1.5rem;">${aiReply.replace(/\n/g, '<br>')}</div>`,
        });
      } catch (e) { console.error('Email error:', e); }
    }

    // Notify the agent
    if (agent.email) {
      await notifyAgentNewLead(lead, agent.email, agentName).catch(console.error);
    }
  } catch (e) {
    console.error('AI trigger error:', e);
  }
}
