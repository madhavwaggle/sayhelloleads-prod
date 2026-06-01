/**
 * lib/db.js
 * Persistence layer using Vercel KV (Redis).
 * Falls back to in-memory store for local dev without KV configured.
 */

let kv = null;

// Lazy-load Vercel KV only when env vars are present
async function getKV() {
  if (kv) return kv;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    //const { kv: vercelKv } = await import('@vercel/kv');
    //kv = vercelKv;
    const { Redis } = await import('@upstash/redis');         // ← changed
    kv = new Redis({                                           // ← changed
      url:   process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    return kv;
  }
  return null;
}

// In-memory fallback for local dev
const memStore = new Map();

// ─── LEADS ────────────────────────────────────────────────────────────────────

export async function saveLead(lead) {
  const store = await getKV();
  const id = lead.id;
  
  if (store) {
    await store.set(`lead:${id}`, JSON.stringify(lead));
    // Keep a sorted set of lead IDs by timestamp for listing
    await store.zadd('leads:index', { score: Date.now(), member: id });
  } else {
    memStore.set(`lead:${id}`, lead);
    if (!memStore.has('leads:index')) memStore.set('leads:index', []);
    const idx = memStore.get('leads:index');
    if (!idx.includes(id)) idx.unshift(id);
  }
  return lead;
}

export async function getLead(id) {
  const store = await getKV();
  if (store) {
    const raw = await store.get(`lead:${id}`);
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  }
  return memStore.get(`lead:${id}`) || null;
}

export async function getAllLeads({ limit = 100, filter = null } = {}) {
  const store = await getKV();
  let ids = [];

  if (store) {
    // Get IDs sorted by recency (highest score = most recent)
    ids = await store.zrange('leads:index', 0, limit - 1, { rev: true });
    if (!ids || ids.length === 0) return [];
    
    const leads = await Promise.all(
      ids.map(async (id) => {
        const raw = await store.get(`lead:${id}`);
        return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      })
    );
    const valid = leads.filter(Boolean);
    return filter ? valid.filter(l => l.score === filter) : valid;
  } else {
    const idx = memStore.get('leads:index') || [];
    const leads = idx.map(id => memStore.get(`lead:${id}`)).filter(Boolean);
    return filter ? leads.filter(l => l.score === filter) : leads;
  }
}

export async function updateLead(id, updates) {
  const existing = await getLead(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  return saveLead(updated);
}

export async function deleteLead(id) {
  const store = await getKV();
  if (store) {
    await store.del(`lead:${id}`);
    await store.zrem('leads:index', id);
  } else {
    memStore.delete(`lead:${id}`);
    const idx = memStore.get('leads:index') || [];
    memStore.set('leads:index', idx.filter(i => i !== id));
  }
}

// ─── STATS ────────────────────────────────────────────────────────────────────

export async function getStats() {
  const leads = await getAllLeads({ limit: 1000 });
  return {
    total: leads.length,
    hot: leads.filter(l => l.score === 'HOT').length,
    warm: leads.filter(l => l.score === 'WARM').length,
    cold: leads.filter(l => l.score === 'COLD').length,
    responseRate: leads.length > 0 ? '100%' : '—',
    avgResponseTime: '<60s',
  };
}
