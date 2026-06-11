/**
 * /api/leads/send-outreach
 * POST { leadId, message, channel: 'email' | 'sms' | 'both' }
 *
 * Called when agent approves (and optionally edits) the AI draft.
 * Sends the approved message then registers the lead for AI follow-up
 * WITHOUT calling triggerAIResponse (which would send a second message).
 *
 * The lead is now in the conversation loop — when the buyer replies,
 * /api/agent/chat.js handles it exactly like Zillow leads.
 */
import { getServerSession }   from 'next-auth/next';
import { authOptions }        from '../../../lib/auth';
import { getLead, saveLead }  from '../../../lib/db';
import { getUserById }        from '../../../lib/users';
import { getAgentConfig }     from '../../../lib/agentConfig';
import { notifyAgentNewLead } from '../../../lib/notify';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const agentId = session.user.id;
  const { leadId, message, channel } = req.body || {};

  if (!leadId)  return res.status(400).json({ error: 'leadId required' });
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!['email','sms','both'].includes(channel)) return res.status(400).json({ error: 'channel must be email, sms, or both' });

  const lead = await getLead(leadId).catch(() => null);
  if (!lead)               return res.status(404).json({ error: 'Lead not found' });
  if (lead.agentId !== agentId) return res.status(403).json({ error: 'Forbidden' });

  const cfg   = await getAgentConfig(agentId);
  const agent = await getUserById(agentId);
  const agentName  = agent?.name || session.user.name || 'Agent';
  const agentEmail = agent?.notifyEmail || agent?.email || '';

  // Add the approved message as the first AI turn in the conversation.
  // When the buyer replies, /api/agent/chat will continue from here.
  lead.messages = [
    ...(lead.messages || []).filter(m => m.role === 'lead'),
    { role: 'ai', text: message },
  ];
  lead.outreachPending = false;
  lead.outreachSentAt  = new Date().toISOString();
  lead.outreachChannel = channel;
  lead.updatedAt       = new Date().toISOString();

  const errors = [];

  // ── EMAIL to lead ─────────────────────────────────────────────────────────
  if ((channel === 'email' || channel === 'both') && lead.email) {
    try {
      if (cfg.postmarkToken) {
        const { ServerClient } = await import('postmark');
        const client = new ServerClient(cfg.postmarkToken);
        // Extract display name — handles both "Jane Smith" and legacy "Jane Smith <abc@sayhelloleads.com>"
        const displayName = cfg.displayName || agentName;
        const inboundFrom = `${displayName} <${lead.agentId}@inbound.sayhelloleads.com>`;
        await client.sendEmail({
          From:     inboundFrom,
          ReplyTo:  `${lead.agentId}@inbound.sayhelloleads.com`,
          To:       lead.email,
          Subject:  lead.property ? `Re: ${lead.property}` : `Hi ${lead.fname} — following up`,
          TextBody: message,
          HtmlBody: `<div style="font-family:sans-serif;max-width:600px;line-height:1.6;">${message.replace(/\n/g, '<br>')}</div>`,
        });
        lead.emailSent = true;
      } else {
        errors.push('Email not sent — Postmark not configured. Copy the message and send manually.');
      }
    } catch (e) {
      console.error('[send-outreach] email error:', e.message);
      errors.push(`Email failed: ${e.message}`);
    }
  }

  // ── SMS to lead ───────────────────────────────────────────────────────────
  if ((channel === 'sms' || channel === 'both') && lead.phone) {
    try {
      if (cfg.twilioSid && cfg.twilioPhone) {
        const twilio = (await import('twilio')).default;
        await twilio(cfg.twilioSid, cfg.twilioToken).messages.create({
          to:   lead.phone,
          from: cfg.twilioPhone,
          body: message.slice(0, 1600),
        });
        lead.smsSent = true;
      } else {
        errors.push('SMS not sent — Twilio not configured.');
      }
    } catch (e) {
      console.error('[send-outreach] SMS error:', e.message);
      errors.push(`SMS failed: ${e.message}`);
    }
  }

  await saveLead(lead);

  // ── Notify the agent (same as any other new lead) ─────────────────────────
  // This replaces the triggerAIResponse call — we notify the agent without
  // sending a second AI message to the buyer.
  if (agentEmail && process.env.RESEND_API_KEY) {
    notifyAgentNewLead(lead, agentEmail, agentName, process.env.RESEND_API_KEY)
      .catch(e => console.error('[send-outreach] agent notify error:', e.message));
  }

  return res.status(200).json({
    ok: true,
    emailSent: !!lead.emailSent,
    smsSent:   !!lead.smsSent,
    errors,
  });
}
