import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '203.0.113.8') }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/fea-jobs/redisFeaJobs', () => ({ enqueueFeaJob: vi.fn() }));
vi.mock('@/app/[lang]/shape-generator/analysis/feaPackage', () => ({
  feaFromStlAsync: vi.fn(), feaReportHtml: vi.fn(),
  FEA_MATERIALS: { steel: { label: 'Steel', yieldStrength: 235 } },
}));

import { getAuthUser } from '@/lib/auth-middleware';
import { enqueueFeaJob } from '@/lib/fea-jobs/redisFeaJobs';
import { feaFromStlAsync } from '@/app/[lang]/shape-generator/analysis/feaPackage';
import { POST } from './route';

function request(precise: boolean): NextRequest {
  return new NextRequest('https://nexyfab.test/api/nexyfab/drawing/fea-quick/', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'rev-1' },
    body: JSON.stringify({ scad: 'cube([10,10,10]);', materialKey: 'steel', loadKg: 100, precise }),
  });
}

describe('drawing FEA web/worker isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails closed when an unauthenticated caller requests precision capacity', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const response = await POST(request(true));
    expect(response.status).toBe(401);
    expect(enqueueFeaJob).not.toHaveBeenCalled();
    expect(feaFromStlAsync).not.toHaveBeenCalled();
  });

  it('returns 202 and never runs the precision solver in the web process', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: 'user-1', email: 'one@example.test', plan: 'pro', globalRole: 'user', roles: [], orgIds: [], emailVerified: true,
    });
    vi.mocked(enqueueFeaJob).mockResolvedValue({
      ok: true, reused: false,
      job: {
        id: 'fea-0123456789abcdef01234567', ownerUserId: 'user-1', scopeId: 'user:user-1', status: 'queued',
        progress: { percent: 0, stage: 'queued' }, createdAt: 1, updatedAt: 1, attempts: 0, maxAttempts: 3,
        requestHash: 'hidden', idempotencyHash: 'hidden',
      },
    });
    const response = await POST(request(true));
    expect(response.status).toBe(202);
    expect(feaFromStlAsync).not.toHaveBeenCalled();
    expect(enqueueFeaJob).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user-1', scopeId: 'user:user-1', idempotencyKey: 'rev-1',
      request: expect.objectContaining({ precise: true, loadN: 981 }),
    }));
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, async: true, jobId: 'fea-0123456789abcdef01234567' });
    expect(body.job).not.toHaveProperty('ownerUserId');
  });
});
