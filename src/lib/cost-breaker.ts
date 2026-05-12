/**
 * cost-breaker — circuit breaker for AI spend.
 *
 * When daily/hourly cost exceeds the operator-set budget (admin settings
 * key `budget.daily_usd_cap` / `budget.hourly_usd_cap`), the breaker
 * trips: subsequent AI calls throw immediately instead of accumulating
 * more cost. Operator can clear it manually from /admin/api-health.
 *
 * Storage: a single nf_admin_settings row per scope holds the
 * `until` timestamp. The auto-cron sets it; the manual UI can also set/clear.
 *
 * Why a separate module: the AI provider chain needs a synchronous
 * `isBreakerActive()` check before each call. Settings cache makes that
 * cheap (in-memory) but the API surface is dedicated so the responsibility
 * is obvious — provider chain doesn't have to know about budget logic.
 */

import { getSetting, setSetting, deleteSetting } from './admin-settings';

export type BreakerScope = 'hourly' | 'daily' | 'manual';

const KEY: Record<BreakerScope, string> = {
  hourly: 'breaker.ai.hourly_until',
  daily:  'breaker.ai.daily_until',
  manual: 'breaker.ai.manual_until',
};

const REASON_KEY: Record<BreakerScope, string> = {
  hourly: 'breaker.ai.hourly_reason',
  daily:  'breaker.ai.daily_reason',
  manual: 'breaker.ai.manual_reason',
};

/**
 * Returns the active breaker (if any). Reads all three scopes and returns
 * the most-restrictive one (longest `until`). Caller can throw or just
 * report — the AI chain throws, the UI just shows status.
 */
export async function getActiveBreaker(): Promise<{
  scope: BreakerScope; untilMs: number; reason: string;
} | null> {
  const now = Date.now();
  const scopes: BreakerScope[] = ['hourly', 'daily', 'manual'];
  let active: { scope: BreakerScope; untilMs: number; reason: string } | null = null;
  for (const s of scopes) {
    const untilStr = await getSetting(KEY[s]);
    const until = untilStr ? Number(untilStr) : 0;
    if (until > now) {
      const reason = (await getSetting(REASON_KEY[s])) ?? '';
      if (!active || until > active.untilMs) {
        active = { scope: s, untilMs: until, reason };
      }
    }
  }
  return active;
}

/**
 * Trip the breaker. `untilMs` defaults to 1 hour from now for hourly,
 * end-of-day for daily, +1h for manual. Idempotent — repeated trips
 * extend (never shrink) the existing window.
 */
export async function tripBreaker(
  scope: BreakerScope,
  reason: string,
  adminUserId: string,
  untilMs?: number,
): Promise<{ untilMs: number }> {
  const now = Date.now();
  const defaultUntil = scope === 'daily'
    ? now + 24 * 60 * 60 * 1000
    : now + 60 * 60 * 1000;
  const candidate = untilMs ?? defaultUntil;

  const currentStr = await getSetting(KEY[scope]);
  const current = currentStr ? Number(currentStr) : 0;
  const finalUntil = Math.max(current, candidate);

  await setSetting(KEY[scope], String(finalUntil), {
    scope: 'budget',
    description: `AI cost breaker (${scope}) active until`,
    updatedBy: adminUserId,
    encrypt: false,
  });
  await setSetting(REASON_KEY[scope], reason.slice(0, 200), {
    scope: 'budget',
    description: `Reason for ${scope} breaker`,
    updatedBy: adminUserId,
    encrypt: false,
  });
  return { untilMs: finalUntil };
}

/** Clear a breaker scope. Use to manually un-trip after fixing the cause. */
export async function clearBreaker(scope: BreakerScope): Promise<void> {
  await deleteSetting(KEY[scope]);
  await deleteSetting(REASON_KEY[scope]);
}
