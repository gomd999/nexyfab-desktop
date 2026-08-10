import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkPlan: vi.fn(),
  consumeMonthlyMetricSlot: vi.fn(),
  checkUserBudget: vi.fn(),
  rateLimitAsync: vi.fn(),
}));

vi.mock('@/lib/plan-guard', () => ({
  checkPlan: mocks.checkPlan,
  consumeMonthlyMetricSlot: mocks.consumeMonthlyMetricSlot,
}));
vi.mock('@/lib/ai/userBudget', () => ({ checkUserBudget: mocks.checkUserBudget }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: mocks.rateLimitAsync }));

import { guardStudioAi } from './studio-ai-guard';

const request = () => new NextRequest('https://nexyfab.com/api/example', {
  headers: { 'x-forwarded-for': '203.0.113.90' },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimitAsync.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
  mocks.checkUserBudget.mockResolvedValue({ ok: true });
  mocks.consumeMonthlyMetricSlot.mockResolvedValue({ ok: true, used: 1, limit: 30 });
});

describe('shared studio AI guard', () => {
  it('uses the distributed-capable aggregate bucket for an anonymous demo', async () => {
    mocks.checkPlan.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect(await guardStudioAi(request())).toBeNull();
    expect(mocks.rateLimitAsync).toHaveBeenCalledWith('studio-ai-anon:203.0.113.90', 10, 60_000);
  });

  it('blocks an anonymous caller after the aggregate quota is exhausted', async () => {
    mocks.checkPlan.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    mocks.rateLimitAsync.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
    expect((await guardStudioAi(request()))?.status).toBe(429);
  });

  it('checks both user cost budget and monthly plan slot when authenticated', async () => {
    mocks.checkPlan.mockResolvedValue({ ok: true, userId: 'beta-user', plan: 'free' });
    expect(await guardStudioAi(request())).toBeNull();
    expect(mocks.checkUserBudget).toHaveBeenCalledWith('beta-user');
    expect(mocks.consumeMonthlyMetricSlot).toHaveBeenCalledWith('beta-user', 'free', 'shape_chat');
    expect(mocks.rateLimitAsync).not.toHaveBeenCalled();
  });
});
