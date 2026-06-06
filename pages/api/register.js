/**
 * /api/register
 * Creates account → sends verification email.
 * Account is unusable until email is verified.
 */

import { createUser, createVerifyToken } from '../../lib/users';
import { sendVerificationEmail } from '../../lib/email';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, password, agencyName } = req.body || {};

  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });

  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    const user  = await createUser({ name, email, password, agencyName });
    const token = await createVerifyToken(user.id);
    const link  = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${token}&id=${user.id}`;

    // Send async — don't block the response
    sendVerificationEmail({ email: user.email, name: user.name, link }).catch(console.error);

    return res.status(201).json({ ok: true, userId: user.id });
  } catch (err) {
    // Duplicate email
    if (err.message?.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
