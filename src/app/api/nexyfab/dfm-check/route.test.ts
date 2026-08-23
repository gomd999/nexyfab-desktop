import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  auth: vi.fn(),
  runDfmChecks: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('@/lib/client-ip', () => ({
  getTrustedClientIp: () => '203.0.113.55',
  getTrustedClientIpOrUndefined: () => '203.0.113.55',
}));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ execute: vi.fn() }) }));
vi.mock('@/lib/dfm-rules', () => ({ runDfmChecks: mocks.runDfmChecks }));
vi.mock('@/lib/shadow-logger', () => ({ logCadAccess: vi.fn() }));
vi.mock('@/lib/demo-session', () => ({
  DEMO_USER_ID: 'demo-user',
  ensureDemoSession: vi.fn().mockResolvedValue(null),
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 59, resetAt: Date.now() + 60_000 });
  mocks.auth.mockResolvedValue(null);
  mocks.runDfmChecks.mockReturnValue({ issues: 0, warnings: 0, items: [] });
});

describe('public DFM request boundary', () => {
  it('rejects exhausted route quota before parsing', async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
    const response = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/dfm-check', {
      method: 'POST',
      body: JSON.stringify({ params: { wallThickness: 1 } }),
    }));
    expect(response.status).toBe(429);
    expect(mocks.runDfmChecks).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON and non-finite parameter surrogates', async () => {
    const invalidJson = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/dfm-check', {
      method: 'POST',
      body: '{',
    }));
    expect(invalidJson.status).toBe(400);

    const oversized = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/dfm-check', {
      method: 'POST',
      body: JSON.stringify({ params: { width: 1_000_000_001 } }),
    }));
    expect(oversized.status).toBe(400);
    expect(mocks.runDfmChecks).not.toHaveBeenCalled();
  });

  it('runs bounded deterministic DFM input', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/dfm-check', {
      method: 'POST',
      body: JSON.stringify({ params: { wallThickness: 1.2 } }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.runDfmChecks).toHaveBeenCalledWith({ wallThickness: 1.2 });
  });
});
