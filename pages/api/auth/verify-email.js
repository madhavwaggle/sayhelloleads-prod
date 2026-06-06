/**
 * /api/auth/verify-email
 * GET ?token=&id=  — validates token, marks verified, sends welcome email
 * POST { email }   — resend verification email
 */

import {
  getUserById,
  getUserByEmail,
  validateVerifyToken,
  markEmailVerified,
  createVerifyToken,
} from '../../../lib/users';
import { sendVerificationEmail, sendWelcomeEmail } from '../../../lib/email';

export default async function handler(req, res) {

  // ── CONFIRM ───────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { token, id } = req.query;
    if (!token || !id) return res.redirect('/verify-email?error=invalid');

    const valid = await validateVerifyToken(id, token).catch(() => false);
    if (!valid)         return res.redirect('/verify-email?error=expired');

    const user = await markEmailVerified(id);
    
    // Send welcome email now that they've confirmed
    if (user) {
      const slug = (user.name || '').toLowerCase().trim()
        .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
      sendWelcomeEmail({ email: user.email, name: user.name, agentSlug: slug }).catch(console.error);
    }

    return res.redirect('/verify-email?success=1');
  }

  // ── RESEND ────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required.' });

    const user = await getUserByEmail(email).catch(() => null);

    if (user && !user.emailVerified) {
      const token = await createVerifyToken(user.id);
      const link  = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${token}&id=${user.id}`;
      await sendVerificationEmail({ email: user.email, name: user.name, link });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
