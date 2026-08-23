import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), queryOne: vi.fn(), uploadPrivate: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: async () => ({ userId: 'u1', plan: 'pro', orgId: null }) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/org-context', () => ({ resolveRequestOrgContext: () => ({ ok: true, orgId: null }) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ execute: mocks.execute, queryOne: mocks.queryOne }) }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ uploadPrivate: mocks.uploadPrivate }) }));
vi.mock('@/lib/billing-engine', () => ({ PLAN_LIMITS: { pro: { storage_gb: 10 } }, recordUsage: vi.fn() }));
vi.mock('@/lib/nfOrderAccess', () => ({ canManageOrderInActiveWorkspace: () => true }));

import { POST } from './route';

function request(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new NextRequest('https://nexyfab.com/api/nexyfab/files', {
    method: 'POST', body, headers: { 'content-type': 'multipart/form-data; boundary=test', ...headers }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('NexyFab files bounded upload ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(undefined);
    mocks.queryOne.mockResolvedValue({ total_bytes: 0 });
  });

  it('cancels a measured oversized upload before private storage mutation', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x2d]));
        for (let i = 0; i < 101; i++) controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(request(stream, { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.uploadPrivate).not.toHaveBeenCalled();
  });

  it('preserves malformed multipart as a bad request without storage mutation', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.close(); },
    });
    const response = await POST(request(stream, {}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid form data' });
    expect(mocks.uploadPrivate).not.toHaveBeenCalled();
  });
});
