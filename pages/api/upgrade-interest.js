/**
 * /api/upgrade-interest
 * POST — records that an agent is interested in a Pro subscription.
 *         Stores in Redis and notifies the owner via email.
 */
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../lib/auth';
import { getRedis } from '../../lib/redis';
import { getUserById } from '../../lib/users';

const OWNER_EMAIL = 'madhav@sayhelloleads.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const agentId = session.user.id;

  try {
    const agent = await getUserById(agentId);
    if (!agent) return res.status(404).json({ error: 'User not found' });

    const store = await getRedis();
    const alreadyRegistered = store
      ? await store.get(`upgrade:interest:${agentId}`).catch(() => null)
      : null;

    // Always upsert — let them click again without error
    const record = {
      agentId,
      name:      agent.name || 'Unknown',
      email:     agent.email || agent.notifyEmail || 'Unknown',
      agencyName: agent.agencyName || '',
      createdAt: agent.createdAt || '',
      recordedAt: new Date().toISOString(),
    };

    if (store) {
      await store.set(`upgrade:interest:${agentId}`, JSON.stringify(record));
    }

    // Only email owner the first time
    if (!alreadyRegistered) {
      await notifyOwnerUpgradeInterest(record);
    }

    return res.status(200).json({ ok: true, alreadyRegistered: !!alreadyRegistered });
  } catch (e) {
    console.error('upgrade-interest error:', e);
    return res.status(500).json({ error: 'Failed to record interest' });
  }
}

async function notifyOwnerUpgradeInterest(agent) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping upgrade interest email');
    return;
  }

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;color:#0a0a0a;">
      <div style="background:#4a7c59;padding:24px 32px;border-radius:12px 12px 0 0;">
        <div style="font-size:20px;font-weight:700;color:#fff;">💰 Pro Upgrade Interest</div>
        <div style="color:rgba(255,255,255,.8);font-size:14px;margin-top:4px;">An agent wants to upgrade — reach out!</div>
      </div>
      <div style="background:#fafaf8;border:1px solid #e0ddd8;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:7px 0;color:#6b6b6b;width:130px;">Name</td><td style="padding:7px 0;font-weight:600;">${agent.name}</td></tr>
          <tr><td style="padding:7px 0;color:#6b6b6b;">Email</td><td style="padding:7px 0;"><a href="mailto:${agent.email}" style="color:#4a7c59;">${agent.email}</a></td></tr>
          ${agent.agencyName ? `<tr><td style="padding:7px 0;color:#6b6b6b;">Agency</td><td style="padding:7px 0;">${agent.agencyName}</td></tr>` : ''}
          ${agent.createdAt  ? `<tr><td style="padding:7px 0;color:#6b6b6b;">Member since</td><td style="padding:7px 0;">${new Date(agent.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</td></tr>` : ''}
          <tr><td style="padding:7px 0;color:#6b6b6b;">Interested at</td><td style="padding:7px 0;">${new Date(agent.recordedAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</td></tr>
        </table>
        <div style="margin-top:24px;padding:14px 16px;background:#eef4f0;border-radius:8px;font-size:13px;color:#4a7c59;font-weight:500;">
          💡 They clicked "I'm Interested" after hitting their 100 AI response cap. Strike while the iron is hot!
        </div>
      </div>
    </div>`;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from:    `Say HelloLeads <${process.env.RESEND_FROM || 'onboarding@resend.dev'}>`,
      to:      OWNER_EMAIL,
      subject: `💰 Pro interest: ${agent.name} (${agent.email})`,
      html,
    });
  } catch (e) {
    console.error('Upgrade interest owner email error:', e);
  }
}
