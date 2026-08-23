import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildValidRobotSystemRequirementsFixture } from '@/lib/ai/robot/robotSystemRequirements.testFixture';
import { POST } from './route';

function request(body: BodyInit | null, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cad/v1/robot/requirements/verify', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cad/v1/robot/requirements/verify', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('CAD v1 robot system requirements verification', () => {
  it('freezes an authoritative and cross-field-consistent requirement set without side effects', async () => {
    const response = await POST(request(JSON.stringify(buildValidRobotSystemRequirementsFixture()), 'robot-req-ok'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      requirementsFrozen: true,
      releaseReady: false,
      cadModified: false,
      quoteOrRfqSideEffects: false,
      report: { requirementsReady: true, status: 'passed', releaseReady: false, sideEffects: { persisted: false, cadModified: false } },
    });
    expect(body.report.frozenRequirementsSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed on a cross-field contradiction', async () => {
    const value = buildValidRobotSystemRequirementsFixture();
    value.power.peakPowerW = value.power.rmsPowerW - 1;
    const response = await POST(request(JSON.stringify(value), 'robot-req-invalid'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, requirementsFrozen: false, releaseReady: false, cadModified: false, report: { requirementsReady: false, frozenRequirementsSha256: null } });
  });

  it('fails closed on malformed JSON and never creates downstream side effects', async () => {
    const response = await POST(request('{', 'robot-req-malformed'));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false, report: { status: 'failed', sideEffects: { persisted: false, quoteCreated: false, rfqSent: false } } });
  });

  it('passes invalid UTF-8 through the raw-byte verifier and fails closed', async () => {
    const response = await POST(request(new Uint8Array([0xff]), 'robot-req-invalid-utf8'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, requirementsFrozen: false, releaseReady: false, cadModified: false, report: { requirementsReady: false, status: 'failed', frozenRequirementsSha256: null } });
  });

  it('does not trust Content-Length and cancels an oversized stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(1_000_000));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, 'robot-req-stream-large', { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, code: 'TOO_LARGE' });
    expect(cancelled).toBe(true);
  });

  it('rejects empty and declared oversized bodies before verification', async () => {
    const empty = await POST(request(null, 'robot-req-empty'));
    expect(empty.status).toBe(400);
    const large = await POST(request('{}', 'robot-req-large', { 'content-length': '1000001' }));
    expect(large.status).toBe(413);
  });
});
