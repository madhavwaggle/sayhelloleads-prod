/**
 * /api/leads
 * GET  — list leads for authenticated agent
 * POST — save lead (must be authenticated; stamps agentId from session)
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';
import { getAllLeads, saveLead, getStats } from '../../../lib/db';
import { getUserById } from '../../../lib/users';
import { notifyAgentNewLead } from '../../../lib/notify';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const agentId = session.user.id;

  if (req.method === 'GET') {
    const { filter, stats } = req.query;
    if (stats === 'true') {
      const s = await getStats(agentId);
      return res.status(200).json(s);
    }
    const leads = await getAllLeads({ agentId, filter: filter || null });
    return res.status(200).json({ leads });
  }

  if (req.method === 'POST') {
    const lead = req.body;
    if (!lead) return res.status(400).json({ error: 'No lead data' });

    const isNew = !lead.id;
    lead.id = lead.id || uuidv4();
    lead.agentId = agentId;
    lead.createdAt = lead.createdAt || new Date().toISOString();
    lead.updatedAt = new Date().toISOString();

    const saved = await saveLead(lead);

    // Notify agent when a scored lead is saved for the first time
    if (isNew && lead.score && process.env.RESEND_API_KEY) {
      const agent = await getUserById(agentId).catch(() => null);
      const agentEmail = agent?.notifyEmail || agent?.email;
      const agentName = agent?.name || session.user.name || 'Agent';
      if (agentEmail) notifyAgentNewLead(saved, agentEmail, agentName).catch(console.error);
    }

    return res.status(200).json({ lead: saved });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
