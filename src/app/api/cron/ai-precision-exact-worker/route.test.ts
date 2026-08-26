import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ run: vi.fn(), db: {} }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => mocks.db) }));
vi.mock('@/lib/ai/aiDesignPrecisionExactWorker', () => ({ runNextAiDesignPrecisionExactJob: mocks.run }));

import { POST } from './route';

function request(token = 'c'.repeat(32)) {
  return new NextRequest('https://local.test/api/cron/ai-precision-exact-worker', {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'c'.repeat(32));
  vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '1');
  vi.stubEnv('S3_BUCKET', 'private-bucket');
  vi.stubEnv('OBJECT_STORAGE_PRIVATE_BUCKET', 'private-bucket');
  vi.stubEnv('GENERATION_EVIDENCE_SIGNING_SECRET', 's'.repeat(32));
  vi.stubEnv('AI_PRECISION_SIGNING_KEY_ID', 'precision-key-1');
  mocks.run.mockReset().mockResolvedValue({
    ok: true, status: 'COMPLETED', recoveredUnknown: 0, jobId: 'job-1',
    receiptId: 'receipt-1', exactArtifactSha256: 'a'.repeat(64), verification: 'PASS',
  });
});

describe('AI Precision exact worker cron route', () => {
  it('fails closed for missing auth and commercial object storage', async () => {
    expect((await POST(request('wrong'))).status).toBe(403);
    vi.stubEnv('S3_BUCKET', '');
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'AI_PRECISION_PRIVATE_OBJECT_STORAGE_REQUIRED' });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('executes one bounded job and never claims manufacturing release', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true, status: 'COMPLETED', exactExecution: true,
      verification: 'PASS', manufacturingReleaseReady: false,
    });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      workerId: 'ai-precision-cron', leaseMs: 600_000,
      signingSecret: 's'.repeat(32), signingKeyId: 'precision-key-1',
    }), { db: mocks.db });
  });

  it('surfaces lease uncertainty as a retryable service failure', async () => {
    mocks.run.mockResolvedValue({
      ok: false, status: 'LEASE_UNCERTAIN', recoveredUnknown: 0,
      jobId: 'job-1', code: 'AI_PRECISION_ACCEPT_RECEIPT_LEASE_EXPIRED',
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'LEASE_UNCERTAIN', manufacturingReleaseReady: false,
    });
  });
});
