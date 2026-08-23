import 'server-only';

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';

export const ADMIN_EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const ADMIN_EMAIL_CODE_MAX_ATTEMPTS = 5;
export const ADMIN_EMAIL_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

interface AllowedEmailRow {
  id: string;
  email: string;
  active: number | boolean;
  added_by: string | null;
  created_at: number;
  updated_at: number;
}

interface LoginCodeRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: number;
}

export interface AdminEmailAccessEntry {
  id: string;
  email: string;
  active: boolean;
  addedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ParsedAdminEmailSession {
  email: string;
  sid: string;
  expiresAt: number;
}

function signingSecret(): string {
  const value = process.env.ADMIN_SESSION_SECRET
    ?? process.env.JWT_SECRET
    ?? process.env.ADMIN_SECRET
    ?? '';
  if (value.length < 32) throw new Error('ADMIN_SESSION_SECRET/JWT_SECRET must contain at least 32 characters');
  return value;
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length || aa.length === 0) return false;
  return timingSafeEqual(aa, bb);
}

function hmac(value: string): string {
  return createHmac('sha256', signingSecret()).update(value).digest('hex');
}

function sidHash(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

export function normalizeAdminEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function maskAdminEmail(value: string): string {
  const email = normalizeAdminEmail(value);
  if (!email) return '***';
  const [user, domain] = email.split('@');
  return `${user.slice(0, Math.min(2, user.length))}***@${domain}`;
}

export function adminRequestIpHash(ip: string): string {
  return hmac(`admin-ip:${ip}`).slice(0, 32);
}

export function adminLoginCodeHash(email: string, code: string): string {
  return hmac(`admin-login-code:${normalizeAdminEmail(email) ?? ''}:${String(code).trim()}`);
}

export function generateAdminLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Seed-only bootstrap. Runtime additions are made from the authenticated admin UI. */
export async function ensureBootstrapAdminEmails(db: DbAdapter = getDbAdapter()): Promise<void> {
  const emails = (process.env.ADMIN_BOOTSTRAP_EMAILS ?? '')
    .split(',')
    .map(normalizeAdminEmail)
    .filter((email): email is string => Boolean(email));
  const now = Date.now();
  for (const email of [...new Set(emails)]) {
    await db.execute(
      `INSERT OR IGNORE INTO nf_admin_access_emails
         (id, email, active, added_by, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`,
      `aae_${randomUUID()}`, email, 'bootstrap', now, now,
    );
  }
}

export async function isAllowedAdminEmail(email: string, db: DbAdapter = getDbAdapter()): Promise<boolean> {
  const normalized = normalizeAdminEmail(email);
  if (!normalized) return false;
  await ensureBootstrapAdminEmails(db);
  const row = await db.queryOne<{ active: number | boolean }>(
    'SELECT active FROM nf_admin_access_emails WHERE email = ?', normalized,
  );
  return row?.active === true || Number(row?.active) === 1;
}

export async function listAdminAccessEmails(db: DbAdapter = getDbAdapter()): Promise<AdminEmailAccessEntry[]> {
  await ensureBootstrapAdminEmails(db);
  const rows = await db.queryAll<AllowedEmailRow>(
    'SELECT id, email, active, added_by, created_at, updated_at FROM nf_admin_access_emails ORDER BY active DESC, created_at ASC',
  );
  return rows.map(row => ({
    id: row.id,
    email: row.email,
    active: row.active === true || Number(row.active) === 1,
    addedBy: row.added_by,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

export async function addAdminAccessEmail(
  email: string,
  addedBy: string,
  db: DbAdapter = getDbAdapter(),
): Promise<AdminEmailAccessEntry> {
  const normalized = normalizeAdminEmail(email);
  if (!normalized) throw new Error('INVALID_EMAIL');
  const now = Date.now();
  const existing = await db.queryOne<AllowedEmailRow>(
    'SELECT id, email, active, added_by, created_at, updated_at FROM nf_admin_access_emails WHERE email = ?', normalized,
  );
  if (existing) {
    await db.execute(
      'UPDATE nf_admin_access_emails SET active = 1, added_by = ?, updated_at = ? WHERE email = ?',
      addedBy, now, normalized,
    );
    return { id: existing.id, email: normalized, active: true, addedBy, createdAt: Number(existing.created_at), updatedAt: now };
  }
  const id = `aae_${randomUUID()}`;
  await db.execute(
    `INSERT INTO nf_admin_access_emails (id, email, active, added_by, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`,
    id, normalized, addedBy, now, now,
  );
  return { id, email: normalized, active: true, addedBy, createdAt: now, updatedAt: now };
}

export async function setAdminAccessEmailActive(
  email: string,
  active: boolean,
  actorEmail: string,
  db: DbAdapter = getDbAdapter(),
): Promise<void> {
  const normalized = normalizeAdminEmail(email);
  const actor = normalizeAdminEmail(actorEmail);
  if (!normalized) throw new Error('INVALID_EMAIL');
  if (!active && normalized === actor) throw new Error('CANNOT_DISABLE_CURRENT_ADMIN');
  if (!active) {
    const row = await db.queryOne<{ count: number | string }>(
      'SELECT COUNT(*) AS count FROM nf_admin_access_emails WHERE active = 1',
    );
    if (Number(row?.count ?? 0) <= 1) throw new Error('CANNOT_DISABLE_LAST_ADMIN');
  }
  const result = await db.execute(
    'UPDATE nf_admin_access_emails SET active = ?, updated_at = ? WHERE email = ?',
    active ? 1 : 0, Date.now(), normalized,
  );
  if (result.changes === 0) throw new Error('ADMIN_EMAIL_NOT_FOUND');
  if (!active) {
    await db.execute(
      'UPDATE nf_admin_sessions SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL',
      Date.now(), normalized,
    );
  }
}

export async function issueAdminEmailLoginCode(
  email: string,
  ipHash: string,
  db: DbAdapter = getDbAdapter(),
  now = Date.now(),
): Promise<{ code: string; expiresAt: number }> {
  const normalized = normalizeAdminEmail(email);
  if (!normalized || !(await isAllowedAdminEmail(normalized, db))) throw new Error('ADMIN_EMAIL_NOT_ALLOWED');
  const code = generateAdminLoginCode();
  const expiresAt = now + ADMIN_EMAIL_CODE_TTL_MS;
  await db.execute(
    'UPDATE nf_admin_login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL',
    now, normalized,
  );
  await db.execute(
    `INSERT INTO nf_admin_login_codes
       (id, email, code_hash, ip_hash, attempts, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, ?)`,
    `alc_${randomUUID()}`, normalized, adminLoginCodeHash(normalized, code), ipHash, expiresAt, now,
  );
  return { code, expiresAt };
}

export type VerifyAdminEmailCodeResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' | 'not_allowed'; attemptsLeft?: number };

export async function verifyAdminEmailLoginCode(
  email: string,
  code: string,
  ipHash: string,
  db: DbAdapter = getDbAdapter(),
  now = Date.now(),
): Promise<VerifyAdminEmailCodeResult> {
  const normalized = normalizeAdminEmail(email);
  if (!normalized || !(await isAllowedAdminEmail(normalized, db))) return { ok: false, reason: 'not_allowed' };
  if (!/^\d{6}$/.test(String(code))) return { ok: false, reason: 'invalid' };
  const row = await db.queryOne<LoginCodeRow>(
    `SELECT id, code_hash, attempts, expires_at FROM nf_admin_login_codes
     WHERE email = ? AND ip_hash = ? AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    normalized, ipHash,
  );
  if (!row) return { ok: false, reason: 'invalid' };
  if (Number(row.expires_at) <= now) {
    await db.execute('UPDATE nf_admin_login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', now, row.id);
    return { ok: false, reason: 'expired' };
  }
  if (Number(row.attempts) >= ADMIN_EMAIL_CODE_MAX_ATTEMPTS) {
    await db.execute('UPDATE nf_admin_login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', now, row.id);
    return { ok: false, reason: 'too_many_attempts' };
  }
  const expected = adminLoginCodeHash(normalized, code);
  if (!safeEqual(expected, row.code_hash)) {
    const attempts = Number(row.attempts) + 1;
    if (attempts >= ADMIN_EMAIL_CODE_MAX_ATTEMPTS) {
      await db.execute('UPDATE nf_admin_login_codes SET attempts = ?, used_at = ? WHERE id = ? AND used_at IS NULL', attempts, now, row.id);
      return { ok: false, reason: 'too_many_attempts' };
    }
    await db.execute('UPDATE nf_admin_login_codes SET attempts = ? WHERE id = ? AND used_at IS NULL', attempts, row.id);
    return { ok: false, reason: 'invalid', attemptsLeft: ADMIN_EMAIL_CODE_MAX_ATTEMPTS - attempts };
  }
  const consumed = await db.execute(
    'UPDATE nf_admin_login_codes SET attempts = attempts + 1, used_at = ? WHERE id = ? AND used_at IS NULL',
    now, row.id,
  );
  return consumed.changes === 1 ? { ok: true } : { ok: false, reason: 'invalid' };
}

function encodeSessionPayload(payload: ParsedAdminEmailSession): string {
  return Buffer.from(JSON.stringify({
    typ: 'nf_admin_email_session',
    email: payload.email,
    sid: payload.sid,
    exp: payload.expiresAt,
  })).toString('base64url');
}

export function createSignedAdminEmailToken(payload: ParsedAdminEmailSession): string {
  const encoded = encodeSessionPayload(payload);
  const signature = createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function parseAdminEmailToken(token: string | null | undefined, now = Date.now()): ParsedAdminEmailSession | null {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
  if (!safeEqual(expected, signature)) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      typ?: unknown; email?: unknown; sid?: unknown; exp?: unknown;
    };
    const email = normalizeAdminEmail(value.email);
    if (value.typ !== 'nf_admin_email_session' || !email || typeof value.sid !== 'string' || !/^[0-9a-f]{64}$/.test(value.sid)) return null;
    if (typeof value.exp !== 'number' || value.exp <= now) return null;
    return { email, sid: value.sid, expiresAt: value.exp };
  } catch {
    return null;
  }
}

export async function createAdminEmailSession(
  email: string,
  ipHash: string,
  userAgent: string,
  db: DbAdapter = getDbAdapter(),
  now = Date.now(),
): Promise<{ token: string; maxAge: number; email: string }> {
  const normalized = normalizeAdminEmail(email);
  if (!normalized || !(await isAllowedAdminEmail(normalized, db))) throw new Error('ADMIN_EMAIL_NOT_ALLOWED');
  const sid = randomBytes(32).toString('hex');
  const expiresAt = now + ADMIN_EMAIL_SESSION_TTL_MS;
  await db.execute(
    `INSERT INTO nf_admin_sessions
       (sid_hash, email, ip_hash, user_agent, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    sidHash(sid), normalized, ipHash, userAgent.slice(0, 500), expiresAt, now,
  );
  await db.execute('DELETE FROM nf_admin_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL', now).catch(() => ({ changes: 0 }));
  return {
    token: createSignedAdminEmailToken({ email: normalized, sid, expiresAt }),
    maxAge: Math.floor(ADMIN_EMAIL_SESSION_TTL_MS / 1000),
    email: normalized,
  };
}

export async function verifyAdminEmailTokenLive(
  token: string | null | undefined,
  db: DbAdapter = getDbAdapter(),
  now = Date.now(),
): Promise<ParsedAdminEmailSession | null> {
  const parsed = parseAdminEmailToken(token, now);
  if (!parsed) return null;
  const row = await db.queryOne<{ email: string }>(
    `SELECT s.email FROM nf_admin_sessions s
     JOIN nf_admin_access_emails a ON a.email = s.email AND a.active = 1
     WHERE s.sid_hash = ? AND s.email = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    sidHash(parsed.sid), parsed.email, now,
  );
  return row ? parsed : null;
}

export async function revokeAdminEmailSession(
  token: string | null | undefined,
  db: DbAdapter = getDbAdapter(),
): Promise<void> {
  const parsed = parseAdminEmailToken(token);
  if (!parsed) return;
  await db.execute(
    'UPDATE nf_admin_sessions SET revoked_at = ? WHERE sid_hash = ? AND revoked_at IS NULL',
    Date.now(), sidHash(parsed.sid),
  );
}
