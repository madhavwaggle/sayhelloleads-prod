/**
 * /api/new-lead
 * Public endpoint — receives leads from website forms / integrations.
 * Requires x-agent-id header (or agentId in body) to route to correct agent.
 * Optional: x-webhook-secret for security.
 */

import { saveLead, getAllLeads } from '../../lib/db';
import { getUserById } from '../../lib/users';
import { notifyAgentNewLead } from '../../lib/notify';
import { getAgentConfig } from '../../lib/agentConfig';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';

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
  if (!cfg.anthropicKey) { console.warn('No Anthropic key for agent', lead.agentId); return; }

  const agentName = agent?.name || 'your agent';
  const agencyName = agent?.agencyName || '';
  const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });

  const systemPrompt = `You are a Say HelloLeads AI real estate lead assistant working on behalf of ${agentName}${agencyName ? ` at ${agencyName}` : ''}.
Lead: ${lead.fname} ${lead.lname} | Email: ${lead.email} | Phone: ${lead.phone || 'not provided'} | Property: ${lead.property} | Source: ${lead.source}
Respond warmly, reference the property, ask one qualifying question (timeline, budget, or pre-approval). Under 4 sentences. Sign off as "Say HelloLeads AI, on behalf of ${agentName}".`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: lead.messages[0].text }],
    });
    const aiReply = resp.content?.[0]?.text || '';
    if (!aiReply) return;

    lead.messages.push({ role: 'ai', text: aiReply });
    lead.updatedAt = new Date().toISOString();

    // Score
    const scoreResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 150,
      system: 'Lead scoring assistant. Respond ONLY with valid JSON, no markdown.',
      messages: [{ role: 'user', content: `Score this lead. HOT=ready <30 days+budget. WARM=interested. COLD=browsing.\nLead: ${lead.fname} ${lead.lname}\nMessage: ${lead.messages[0].text}\nProperty: ${lead.property}\nRespond: {"score":"HOT","summary":"2-sentence agent briefing."}` }],
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

    // SMS
    if (lead.phone && cfg.twilioSid) {
      try {
        const twilio = (await import('twilio')).default;
        const client = twilio(cfg.twilioSid, cfg.twilioToken);
        await client.messages.create({ to: lead.phone, from: cfg.twilioPhone, body: aiReply.slice(0, 1600) });
        lead.smsSent = true;
        await saveLead(lead);
      } catch (e) { console.error('SMS error:', e); }
    }

    // Email lead
    if (lead.email && cfg.postmarkToken) {
      try {
        const postmark = await import('postmark');
        const client = new postmark.ServerClient(cfg.postmarkToken);
        await client.sendEmail({
          From: cfg.emailFrom, To: lead.email,
          Subject: `Re: ${lead.property}`,
          TextBody: aiReply,
          HtmlBody: `<div style="font-family:sans-serif;max-width:600px;padding:1.5rem;">${aiReply.replace(/\n/g, '<br>')}</div>`,
        });
      } catch (e) { console.error('Email error:', e); }
    }

    // Notify agent
    const agentEmail = agent?.notifyEmail || agent?.email;
    if (agentEmail) {
      await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey).catch(console.error);
    }
  } catch (e) {
    console.error('AI trigger error:', e);
  }
}

export const config = { maxDuration: 30 };
