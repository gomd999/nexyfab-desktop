import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildComplexSystemGraphFixture } from '@/lib/ai/complexSystemGraph.testFixture';
import { POST } from './route';

function request(valid: boolean, ip: string) {
  const form = new FormData(), base = buildComplexSystemGraphFixture(), target = structuredClone(base.graph); target.revision++;
  if (valid) {
    form.set('baseGraph', new File([new Uint8Array(base.graphBytes)], 'base.json'));
    form.set('targetGraph', new File([JSON.stringify(target)], 'target.json'));
    for (const [name, bytes] of base.artifacts) { form.append('baseArtifact', new File([new Uint8Array(bytes)], name)); form.append('targetArtifact', new File([new Uint8Array(bytes)], name)); }
  }
  return new NextRequest('http://localhost/api/cad/v1/system/change-impact/verify', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}

describe('CAD v1 complex system change-impact verification', () => {
  it('returns a no-side-effect impact plan without release authority', async () => {
    const response = await POST(request(true, 'change-impact-ok'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, revalidationRequired: false, cadModified: false, quoteOrRfqSideEffects: false, report: { schema: 'nexyfab.complex-system-change-impact-report.v1', impactPlanReady: true, scope: 'none', releaseReady: false } });
  });
  it('requires both revisions and both artifact sets', async () => { expect((await POST(request(false, 'change-impact-empty'))).status).toBe(400); });
  it('rejects declared multipart ingress beyond the file total plus framing allowance', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/system/change-impact/verify', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(300_000_000 + 4 * 1024 * 1024 + 1), 'x-forwarded-for': 'change-impact-oversize' }, body: 'x' }));
    expect(response.status).toBe(413); await expect(response.json()).resolves.toEqual({ ok: false, code: 'TOO_LARGE' });
  });
});
