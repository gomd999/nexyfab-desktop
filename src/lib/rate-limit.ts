import type { Redis } from 'ioredis';
import IORedis from 'ioredis';

// ─── Production Redis warning ──────────────────────────────────────────────
if (
  process.env.NODE_ENV === 'production' &&
  !process.env.REDIS_URL &&
  typeof process !== 'undefined'
) {
  console.warn(
    '[rate-limit] WARNING: REDIS_URL is not set. Using in-memory rate limiting.\n' +
    '  This does NOT work across multiple server instances.\n' +
    '  Set REDIS_URL (e.g. Upstash Redis) for production deployments.',
  );
}

// ─── Redis Client ──────────────────────────────────────────────────────────

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redisClient = new IORedis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
    });
    redisClient!.connect().catch(() => {
      console.warn('[rate-limit] Redis connection failed, falling back to in-memory');
      redisClient = null;
    });
    return redisClient;
  } catch {
    return null;
  }
}

// ─── In-Memory Store ───────────────────────────────────────────────────────

const counts = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 50_000;

// 5분마다 만료된 엔트리 정리
const CLEANUP_INTERVAL_MS = 5 * 60_000;
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of counts.entries()) {
      if (now > entry.resetAt) counts.delete(key);
    }
  }, CLEANUP_INTERVAL_MS).unref?.();
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ─── Background Redis Sync ─────────────────────────────────────────────────

function syncToRedis(key: string, windowMs: number): void {
  const redis = getRedis();
  if (!redis) return;
  const redisKey = `rl:${key}`;
  redis.incr(redisKey).then((count: number) => {
    if (count === 1) redis.pexpire(redisKey, windowMs);
    // Update in-memory with Redis count if higher
    const entry = counts.get(key);
    if (entry && count > entry.count) {
      entry.count = count;
    }
  }).catch(() => {}); // ignore Redis errors
}

// ─── In-Memory Rate Limiter (synchronous) ──────────────────────────────────

function rateLimitMemory(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const entry = counts.get(key);

  if (!entry || now > entry.resetAt) {
    if (!entry && counts.size >= MAX_KEYS) {
      // Evict oldest 10% of entries (lowest resetAt values)
      const sorted = [...counts.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (let i = 0; i < 5000; i++) {
        counts.delete(sorted[i][0]);
      }
    }
    counts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

// ─── Main Export (synchronous, with background Redis sync) ─────────────────

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const result = rateLimitMemory(key, maxRequests, windowMs);
  // Fire-and-forget Redis sync for cross-instance coordination
  syncToRedis(key, windowMs);
  return result;
}

// ─── Async Rate Limiter (uses Redis when available) ────────────────────────

export async function rateLimitAsync(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return rateLimitMemory(key, maxRequests, windowMs);

  try {
    const redisKey = `rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, windowMs);
    }
    const ttl = await redis.pttl(redisKey);
    const resetAt = Date.now() + Math.max(ttl, 0);

    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetAt,
    };
  } catch {
    // Redis error — fallback to in-memory
    return rateLimitMemory(key, maxRequests, windowMs);
  }
}

/** @deprecated use rateLimit() and check .allowed */
export function rateLimitCheck(key: string, maxRequests: number, windowMs: number): boolean {
  return rateLimit(key, maxRequests, windowMs).allowed;
}

export function rateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
    'Retry-After': String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
}
