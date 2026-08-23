import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), execute: vi.fn(), notify: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ queryOne: mocks.queryOne, execute: mocks.execute }) }));
vi.mock('@/app/lib/notify', () => ({ createNotification: mocks.notify }));

import { POST } from './route';

function request(body: BodyInit) {
  return new NextRequest('http://localhost/api/nexyfab/quote-response/q1?t=token-1', {
    method: 'POST', body, headers: { 'content-type': 'application/json' },
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>) {
  return new NextRequest('http://localhost/api/nexyfab/quote-response/q1?t=token-1', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': '1' }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

const context = { params: Promise.resolve({ quoteId: 'q1' }) };

describe('public quote response bounded ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryOne.mockResolvedValue({
      id: 'q1', inquiry_id: 'rfq-1', project_name: 'Part', factory_name: 'Factory', valid_until: null,
      status: 'pending', response_token: 'token-1', partner_email: null, estimated_amount: 0, estimated_days: null, note: null,
    });
  });

  it('rejects invalid UTF-8 before quote, RFQ and notification side effects', async () => {
    const response = await POST(request(new Uint8Array([0xff])), context);
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('cancels measured overflow before quote, RFQ and notification side effects', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream), context);
    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
