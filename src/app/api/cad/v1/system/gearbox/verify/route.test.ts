import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildGearboxFamilyContractFixture } from '@/lib/ai/familyContracts/gearbox/gearboxContract.testFixture';
import { POST } from './route';

function request(valid: boolean, ip: string) { const form = new FormData(), fixture = buildGearboxFamilyContractFixture(); if (valid) { form.set('graph', new File([new Uint8Array(fixture.graphBytes)], 'graph.json')); form.set('contract', new File([new Uint8Array(fixture.contractBytes)], 'gearbox.json')); for (const [name, bytes] of fixture.artifacts) form.append('artifact', new File([new Uint8Array(bytes)], name)); } return new NextRequest('http://localhost/api/cad/v1/system/gearbox/verify', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } }); }
describe('CAD v1 gearbox family verification', () => {
  it('returns calculated family eligibility without physical or release claims', async () => { const response = await POST(request(true, 'gearbox-ok')); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, releaseReady: false, physicalValidationRequired: true, finalExpertReviewRequired: true, cadModified: false, quoteOrRfqSideEffects: false, report: { status: 'passed', familyContractReady: true, physicalValidationComplete: false, releaseReady: false } }); });
  it('requires the complete graph, contract and evidence bytes', async () => { expect((await POST(request(false, 'gearbox-empty'))).status).toBe(400); });
  it('rejects multipart ingress beyond the bounded envelope', async () => { const response = await POST(new NextRequest('http://localhost/api/cad/v1/system/gearbox/verify', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(150_000_000 + 2 * 1024 * 1024 + 1), 'x-forwarded-for': 'gearbox-oversize' }, body: 'x' })); expect(response.status).toBe(413); await expect(response.json()).resolves.toEqual({ ok: false, code: 'TOO_LARGE' }); });
});
