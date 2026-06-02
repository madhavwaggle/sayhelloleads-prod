/**
 * /api/inbound-sms
 * Twilio webhook — receives SMS, finds/creates lead, AI responds.
 * Set as Twilio number Incoming Message Webhook URL.
 * Since one Twilio number serves all agents during testing,
 * we route by DEFAULT_AGENT_ID env var. Add per-number routing later.
 */

import { saveLead, getAllLeads } from '../../lib/db';
import { getUserById } from '../../lib/users';
import { notifyAgentNewLead } from '../../lib/notify';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const from = req.body?.From || '';
  const body = req.body?.Body || '';
  if (!from || !body) return res.status(400).send('Missing From or Body');

  // Route to agent — for MVP use DEFAULT_AGENT_ID env var
  const agentId = process.env.DEFAULT_AGENT_ID || '';
  const agent = agentId ? await getUserById(agentId).catch(() => null) : null;
  const agentName = agent?.name || process.env.AGENT_NAME || 'your agent';

  // Find existing lead for this phone number (scoped to agent)
  const allLeads = agentId ? await getAllLeads({ agentId, limit: 500 }) : [];
  let lead = allLeads.find(l => l.phone === from);
  const isNewLead = !lead;

  if (!lead) {
    lead = {
      id: uuidv4(),
      agentId,
      fname: 'SMS',
      lname: 'Lead',
      email: '',
      phone: from,
      property: 'SMS inquiry',
      source: 'SMS / Text',
      messages: [],
      score: null,
      summary: '',
      smsSent: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  lead.messages.push({ role: 'lead', text: body });
  lead.updatedAt = new Date().toISOString();
  await saveLead(lead);

  const history = lead.messages.map(m => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.text,
  }));

  const systemPrompt = `You are ReplyFast, an AI real estate lead assistant for ${agentName}. You're responding via SMS.

Rules:
- Keep responses SHORT (1-3 sentences) — this is SMS
- Be warm, helpful, qualify the lead (timeline, budget, pre-approval)
- If they mention a property, get their timeline and budget
- Only sign off as "- ReplyFast AI" on the very first message`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: systemPrompt,
      messages: history,
    });

    const aiReply = resp.content?.[0]?.text || "Thanks for reaching out! What property are you interested in?";

    lead.messages.push({ role: 'ai', text: aiReply });
    lead.updatedAt = new Date().toISOString();

    // Score new leads after first exchange
    if (isNewLead && lead.messages.length >= 2) {
      try {
        const scoreResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 150,
          system: 'Lead scoring assistant. Respond ONLY with valid JSON, no markdown.',
          messages: [{ role: 'user', content: `Score: HOT/WARM/COLD. Lead: ${lead.fname} from SMS. Message: "${body}"\n\nRespond: {"score":"WARM","summary":"Brief agent note."}` }],
        });
        const parsed = JSON.parse(scoreResp.content?.[0]?.text?.replace(/```json|```/g, '').trim());
        lead.score = parsed.score || 'WARM';
        lead.summary = parsed.summary || `SMS lead from ${from}. Follow up to qualify.`;
      } catch { lead.score = 'WARM'; }

      // Notify agent of new SMS lead
      const agentEmail = agent?.email || process.env.AGENT_EMAIL;
      if (agentEmail) {
        notifyAgentNewLead(lead, agentEmail, agentName).catch(console.error);
      }
    }

    await saveLead(lead);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(aiReply.slice(0, 1600))}</Message>
</Response>`;

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml);
  } catch (e) {
    console.error('Inbound SMS error:', e);
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks for reaching out! We'll get back to you shortly.</Message></Response>`);
  }
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export const config = {
  api: { bodyParser: { type: 'application/x-www-form-urlencoded' } },
};
