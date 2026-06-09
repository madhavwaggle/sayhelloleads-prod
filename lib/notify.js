/**
 * lib/notify.js
 * Agent notifications — email (Resend) + SMS (Twilio platform number).
 *
 * Both fire for every new lead.
 * SMS comes from Say HelloLeads's own toll-free number (TWILIO_NOTIFY_FROM env var)
 * NOT the agent's own Twilio number. Inbound replies to that number are ignored.
 */

const OWNER_EMAIL = 'madhav@sayhelloleads.com';
const AI_MONTHLY_CAP = 100;

/**
 * Notify the owner when an agent exceeds their monthly AI cap.
 * Fires once per agent per month (caller is responsible for deduplication via Redis).
 */
export async function notifyOwnerCapExceeded(agent) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;color:#0a0a0a;">
      <div style="background:#c0392b;padding:24px 32px;border-radius:12px 12px 0 0;">
        <div style="font-size:20px;font-weight:700;color:#fff;">🚨 Agent Hit AI Cap</div>
        <div style="color:rgba(255,255,255,.8);font-size:14px;margin-top:4px;">Monthly limit of ${AI_MONTHLY_CAP} AI responses exceeded</div>
      </div>
      <div style="background:#fafaf8;border:1px solid #e0ddd8;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:7px 0;color:#6b6b6b;width:130px;">Name</td><td style="padding:7px 0;font-weight:600;">${agent.name || 'Unknown'}</td></tr>
          <tr><td style="padding:7px 0;color:#6b6b6b;">Email</td><td style="padding:7px 0;"><a href="mailto:${agent.email}" style="color:#4a7c59;">${agent.email || '—'}</a></td></tr>
          ${agent.agencyName ? `<tr><td style="padding:7px 0;color:#6b6b6b;">Agency</td><td style="padding:7px 0;">${agent.agencyName}</td></tr>` : ''}
          <tr><td style="padding:7px 0;color:#6b6b6b;">Agent ID</td><td style="padding:7px 0;font-family:monospace;font-size:12px;">${agent.id || '—'}</td></tr>
          <tr><td style="padding:7px 0;color:#6b6b6b;">Member since</td><td style="padding:7px 0;">${agent.createdAt ? new Date(agent.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '—'}</td></tr>
          <tr><td style="padding:7px 0;color:#6b6b6b;">Cap hit at</td><td style="padding:7px 0;">${new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</td></tr>
        </table>
        <div style="margin-top:24px;padding:14px 16px;background:#fdf0ee;border-radius:8px;font-size:13px;color:#c0392b;font-weight:500;">
          New leads are still being captured and agents are still notified — AI replies and scoring are paused until next month or until they upgrade.
        </div>
      </div>
    </div>`;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const fromAddress = process.env.RESEND_FROM || 'onboarding@resend.dev';
    await resend.emails.send({
      from:    `Say HelloLeads <${fromAddress}>`,
      to:      OWNER_EMAIL,
      subject: `🚨 AI cap hit: ${agent.name || 'Unknown agent'} (${agent.email || agent.id})`,
      html,
    });
  } catch (e) {
    console.error('Owner cap alert error:', e);
  }
}

export async function notifyAgentNewLead(lead, agentEmail, agentName, apiKey) {
  // Run email + SMS in parallel — neither blocks the other
  await Promise.allSettled([
    notifyByEmail(lead, agentEmail, agentName, apiKey),
    notifyBySMS(lead, agentName),
  ]);
}

// ─── EMAIL ───────────────────────────────────────────────────────────────────

async function notifyByEmail(lead, agentEmail, agentName, apiKey) {
  const key = apiKey || process.env.RESEND_API_KEY;
  if (!agentEmail) return;
  if (!key) {
    console.warn('RESEND_API_KEY not set — skipping agent notification email for', agentEmail);
    return;
  }

  const scoreEmoji = lead.score === 'HOT' ? '🔥' : lead.score === 'WARM' ? '🌤️' : '❄️';
  const subject = lead.score === 'HOT'
    ? `🔥 Hot lead: ${lead.fname} ${lead.lname} — ${lead.property}`
    : `New lead: ${lead.fname} ${lead.lname} from ${lead.source}`;

  const conversationHtml = (lead.messages || []).map(m => `
    <div style="margin-bottom:12px;${m.role === 'ai' ? '' : 'text-align:right;'}">
      <div style="display:inline-block;max-width:80%;padding:10px 14px;border-radius:12px;
        background:${m.role === 'ai' ? '#f5f3ee' : '#4a7c59'};color:${m.role === 'ai' ? '#0a0a0a' : '#fff'};font-size:14px;line-height:1.5;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;opacity:.7;">
          ${m.role === 'ai' ? agentName : (lead.fname || 'Lead')}
        </div>
        ${m.text}
      </div>
    </div>
  `).join('');

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:580px;margin:0 auto;color:#0a0a0a;">
      <div style="background:#4a7c59;padding:24px 32px;border-radius:12px 12px 0 0;">
        ${lead.agentPhotoUrl ? `<img src="${lead.agentPhotoUrl}" alt="${agentName}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.4);flex-shrink:0;" />` : ''}
        <div>
          <div style="font-size:22px;font-weight:600;color:#fff;margin-bottom:4px;">Say HelloLeads</div>
          <div style="color:rgba(255,255,255,.8);font-size:14px;">Lead alert for ${agentName}</div>
        </div>
      </div>
      <div style="background:#fafaf8;border:1px solid #e0ddd8;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
        <div style="font-size:24px;margin-bottom:20px;">${scoreEmoji} ${lead.score || 'New'} Lead</div>
        <table style="width:100%;font-size:14px;margin-bottom:24px;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b6b6b;width:120px;">Name</td><td style="padding:6px 0;font-weight:500;">${lead.fname} ${lead.lname}</td></tr>
          <tr><td style="padding:6px 0;color:#6b6b6b;">Email</td><td style="padding:6px 0;">${lead.email || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b6b6b;">Phone</td><td style="padding:6px 0;">${lead.phone || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b6b6b;">Property</td><td style="padding:6px 0;">${lead.property || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b6b6b;">Source</td><td style="padding:6px 0;">${lead.source || '—'}</td></tr>
        </table>
        ${lead.summary ? `
          <div style="background:#eef4f0;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
            <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#4a7c59;margin-bottom:6px;">AI brief</div>
            <div style="font-size:14px;line-height:1.6;">${lead.summary}</div>
          </div>` : ''}
        <div style="margin-bottom:8px;">
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b6b6b;margin-bottom:12px;">Conversation</div>
          ${conversationHtml}
        </div>
        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e0ddd8;text-align:center;">
          <a href="${process.env.NEXTAUTH_URL || 'https://www.sayhelloleads.com'}"
            style="display:inline-block;background:#4a7c59;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            View in dashboard →
          </a>
        </div>
        <div style="margin-top:20px;font-size:12px;color:#6b6b6b;text-align:center;">
          Say HelloLeads · Real estate lead notifications
        </div>
      </div>
    </div>`;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(key);
    const fromAddress = process.env.RESEND_FROM || 'onboarding@resend.dev';
    await resend.emails.send({
      from: `Say HelloLeads <${fromAddress}>`,
      to: agentEmail, subject, html,
    });
  } catch (e) {
    console.error('Resend notification error:', e);
  }
}

// ─── SMS ─────────────────────────────────────────────────────────────────────

async function notifyBySMS(lead, agentName) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_NOTIFY_FROM;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('TWILIO_NOTIFY_FROM/TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set — skipping agent SMS');
    return;
  }

  const toNumber = lead.agentNotifyPhone;
  if (!toNumber) return;

  const scoreEmoji = lead.score === 'HOT' ? '🔥' : lead.score === 'WARM' ? '🌤️' : '❄️';
  const name  = [lead.fname, lead.lname].filter(Boolean).join(' ') || 'Unknown';
  const phone = lead.phone     ? `\nPhone: ${lead.phone}`     : '';
  const email = lead.email     ? `\nEmail: ${lead.email}`     : '';
  const next  = lead.nextAction ? `\n\nNext: ${lead.nextAction}` : '';

  const body = `${scoreEmoji} ${lead.score} lead via Say HelloLeads\nName: ${name}${phone}${email}\nProperty: ${lead.property || '—'}\nSource: ${lead.source || '—'}${next}\n\nView: ${process.env.NEXTAUTH_URL || 'https://www.sayhelloleads.com'}`.slice(0, 1600);

  try {
    const twilio = (await import('twilio')).default;
    await twilio(accountSid, authToken).messages.create({
      to: toNumber, from: fromNumber, body,
    });
  } catch (e) {
    console.error('Agent SMS notify error:', e.message);
  }
}
