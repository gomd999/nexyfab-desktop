import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildComplexAssemblyScaleFixture } from '@/lib/ai/complexAssemblyScaleBenchmark.testFixture';
import { POST } from './route';

const MAX_SCALE_MULTIPART_BYTES = 128 * 1024 * 1024;
function request(valid: boolean, ip: string) { const form = new FormData(), fixture = buildComplexAssemblyScaleFixture(); if (valid) { form.set('benchmark', new File([new Uint8Array(fixture.bytes)], 'benchmark.json')); for (const [name, bytes] of fixture.artifacts) form.append('artifact', new File([new Uint8Array(bytes)], name)); } return new NextRequest('http://localhost/api/cad/v1/system/scale/verify', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } }); }
describe('CAD v1 complex assembly scale benchmark', () => {
  it('returns a recomputed four-tier report without release authority', async () => { const response = await POST(request(true, 'scale-ok')); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, independentBenchmarkApprovalRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { schema: 'nexyfab.complex-assembly-scale-benchmark-report.v1', benchmarkExecutionReady: true, independentBenchmarkApprovalComplete: false, releaseReady: false } }); });
  it('requires benchmark and artifact bytes', async () => { expect((await POST(request(false, 'scale-empty'))).status).toBe(400); });
  it('rejects multipart ingress beyond the bounded envelope', async () => { const response = await POST(new NextRequest('http://localhost/api/cad/v1/system/scale/verify', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_SCALE_MULTIPART_BYTES + 1), 'x-forwarded-for': 'scale-oversize' }, body: 'x' })); expect(response.status).toBe(413); await expect(response.json()).resolves.toEqual({ ok: false, code: 'TOO_LARGE' }); });
});
