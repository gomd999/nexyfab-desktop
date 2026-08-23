import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildComplexSystemGraphFixture } from '@/lib/ai/complexSystemGraph.testFixture';
import { POST } from './route';

function request(valid: boolean, ip: string) {
  const form = new FormData(), fixture = buildComplexSystemGraphFixture();
  if (valid) {
    form.set('graph', new File([new Uint8Array(fixture.graphBytes)], 'graph.json'));
    for (const [name, bytes] of fixture.artifacts) form.append('artifact', new File([new Uint8Array(bytes)], name));
  }
  return new NextRequest('http://localhost/api/cad/v1/system/verify', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 complex system graph verification', () => {
  it('returns a byte-bound system graph report without release or transaction effects', async () => {
    const response = await POST(request(true, 'system-graph-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, familyContractRequired: true, physicalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { schema: 'nexyfab.complex-system-graph-report.v2', status: 'passed', graphReady: true, releaseReady: false } });
  });
  it('requires graph and artifact bytes', async () => { expect((await POST(request(false, 'system-graph-empty'))).status).toBe(400); });
  it('rejects oversize before multipart parsing and keeps malformed multipart on BAD_REQUEST', async () => {
    const oversize = await POST(new NextRequest('http://localhost/api/cad/v1/system/verify', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(150_000_000 + 2 * 1024 * 1024 + 1), 'x-forwarded-for': 'system-graph-oversize' }, body: 'x' }));
    expect(oversize.status).toBe(413); await expect(oversize.json()).resolves.toEqual({ ok: false, code: 'TOO_LARGE' });
    const malformed = await POST(new NextRequest('http://localhost/api/cad/v1/system/verify', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=missing', 'x-forwarded-for': 'system-graph-malformed' }, body: new Uint8Array([1, 2, 3]) }));
    expect(malformed.status).toBe(400); await expect(malformed.json()).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });
});
