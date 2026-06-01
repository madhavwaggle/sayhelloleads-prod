/**
 * /api/leads
 * GET  — list leads for the authenticated agent
 * POST — save a new or updated lead (auto-tagged with agentId)
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';
import { getAllLeads, saveLead, getStats } from '../../../lib/db';
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

    lead.id      = lead.id || uuidv4();
    lead.agentId = agentId;          // always stamp with the logged-in agent
    lead.createdAt = lead.createdAt || new Date().toISOString();
    lead.updatedAt = new Date().toISOString();

    const saved = await saveLead(lead);
    return res.status(200).json({ lead: saved });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}


/**
 * /api/leads
 * GET  — list all leads (with optional ?filter=HOT|WARM|COLD)
 * POST — save a new or updated lead
 */

/**import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth';
import { getAllLeads, saveLead, getStats } from '../../../lib/db';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { filter, stats } = req.query;
    
    if (stats === 'true') {
      const s = await getStats();
      return res.status(200).json(s);
    }

    const leads = await getAllLeads({ filter: filter || null });
    return res.status(200).json({ leads });
  }

  if (req.method === 'POST') {
    const lead = req.body;
    if (!lead) return res.status(400).json({ error: 'No lead data' });

    // Ensure ID and timestamps
    lead.id = lead.id || uuidv4();
    lead.createdAt = lead.createdAt || new Date().toISOString();
    lead.updatedAt = new Date().toISOString();

    const saved = await saveLead(lead);
    return res.status(200).json({ lead: saved });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
**/
