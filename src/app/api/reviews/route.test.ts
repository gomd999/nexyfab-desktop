import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), sendEmail: vi.fn(), recordMetric: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: async () => ({ userId: 'u1', email: 'user@example.com' }) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDb }));
vi.mock('@/app/lib/mailer', () => ({ sendNotificationEmail: mocks.sendEmail }));
vi.mock('@/lib/partner-metrics', () => ({ recordMetric: mocks.recordMetric }));

import { POST } from './route';

function request(body: BodyInit) {
  return new NextRequest('http://localhost/api/reviews', {
    method: 'POST', body, headers: { 'content-type': 'application/json' },
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>) {
  return new NextRequest('http://localhost/api/reviews', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': '1' }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

function expectNoMutation() {
  expect(mocks.getDb).not.toHaveBeenCalled();
  expect(mocks.sendEmail).not.toHaveBeenCalled();
  expect(mocks.recordMetric).not.toHaveBeenCalled();
}

describe('reviews bounded ingress', () => {
  it('rejects invalid UTF-8 before DB, metrics and email side effects', async () => {
    const response = await POST(request(new Uint8Array([0xff])));
    expect(response.status).toBe(400);
    expectNoMutation();
  });

  it('cancels measured overflow before DB, metrics and email side effects', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream));
    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
    expectNoMutation();
  });
});
