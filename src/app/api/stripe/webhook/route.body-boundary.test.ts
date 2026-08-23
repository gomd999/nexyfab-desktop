import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDbAdapter: vi.fn(),
  enqueueJob: vi.fn(),
}));

vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));
vi.mock('@/lib/job-queue', () => ({ enqueueJob: mocks.enqueueJob }));

import { POST } from './route';

const STRIPE_WEBHOOK_RAW_BYTES = 1024 * 1024;

const WEBHOOK_SECRET = 'whsec_route_boundary_test';

function stripeSignature(bytes: Uint8Array): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.`)
    .update(bytes)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function requestFromStream(
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string>,
): Parameters<typeof POST>[0] {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' }) as Parameters<typeof POST>[0];
}

describe('Stripe webhook request boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_route_boundary');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    mocks.getDbAdapter.mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(null),
      execute: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('rejects a declared oversized body, cancels it, and performs no DB work', async () => {
    let cancelled = false;
    const request = requestFromStream(
      new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }),
      { 'content-length': String(STRIPE_WEBHOOK_RAW_BYTES + 1), 'stripe-signature': 'ignored' },
    );

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.getDbAdapter).not.toHaveBeenCalled();
  });

  it('does not trust a false Content-Length and cancels an oversized stream', async () => {
    let cancelled = false;
    const request = requestFromStream(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(STRIPE_WEBHOOK_RAW_BYTES));
          controller.enqueue(new Uint8Array([0x7d]));
        },
        cancel() { cancelled = true; },
      }),
      { 'content-length': '1', 'stripe-signature': 'ignored' },
    );

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.getDbAdapter).not.toHaveBeenCalled();
  });

  it('verifies the exact UTF-8 bytes before recording a valid event', async () => {
    const raw = '{\n  "id":"evt_exact", "object":"event", "type":"customer.created", "data":{"object":{}}, "note":"정밀 CAD"\n}';
    const bytes = new TextEncoder().encode(raw);
    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': stripeSignature(bytes) },
      body: bytes,
    }) as Parameters<typeof POST>[0];

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.getDbAdapter).toHaveBeenCalledOnce();
    const db = mocks.getDbAdapter.mock.results[0]?.value as { execute: ReturnType<typeof vi.fn> };
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO nf_webhook_events'),
      expect.any(String),
      'evt_exact',
      'customer.created',
      expect.any(Number),
      raw,
    );
  });

  it('rejects correctly signed invalid UTF-8 before any DB work', async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]);
    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': stripeSignature(bytes) },
      body: bytes,
    }) as Parameters<typeof POST>[0];

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mocks.getDbAdapter).not.toHaveBeenCalled();
  });
});
