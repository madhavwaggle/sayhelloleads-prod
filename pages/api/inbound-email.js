/**
 * /api/inbound-email
 * Postmark inbound webhook — receives forwarded lead emails from Zillow,
 * Homes.com, Realtor.com etc. and creates a lead for the correct agent.
 *
 * Setup: In Postmark, set inbound webhook to:
 *   https://www.sayhelloleads.com/api/inbound-email
 * Each agent gets a unique inbound address like:
 *   <agentId>@inbound.postmarkapp.com
 * They forward their Zillow/Homes.com notification emails to that address.
 */

import { saveLead } from '../../lib/db';
import { getUserById } from '../../lib/users';
import { getAgentConfig } from '../../lib/agentConfig';
import { notifyAgentNewLead } from '../../lib/notify';
import { triggerAIResponse } from './new-lead';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const payload = req.body;
  const toEmail   = payload?.To || payload?.ToFull?.[0]?.Email || '';
  const fromEmail = payload?.From || payload?.FromFull?.Email || '';
  const subject   = payload?.Subject || '';
  const textBody  = payload?.TextBody || payload?.StrippedTextReply || payload?.HtmlBody || '';

  // Derive agentId from the "To" address — agents use <agentId>@inbound.postmarkapp.com
  const agentId = extractAgentId(toEmail);
  if (!agentId) {
    console.warn('inbound-email: could not resolve agentId from', toEmail);
    return res.status(200).json({ message: 'ignored — no agent found' });
  }

  const agent = await getUserById(agentId).catch(() => null);
  const cfg   = await getAgentConfig(agentId);

  const lead = parseLeadEmail(fromEmail, subject, textBody, agentId);

  if (!lead.email && !lead.phone) {
    console.log('inbound-email: no contact info parsed from:', subject);
    return res.status(200).json({ message: 'ignored — not a lead email' });
  }

  lead.id        = uuidv4();
  lead.createdAt = new Date().toISOString();
  lead.updatedAt = new Date().toISOString();

  await saveLead(lead);

  // Await AI + scoring so notification includes score (25s timeout)
  try {
    await Promise.race([
      triggerAIResponse(lead, agent, cfg),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000)),
    ]);
  } catch (e) { console.error('inbound-email AI error:', e.message); }

  // Notify agent — fires after scoring so email shows HOT/WARM/COLD
  const agentEmail = agent?.notifyEmail || agent?.email;
  if (agentEmail) {
    const agentName = agent?.name || 'your agent';
    await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
      .catch(e => console.error('inbound-email notify error:', e.message));
  }

  return res.status(200).json({ id: lead.id, message: 'Lead captured' });
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function extractAgentId(toAddress) {
  // Format: <agentId>@inbound.postmarkapp.com  OR  inbound+<agentId>@sayhelloleads.com
  const m1 = toAddress.match(/^([a-f0-9-]{36})@/i);
  if (m1) return m1[1];
  const m2 = toAddress.match(/inbound\+([^@]+)@/i);
  if (m2) return m2[1];
  return null;
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
  if (combined.includes('zillow'))       lead.source = 'Zillow';
  else if (combined.includes('homes.com'))   lead.source = 'Homes.com';
  else if (combined.includes('realtor.com')) lead.source = 'Realtor.com';
  else if (combined.includes('redfin'))      lead.source = 'Redfin';
  else if (combined.includes('trulia'))      lead.source = 'Trulia';

  // ── Name ────────────────────────────────────────────────────────────────
  // Zillow:    "John Smith is interested in…"
  // Homes.com: "Name: John Smith"
  const namePatterns = [
    /(?:Name|Buyer|Lead|Contact|From)[:\s]+([A-Z][a-z]+)\s+([A-Z][a-z]+)/,
    /^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(?:is interested|has inquired|sent you)/m,
    /New lead from\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i,
  ];
  for (const p of namePatterns) {
    const m = body.match(p) || subject.match(p);
    if (m) { lead.fname = m[1]; lead.lname = m[2]; break; }
  }

  // ── Email ────────────────────────────────────────────────────────────────
  const emailMatch = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  // Exclude notification sender addresses (zillow.com, homes.com etc.)
  if (emailMatch) {
    const skip = ['zillow','homes.com','realtor.com','redfin','trulia','postmark','sayhelloleads'];
    if (!skip.some(s => emailMatch[0].includes(s))) lead.email = emailMatch[0];
  }

  // ── Phone ────────────────────────────────────────────────────────────────
  const phoneMatch = body.match(/(?:\+?1[\s\-.]?)?\(?(\d{3})\)?[\s\-.]?(\d{3})[\s\-.]?(\d{4})/);
  if (phoneMatch) lead.phone = phoneMatch[0].replace(/\s/g,'');

  // ── Property ─────────────────────────────────────────────────────────────
  const propPatterns = [
    /(?:property|address|listing|home)[:\s]+([^\n]{10,100})/i,
    /interested in\s+([^\n]{10,100})/i,
    /inquired about\s+([^\n]{10,100})/i,
    /(\d+\s+[A-Z][a-z]+\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl)[^\n]{0,60})/,
  ];
  for (const p of propPatterns) {
    const m = body.match(p) || subject.match(p);
    if (m) { lead.property = m[1].trim().slice(0, 120); break; }
  }
  if (!lead.property) lead.property = subject.replace(/^(fwd|re|fw):\s*/i,'').slice(0,80);

  // ── Message ──────────────────────────────────────────────────────────────
  lead.messages = [{ role: 'lead', text: body.slice(0, 600) }];

  return lead;
}

export const config = {
  api: { bodyParser: { type: 'application/json' } },
};
