import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDb }));
vi.mock('@/lib/storage', () => ({ getStorage: vi.fn(() => ({})) }));
vi.mock('@/lib/precision-cad-agent/commercialWorkerReceipt', () => ({ loadTrustedCommercialWorkers: vi.fn(() => undefined) }));
import { POST } from './route';
const request = (token = 'c'.repeat(32), body = '{}') => new NextRequest('https://local.test/api/cron/precision-cad-commercial-persistence', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'c'.repeat(32)); mocks.getDb.mockClear(); mocks.getDb.mockReturnValue({}); });
describe('commercial persistence cron', () => {
  it('fails closed on auth, missing body, and absent trusted registries', async () => {
    expect((await POST(request('wrong'))).status).toBe(403);
    expect((await POST(request())).status).toBe(422);
    const response = await POST(request('c'.repeat(32), JSON.stringify({ executionId: 'exec-1', parserReceipt: { parserIdentity: 'p' } })));
    expect(response.status).toBe(503);
  });
  it('rejects oversized input before any database work', async () => {
    const response = await POST(request('c'.repeat(32), 'x'.repeat(512 * 1024 + 1)));
    expect(response.status).toBe(413); expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
