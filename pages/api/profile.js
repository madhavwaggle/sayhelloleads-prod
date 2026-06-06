/**
 * /api/profile
 * GET  — return current agent profile
 * PUT  — update name, agencyName, notifyEmail, phone, agentNotifyPhone,
 *         zillowDone, homesDone, realtorDone, redfinDone
 */
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../lib/auth';
import { getUserById } from '../../lib/users';
import { updateUserProfile } from '../../lib/db';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const userId = session.user.id;

  if (req.method === 'GET') {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { passwordHash, ...safe } = user;
    return res.status(200).json({ profile: safe });
  }

  if (req.method === 'PUT') {
    const { name, agencyName, notifyEmail, phone, agentNotifyPhone, zillowDone, homesDone, realtorDone, redfinDone, facebookDone } = req.body || {};
    const allowed = {};
    if (name)                    allowed.name             = name.trim();
    if (agencyName !== undefined) allowed.agencyName      = agencyName.trim();
    if (notifyEmail !== undefined) allowed.notifyEmail    = notifyEmail.trim();
    if (phone !== undefined)      allowed.phone            = phone.trim();
    if (agentNotifyPhone !== undefined) allowed.agentNotifyPhone = agentNotifyPhone.trim();
    if (zillowDone  !== undefined) allowed.zillowDone    = !!zillowDone;
    if (homesDone   !== undefined) allowed.homesDone      = !!homesDone;
    if (realtorDone !== undefined) allowed.realtorDone   = !!realtorDone;
    if (redfinDone  !== undefined) allowed.redfinDone    = !!redfinDone;
    if (facebookDone !== undefined) allowed.facebookDone  = !!facebookDone;

    const updated = await updateUserProfile(userId, allowed);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    const { passwordHash, ...safe } = updated;
    return res.status(200).json({ profile: safe });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
