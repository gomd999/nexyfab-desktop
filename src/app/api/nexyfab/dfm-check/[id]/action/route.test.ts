import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), execute: vi.fn(), logFunnelEvent: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: async () => ({ userId: 'u1' }) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ queryOne: mocks.queryOne, execute: mocks.execute }) }));
vi.mock('@/lib/funnel-logger', () => ({ logFunnelEvent: mocks.logFunnelEvent }));

import { POST } from './route';

function request(body: BodyInit) {
  return new NextRequest('http://localhost/api/nexyfab/dfm-check/check-1/action', {
    method: 'POST', body, headers: { 'content-type': 'application/json' },
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>) {
  return new NextRequest('http://localhost/api/nexyfab/dfm-check/check-1/action', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': '1' }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

const context = { params: Promise.resolve({ id: 'check-1' }) };

describe('DFM action bounded ingress', () => {
  it('rejects invalid UTF-8 before database and funnel side effects', async () => {
    const response = await POST(request(new Uint8Array([0xff])), context);
    expect(response.status).toBe(400);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.logFunnelEvent).not.toHaveBeenCalled();
  });

  it('cancels measured overflow before database and funnel side effects', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(16 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream), context);
    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.logFunnelEvent).not.toHaveBeenCalled();
  });
});
