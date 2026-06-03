/**
 * /api/credentials.js
 * GET  — return agent's saved integration credentials (values masked for display)
 * PUT  — save/update one or more credential fields
 *
 * Fields stored per agent in Redis under key: creds:{agentId}
 * Values are stored in plaintext in Redis (Upstash is encrypted at rest).
 * We mask values on GET so they never travel back to the browser unnecessarily.
 *
 * Supported fields:
 *   anthropicKey, resendKey, twilioSid, twilioToken, twilioPhone,
 *   postmarkToken, emailFrom, webhookSecret
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../lib/auth';

const FIELDS = [
  'anthropicKey', 'resendKey',
  'twilioSid', 'twilioToken', 'twilioPhone',
  'postmarkToken', 'emailFrom',
  'webhookSecret',
];

async function getRedis() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  }
  return null;
}

// In-memory fallback for local dev
const memCreds = new Map();

export async function getAgentCredentials(agentId) {
  const store = await getRedis();
  if (store) {
    const raw = await store.get(`creds:${agentId}`);
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
  }
  return memCreds.get(`creds:${agentId}`) || {};
}

async function saveAgentCredentials(agentId, creds) {
  const store = await getRedis();
  if (store) {
    await store.set(`creds:${agentId}`, JSON.stringify(creds));
  } else {
    memCreds.set(`creds:${agentId}`, creds);
  }
}

function maskValue(val) {
  if (!val || val.length < 6) return val ? '••••' : '';
  return val.slice(0, 4) + '••••••••' + val.slice(-3);
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const agentId = session.user.id;

  if (req.method === 'GET') {
    const creds = await getAgentCredentials(agentId);
    // Return masked values + a boolean "isSet" for each field
    const masked = {};
    for (const f of FIELDS) {
      masked[f] = {
        isSet: !!(creds[f] && creds[f].length > 0),
        masked: maskValue(creds[f]),
      };
    }
    return res.status(200).json({ credentials: masked });
  }

  if (req.method === 'PUT') {
    const updates = req.body || {};
    const existing = await getAgentCredentials(agentId);
    const merged = { ...existing };
    for (const f of FIELDS) {
      if (updates[f] !== undefined) {
        // Empty string = clear the field
        merged[f] = updates[f].trim();
      }
    }
    await saveAgentCredentials(agentId, merged);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
