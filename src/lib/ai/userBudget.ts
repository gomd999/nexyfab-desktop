/**
 * Per-user daily cost gate.
 *
 * Sums `costCents` from `nf_usage_events` (metric='prompt_call') over the last
 * 24h for one userId. If the total exceeds `COST_BUDGET_USD_PER_USER_DAILY`,
 * the gate denies further AI calls until the rolling 24h window drops back
 * below the limit.
 *
 * Why per-user:
 *   - The global cron (`prompt-cost-budget`) only alerts after damage is done.
 *   - A single runaway client (stuck retry loop, broken UI) can consume
 *     significant tokens before any human sees the alert.
 *   - This gate lets us cap individual exposure while keeping the system
 *     available for everyone else.
 *
 * Design choices:
 *   - Read-only summation per call. No write-side throttle/race protection
 *     beyond the underlying `nf_usage_events` insert from telemetry; under
 *     extreme bursts a user can briefly overshoot. Acceptable: the next call
 *     will see the new total.
 *   - Cache backends:
 *      * In-process Map (always — fastest, ~1ms reads)
 *      * Redis (when REDIS_URL set) — shared across instances so a hot user
 *        on instance A doesn't trigger a DB scan on every other replica too.
 *     Both layers have TTL so one fresh DB read amortizes across both.
 *   - Limit unset → gate disabled (returns ok). Same pattern as quota slots.
 */

import { getDbAdapter } from '@/lib/db-adapter';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60_000;
const REDIS_KEY_PREFIX = 'nf:user-budget:';

interface CachedUsage {
  cents: number;
  /** ms timestamp of the oldest billed event still inside the rolling 24h window. */
  oldestEventMs: number | null;
  expiresAt: number;
}

const cache = new Map<string, CachedUsage>();

// ─── Redis backend (optional) ───────────────────────────────────────────────
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
    console.warn('[userBudget] Redis init failed, using in-memory cache:', e);
    return null;
  }
}

async function readFromRedis(userId: string): Promise<CachedUsage | null> {
  const r = await getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(REDIS_KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUsage;
    if (typeof parsed.cents !== 'number') return null;
    return parsed;
  } catch (e) {
    console.warn('[userBudget] redis read failed:', e);
    return null;
  }
}

async function writeToRedis(userId: string, value: CachedUsage): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(
      REDIS_KEY_PREFIX + userId,
      JSON.stringify(value),
      'EX',
      Math.max(1, Math.ceil(CACHE_TTL_MS / 1000)),
    );
  } catch (e) {
    console.warn('[userBudget] redis write failed:', e);
  }
}

interface UsageRow { metadata: string | null; created_at: number }

interface CallMeta { costCents?: number }

async function loadDailyCost(userId: string): Promise<{ cents: number; oldestEventMs: number | null }> {
  const db = getDbAdapter();
  const since = Date.now() - WINDOW_MS;
  const rows = await db
    .queryAll<UsageRow>(
      `SELECT metadata, created_at FROM nf_usage_events WHERE user_id = ? AND metric = 'prompt_call' AND created_at > ? LIMIT 5000`,
      userId,
      since,
    )
    .catch(() => [] as UsageRow[]);

  let total = 0;
  let oldest: number | null = null;
  for (const r of rows) {
    if (!r.metadata) continue;
    let m: CallMeta;
    try { m = JSON.parse(r.metadata) as CallMeta; } catch { continue; }
    if (typeof m.costCents === 'number' && m.costCents > 0) {
      total += m.costCents;
      // Track the earliest billed event so we can compute when the rolling
      // window will drop them and free budget headroom.
      if (oldest === null || r.created_at < oldest) oldest = r.created_at;
    }
  }
  return { cents: total, oldestEventMs: oldest };
}

export interface UserBudgetCheck {
  ok: boolean;
  /** Cents spent in the rolling 24h window. */
  usedCents: number;
  /** Configured daily limit in USD, or null when no limit is set. */
  limitUsd: number | null;
  /**
   * When enough cost will roll out of the window to bring the user back
   * under-limit. Approximated as `oldestEventMs + 24h` — by then the oldest
   * billed event drops out of the window.
   *
   * Only meaningful when ok=false. Null when budget unset or no events.
   */
  resetAtMs: number | null;
  /** 0..1 — fraction of the limit consumed. 0 when no limit. */
  fraction: number;
  /** True when usage ≥ BUDGET_WARN_AT (default 0.8) but below limit. */
  approaching: boolean;
  /** Where this came from — useful for tests/logs. */
  source: 'cache' | 'db' | 'no-limit';
}

/**
 * Returns ok=false when the user has exceeded the configured per-user daily
 * budget. With no limit configured, returns ok=true unconditionally.
 */
export async function checkUserBudget(userId: string): Promise<UserBudgetCheck> {
  const limitUsd = parseFloat(process.env.COST_BUDGET_USD_PER_USER_DAILY ?? '');
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) {
    return {
      ok: true, usedCents: 0, limitUsd: null, resetAtMs: null,
      fraction: 0, approaching: false, source: 'no-limit',
    };
  }
  const limitCents = limitUsd * 100;
  const warnAt = (() => {
    const v = parseFloat(process.env.BUDGET_WARN_AT ?? '0.8');
    return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.8;
  })();

  const buildResult = (cents: number, oldestEventMs: number | null, source: 'cache' | 'db'): UserBudgetCheck => {
    const fraction = limitCents > 0 ? cents / limitCents : 0;
    const ok = cents <= limitCents;
    return {
      ok,
      usedCents: cents,
      limitUsd,
      resetAtMs: oldestEventMs !== null ? oldestEventMs + WINDOW_MS : null,
      fraction: Math.round(Math.min(1, fraction) * 1000) / 1000,
      approaching: ok && fraction >= warnAt,
      source,
    };
  };

  const now = Date.now();

  // 1. Hot path: in-process cache (~1ms).
  const local = cache.get(userId);
  if (local && local.expiresAt > now) {
    return buildResult(local.cents, local.oldestEventMs, 'cache');
  }

  // 2. Warm path: shared Redis cache when configured. A peer instance may
  //    have just queried for this user — we get to skip the DB hit.
  const remote = await readFromRedis(userId);
  if (remote && remote.expiresAt > now) {
    cache.set(userId, remote);  // populate local for subsequent calls
    return buildResult(remote.cents, remote.oldestEventMs, 'cache');
  }

  // 3. Cold path: DB scan. Populate both caches.
  const { cents, oldestEventMs } = await loadDailyCost(userId);
  const entry: CachedUsage = { cents, oldestEventMs, expiresAt: now + CACHE_TTL_MS };
  cache.set(userId, entry);
  // Fire-and-forget: never block the response on a cache write.
  void writeToRedis(userId, entry);
  return buildResult(cents, oldestEventMs, 'db');
}

/** Test-only: clear the in-process cache. */
export function _clearUserBudgetCacheForTests(): void {
  cache.clear();
}
