import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('CAD v1 manufacturing verify', () => {
  it('fails closed without evidence and performs no external side effect', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/manufacturing/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    const payload = await response.json();
    expect(payload.report.gates.every((gate: { status: string }) => gate.status === 'not_run')).toBe(true);
    expect(payload.designOk).toBe(false);
    expect(payload.sideEffects).toEqual({ quoteCreated: false, rfqCreated: false, artifactReleased: false });
  });

  it('never upgrades client-asserted measurements into an authoritative manufacturing pass', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/manufacturing/verify', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'manufacturing-self-attested' }, body: JSON.stringify({
        provenance: { traceable: true, privacyCompliant: true, refs: ['caller:claim'] },
        intent: { resolved: true, unresolved: [], conflicts: [] },
        program: { valid: true, errors: [], hash: 'caller-claim' },
        kernel: { built: true, analytic: true, engine: 'OCCT', errors: [] },
        topology: { closed: true, solidCount: 1, manifold: true, errors: [] },
        dimensions: { checked: 1, maxErrorMm: 0, toleranceMm: 0.1, mismatches: [] },
        features: { requested: 1, verified: 1, skipped: [], mismatches: [] },
        dfm: { process: 'claimed', material: 'claimed', passed: true, violations: [] },
        stepRoundtrip: { reimported: true, topologyMatched: true, dimensionsMatched: true, errors: [] },
        release: { artifactId: 'claimed', exactArtifactVerified: true, authorized: true, reasons: [] },
      }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      reportedGatePass: true,
      designOk: false,
      releaseReady: false,
      authoritative: false,
      trustBoundary: 'client_asserted_preview',
      blockers: ['SERVER_DERIVED_MANUFACTURING_EVIDENCE_REQUIRED'],
    });
  });

  it('measures a chunked body despite a false Content-Length and cancels it over the cap', async () => {
    let cancelled = false;
    const request = new Request('http://localhost/api/cad/v1/manufacturing/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1', 'x-forwarded-for': 'manufacturing-stream-cap' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"evidence":"'));
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() { cancelled = true; },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });

  it('preserves INVALID_EVIDENCE for malformed JSON and invalid UTF-8', async () => {
    for (const [suffix, body] of [['json', '{'], ['utf8', new Uint8Array([0xff])]] as const) {
      const response = await POST(new NextRequest('http://localhost/api/cad/v1/manufacturing/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `manufacturing-malformed-${suffix}` },
        body,
      }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'INVALID_EVIDENCE' });
    }
  });
});
