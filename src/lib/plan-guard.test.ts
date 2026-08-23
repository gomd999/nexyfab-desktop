import { describe, it, expect, vi } from 'vitest';
import { meetsPlan, PLAN_MONTHLY_LIMITS } from './plan-guard';

const authUser = vi.hoisted(() => ({
  value: {
    userId: 'user-api-key',
    email: 'api-key@example.test',
    plan: 'pro',
    globalRole: 'user',
    roles: [],
    orgIds: [],
    orgContextStatus: 'personal' as const,
    activeOrgId: null,
    emailVerified: true,
    apiKey: { id: 'key-1', scopes: ['read:projects', 'write:projects'] },
  },
}));

vi.mock('./auth-middleware', () => ({
  getAuthUser: vi.fn(async () => authUser.value),
}));

vi.mock('./org-context', () => ({
  resolveRequestOrgContext: vi.fn(() => ({ ok: true, orgId: null, mode: 'personal' })),
}));

describe('meetsPlan', () => {
  it('free plan meets free requirement', () => {
    expect(meetsPlan('free', 'free')).toBe(true);
  });

  it('free plan does not meet pro requirement', () => {
    expect(meetsPlan('free', 'pro')).toBe(false);
  });

  it('pro plan meets free and pro requirements', () => {
    expect(meetsPlan('pro', 'free')).toBe(true);
    expect(meetsPlan('pro', 'pro')).toBe(true);
  });

  it('pro plan does not meet team requirement', () => {
    expect(meetsPlan('pro', 'team')).toBe(false);
  });

  it('enterprise plan meets all requirements', () => {
    expect(meetsPlan('enterprise', 'free')).toBe(true);
    expect(meetsPlan('enterprise', 'pro')).toBe(true);
    expect(meetsPlan('enterprise', 'team')).toBe(true);
    expect(meetsPlan('enterprise', 'enterprise')).toBe(true);
  });

  it('handles unknown plan gracefully (treated as free)', () => {
    // unknown plan falls back to rank 0 (=free), so meets 'free' but not 'pro'
    expect(meetsPlan('unknown', 'free')).toBe(true);
    expect(meetsPlan('unknown', 'pro')).toBe(false);
  });
});

describe('AI trial limits', () => {
  it('keeps the SCAD agent usable for free trial accounts', () => {
    expect(PLAN_MONTHLY_LIMITS.free.scad_agent).toBe(10);
  });
});

describe('checkPlan authentication metadata', () => {
  it('preserves API-key identity and scopes for route-level authorization', async () => {
    const { checkPlan } = await import('./plan-guard');
    const result = await checkPlan(new Request('https://nexyfab.test/api/test') as never, 'free');
    expect(result).toEqual({
      ok: true,
      userId: 'user-api-key',
      orgId: null,
      plan: 'pro',
      apiKey: { id: 'key-1', scopes: ['read:projects', 'write:projects'] },
    });
  });
});
