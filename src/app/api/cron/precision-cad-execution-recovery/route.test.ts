import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), recover: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDb }));
vi.mock('@/lib/precision-cad-agent/dbExecutionJournalStore', () => ({ DbExecutionJournalStore: class { recoverExpiredLeases = mocks.recover; } }));
import { POST } from './route';

const secret = 'r'.repeat(32);
const request = (auth = secret) => new NextRequest('https://local.test/api/cron/precision-cad-execution-recovery', { method: 'POST', headers: { authorization: `Bearer ${auth}` } });
beforeEach(() => { vi.stubEnv('CRON_SECRET', secret); mocks.getDb.mockReturnValue({}); mocks.recover.mockResolvedValue([{ executionId: 'exec-1', status: 'HOLD' }]); });

describe('precision CAD execution recovery', () => {
  it('requires maintenance auth and never recovers by re-running a worker', async () => {
    expect((await POST(request('wrong'))).status).toBe(403);
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: 'PRECISION_CAD_EXECUTION_RECOVERY_COMPLETE', heldCount: 1 });
    expect(mocks.recover).toHaveBeenCalledWith(expect.any(Number), 100);
  });
  it('fails closed when the versioned migration is unavailable', async () => {
    mocks.recover.mockRejectedValue(new Error('commercial_execution_migration_required:v2026082202'));
    expect((await POST(request())).status).toBe(503);
    await expect((await POST(request())).json()).resolves.toMatchObject({ code: 'MIGRATION_REQUIRED' });
  });
});
