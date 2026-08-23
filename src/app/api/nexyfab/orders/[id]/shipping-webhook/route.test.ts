import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  queryOne: vi.fn(),
  getDbAdapter: vi.fn(),
}));

vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));

import { POST } from './route';

const URL = 'https://nexyfab.test/api/nexyfab/orders/order-1/shipping-webhook';
const SECRET = 'shipping-webhook-test-secret';

function signedRequest(raw: string, signature?: string) {
  const hex = signature ?? createHmac('sha256', SECRET).update(Buffer.from(raw, 'utf8')).digest('hex');
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shipping-signature': `sha256=${hex}` },
    body: raw,
  });
}

describe('shipping webhook exact-byte HMAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHIPPING_WEBHOOK_SECRET = SECRET;
    mocks.getDbAdapter.mockReturnValue({ execute: mocks.execute, queryOne: mocks.queryOne });
    mocks.execute.mockResolvedValue({ changes: 1 });
    mocks.queryOne.mockResolvedValue({
      id: 'order-1', status: 'production', tracking_number: null, tracking_updated_at: null,
    });
  });

  it('accepts a signature computed over the exact UTF-8 request bytes', async () => {
    const raw = JSON.stringify({
      trackingNumber: 'TRACK-1', carrier: 'dhl', event: 'in_transit', location: '서울',
    });

    const response = await POST(signedRequest(raw), { params: Promise.resolve({ id: 'order-1' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ received: true, statusAfter: 'shipped' });
    expect(mocks.getDbAdapter).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid signature before any database access', async () => {
    const raw = JSON.stringify({ trackingNumber: 'TRACK-1', carrier: 'dhl', event: 'in_transit' });

    const response = await POST(signedRequest(raw, '0'.repeat(64)), { params: Promise.resolve({ id: 'order-1' }) });

    expect(response.status).toBe(401);
    expect(mocks.getDbAdapter).not.toHaveBeenCalled();
  });
});
