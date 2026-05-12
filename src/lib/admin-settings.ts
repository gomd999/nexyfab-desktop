/**
 * admin-settings — runtime config store backed by nf_admin_settings.
 *
 * Hot-swappable values (API keys, feature flag overrides, budget caps)
 * land here so an operator can change them via /admin/settings without
 * a redeploy. Secrets use AES-256-GCM with NEXYFAB_SECRET_KEY as the
 * master key; non-secret values (booleans, thresholds) go in plaintext.
 *
 * Read path:
 *   getSetting('toss.secret_key')
 *     → checks 30s in-process cache
 *     → falls back to env var (uppercased + dotted-to-underscored)
 *
 * Write path (super_admin only — guarded by callers):
 *   setSetting('toss.secret_key', 'live_sk_...', { scope: 'api_key', updatedBy })
 *     → encrypts, upserts, invalidates cache, returns new hash for audit
 *
 * The env var fallback is critical during the migration window — even
 * after this lands, most secrets still live in env. As they get rotated
 * via the admin UI, they move into the DB transparently.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getDbAdapter } from './db-adapter';

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_admin_settings (
      key             TEXT PRIMARY KEY,
      value_plain     TEXT,
      value_encrypted TEXT,
      scope           TEXT NOT NULL,
      description     TEXT,
      updated_by      TEXT,
      updated_at      BIGINT NOT NULL,
      created_at      BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_admin_settings_scope ON nf_admin_settings(scope)').catch(() => {});
  tableEnsured = true;
}

function getMasterKey(): Buffer {
  const raw = process.env.NEXYFAB_SECRET_KEY;
  if (!raw) {
    // Derive a stable but obviously-dev key from JWT_SECRET so local dev
    // doesn't crash. Production deploys MUST set NEXYFAB_SECRET_KEY.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXYFAB_SECRET_KEY required in production');
    }
    return createHash('sha256').update(process.env.JWT_SECRET ?? 'dev-fallback').digest();
  }
  // Accept either 32-byte hex (preferred) or any string (hashed to 32 bytes).
  return raw.length === 64 && /^[0-9a-f]+$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : createHash('sha256').update(raw).digest();
}

/** Encrypt a plaintext secret. Output format: base64(iv|tag|ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt the inverse of encryptSecret. Throws on tamper or wrong key. */
export function decryptSecret(encoded: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Read a setting. Returns the resolved value or null. Order: cache → DB
 * → env fallback (where 'toss.secret_key' resolves env 'TOSS_SECRET_KEY').
 */
export async function getSetting(key: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const db = getDbAdapter();
  await ensureTable(db);
  const row = await db.queryOne<{
    value_plain: string | null; value_encrypted: string | null; scope: string;
  }>(
    'SELECT value_plain, value_encrypted, scope FROM nf_admin_settings WHERE key = ?',
    key,
  ).catch(() => null);

  let value: string | null = null;
  if (row) {
    if (row.value_encrypted) {
      try { value = decryptSecret(row.value_encrypted); }
      catch (e) { console.warn(`[admin-settings] decrypt failed for ${key}:`, (e as Error).message); }
    } else if (row.value_plain != null) {
      value = row.value_plain;
    }
  }
  if (value === null) {
    // env fallback: dot → underscore, uppercased
    const envKey = key.replace(/\./g, '_').toUpperCase();
    value = process.env[envKey] ?? null;
  }

  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/** Synchronous variant — only checks cache + env. Use in hot paths. */
export function getSettingSync(key: string): string | null {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const envKey = key.replace(/\./g, '_').toUpperCase();
  return process.env[envKey] ?? null;
}

export interface SetSettingOptions {
  scope: 'api_key' | 'feature_flag' | 'budget' | 'config';
  description?: string;
  updatedBy: string;
  /** When true (default for api_key scope), value is encrypted at rest. */
  encrypt?: boolean;
}

/**
 * Upsert a setting. Returns sha256 hashes of old + new for audit logging.
 * Caller is responsible for RBAC + writing the audit row.
 */
export async function setSetting(
  key: string,
  value: string,
  opts: SetSettingOptions,
): Promise<{ oldHash: string | null; newHash: string }> {
  const db = getDbAdapter();
  await ensureTable(db);

  const existing = await db.queryOne<{ value_plain: string | null; value_encrypted: string | null }>(
    'SELECT value_plain, value_encrypted FROM nf_admin_settings WHERE key = ?',
    key,
  ).catch(() => null);
  const oldPlain = existing?.value_plain ?? (existing?.value_encrypted
    ? (() => { try { return decryptSecret(existing.value_encrypted!); } catch { return null; } })()
    : null);
  const oldHash = oldPlain == null ? null : sha256(oldPlain);
  const newHash = sha256(value);

  const encrypt = opts.encrypt ?? (opts.scope === 'api_key');
  const now = Date.now();
  if (existing) {
    await db.execute(
      `UPDATE nf_admin_settings
          SET value_plain = ?, value_encrypted = ?, scope = ?, description = COALESCE(?, description),
              updated_by = ?, updated_at = ?
        WHERE key = ?`,
      encrypt ? null : value,
      encrypt ? encryptSecret(value) : null,
      opts.scope, opts.description ?? null,
      opts.updatedBy, now, key,
    );
  } else {
    await db.execute(
      `INSERT INTO nf_admin_settings
         (key, value_plain, value_encrypted, scope, description, updated_by, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      key,
      encrypt ? null : value,
      encrypt ? encryptSecret(value) : null,
      opts.scope, opts.description ?? null,
      opts.updatedBy, now, now,
    );
  }

  // Invalidate cache — next read pulls the new value.
  cache.delete(key);
  return { oldHash, newHash };
}

/** Delete a setting and invalidate cache. */
export async function deleteSetting(key: string): Promise<void> {
  const db = getDbAdapter();
  await ensureTable(db);
  await db.execute('DELETE FROM nf_admin_settings WHERE key = ?', key);
  cache.delete(key);
}

/** Mask a secret value for UI display: first 4 + last 4 chars. */
export function maskSecret(value: string | null): string {
  if (!value) return '(unset)';
  if (value.length <= 12) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
