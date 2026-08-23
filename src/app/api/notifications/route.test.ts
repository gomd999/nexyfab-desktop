import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: async () => ({ userId: 'u1', email: 'user@example.com' }) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/notificationRecipientKeys', () => ({ notificationRecipientKeys: () => ['u1'], sqlPlaceholders: () => '?' }));

import { DELETE, POST } from './route';

function request(method: 'POST' | 'DELETE', body: BodyInit) {
  return new NextRequest('http://localhost/api/notifications', {
    method, body, headers: { 'content-type': 'application/json' },
  });
}

function streamedRequest(method: 'POST' | 'DELETE', body: ReadableStream<Uint8Array>) {
  return new NextRequest('http://localhost/api/notifications', {
    method, body, headers: { 'content-type': 'application/json', 'content-length': '1' }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('notification mutation bounded ingress', () => {
  it('rejects invalid UTF-8 instead of marking or deleting notifications', async () => {
    expect((await POST(request('POST', new Uint8Array([0xff])))).status).toBe(400);
    expect((await DELETE(request('DELETE', new Uint8Array([0xff])))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('cancels measured overflow before notification mutation', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(16 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await DELETE(streamedRequest('DELETE', stream));
    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
