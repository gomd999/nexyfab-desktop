import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ authenticated: true, deleted: 1, calls: [] as unknown[][] }));
vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => state.authenticated ? {
    userId: 'u-owner', orgIds: ['org-a'], activeOrgId: 'org-a', orgContextStatus: 'active',
  } : null),
}));
vi.mock('@/lib/design-reviews', () => ({
  deleteReview: vi.fn(async (...args: unknown[]) => { state.calls.push(args); return state.deleted; }),
  listReviews: vi.fn(async () => []),
  saveReview: vi.fn(async () => undefined),
}));

import { DELETE } from './route';

beforeEach(() => {
  state.authenticated = true;
  state.deleted = 1;
  state.calls = [];
});

describe('review cleanup ownership', () => {
  it('deletes by authenticated owner id', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/nexyfab/reviews?id=review-a', { method: 'DELETE' }));
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([['u-owner', 'review-a', 'org-a']]);
  });

  it('returns 404 without disclosing another owner record', async () => {
    state.deleted = 0;
    const response = await DELETE(new NextRequest('http://localhost/api/nexyfab/reviews?id=review-a', { method: 'DELETE' }));
    expect(response.status).toBe(404);
  });
});
