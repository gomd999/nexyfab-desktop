/**
 * Lightweight cache for NL→intent results.
 *
 * Same prompt → same JSON intent → same SCAD → same STL, so caching the AI
 * response saves a paid token round-trip and keeps latency under 50ms for
 * repeat queries (e.g. "M8 hex bolt" hit thousands of times across users).
 *
 * Backing store priority:
 *   1. Redis (REDIS_URL set) — shared across instances, 24h TTL
 *   2. In-process LRU Map  — single-instance fallback, ~500 entries max
 *
 * Privacy: the cache key is a sha256 of the *prompt only*, no userId — so
 * two users with the same prompt share a cache slot. This is fine because
 * the response is purely deterministic geometry; nothing user-specific leaks.
 */

import { createHash } from 'node:crypto';

export interface CachedIntent {
  intent: unknown;
  scad: string;
  warnings: string[];
  summary?: string;
  createdAt: number;
}

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const LRU_MAX_SIZE = 500;

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt.trim()).digest('hex');
}

function redisKey(hash: string): string {
  return `nf:intent-cache:${hash}`;
}

// ─── Redis (optional) ────────────────────────────────────────────────────────
// Lazy-load ioredis so dev environments without REDIS_URL don't pay startup cost.

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
};

let redisClient: RedisClient | null = null;
let redisInitialized = false;

async function getRedis(): Promise<RedisClient | null> {
  if (redisInitialized) return redisClient;
  redisInitialized = true;
  if (!process.env.REDIS_URL?.trim()) return null;
  try {
    const { default: IORedis } = await import('ioredis');
    redisClient = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      connectTimeout: 5000,
    }) as unknown as RedisClient;
    return redisClient;
  } catch (e) {
    console.warn('[intent-cache] Redis init failed, using in-memory LRU:', e);
    return null;
  }
}

// ─── In-memory LRU fallback ──────────────────────────────────────────────────

const lru = new Map<string, { value: CachedIntent; expiresAt: number }>();

function lruGet(hash: string): CachedIntent | null {
  const entry = lru.get(hash);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    lru.delete(hash);
    return null;
  }
  // Touch — move to end so least-recently-used can be evicted on overflow.
  lru.delete(hash);
  lru.set(hash, entry);
  return entry.value;
}

function lruSet(hash: string, value: CachedIntent): void {
  if (lru.size >= LRU_MAX_SIZE) {
    // Evict the oldest entry (Map preserves insertion order).
    const first = lru.keys().next().value;
    if (first !== undefined) lru.delete(first);
  }
  lru.set(hash, { value, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getCachedIntent(prompt: string): Promise<CachedIntent | null> {
  const hash = hashPrompt(prompt);
  const r = await getRedis();
  if (r) {
    try {
      const raw = await r.get(redisKey(hash));
      if (raw) return JSON.parse(raw) as CachedIntent;
    } catch (e) {
      console.warn('[intent-cache] redis get failed:', e);
      // fall through to LRU
    }
  }
  return lruGet(hash);
}

export async function setCachedIntent(prompt: string, value: Omit<CachedIntent, 'createdAt'>): Promise<void> {
  const hash = hashPrompt(prompt);
  const enriched: CachedIntent = { ...value, createdAt: Date.now() };
  const r = await getRedis();
  if (r) {
    try {
      await r.set(redisKey(hash), JSON.stringify(enriched), 'EX', CACHE_TTL_SECONDS);
      return;
    } catch (e) {
      console.warn('[intent-cache] redis set failed:', e);
      // fall through to LRU so the call isn't wasted
    }
  }
  lruSet(hash, enriched);
}

/** Test-only: reset the in-memory LRU. Does not touch Redis. */
export function _resetIntentCacheForTests(): void {
  lru.clear();
}
