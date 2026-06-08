/**
 * /api/ai-usage
 * GET — returns this agent's AI response count for the current month and the cap.
 */
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../lib/auth';
import { getRedis } from '../../lib/redis';

export const AI_MONTHLY_CAP = 300;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const agentId = session.user.id;
  const month   = new Date().toISOString().slice(0, 7); // e.g. "2026-06"

  try {
    const store = await getRedis();
    let used = 0;
    if (store) {
      const raw = await store.get(`ai:usage:${agentId}:${month}`).catch(() => null);
      used = parseInt(raw || '0', 10);
    }
    return res.status(200).json({ used, cap: AI_MONTHLY_CAP, month });
  } catch (e) {
    console.error('ai-usage error:', e);
    return res.status(500).json({ error: 'Failed to fetch usage' });
  }
}
