import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { logAudit } = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => 'test-ip' }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ allowed: true }) }));

import { POST } from './route';

const MAX_TEST_BODY_BYTES = 2_048;

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new NextRequest('https://nexyfab.com/api/observability/web-vitals/', {
    method: 'POST', body, headers: { 'content-type': 'application/json', ...headers }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('POST /api/observability/web-vitals', () => {
  beforeEach(() => logAudit.mockClear());

  it('stores a sanitized anonymous metric without IP or arbitrary fields', async () => {
    const request = new NextRequest('https://nexyfab.com/api/observability/web-vitals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'INP', value: 140, delta: 30, rating: 'good', device: 'mobile',
        route: '/kr/nexyfab/projects/private-project-id-123456?email=secret@example.com',
        prompt: 'private design prompt',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(logAudit).toHaveBeenCalledWith({
      userId: 'anonymous-rum',
      action: 'rum.web_vital',
      resourceId: '/kr/nexyfab/projects/:id',
      metadata: {
        name: 'INP', value: 140, delta: 30, rating: 'good', device: 'mobile',
        route: '/kr/nexyfab/projects/:id',
      },
    });
  });

  it('rejects unsupported or oversized metrics', async () => {
    const bad = new NextRequest('https://nexyfab.com/api/observability/web-vitals/', {
      method: 'POST', body: JSON.stringify({ name: 'FCP' }),
    });
    expect((await POST(bad)).status).toBe(400);

    const oversized = new NextRequest('https://nexyfab.com/api/observability/web-vitals/', {
      method: 'POST', body: '{}', headers: { 'content-length': '4096' },
    });
    expect((await POST(oversized)).status).toBe(413);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 without writing an audit event', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/observability/web-vitals/', {
      method: 'POST', body: new Uint8Array([0xff]), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: 'BAD_METRIC' });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('does not trust Content-Length and cancels measured overflow without audit mutation', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(MAX_TEST_BODY_BYTES));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
