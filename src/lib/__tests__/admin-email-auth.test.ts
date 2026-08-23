import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from '../db-adapter';
import type { VerifyAdminEmailCodeResult } from '../admin-email-auth';

vi.mock('server-only', () => ({}));

interface AccessRow {
  id: string;
  email: string;
  active: number;
  added_by: string | null;
  created_at: number;
  updated_at: number;
}

interface CodeRow {
  id: string;
  email: string;
  code_hash: string;
  ip_hash: string;
  attempts: number;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

interface SessionRow {
  sid_hash: string;
  email: string;
  expires_at: number;
  revoked_at: number | null;
}

class MemoryAdminDb {
  backend = 'sqlite' as const;
  access: AccessRow[] = [];
  codes: CodeRow[] = [];
  sessions: SessionRow[] = [];

  async queryOne<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT active FROM nf_admin_access_emails')) {
      return (this.access.find(row => row.email === args[0]) ?? null) as T | null;
    }
    if (s.startsWith('SELECT COUNT(*) AS count FROM nf_admin_access_emails')) {
      return { count: this.access.filter(row => row.active === 1).length } as T;
    }
    if (s.startsWith('SELECT id, email, active, added_by')) {
      return (this.access.find(row => row.email === args[0]) ?? null) as T | null;
    }
    if (s.startsWith('SELECT id, code_hash, attempts, expires_at')) {
      const [email, ipHash] = args;
      return (this.codes
        .filter(row => row.email === email && row.ip_hash === ipHash && row.used_at === null)
        .sort((a, b) => b.created_at - a.created_at)[0] ?? null) as T | null;
    }
    if (s.startsWith('SELECT s.email FROM nf_admin_sessions')) {
      const [sidHash, email, now] = args;
      const allowed = this.access.some(row => row.email === email && row.active === 1);
      const session = this.sessions.find(row => row.sid_hash === sidHash && row.email === email && row.revoked_at === null && row.expires_at > Number(now));
      return (allowed && session ? { email: session.email } : null) as T | null;
    }
    return null;
  }

  async queryAll<T>(sql: string): Promise<T[]> {
    if (sql.includes('FROM nf_admin_access_emails')) return [...this.access] as T[];
    return [];
  }

  async execute(sql: string, ...args: unknown[]): Promise<{ changes: number }> {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT OR IGNORE INTO nf_admin_access_emails')) {
      if (this.access.some(row => row.email === args[1])) return { changes: 0 };
      this.access.push({ id: String(args[0]), email: String(args[1]), active: 1, added_by: String(args[2]), created_at: Number(args[3]), updated_at: Number(args[4]) });
      return { changes: 1 };
    }
    if (s.startsWith('INSERT INTO nf_admin_login_codes')) {
      this.codes.push({ id: String(args[0]), email: String(args[1]), code_hash: String(args[2]), ip_hash: String(args[3]), attempts: 0, expires_at: Number(args[4]), used_at: null, created_at: Number(args[5]) });
      return { changes: 1 };
    }
    if (s.startsWith('UPDATE nf_admin_login_codes SET used_at = ? WHERE email')) {
      let changes = 0;
      for (const row of this.codes) if (row.email === args[1] && row.used_at === null) { row.used_at = Number(args[0]); changes += 1; }
      return { changes };
    }
    if (s.startsWith('UPDATE nf_admin_login_codes SET attempts = attempts + 1')) {
      const row = this.codes.find(item => item.id === args[1] && item.used_at === null);
      if (!row) return { changes: 0 };
      row.attempts += 1;
      row.used_at = Number(args[0]);
      return { changes: 1 };
    }
    if (s.startsWith('UPDATE nf_admin_login_codes SET attempts = ?, used_at = ?')) {
      const row = this.codes.find(item => item.id === args[2] && item.used_at === null);
      if (!row) return { changes: 0 };
      row.attempts = Number(args[0]);
      row.used_at = Number(args[1]);
      return { changes: 1 };
    }
    if (s.startsWith('UPDATE nf_admin_login_codes SET attempts = ?')) {
      const row = this.codes.find(item => item.id === args[1] && item.used_at === null);
      if (!row) return { changes: 0 };
      row.attempts = Number(args[0]);
      return { changes: 1 };
    }
    if (s.startsWith('UPDATE nf_admin_login_codes SET used_at = ? WHERE id')) {
      const row = this.codes.find(item => item.id === args[1] && item.used_at === null);
      if (!row) return { changes: 0 };
      row.used_at = Number(args[0]);
      return { changes: 1 };
    }
    if (s.startsWith('INSERT INTO nf_admin_sessions')) {
      this.sessions.push({ sid_hash: String(args[0]), email: String(args[1]), expires_at: Number(args[4]), revoked_at: null });
      return { changes: 1 };
    }
    if (s.startsWith('DELETE FROM nf_admin_sessions')) return { changes: 0 };
    if (s.startsWith('UPDATE nf_admin_sessions SET revoked_at = ? WHERE sid_hash')) {
      const row = this.sessions.find(item => item.sid_hash === args[1] && item.revoked_at === null);
      if (!row) return { changes: 0 };
      row.revoked_at = Number(args[0]);
      return { changes: 1 };
    }
    if (s.startsWith('UPDATE nf_admin_sessions SET revoked_at = ? WHERE email')) {
      let changes = 0;
      for (const row of this.sessions) if (row.email === args[1] && row.revoked_at === null) { row.revoked_at = Number(args[0]); changes += 1; }
      return { changes };
    }
    if (s.startsWith('UPDATE nf_admin_access_emails SET active = ?')) {
      const row = this.access.find(item => item.email === args[2]);
      if (!row) return { changes: 0 };
      row.active = Number(args[0]);
      row.updated_at = Number(args[1]);
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  async executeRaw(): Promise<void> {}
  async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> { return fn(this as unknown as DbAdapter); }
}

const auth = await import('../admin-email-auth');

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = 'admin-email-auth-test-secret-at-least-32-characters';
  process.env.ADMIN_BOOTSTRAP_EMAILS = 'Owner@Example.com';
});

describe('passwordless admin email authentication', () => {
  it('normalizes, validates, and masks email addresses', () => {
    expect(auth.normalizeAdminEmail(' Owner@Example.COM ')).toBe('owner@example.com');
    expect(auth.normalizeAdminEmail('not-an-email')).toBeNull();
    expect(auth.maskAdminEmail('owner@example.com')).toBe('ow***@example.com');
  });

  it('seeds only configured bootstrap administrators', async () => {
    const db = new MemoryAdminDb();
    expect(await auth.isAllowedAdminEmail('owner@example.com', db as unknown as DbAdapter)).toBe(true);
    expect(await auth.isAllowedAdminEmail('stranger@example.com', db as unknown as DbAdapter)).toBe(false);
    expect(db.access.map(row => row.email)).toEqual(['owner@example.com']);
  });

  it('stores only a code hash and consumes a correct code once', async () => {
    const db = new MemoryAdminDb();
    const ipHash = auth.adminRequestIpHash('127.0.0.1');
    const issued = await auth.issueAdminEmailLoginCode('owner@example.com', ipHash, db as unknown as DbAdapter, 1_000);
    expect(db.codes[0].code_hash).not.toBe(issued.code);
    expect(db.codes[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await auth.verifyAdminEmailLoginCode('owner@example.com', issued.code, ipHash, db as unknown as DbAdapter, 2_000)).toEqual({ ok: true });
    expect((await auth.verifyAdminEmailLoginCode('owner@example.com', issued.code, ipHash, db as unknown as DbAdapter, 2_001)).ok).toBe(false);
  });

  it('limits wrong-code attempts', async () => {
    const db = new MemoryAdminDb();
    const ipHash = auth.adminRequestIpHash('127.0.0.1');
    await auth.issueAdminEmailLoginCode('owner@example.com', ipHash, db as unknown as DbAdapter, 1_000);
    let last: VerifyAdminEmailCodeResult = { ok: false, reason: 'invalid' };
    for (let i = 0; i < auth.ADMIN_EMAIL_CODE_MAX_ATTEMPTS; i += 1) {
      last = await auth.verifyAdminEmailLoginCode('owner@example.com', '999999', ipHash, db as unknown as DbAdapter, 2_000 + i);
    }
    expect(last).toEqual({ ok: false, reason: 'too_many_attempts' });
  });

  it('rejects tampered and expired signed session tokens', () => {
    const token = auth.createSignedAdminEmailToken({ email: 'owner@example.com', sid: 'a'.repeat(64), expiresAt: 2_000 });
    expect(auth.parseAdminEmailToken(token, 1_999)?.email).toBe('owner@example.com');
    expect(auth.parseAdminEmailToken(`${token}x`, 1_999)).toBeNull();
    expect(auth.parseAdminEmailToken(token, 2_000)).toBeNull();
  });

  it('checks sessions against the live allowlist and supports revocation', async () => {
    const db = new MemoryAdminDb();
    const now = Date.now();
    const session = await auth.createAdminEmailSession('owner@example.com', 'ip-hash', 'test', db as unknown as DbAdapter, now);
    expect(await auth.verifyAdminEmailTokenLive(session.token, db as unknown as DbAdapter, now + 1)).not.toBeNull();
    await auth.revokeAdminEmailSession(session.token, db as unknown as DbAdapter);
    expect(await auth.verifyAdminEmailTokenLive(session.token, db as unknown as DbAdapter, now + 2)).toBeNull();
  });

  it('cannot disable the current or last active administrator', async () => {
    const db = new MemoryAdminDb();
    await auth.ensureBootstrapAdminEmails(db as unknown as DbAdapter);
    await expect(auth.setAdminAccessEmailActive('owner@example.com', false, 'owner@example.com', db as unknown as DbAdapter)).rejects.toThrow('CANNOT_DISABLE_CURRENT_ADMIN');
    await expect(auth.setAdminAccessEmailActive('owner@example.com', false, 'other@example.com', db as unknown as DbAdapter)).rejects.toThrow('CANNOT_DISABLE_LAST_ADMIN');
  });
});
