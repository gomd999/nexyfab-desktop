import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: async () => ({ userId: 'u1', plan: 'team' }) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ execute: mocks.execute }) }));

import { POST } from './route';

function request(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new NextRequest('https://nexyfab.com/api/nexyfab/erp/import', {
    method: 'POST', body, headers: { 'content-type': 'multipart/form-data; boundary=test', ...headers }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('ERP import bounded upload ingress', () => {
  it('cancels a declared oversized import before database mutation', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const response = await POST(request(stream, { 'content-length': String(11 * 1024 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('preserves malformed multipart as a bad request before database mutation', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.close(); },
    });
    const response = await POST(request(stream));
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
