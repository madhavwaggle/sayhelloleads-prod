/**
 * lib/redis.js — shared Upstash Redis singleton.
 * Import getRedis() from here instead of duplicating it in every module.
 */

let redis = null;

export async function getRedis() {
  if (redis) return redis;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const { Redis } = await import('@upstash/redis');
    redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    return redis;
  }
  return null;
}
