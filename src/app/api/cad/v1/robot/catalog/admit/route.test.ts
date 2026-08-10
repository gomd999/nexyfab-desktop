import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const artifact = new TextEncoder().encode('catalog evidence');
const hash = createHash('sha256').update(artifact).digest('hex');
const manifest = { schema: 'nexyfab.robot-component-catalog.v1', components: [{ id: 'bearing-1', kind: 'bearing', manufacturer: 'Maker', model: 'B1', revision: 'A', source: 'datasheet', artifactHash: hash, massKg: 0.2, massSource: 'confirmed', envelopeMm: { x: 30, y: 30, z: 10 }, interface: { axisRef: 'bore_axis', mountingPlaneRef: 'side_face', shaftDiameterMm: 10 }, boreMm: 10, odMm: 30, widthMm: 10, dynamicLoadN: 1000, staticLoadN: 500, limitingRpm: 5000 }], artifacts: [{ path: 'bearing.pdf', sha256: hash, source: 'datasheet', mediaType: 'application/pdf' }] };
function request(manifestValue: unknown, artifactBytes: Uint8Array, ip: string) {
  const form = new FormData(); form.set('manifest', new File([JSON.stringify(manifestValue)], 'manifest.json', { type: 'application/json' })); form.append('artifact', new File([new Uint8Array(artifactBytes)], 'bearing.pdf', { type: 'application/pdf' }));
  return new NextRequest('http://localhost/api/cad/v1/robot/catalog/admit', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } });
}
describe('CAD v1 robot catalog admission', () => {
  it('returns a non-persistent production-eligible validation report for exact bytes', async () => {
    const response = await POST(request(manifest, artifact, 'catalog-ok')); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, productionEligible: true, quoteOrRfqSideEffects: false, report: { valid: true, selectionReady: false, selectionStatus: 'not_run', artifactCount: 1, artifacts: [{ verified: true }], sideEffects: { persisted: false, catalogActivated: false, quoteCreated: false, rfqSent: false } } });
  });
  it('returns 422 instead of activating a hash-mismatched catalog', async () => {
    const response = await POST(request(manifest, new TextEncoder().encode('changed'), 'catalog-mismatch')); expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, productionEligible: false, quoteOrRfqSideEffects: false });
  });
  it('requires files and rate-limits before validation work', async () => {
    const empty = () => new NextRequest('http://localhost/api/cad/v1/robot/catalog/admit', { method: 'POST', body: new FormData(), headers: { 'x-forwarded-for': 'catalog-rate' } });
    for (let index = 0; index < 5; index += 1) expect((await POST(empty())).status).toBe(400);
    expect((await POST(empty())).status).toBe(429);
  });
});
