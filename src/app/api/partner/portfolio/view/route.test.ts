import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  queryOne: vi.fn(),
  ensure: vi.fn(),
  record: vi.fn(),
  rate: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '203.0.113.44') }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ queryOne: mocks.queryOne }) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rate }));
vi.mock('@/lib/partner-portfolio-views', () => ({
  ensurePortfolioViewTable: mocks.ensure,
  recordPortfolioView: mocks.record,
}));

import { POST } from './route';

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new NextRequest('https://nexyfab.com/api/partner/portfolio/view', {
    method: 'POST', body, headers, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.rate.mockReturnValue({ allowed: true, remaining: 59, resetAt: Date.now() + 60_000 });
  mocks.ensure.mockResolvedValue(undefined);
  mocks.record.mockResolvedValue(undefined);
  mocks.queryOne.mockResolvedValueOnce({ id: 'factory-1' }).mockResolvedValueOnce({ n: 0 });
});

describe('public portfolio view tracking', () => {
  it('uses the trusted viewer identity and bounds the source label', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/partner/portfolio/view', {
      method: 'POST',
      headers: {
        // This should not override the trusted client-ip helper.
        'x-forwarded-for': '198.51.100.99',
        'user-agent': 'focused-test',
      },
      body: JSON.stringify({
        partnerEmail: 'Owner@Example.com',
        source: `  ${'s'.repeat(200)}  `,
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      partnerEmail: 'owner@example.com',
      source: 's'.repeat(64),
      viewerIpHash: expect.any(String),
    }));
    expect(mocks.queryOne).toHaveBeenCalledTimes(2);
    expect(mocks.queryOne.mock.calls[0][0]).toContain('nf_user_roles');
  });

  it('does not create a count for an unknown partner email', async () => {
    mocks.queryOne.mockReset();
    mocks.queryOne.mockResolvedValue(null);

    const response = await POST(new NextRequest('https://nexyfab.com/api/partner/portfolio/view', {
      method: 'POST',
      body: JSON.stringify({ partnerEmail: 'nobody@example.com' }),
    }));

    expect(response.status).toBe(404);
    expect(mocks.queryOne).toHaveBeenCalledTimes(2);
    expect(mocks.queryOne.mock.calls[1][0]).toContain('nf_factories');
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('applies a dedicated limiter before parsing or writing', async () => {
    mocks.rate.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 10_000 });

    const response = await POST(new NextRequest('https://nexyfab.com/api/partner/portfolio/view', {
      method: 'POST',
      body: JSON.stringify({ partnerEmail: 'owner@example.com' }),
    }));

    expect(response.status).toBe(429);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('does not trust false-small Content-Length and cancels actual overflow before DB work', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(16 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 before DB work', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/partner/portfolio/view', {
      method: 'POST', body: new Uint8Array([0xff]),
    }));
    expect(response.status).toBe(400);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
