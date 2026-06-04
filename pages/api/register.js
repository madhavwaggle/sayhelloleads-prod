/**
 * /api/register
 * POST — create a new agent account
 */

import { createUser } from '../../lib/users';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, password, agencyName } = req.body || {};

  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });

  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    const user = await createUser({ name, email, password, agencyName });
    // Send welcome email async — don't block the response
    sendWelcomeEmail(user).catch(console.error);
    return res.status(201).json({ ok: true, userId: user.id });
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
}


async function sendWelcomeEmail(user) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY not set — welcome email skipped'); return; }

  const firstName  = (user.name || 'there').split(' ')[0];
  const dashUrl    = process.env.NEXTAUTH_URL || 'https://www.sayhelloleads.com';
  const agentSlug  = (user.name || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-');
  const agentUrl   = `${dashUrl}/agent/${agentSlug}`;

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;">
      <div style="background:#4a7c59;padding:22px 30px;border-radius:12px 12px 0 0;">
        <div style="font-size:20px;font-weight:600;color:#fff;">Say HelloLeads</div>
        <div style="color:rgba(255,255,255,.75);font-size:13px;margin-top:2px;">Welcome aboard 🎉</div>
      </div>
      <div style="background:#fafaf8;border:1px solid #e0ddd8;border-top:none;padding:28px 30px;border-radius:0 0 12px 12px;">
        <h2 style="font-size:20px;margin-bottom:10px;">Hey ${firstName}, you're all set!</h2>
        <p style="font-size:14px;color:#555;line-height:1.7;margin-bottom:20px;">
          Your Say HelloLeads account is ready. Here's everything you need to get started:
        </p>
        <table style="width:100%;margin-bottom:24px;font-size:14px;border-collapse:collapse;">
          <tr>
            <td style="padding:10px 14px;background:#eef4f0;border-radius:8px 8px 0 0;font-weight:600;">
              🔗 Your public lead page
            </td>
          </tr>
          <tr>
            <td style="padding:10px 14px;background:#fff;border:1px solid #e0ddd8;border-top:none;border-radius:0 0 8px 8px;word-break:break-all;">
              <a href="${agentUrl}" style="color:#4a7c59;">${agentUrl}</a>
            </td>
          </tr>
        </table>
        <p style="font-size:14px;color:#555;line-height:1.7;margin-bottom:20px;">
          Share this link on Zillow, your website, business cards, or anywhere buyers can reach you.
          Every inquiry goes straight to your dashboard and the AI responds within 60 seconds.
        </p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="${dashUrl}" style="display:inline-block;background:#4a7c59;color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Go to my dashboard →
          </a>
        </div>
        <div style="background:#fff8ed;border:1px solid #fde9b4;border-radius:8px;padding:14px 16px;font-size:13px;color:#7a5c00;line-height:1.6;margin-bottom:20px;">
          <strong>Quick start:</strong> Head to the Dashboard → Setup tab to add your Twilio number for SMS replies, or try the demo right away to see the AI in action.
        </div>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e0ddd8;font-size:12px;color:#aaa;text-align:center;">
          Say HelloLeads · Real estate lead response · <a href="${dashUrl}" style="color:#aaa;">sayhelloleads.com</a>
        </div>
      </div>
    </div>`;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(key);
    await resend.emails.send({
      from: 'Say HelloLeads <onboarding@sayhelloleads.com>',
      to: user.email,
      subject: `Welcome to Say HelloLeads, ${firstName}! 🎉`,
      html,
    });
  } catch (e) {
    console.error('Welcome email error:', e);
  }
}
