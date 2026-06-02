/**
 * /api/inbound-email
 * Postmark inbound webhook.
 * Set your Postmark inbound webhook URL to: https://YOUR-APP.vercel.app/api/inbound-email
 * Forward Zillow / Homes.com / Realtor.com lead notification emails to your Postmark inbound address.
 */

import { saveLead } from '../../lib/db';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const payload = req.body;
  
  // Postmark sends parsed email data
  const fromEmail = payload?.From || payload?.FromFull?.Email || '';
  const subject = payload?.Subject || '';
  const textBody = payload?.TextBody || payload?.HtmlBody || '';

  // Parse lead info from Zillow/Homes.com email format
  const lead = parseLeadEmail(fromEmail, subject, textBody);
  
  if (!lead.email && !lead.phone) {
    console.log('Could not parse lead from email:', subject);
    return res.status(200).json({ message: 'Ignored - not a lead email' });
  }

  lead.id = uuidv4();
  lead.createdAt = new Date().toISOString();
  lead.updatedAt = new Date().toISOString();

  await saveLead(lead);

  // Trigger AI response
  triggerAIFirstResponse(lead).catch(console.error);

  return res.status(200).json({ id: lead.id, message: 'Lead captured' });
}

function parseLeadEmail(fromEmail, subject, body) {
  const lead = {
    fname: '',
    lname: '',
    email: '',
    phone: '',
    property: '',
    source: 'Email',
    messages: [],
    score: null,
    summary: '',
    smsSent: false,
  };

  // Detect source
  if (fromEmail.includes('zillow') || subject.toLowerCase().includes('zillow')) lead.source = 'Zillow';
  else if (fromEmail.includes('homes.com') || subject.toLowerCase().includes('homes.com')) lead.source = 'Homes.com';
  else if (fromEmail.includes('realtor.com') || subject.toLowerCase().includes('realtor')) lead.source = 'Realtor.com';

  // Parse common patterns from lead notification emails
  // Zillow format: "New Lead: John Smith is interested in 123 Main St"
  const nameMatch = body.match(/(?:Name|Buyer|Lead):\s*([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
  if (nameMatch) {
    lead.fname = nameMatch[1];
    lead.lname = nameMatch[2];
  }

  // Email in body
  const emailMatch = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) lead.email = emailMatch[0];

  // Phone
  const phoneMatch = body.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/);
  if (phoneMatch) lead.phone = phoneMatch[0];

  // Property
  const propMatch = body.match(/(?:property|address|home|listing)[:.]?\s*([^\n]{10,80})/i);
  if (propMatch) lead.property = propMatch[1].trim();

  // Message — use body trimmed
  lead.messages = [{ role: 'lead', text: body.slice(0, 500) }];

  return lead;
}

async function triggerAIFirstResponse(lead) {
  const systemPrompt = `You are a Say Hello Leads AI real estate lead assistant for ${process.env.AGENT_NAME || 'a real estate agent'}.
A new lead came from ${lead.source}. Respond warmly, reference what you know, ask one qualifying question. Under 4 sentences.`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: lead.messages[0].text }],
    });

    const aiReply = resp.content?.[0]?.text || '';
    if (aiReply) {
      lead.messages.push({ role: 'ai', text: aiReply });
      lead.updatedAt = new Date().toISOString();
      await saveLead(lead);

      // Send email reply if we have their email
      if (lead.email && process.env.POSTMARK_SERVER_TOKEN) {
        const postmark = await import('postmark');
        const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
        await client.sendEmail({
          From: process.env.EMAIL_FROM || 'Say Hello Leads <noreply@sayhelloleads.com>',
          To: lead.email,
          Subject: lead.property ? `Re: ${lead.property}` : 'Thanks for your inquiry!',
          TextBody: aiReply,
          HtmlBody: `<div style="font-family:sans-serif;max-width:600px;padding:1.5rem;">${aiReply.replace(/\n/g, '<br>')}</div>`,
        });
      }

      // Send SMS if phone available
      if (lead.phone && process.env.TWILIO_ACCOUNT_SID) {
        const twilio = (await import('twilio')).default;
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
          to: lead.phone,
          from: process.env.TWILIO_PHONE_NUMBER,
          body: aiReply.slice(0, 1600),
        });
        lead.smsSent = true;
        await saveLead(lead);
      }
    }
  } catch (e) {
    console.error('AI first response error:', e);
  }
}

export const config = {
  api: { bodyParser: { type: 'application/json' } },
};
