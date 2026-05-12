/**
 * Server-side provider chain override.
 *
 * The default chain comes from `AI_PROVIDER_PRIMARY` and `AI_PROVIDER_FALLBACKS`
 * environment variables. Admins can override at runtime by writing rows to
 * `nf_provider_override` — the chatCompletion factory checks this table on
 * every call (with 30s cache) and prefers DB rows when present.
 *
 * Why DB-backed:
 *   - Env changes require redeploy. A regressing provider should be moved out
 *     of the chain in seconds, not after the next ship.
 *   - Same kill-switch pattern as `nf_disabled_variants`.
 *   - Admin UI can show current chain + edit without touching infra.
 *
 * Storage shape: a single row per chain slot, ordered by `position` ASC.
 */

import { getDbAdapter } from '@/lib/db-adapter';
import type { ProviderName } from './types';

const CACHE_TTL_MS = 30_000;
const VALID_PROVIDERS: ProviderName[] = ['deepseek', 'openai', 'anthropic', 'local'];

let cache: { chain: ProviderName[] | null; expiresAt: number } | null = null;
let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_provider_override (
      provider TEXT NOT NULL PRIMARY KEY,
      position INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_nf_po_position ON nf_provider_override(position);
  `).catch(() => {});
  // Audit table — append-only history of every chain change. Separate from
  // the live override table so it can grow without inflating the read path.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_provider_override_audit (
      id          TEXT NOT NULL PRIMARY KEY,
      changed_at  INTEGER NOT NULL,
      changed_by  TEXT,
      chain_json  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nf_poa_time ON nf_provider_override_audit(changed_at);
  `).catch(() => {});
  tableEnsured = true;
}

/**
 * Read the active override chain, or null when no rows exist (env defaults
 * apply). 30s in-process cache keeps the lookup ~free.
 */
export async function loadProviderOverride(force = false): Promise<ProviderName[] | null> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.chain;
  await ensureTable();
  const db = getDbAdapter();
  const rows = await db
    .queryAll<{ provider: string; position: number }>(
      'SELECT provider, position FROM nf_provider_override ORDER BY position ASC',
    )
    .catch(() => [] as { provider: string; position: number }[]);
  const chain = rows.length === 0
    ? null
    : rows
        .map(r => r.provider as ProviderName)
        .filter((p): p is ProviderName => VALID_PROVIDERS.includes(p));
  cache = { chain, expiresAt: now + CACHE_TTL_MS };
  return chain;
}

/** Synchronous fallback for the chatCompletion hot path. */
export function providerOverrideCached(): ProviderName[] | null {
  if (cache && cache.expiresAt > Date.now()) return cache.chain;
  return null;
}

export function scheduleProviderOverrideRefresh(): void {
  void loadProviderOverride(true).catch(() => { /* swallow */ });
}

/**
 * Replace the entire chain. `chain` must be a list of valid provider names
 * with no duplicates. Pass `[]` to clear the override (back to env defaults).
 */
export async function setProviderOverride(
  chain: ProviderName[],
  updatedBy?: string,
): Promise<void> {
  // Validate + dedupe.
  const clean: ProviderName[] = [];
  const seen = new Set<string>();
  for (const p of chain) {
    if (!VALID_PROVIDERS.includes(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    clean.push(p);
  }
  await ensureTable();
  const db = getDbAdapter();
  // Replace strategy: delete all, insert fresh ordered list. Wrap in a
  // transaction when the adapter supports it; otherwise sequential is fine
  // since override edits are admin-rate (not high-concurrency).
  await db.execute('DELETE FROM nf_provider_override');
  for (let i = 0; i < clean.length; i++) {
    await db.execute(
      'INSERT INTO nf_provider_override (provider, position, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      clean[i],
      i,
      Date.now(),
      updatedBy ?? null,
    );
  }
  // Append audit row with the *resulting* chain (empty = override cleared).
  const auditId = `pca-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.execute(
    'INSERT INTO nf_provider_override_audit (id, changed_at, changed_by, chain_json) VALUES (?, ?, ?, ?)',
    auditId,
    Date.now(),
    updatedBy ?? null,
    JSON.stringify(clean),
  ).catch(e => console.warn('[providerOverride] audit insert failed:', e));
  cache = null;
}

/** Read recent audit history (most-recent first). */
export async function listProviderOverrideAudit(limit = 50): Promise<Array<{
  id: string;
  changedAt: number;
  changedBy: string | null;
  chain: ProviderName[];
}>> {
  await ensureTable();
  const db = getDbAdapter();
  const rows = await db
    .queryAll<{ id: string; changed_at: number; changed_by: string | null; chain_json: string }>(
      'SELECT id, changed_at, changed_by, chain_json FROM nf_provider_override_audit ORDER BY changed_at DESC LIMIT ?',
      Math.max(1, Math.min(500, limit)),
    )
    .catch(() => [] as { id: string; changed_at: number; changed_by: string | null; chain_json: string }[]);
  return rows.map(r => {
    let chain: ProviderName[] = [];
    try {
      const parsed = JSON.parse(r.chain_json) as unknown[];
      if (Array.isArray(parsed)) {
        chain = parsed
          .filter((v): v is string => typeof v === 'string')
          .filter((v): v is ProviderName => VALID_PROVIDERS.includes(v as ProviderName));
      }
    } catch { /* malformed row — return empty chain */ }
    return {
      id: r.id,
      changedAt: r.changed_at,
      changedBy: r.changed_by,
      chain,
    };
  });
}

export async function listProviderOverride(): Promise<Array<{
  provider: ProviderName;
  position: number;
  updatedAt: number;
  updatedBy: string | null;
}>> {
  await ensureTable();
  const db = getDbAdapter();
  const rows = await db
    .queryAll<{ provider: string; position: number; updated_at: number; updated_by: string | null }>(
      'SELECT provider, position, updated_at, updated_by FROM nf_provider_override ORDER BY position ASC',
    )
    .catch(() => [] as { provider: string; position: number; updated_at: number; updated_by: string | null }[]);
  return rows
    .filter(r => VALID_PROVIDERS.includes(r.provider as ProviderName))
    .map(r => ({
      provider: r.provider as ProviderName,
      position: r.position,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    }));
}

/**
 * Pure helper: rebuild a provider chain so that `keep` sits at index 0 and
 * `drop` is removed entirely. Preserves the relative order of remaining
 * providers. Used by /admin/apply-consolidation when an admin clicks "drop X".
 *
 * Why a pure helper:
 *   - testable without spinning up a Request/Response or the DB mock.
 *   - the route just needs to load the chain, call this, and persist.
 */
export function applyConsolidation(
  oldChain: ProviderName[],
  keep: ProviderName,
  drop: ProviderName,
): ProviderName[] {
  if (keep === drop) return oldChain.slice();
  const out: ProviderName[] = [keep];
  for (const p of oldChain) {
    if (p === keep || p === drop) continue;
    out.push(p);
  }
  return out;
}

/** Test-only: reset the in-process cache. */
export function _clearProviderOverrideCacheForTests(): void {
  cache = null;
  tableEnsured = false;
}
