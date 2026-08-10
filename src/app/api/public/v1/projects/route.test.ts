import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 59, resetAt: Date.now() + 60_000 })),
  rateLimitHeaders: vi.fn(() => ({ 'X-RateLimit-Limit': '60' })),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { GET, POST } from './route';

const auth = vi.mocked(getAuthUser);
const db = vi.mocked(getDbAdapter);
const request = (method: string, body?: unknown) => new NextRequest('http://localhost/api/public/v1/projects', {
  method,
  headers: { authorization: `Bearer nf_live_${'a'.repeat(64)}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('public v1 project API key controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.mockReturnValue({ queryAll: vi.fn().mockResolvedValue([]), execute: vi.fn().mockResolvedValue({ changes: 1 }) } as never);
  });

  it('rejects a key without the required read scope', async () => {
    auth.mockResolvedValue({ userId: 'u1', email: 'u@example.com', plan: 'pro', globalRole: 'user', roles: [], orgIds: [], emailVerified: true, apiKey: { id: 'ak1', scopes: ['write:projects'] } });
    expect((await GET(request('GET'))).status).toBe(403);
  });

  it('allows scoped reads and separately requires write scope', async () => {
    auth.mockResolvedValue({ userId: 'u1', email: 'u@example.com', plan: 'pro', globalRole: 'user', roles: [], orgIds: [], emailVerified: true, apiKey: { id: 'ak1', scopes: ['read:projects'] } });
    const read = await GET(request('GET'));
    expect(read.status).toBe(200);
    expect(read.headers.get('x-ratelimit-limit')).toBe('60');
    expect((await POST(request('POST', { name: 'P' }))).status).toBe(403);
  });
});
