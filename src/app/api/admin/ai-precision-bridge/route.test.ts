import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn(), db: {} }));
vi.mock('@/lib/admin-auth', () => ({ verifyAdmin: mocks.verify }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => mocks.db) }));
vi.mock('@/lib/ai/aiDesignPrecisionBridgeOperations', () => ({
  readAiPrecisionBridgeOperationalSnapshot: mocks.read,
}));

import { GET } from './route';

function request() {
  return new NextRequest('https://local.test/api/admin/ai-precision-bridge');
}

beforeEach(() => {
  mocks.verify.mockReset().mockResolvedValue(true);
  mocks.read.mockReset().mockResolvedValue({
    schema: 'nexyfab.ai-precision-bridge-operations.v1',
    generatedAt: '2026-08-24T14:00:00.000Z', status: 'READY',
    manufacturingReleaseReady: false,
    counts: { PENDING: 0, CLAIMED: 0, SENT: 0, COMPLETED: 3, HOLD: 0, VERIFIED_UNKNOWN: 0 },
    oldestAgeMs: { PENDING: null, CLAIMED: null, SENT: null, COMPLETED: 1000, HOLD: null, VERIFIED_UNKNOWN: null },
    throughput24h: { completed: 3, held: 0, receiptsAccepted: 3 },
    leases: { active: 0, expired: 0 }, alerts: [], exceptions: [],
  });
});

describe('admin AI Precision bridge operations API', () => {
  it('does not disclose queue state to non-admin callers', async () => {
    mocks.verify.mockResolvedValue(false);
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('returns a private no-store operational snapshot without release authority', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      ok: true, status: 'READY', manufacturingReleaseReady: false,
      throughput24h: { completed: 3, receiptsAccepted: 3 },
    });
    expect(mocks.read).toHaveBeenCalledWith({ db: mocks.db });
  });

  it('fails closed when the authority migration is unavailable', async () => {
    mocks.read.mockRejectedValue(new Error('AI_PRECISION_BRIDGE_MIGRATION_REQUIRED'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false, code: 'AI_PRECISION_MIGRATION_REQUIRED', manufacturingReleaseReady: false,
    });
  });
});
