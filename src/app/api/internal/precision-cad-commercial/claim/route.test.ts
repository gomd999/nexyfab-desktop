import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), claim: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDb }));
vi.mock('@/lib/precision-cad-agent/commercialExecutionOutboxStore', () => ({ CommercialExecutionOutboxStore: class { claim = mocks.claim; } }));
import { POST } from './route';
const request = (body: unknown, secret = 's'.repeat(32)) => new NextRequest('https://local.test/api/internal/precision-cad-commercial/claim', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv('NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET', 's'.repeat(32)); vi.stubEnv('NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 't'.repeat(32)); vi.stubEnv('NEXYFAB_COMMERCIAL_CALLBACK_URL', 'https://core.example.test/callback'); vi.stubEnv('NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON', ''); mocks.getDb.mockReturnValue({}); mocks.claim.mockResolvedValue({ ok: false, code: 'NOT_FOUND' }); });
describe('commercial claim route', () => { it('rejects unauthorized and unregistered worker identities', async () => { expect((await POST(request({ owner: 'worker-1' }, 'wrong'))).status).toBe(403); expect((await POST(request({ owner: 'worker-1' }))).status).toBe(403); }); it('holds while the worker registry is absent', async () => { vi.stubEnv('NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', ''); expect((await POST(request({ owner: 'worker-1' }))).status).toBe(403); }); });
