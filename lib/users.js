/**
 * lib/users.js
 * Agent user accounts stored in Redis.
 * Keys:
 *   user:{id}                → JSON user object
 *   user:email:{email}       → id  (lookup by email)
 *   users:index              → sorted set of all user IDs
 *   verify:{userId}          → { token, expiresAt }  (TTL 7 days)
 *   reset:{userId}           → { token, expiresAt }  (TTL 1 hour)
 */

import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getRedis } from './redis';

const mem = new Map();

// ── CREATE USER ───────────────────────────────────────────────────────────────

export async function createUser({ name, email, password, agencyName = '' }) {
  const store = await getRedis();
  const existing = await getUserByEmail(email);
  if (existing) throw new Error('An account with this email already exists.');

  const id   = uuidv4();
  const hash = await bcrypt.hash(password, 10);
  const slug = (name || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

  const user = {
    id,
    name,
    email:          email.toLowerCase().trim(),
    passwordHash:   hash,
    agencyName,
    inboundEmail:   `${id}@inbound.sayhelloleads.com`,
    emailVerified:  false,   // ← must verify before login
    createdAt:      new Date().toISOString(),
  };

  if (store) {
    // Store user — no TTL. Unverified cleanup handled by verify token TTL awareness.
    await store.set(`user:${id}`, JSON.stringify(user));
    await store.set(`user:email:${email.toLowerCase().trim()}`, id);
    await store.zadd('users:index', { score: Date.now(), member: id });
    if (slug) await store.set(`agent:slug:${slug}`, id);
  } else {
    mem.set(`user:${id}`, user);
    mem.set(`user:email:${email.toLowerCase().trim()}`, id);
  }

  return user;
}

// ── READ ──────────────────────────────────────────────────────────────────────

export async function getUserByEmail(email) {
  if (!email) return null;
  const key   = email.toLowerCase().trim();
  const store = await getRedis();
  if (store) {
    const id = await store.get(`user:email:${key}`);
    if (!id) return null;
    const raw = await store.get(`user:${id}`);
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  }
  const id = mem.get(`user:email:${key}`);
  return id ? mem.get(`user:${id}`) || null : null;
}

export async function getUserById(id) {
  const store = await getRedis();
  if (store) {
    const raw = await store.get(`user:${id}`);
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  }
  return mem.get(`user:${id}`) || null;
}

export async function getUserBySlug(slug) {
  if (!slug) return null;
  const store = await getRedis();
  if (store) {
    const id = await store.get(`agent:slug:${slug}`);
    if (!id) return null;
    return getUserById(id);
  }
  return null;
}

// ── UPDATE ────────────────────────────────────────────────────────────────────

export async function updateUser(id, updates) {
  const existing = await getUserById(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  const store   = await getRedis();
  if (store) {
    await store.set(`user:${id}`, JSON.stringify(updated));
  } else {
    mem.set(`user:${id}`, updated);
  }
  return updated;
}

// ── PASSWORD ──────────────────────────────────────────────────────────────────

export async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

export async function updatePassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  return updateUser(userId, { passwordHash: hash });
}

// ── EMAIL VERIFICATION TOKENS ─────────────────────────────────────────────────
// Token TTL = 7 days in Redis. After expiry the token is gone — user must re-register
// or request a new verification email.

const VERIFY_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function createVerifyToken(userId) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + VERIFY_TTL_SECONDS * 1000;
  const store     = await getRedis();
  const data      = JSON.stringify({ token, expiresAt });

  if (store) {
    await store.set(`verify:${userId}`, data, { ex: VERIFY_TTL_SECONDS });
  } else {
    mem.set(`verify:${userId}`, { token, expiresAt });
  }
  return token;
}

export async function validateVerifyToken(userId, token) {
  const store = await getRedis();
  let record;
  if (store) {
    const raw = await store.get(`verify:${userId}`);
    record    = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  } else {
    record = mem.get(`verify:${userId}`) || null;
  }
  if (!record)               return false;
  if (record.token !== token) return false;
  if (Date.now() > record.expiresAt) return false;
  return true;
}

export async function clearVerifyToken(userId) {
  const store = await getRedis();
  if (store) await store.del(`verify:${userId}`);
  else        mem.delete(`verify:${userId}`);
}

export async function markEmailVerified(userId) {
  await clearVerifyToken(userId);
  return updateUser(userId, { emailVerified: true, verifiedAt: new Date().toISOString() });
}

// ── PASSWORD RESET TOKENS ─────────────────────────────────────────────────────

export async function saveResetToken(userId, token, expiresAt) {
  const store = await getRedis();
  const data  = JSON.stringify({ token, expiresAt });
  if (store) {
    await store.set(`reset:${userId}`, data, { ex: 3600 });
  } else {
    mem.set(`reset:${userId}`, { token, expiresAt });
  }
}

export async function validateResetToken(userId, token) {
  const store = await getRedis();
  let record;
  if (store) {
    const raw = await store.get(`reset:${userId}`);
    record    = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  } else {
    record = mem.get(`reset:${userId}`) || null;
  }
  if (!record)               return false;
  if (record.token !== token) return false;
  if (Date.now() > record.expiresAt) return false;
  return true;
}

export async function clearResetToken(userId) {
  const store = await getRedis();
  if (store) await store.del(`reset:${userId}`);
  else        mem.delete(`reset:${userId}`);
}
