/**
 * /api/waitlist
 * POST { plan, name, email, agencyName? }
 * Stores the waitlist entry in Redis and emails madhav@sayhelloleads.com
 */
import { getRedis } from '../../lib/redis';

const OWNER_EMAIL = 'madhav@sayhelloleads.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { plan, name, email, agencyName } = req.body || {};
  if (!plan || !email) return res.status(400).json({ error: 'plan and email are required' });

  const entry = {
    plan,
    name:       name       || '',
    email:      email.toLowerCase().trim(),
    agencyName: agencyName || '',
    createdAt:  new Date().toISOString(),
  };

  try {
    const store = await getRedis();
    if (store) {
      const key = `waitlist:${plan}:${entry.email}`;
      const exists = await store.get(key).catch(() => null);
      await store.set(key, JSON.stringify(entry));
      // Keep a list so we can enumerate all waitlist entries later
      await store.lpush(`waitlist:list:${plan}`, entry.email).catch(() => {});
      if (!exists) await notifyOwner(entry);
    } else {
      await notifyOwner(entry);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('waitlist error:', e);
    return res.status(500).json({ error: 'Failed to save' });
  }
}

async function notifyOwner(entry) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const planLabel = entry.plan.charAt(0).toUpperCase() + entry.plan.slice(1);

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;color:#0a0a0a;">
      <div style="background:#4a6741;padding:24px 32px;border-radius:12px 12px 0 0;">
        <div style="font-size:20px;font-weight:700;color:#fff;">🎯 New Waitlist Signup</div>
        <div style="color:rgba(255,255,255,.8);font-size:14px;margin-top:4px;">${planLabel} plan — Say HelloLeads</div>
      </div>
      <div style="background:#fafaf8;border:1px solid #e0ddd8;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:7px 0;color:#6b6b6b;width:130px;">Name</td><td style="padding:7px 0;font-weight:600;">${entry.name || '—'}</td></tr>
          <tr><td style="padding:7px 0;color:#6b6b6b;">Email</td><td style="padding:7px 0;"><a href="mailto:${entry.email}" style="color:#4a6741;">${entry.email}</a></td></tr>
          ${entry.agencyName ? `<tr><td style="padding:7px 0;color:#6b6b6b;">Agency</td><td style="padding:7px 0;">${entry.agencyName}</td></tr>` : ''}
          <tr><td style="padding:7px 0;color:#6b6b6b;">Plan</td><td style="padding:7px 0;font-weight:600;">${planLabel}</td></tr>
          <tr><td style="padding:7px 0;color:#6b6b6b;">Signed up</td><td style="padding:7px 0;">${new Date(entry.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</td></tr>
        </table>
        <div style="margin-top:20px;padding:12px 16px;background:#eef4f0;border-radius:8px;font-size:13px;color:#4a6741;">
          💡 Reach out personally — they're interested in ${planLabel}.
        </div>
      </div>
    </div>`;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from:    `Say HelloLeads <${process.env.RESEND_FROM || 'onboarding@resend.dev'}>`,
      to:      OWNER_EMAIL,
      subject: `🎯 Waitlist: ${entry.name || entry.email} → ${planLabel} plan`,
      html,
    });
  } catch (e) {
    console.error('waitlist notify error:', e);
  }
}
