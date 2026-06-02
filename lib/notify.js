/**
 * lib/notify.js
 * Agent notification emails via Resend (free tier: 3,000/mo, no domain needed).
 * Sign up at resend.com → API Keys → copy key → add RESEND_API_KEY to Vercel env vars.
 */

export async function notifyAgentNewLead(lead, agentEmail, agentName) {
  if (!process.env.RESEND_API_KEY || !agentEmail) return;

  const scoreEmoji = lead.score === 'HOT' ? '🔥' : lead.score === 'WARM' ? '🌤️' : '❄️';
  const subject = lead.score === 'HOT'
    ? `🔥 Hot lead: ${lead.fname} ${lead.lname} — ${lead.property}`
    : `New lead: ${lead.fname} ${lead.lname} from ${lead.source}`;

  const conversationHtml = (lead.messages || []).map(m => `
    <div style="margin-bottom:12px; ${m.role === 'ai' ? '' : 'text-align:right;'}">
      <div style="display:inline-block; max-width:80%; padding:10px 14px; border-radius:12px;
        background:${m.role === 'ai' ? '#f5f3ee' : '#4a6741'}; color:${m.role === 'ai' ? '#0a0a0a' : '#fff'}; font-size:14px; line-height:1.5;">
        <div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; opacity:.7;">
          ${m.role === 'ai' ? 'Say Hello Leads AI' : lead.fname}
        </div>
        ${m.text}
      </div>
    </div>
  `).join('');

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif; max-width:580px; margin:0 auto; color:#0a0a0a;">
      <div style="background:#4a6741; padding:24px 32px; border-radius:12px 12px 0 0;">
        <div style="font-size:22px; font-weight:600; color:#fff; margin-bottom:4px;">Say Hello Leads</div>
        <div style="color:rgba(255,255,255,.8); font-size:14px;">Lead alert for ${agentName}</div>
      </div>

      <div style="background:#fafaf8; border:1px solid #e0ddd8; border-top:none; padding:28px 32px; border-radius:0 0 12px 12px;">
        <div style="font-size:24px; margin-bottom:20px;">${scoreEmoji} ${lead.score || 'New'} Lead</div>

        <table style="width:100%; font-size:14px; margin-bottom:24px; border-collapse:collapse;">
          <tr><td style="padding:6px 0; color:#6b6b6b; width:120px;">Name</td><td style="padding:6px 0; font-weight:500;">${lead.fname} ${lead.lname}</td></tr>
          <tr><td style="padding:6px 0; color:#6b6b6b;">Email</td><td style="padding:6px 0;">${lead.email || '—'}</td></tr>
          <tr><td style="padding:6px 0; color:#6b6b6b;">Phone</td><td style="padding:6px 0;">${lead.phone || '—'}</td></tr>
          <tr><td style="padding:6px 0; color:#6b6b6b;">Property</td><td style="padding:6px 0;">${lead.property}</td></tr>
          <tr><td style="padding:6px 0; color:#6b6b6b;">Source</td><td style="padding:6px 0;">${lead.source}</td></tr>
        </table>

        ${lead.summary ? `
          <div style="background:#e8efe7; border-radius:8px; padding:14px 16px; margin-bottom:24px;">
            <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:#4a6741; margin-bottom:6px;">AI brief</div>
            <div style="font-size:14px; line-height:1.6;">${lead.summary}</div>
          </div>
        ` : ''}

        <div style="margin-bottom:8px;">
          <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:#6b6b6b; margin-bottom:12px;">Conversation</div>
          ${conversationHtml}
        </div>

        <div style="margin-top:28px; padding-top:20px; border-top:1px solid #e0ddd8; text-align:center;">
          <a href="${process.env.NEXTAUTH_URL || 'https://www.sayhelloleads.com'}"
            style="display:inline-block; background:#4a6741; color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
            View in dashboard →
          </a>
        </div>

        <div style="margin-top:20px; font-size:12px; color:#6b6b6b; text-align:center;">
          Say Hello Leads · AI lead response for real estate agents
        </div>
      </div>
    </div>
  `;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Say Hello Leads <onboarding@resend.dev>',
      to: agentEmail,
      subject,
      html,
    });
  } catch (e) {
    console.error('Resend notification error:', e);
  }
}
