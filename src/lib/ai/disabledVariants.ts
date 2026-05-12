/**
 * Server-side disabled variant overrides.
 *
 * The A/B variant rollout config in env (`AI_PROMPT_VARIANTS`) is the steady
 * state. Burn-in or admin can mark a specific variant id as DISABLED, which
 * forces `getPromptVariant` to return the baseline regardless of rollout
 * fraction. This is the kill-switch for a regressing variant.
 *
 * Storage: `nf_disabled_variants` (lazily created). Cached in-process for
 * 30 seconds so the lookup doesn't add round-trip latency to every prompt
 * call. After admin disable/enable, callers should pass `force=true` to
 * bypass the cache for the next read.
 */

import { getDbAdapter } from '@/lib/db-adapter';

const CACHE_TTL_MS = 30_000;

let cache: { ids: Set<string>; expiresAt: number } | null = null;

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_disabled_variants (
      variant_id TEXT NOT NULL PRIMARY KEY,
      reason     TEXT,
      disabled_at INTEGER NOT NULL,
      disabled_by TEXT
    );
  `).catch(() => {});
  tableEnsured = true;
}

/** Read the active disabled-variant set, with 30s in-process cache. */
export async function loadDisabledVariants(force = false): Promise<Set<string>> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.ids;
  await ensureTable();
  const db = getDbAdapter();
  const rows = await db
    .queryAll<{ variant_id: string }>('SELECT variant_id FROM nf_disabled_variants')
    .catch(() => [] as { variant_id: string }[]);
  const ids = new Set(rows.map(r => r.variant_id));
  cache = { ids, expiresAt: now + CACHE_TTL_MS };
  return ids;
}

/**
 * Synchronous fallback for hot paths: returns the cached set if still valid,
 * otherwise an empty set (callers MUST also schedule an async refresh). Used
 * by getPromptVariant which is not async-friendly per existing API.
 */
export function disabledVariantsCached(): Set<string> {
  if (cache && cache.expiresAt > Date.now()) return cache.ids;
  return new Set();
}

/** Schedule a background refresh of the cache. Fire-and-forget. */
export function scheduleDisabledVariantsRefresh(): void {
  // Tail latency only; if the call takes 100ms we do not block any caller.
  void loadDisabledVariants(true).catch(() => { /* swallow */ });
}

export interface DisableEntry {
  variantId: string;
  reason?: string;
  disabledBy?: string;
}

export async function disableVariant(entry: DisableEntry): Promise<void> {
  await ensureTable();
  const db = getDbAdapter();
  await db.execute(
    `INSERT OR REPLACE INTO nf_disabled_variants (variant_id, reason, disabled_at, disabled_by) VALUES (?, ?, ?, ?)`,
    entry.variantId,
    entry.reason ?? null,
    Date.now(),
    entry.disabledBy ?? null,
  );
  // Invalidate cache so subsequent reads see the change.
  cache = null;
}

export async function enableVariant(variantId: string): Promise<void> {
  await ensureTable();
  const db = getDbAdapter();
  await db.execute(`DELETE FROM nf_disabled_variants WHERE variant_id = ?`, variantId);
  cache = null;
}

export async function listDisabledVariants(): Promise<Array<{
  variantId: string;
  reason: string | null;
  disabledAt: number;
  disabledBy: string | null;
}>> {
  await ensureTable();
  const db = getDbAdapter();
  const rows = await db
    .queryAll<{ variant_id: string; reason: string | null; disabled_at: number; disabled_by: string | null }>(
      'SELECT variant_id, reason, disabled_at, disabled_by FROM nf_disabled_variants ORDER BY disabled_at DESC',
    )
    .catch(() => [] as { variant_id: string; reason: string | null; disabled_at: number; disabled_by: string | null }[]);
  return rows.map(r => ({
    variantId: r.variant_id,
    reason: r.reason,
    disabledAt: r.disabled_at,
    disabledBy: r.disabled_by,
  }));
}

/** Test-only: clear the in-process cache so tests start clean. */
export function _clearDisabledVariantsCacheForTests(): void {
  cache = null;
  tableEnsured = false;
}
