/**
 * /api/upload-photo
 * POST — accepts a base64 image, resizes via canvas on client,
 * stores as dataURL in the agent's profile in Redis.
 * Max 500KB after compression (enforced client-side).
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../lib/auth';
import { updateUserProfile } from '../../lib/db';
//import { updateUserProfile, getUserById } from '../../lib/users';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const { photoUrl } = req.body;
  if (!photoUrl) return res.status(400).json({ error: 'No photo provided' });

  // Validate it's an image data URL
  if (!photoUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Invalid image format' });
  }

  // Rough size check — base64 encoded ~1.33x raw size
  const sizeKB = Math.round((photoUrl.length * 0.75) / 1024);
  if (sizeKB > 600) {
    return res.status(400).json({ error: 'Image too large. Please use a smaller photo.' });
  }

  try {
    const updated = await updateUserProfile(session.user.id, { photoUrl });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ ok: true, photoUrl });
  } catch (e) {
    console.error('Photo upload error:', e);
    return res.status(500).json({ error: 'Failed to save photo' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};
