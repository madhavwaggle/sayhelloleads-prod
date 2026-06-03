/**
 * pages/api/agent/[slug].js
 *
 * GET  /api/agent/:slug  → public agent profile
 * POST /api/agent/:slug  → buyer inquiry → save lead → AI response + scoring
 *
 * Key fix: triggerAIResponse is awaited with a 25s timeout BEFORE we respond,
 * so Vercel doesn't kill the function before the AI call completes.
 * The buyer sees a ~2-3s delay on submit which is fine for a form.
 */

import { saveLead } from '../../../lib/db';
import { getUserById } from '../../../lib/users';
import { notifyAgentNewLead } from '../../../lib/notify';
import { getAgentConfig } from '../../../lib/agentConfig';
import { buildFirstResponsePrompt, buildScoringPrompt, parseScoreResponse } from '../../../lib/aiPrompts';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';

// ─── SLUG HELPERS ─────────────────────────────────────────────────────────────

function nameToSlug(name) {
  return (name || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
}

export async function getAgentBySlug(slug) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Fast path: slug index
    const agentId = await redis.get(`agent:slug:${slug}`);
    if (agentId) {
      const raw = await redis.get(`user:${agentId}`);
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }

    // Slow path: scan all users once, then cache
    const ids = await redis.zrange('users:index', 0, -1);
    for (const id of ids) {
      const raw = await redis.get(`user:${id}`);
      const user = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      if (user && nameToSlug(user.name) === slug) {
        await redis.set(`agent:slug:${slug}`, id);
        return user;
      }
    }
    return null;
  }

  // Local dev in-memory fallback
  try {
    const { _memMap } = await import('../../../lib/users');
    if (_memMap) {
      for (const [key, val] of _memMap.entries()) {
        if (key.startsWith('user:') && !key.includes(':email:') && nameToSlug(val?.name) === slug) return val;
      }
    }
  } catch {}
  return null;
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const agent = await getAgentBySlug(slug).catch(() => null);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    return res.status(200).json({ id: agent.id, name: agent.name, agencyName: agent.agencyName || '', slug });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
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
      messages: [{ role: 'lead', text: message || `I'm interested in ${property || 'a property'}.` }],
      score: null,
      summary: '',
      smsSent: false,
      publicSlug: slug,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save the lead first so it appears immediately
    await saveLead(lead);

    // Run AI + scoring with a 25s timeout — await it before responding
    // so Vercel doesn't kill the function mid-flight
    try {
      await Promise.race([
        runAI(lead, agent),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 25000)),
      ]);
    } catch (e) {
      // AI timed out or errored — lead is still saved, just without score
      console.error('AI response error:', e.message);
    }

    // Return the AI's first reply so the chat page shows it instantly
    const firstReply = lead.messages.find(m => m.role === 'ai')?.text || null;
    return res.status(200).json({ id, message: 'Inquiry sent!', firstReply });
  }

  return res.status(405).end();
}

// ─── AI RESPONSE + SCORING ───────────────────────────────────────────────────

async function runAI(lead, agent) {
  const cfg = await getAgentConfig(agent?.id || lead.agentId);
  const agentName  = agent?.name || 'your agent';
  const agencyName = agent?.agencyName || '';

  if (!cfg.anthropicKey) {
    console.warn('No Anthropic API key — skipping AI for lead', lead.id);
    lead.score = 'WARM';
    lead.summary = `${lead.fname} inquired about ${lead.property}. Follow up to schedule a showing.`;
    lead.nextAction = 'Call to introduce yourself and schedule a showing.';
    await saveLead(lead);
    return;
  }

  const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });

  // ── 1. Human-sounding first response ─────────────────────────────────────
  const replyPrompt = buildFirstResponsePrompt({ agentName, agencyName, lead });
  const replyResp = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 250,
    system: replyPrompt.system,
    messages: replyPrompt.messages,
  });

  const aiReply = replyResp.content?.[0]?.text?.trim() || '';
  if (aiReply) {
    lead.messages.push({ role: 'ai', text: aiReply });
    lead.updatedAt = new Date().toISOString();
  }

  // ── 2. Structured scoring with signals ───────────────────────────────────
  const scorePrompt = buildScoringPrompt({ lead });
  const scoreResp = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: scorePrompt.system,
    messages: scorePrompt.messages,
  });

  const scored = parseScoreResponse(scoreResp.content?.[0]?.text);
  lead.score      = scored.score;
  lead.confidence = scored.confidence;
  lead.signals    = scored.signals;   // { timeline, budget, preApproved, alsoSelling, motivation, urgencyLevel }
  lead.summary    = scored.summary || `${lead.fname} inquired about ${lead.property}.`;
  lead.nextAction = scored.nextAction || 'Follow up to schedule a showing.';

  // ── 3. Save with full scoring data ───────────────────────────────────────
  await saveLead(lead);

  // ── 4. SMS lead if Twilio connected ──────────────────────────────────────
  if (aiReply && lead.phone && cfg.twilioSid && cfg.twilioPhone) {
    try {
      const twilio = (await import('twilio')).default;
      await twilio(cfg.twilioSid, cfg.twilioToken).messages.create({
        to: lead.phone, from: cfg.twilioPhone, body: aiReply.slice(0, 1600),
      });
      lead.smsSent = true;
      await saveLead(lead);
    } catch (e) { console.error('SMS error:', e.message); }
  }

  // ── 5. Email buyer if Postmark connected ─────────────────────────────────
  if (aiReply && lead.email && cfg.postmarkToken) {
    try {
      const { ServerClient } = await import('postmark');
      await new ServerClient(cfg.postmarkToken).sendEmail({
        From:     cfg.emailFrom || `${agentName} via Say HelloLeads <noreply@sayhelloleads.com>`,
        To:       lead.email,
        Subject:  `Re: ${lead.property}`,
        TextBody: aiReply,
        HtmlBody: `<div style="font-family:sans-serif;max-width:600px;padding:1.5rem;line-height:1.6;">${aiReply.replace(/\n/g, '<br>')}</div>`,
      });
    } catch (e) { console.error('Postmark error:', e.message); }
  }

  // ── 6. Notify agent ───────────────────────────────────────────────────────
  const agentEmail = agent?.notifyEmail || agent?.email;
  if (agentEmail) {
    await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
      .catch(e => console.error('Notify error:', e.message));
  }
}

export const config = {
  maxDuration: 30, // Tell Vercel this function can run up to 30s
};
