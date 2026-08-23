import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), read: vi.fn(), accept: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDb }));
vi.mock('@/lib/precision-cad-agent/commercialExecutionOutboxStore', () => ({ CommercialExecutionOutboxStore: class { read = mocks.read; acceptReceipt = mocks.accept; } }));
import { POST } from './route';
const body = JSON.stringify({ schema: 'nexyfab.precision-cad-commercial-execution.v2', status: 'PASS' });
const request = (value = body) => new NextRequest('https://local.test/api/internal/precision-cad-commercial/callback', { method: 'POST', headers: { 'x-commercial-callback-hmac': 'bad' }, body: value });
beforeEach(() => { vi.stubEnv('NEXYFAB_COMMERCIAL_CALLBACK_SECRET', 'c'.repeat(32)); mocks.getDb.mockReturnValue({}); });
describe('commercial callback route', () => {
  it('rejects forged callback HMAC and oversized/noncanonical callback bodies', async () => { expect((await POST(request())).status).toBe(403); const oversized = new NextRequest('https://local.test', { method: 'POST', headers: { 'x-commercial-callback-hmac': 'bad' }, body: 'x'.repeat(513 * 1024) }); expect((await POST(oversized)).status).toBe(413); });
  it('verifies HMAC over exact raw bytes before rejecting invalid UTF-8', async () => {
    const bytes = new Uint8Array([0xff]);
    const signature = createHmac('sha256', 'c'.repeat(32)).update(bytes).digest('base64url');
    const response = await POST(new NextRequest('https://local.test/api/internal/precision-cad-commercial/callback', { method: 'POST', headers: { 'x-commercial-callback-hmac': signature }, body: bytes }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'INVALID_JSON' });
  });
  it('holds when callback secret is not configured', async () => { vi.stubEnv('NEXYFAB_COMMERCIAL_CALLBACK_SECRET', ''); expect((await POST(request())).status).toBe(503); });
});
