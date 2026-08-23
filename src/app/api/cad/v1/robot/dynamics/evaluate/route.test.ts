import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotDynamicLoadEnvelopeFixture } from '@/lib/ai/robot/robotDynamicLoadEnvelope.testFixture';
import { POST } from './route';

function request(body: BodyInit | null, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cad/v1/robot/dynamics/evaluate', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers } });
}

function streamedRequest(body: ReadableStream<Uint8Array>, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cad/v1/robot/dynamics/evaluate', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('CAD v1 robot dynamic load evaluation', () => {
  it('returns a hash-bound dynamic trace but never releases or modifies CAD', async () => {
    const response = await POST(request(JSON.stringify(buildRobotDynamicLoadEnvelopeFixture()), 'robot-dynamics-ok'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false, report: { dynamicsReady: true, status: 'passed', frameCount: 2, releaseReady: false, sideEffects: { persisted: false, cadModified: false } } });
    expect(body.report.traceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.report.joints).toHaveLength(6);
  });

  it('fails closed when a drive curve is insufficient', async () => {
    const value = buildRobotDynamicLoadEnvelopeFixture();
    value.drives[0]!.torqueSpeedCurve = value.drives[0]!.torqueSpeedCurve.map(point => ({ ...point, continuousTorqueNm: 1, peakTorqueNm: 2 }));
    const response = await POST(request(JSON.stringify(value), 'robot-dynamics-fail'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, cadModified: false, report: { dynamicsReady: false, status: 'failed' } });
  });

  it('rejects malformed JSON without downstream effects', async () => {
    const response = await POST(request('{', 'robot-dynamics-malformed'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false, report: { traceSha256: null, sideEffects: { quoteCreated: false, rfqSent: false } } });
  });

  it('passes invalid UTF-8 through the raw-byte verifier and fails closed', async () => {
    const response = await POST(request(new Uint8Array([0xff]), 'robot-dynamics-invalid-utf8'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, cadModified: false, report: { dynamicsReady: false, status: 'failed', traceSha256: null } });
  });

  it('does not trust Content-Length and cancels an oversized stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(5_000_000));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, 'robot-dynamics-stream-large', { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, code: 'TOO_LARGE' });
    expect(cancelled).toBe(true);
  });

  it('rejects empty and declared oversized input', async () => {
    expect((await POST(request(null, 'robot-dynamics-empty'))).status).toBe(400);
    expect((await POST(request('{}', 'robot-dynamics-large', { 'content-length': '5000001' }))).status).toBe(413);
  });
});
