import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

function request(body: BodyInit | null, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cad/v1/mep/route', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cad/v1/mep/route', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('CAD v1 MEP routing', () => {
  it('routes a valid bounded request without downstream quote or RFQ effects', async () => {
    const response = await POST(request(JSON.stringify({
      request: {
        id: 'supply-1',
        system: 'supply_air',
        startMm: [0, 0, 0],
        endMm: [1_000, 0, 0],
        clearanceMm: 0,
        gridMm: 100,
        obstacles: [],
      },
    }), 'mep-route-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, routeVerificationPassed: true, releaseReady: false, releaseGate: { status: 'HOLD', releaseReady: false }, route: { status: 'routed' }, quoteOrRfqSideEffects: false });
  });

  it('preserves the existing bad-request response for malformed JSON and invalid UTF-8', async () => {
    for (const [body, ip] of [['{', 'mep-route-malformed'], [new Uint8Array([0xff]), 'mep-route-invalid-utf8']] as const) {
      const response = await POST(request(body, ip));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, code: 'BAD_REQUEST', message: 'request is required' });
    }
  });

  it('does not trust Content-Length and cancels an oversized stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(4 * 1024 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, 'mep-route-stream-large', { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });
});
