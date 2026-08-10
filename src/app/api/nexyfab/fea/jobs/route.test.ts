import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 })),
  rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/fea-jobs/redisFeaJobs', () => ({ enqueueFeaJob: vi.fn() }));

import { getAuthUser } from '@/lib/auth-middleware';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { enqueueFeaJob } from '@/lib/fea-jobs/redisFeaJobs';
import { POST } from './route';

const user = {
  userId: 'user-a', email: 'a@example.test', plan: 'pro', globalRole: 'user',
  roles: [], orgIds: ['org-a'], emailVerified: true,
};

function request(body: unknown): NextRequest {
  return new NextRequest('https://nexyfab.test/api/nexyfab/fea/jobs', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'design-rev-7' },
    body: JSON.stringify(body),
  });
}

describe('authenticated asynchronous FEA submission boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue(user);
  });

  it('does not disclose a project outside the authenticated tenant boundary', async () => {
    vi.mocked(resolveProjectAccess).mockResolvedValue(null);
    const response = await POST(request({ projectId: 'project-other', source: { kind: 'scad', source: 'cube([1,2,3]);' }, loadN: 10 }));
    expect(response.status).toBe(404);
    expect(enqueueFeaJob).not.toHaveBeenCalled();
  });

  it('requires edit permission instead of letting a viewer spend solver capacity', async () => {
    vi.mocked(resolveProjectAccess).mockResolvedValue({ row: {}, role: 'viewer', canEdit: false, ownerUserId: 'owner' });
    const response = await POST(request({ projectId: 'project-view', source: { kind: 'scad', source: 'cube([1,2,3]);' }, loadN: 10 }));
    expect(response.status).toBe(403);
    expect(enqueueFeaJob).not.toHaveBeenCalled();
  });

  it('derives owner and project scope server-side and returns a polling URL', async () => {
    vi.mocked(resolveProjectAccess).mockResolvedValue({ row: {}, role: 'editor', canEdit: true, ownerUserId: 'owner' });
    vi.mocked(enqueueFeaJob).mockResolvedValue({
      ok: true,
      reused: false,
      job: {
        id: 'fea-0123456789abcdef01234567', ownerUserId: 'user-a', scopeId: 'project:project-1', projectId: 'project-1',
        status: 'queued', progress: { percent: 0, stage: 'queued' }, createdAt: 1, updatedAt: 1,
        attempts: 0, maxAttempts: 3, requestHash: 'hidden', idempotencyHash: 'hidden',
      },
    });
    const body = { projectId: 'project-1', scopeId: 'project:attacker', ownerUserId: 'attacker', source: { kind: 'scad', source: 'cube([1,2,3]);' }, loadN: 10 };
    const response = await POST(request(body));
    expect(response.status).toBe(202);
    expect(enqueueFeaJob).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user-a', scopeId: 'project:project-1', projectId: 'project-1', idempotencyKey: 'design-rev-7',
    }));
    const payload = await response.json();
    expect(payload.pollUrl).toBe('/api/nexyfab/fea/jobs/fea-0123456789abcdef01234567');
    expect(payload.job).not.toHaveProperty('ownerUserId');
    expect(payload.job).not.toHaveProperty('requestHash');
  });
});
