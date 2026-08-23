import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRobotMotionCoverageFixture } from '@/lib/ai/robot/robotMotionCoverage.testFixture';
import { POST } from './route';

function request(requirements: Uint8Array | null, input: unknown | null, ip: string, evidence: ReadonlyMap<string, Uint8Array> = new Map()) {
  const form = new FormData();
  if (requirements) form.set('requirements', new File([new Uint8Array(requirements)], 'requirements.json', { type: 'application/json' }));
  if (input) form.set('motionInput', new File([JSON.stringify(input)], 'motion.json', { type: 'application/json' }));
  for (const [hash, bytes] of evidence) form.append('sweptEvidence', new File([new Uint8Array(bytes)], `${hash}.json`, { type: 'application/json' }));
  return new NextRequest('http://localhost/api/cad/v1/robot/motion/coverage', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

async function chunkedRequest(form: FormData, ip: string): Promise<NextRequest> {
  const encoded = new Request('http://localhost/api/cad/v1/robot/motion/coverage', { method: 'POST', body: form });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const contentType = encoded.headers.get('content-type');
  if (!contentType) throw new Error('multipart content type missing');
  const requestInit = {
    method: 'POST',
    // Deliberately stale: the route must trust measured bytes, then remove
    // transport framing when it reconstructs the request for multipart parse.
    headers: { 'content-type': contentType, 'content-length': '1', 'x-forwarded-for': ip },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const midpoint = Math.max(1, Math.floor(bytes.byteLength / 2));
        controller.enqueue(bytes.subarray(0, midpoint));
        controller.enqueue(bytes.subarray(midpoint));
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' };
  return new NextRequest('http://localhost/api/cad/v1/robot/motion/coverage', requestInit as never);
}

async function withTrustedSigners<T>(trustedSigners: ReadonlyMap<string, { publicKey: string; role: 'worker' | 'kernel'; identitySha256: string }>, run: () => Promise<T>): Promise<T> {
  const previous = process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS;
  process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS = JSON.stringify(Object.fromEntries(trustedSigners));
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS;
    else process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS = previous;
  }
}

describe('CAD v1 robot motion coverage', () => {
  it('returns complete governed motion coverage without release effects', async () => {
    const fixture = buildRobotMotionCoverageFixture();
    const response = await withTrustedSigners(fixture.trustedSigners, () => POST(request(fixture.requirementsBytes, fixture.motionInput, 'robot-motion-ok', fixture.sweptEvidenceArtifacts)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, physicalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { motionCoverageReady: true, continuousCollisionCoverageComplete: true, physicalValidationComplete: false, releaseReady: false } });
  });

  it('fails closed when the server trusted signer registry is absent', async () => {
    const fixture = buildRobotMotionCoverageFixture();
    const previous = process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS;
    delete process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS;
    try {
      const response = await POST(request(fixture.requirementsBytes, fixture.motionInput, 'robot-motion-no-trust', fixture.sweptEvidenceArtifacts));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ ok: false, report: { motionCoverageReady: false, sweptEvidenceArtifactsVerified: false } });
    } finally {
      if (previous === undefined) delete process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS;
      else process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS = previous;
    }
  });

  it('fails closed when the request omits the referenced swept evidence bytes', async () => {
    const fixture = buildRobotMotionCoverageFixture();
    const response = await POST(request(fixture.requirementsBytes, fixture.motionInput, 'robot-motion-missing-evidence'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, report: { motionCoverageReady: false, sweptEvidenceArtifactsVerified: false } });
  });

  it('returns 422 on incomplete continuous coverage', async () => {
    const fixture = buildRobotMotionCoverageFixture();
    fixture.motionInput.combinations[0]!.segments.pop();
    const response = await POST(request(fixture.requirementsBytes, fixture.motionInput, 'robot-motion-fail', fixture.sweptEvidenceArtifacts));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, report: { motionCoverageReady: false } });
  });

  it('requires both files', async () => {
    expect((await POST(request(null, null, 'robot-motion-empty'))).status).toBe(400);
  });

  it('rejects uploaded files with a non-JSON MIME type', async () => {
    const fixture = buildRobotMotionCoverageFixture();
    const form = new FormData();
    form.set('requirements', new File([new Uint8Array(fixture.requirementsBytes)], 'requirements.json', { type: 'text/plain' }));
    form.set('motionInput', new File([JSON.stringify(fixture.motionInput)], 'motion.json', { type: 'application/json' }));
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/robot/motion/coverage', { method: 'POST', body: form, headers: { 'x-forwarded-for': 'robot-motion-content-type' } }));
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('parses a chunked multipart body after the bounded pre-parse read preserves its boundary', async () => {
    const fixture = buildRobotMotionCoverageFixture();
    const form = new FormData();
    form.set('requirements', new File([new Uint8Array(fixture.requirementsBytes)], 'requirements.json', { type: 'application/json' }));
    form.set('motionInput', new File([JSON.stringify(fixture.motionInput)], 'motion.json', { type: 'application/json' }));
    for (const [hash, bytes] of fixture.sweptEvidenceArtifacts) form.append('sweptEvidence', new File([new Uint8Array(bytes)], `${hash}.json`, { type: 'application/json' }));
    const response = await withTrustedSigners(fixture.trustedSigners, () => chunkedRequest(form, 'robot-motion-chunked').then(POST));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, report: { motionCoverageReady: true } });
  });

  it('rejects a chunked body over 55 MB before multipart parsing', async () => {
    const requestInit = {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=chunked-limit', 'x-forwarded-for': 'robot-motion-chunked-too-large' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(55_000_001));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const request = new NextRequest('http://localhost/api/cad/v1/robot/motion/coverage', requestInit as never);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });

  it('rejects empty or malformed multipart bodies safely', async () => {
    const empty = await POST(new NextRequest('http://localhost/api/cad/v1/robot/motion/coverage', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=empty', 'x-forwarded-for': 'robot-motion-empty-body' },
    }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ ok: false, code: 'BAD_REQUEST' });

    const malformed = await POST(new NextRequest('http://localhost/api/cad/v1/robot/motion/coverage', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=malformed', 'x-forwarded-for': 'robot-motion-malformed-body' },
      body: 'not multipart',
    }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });
});
