import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), claim: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDb }));
vi.mock('@/lib/precision-cad-agent/commercialExecutionOutboxStore', () => ({ CommercialExecutionOutboxStore: class { claim = mocks.claim; recoverExpiredClaims = vi.fn().mockResolvedValue(0); } }));
import { POST } from './route';
const request = (token = 'c'.repeat(32)) => new NextRequest('https://local.test/api/cron/precision-cad-commercial-outbox', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'c'.repeat(32)); vi.stubEnv('NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 's'.repeat(32)); mocks.getDb.mockReturnValue({}); mocks.claim.mockResolvedValue({ ok: false, code: 'NOT_FOUND' }); });
describe('commercial outbox cron', () => { it('authenticates recovery without consuming a pending worker claim', async () => { expect((await POST(request('wrong'))).status).toBe(403); const response = await POST(request()); expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ code: 'EXTERNAL_WORKER_POLL_REQUIRED', releaseReady: false }); expect(mocks.claim).not.toHaveBeenCalled(); }); });
