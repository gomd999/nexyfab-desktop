import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ authenticated: true, changes: 1, calls: [] as Array<{ sql: string; args: unknown[] }> }));
vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => state.authenticated ? { userId: 'u-owner', plan: 'free' } : null),
}));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    execute: vi.fn(async (sql: string, ...args: unknown[]) => {
      state.calls.push({ sql, args });
      return { changes: state.changes };
    }),
    queryOne: vi.fn(async () => null),
    queryAll: vi.fn(async () => []),
  })),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '127.0.0.1') }));

import { DELETE } from './route';

beforeEach(() => {
  state.authenticated = true;
  state.changes = 1;
  state.calls = [];
});

describe('share revocation ownership', () => {
  it('binds revocation to token and authenticated owner', async () => {
    const token = 'a'.repeat(32);
    const response = await DELETE(new NextRequest(`http://localhost/api/nexyfab/share?token=${token}`, {
      method: 'DELETE', headers: { origin: 'http://localhost' },
    }));
    expect(response.status).toBe(200);
    expect(state.calls[0]?.sql).toContain('token = ? AND user_id = ?');
    expect(state.calls[0]?.args).toEqual([token, 'u-owner']);
  });

  it('returns 404 for a token not owned by the caller', async () => {
    state.changes = 0;
    const token = 'b'.repeat(32);
    const response = await DELETE(new NextRequest(`http://localhost/api/nexyfab/share?token=${token}`, {
      method: 'DELETE', headers: { origin: 'http://localhost' },
    }));
    expect(response.status).toBe(404);
  });
});
