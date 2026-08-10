import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const artifact = new TextEncoder().encode('selection evidence'); const hash = createHash('sha256').update(artifact).digest('hex');
const base = { manufacturer: 'M', revision: 'A', source: 'datasheet', artifactHash: hash, massSource: 'confirmed', interface: { axisRef: 'axis', mountingPlaneRef: 'face', shaftDiameterMm: 30 } };
const manifest = { schema: 'nexyfab.robot-component-catalog.v1', components: [{ ...base, id: 'M', model: 'M', kind: 'motor', massKg: 1, envelopeMm: { x: 50, y: 50, z: 80 }, ratedTorqueNm: 10, peakTorqueNm: 20, maxRpm: 5000, rotorInertiaKgM2: 0.01 }, { ...base, id: 'R', model: 'R', kind: 'reducer', massKg: 2, envelopeMm: { x: 80, y: 80, z: 60 }, ratio: 100, ratedOutputTorqueNm: 1000, peakOutputTorqueNm: 1500, maxInputRpm: 6000, efficiency: 0.9, backlashArcmin: 2 }, { ...base, id: 'B', model: 'B', kind: 'bearing', massKg: 0.5, envelopeMm: { x: 80, y: 80, z: 20 }, boreMm: 30, odMm: 80, widthMm: 20, dynamicLoadN: 20000, staticLoadN: 10000, limitingRpm: 5000 }], artifacts: [{ path: 'catalog.pdf', sha256: hash, source: 'datasheet' }] };
const requirements = { schema: 'nexyfab.robot-selection-requirements.v1', requirements: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, requiredOutputTorqueNm: 100, requiredOutputRpm: 10, radialLoadN: 1000, minShaftDiameterMm: 25, safetyFactor: 1.5 })) };
function request(requirementValue: unknown, bytes: Uint8Array, ip: string) { const form = new FormData(); form.set('requirements', new File([JSON.stringify(requirementValue)], 'requirements.json')); form.set('manifest', new File([JSON.stringify(manifest)], 'manifest.json')); form.append('artifact', new File([new Uint8Array(bytes)], 'catalog.pdf')); return new NextRequest('http://localhost/api/cad/v1/robot/catalog/select', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } }); }

describe('CAD v1 robot catalog selection', () => {
  it('returns six selections but never modifies CAD or releases production', async () => {
    const response = await POST(request(requirements, artifact, 'select-ok')); expect(response.status).toBe(200);
    const body = await response.json(); expect(body).toMatchObject({ ok: true, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false, report: { selectionReady: true, selectionStatus: 'passed', cadIntegrationStatus: 'not_run', releaseReady: false, sideEffects: { cadModified: false } } }); expect(body.report.selections).toHaveLength(6);
  });
  it('fails closed on insufficient catalog evidence', async () => {
    const response = await POST(request(requirements, new TextEncoder().encode('changed'), 'select-bad')); expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ ok: false, releaseReady: false, cadModified: false });
  });
  it('requires every file', async () => { const response = await POST(new NextRequest('http://localhost/api/cad/v1/robot/catalog/select', { method: 'POST', body: new FormData(), headers: { 'x-forwarded-for': 'select-empty' } })); expect(response.status).toBe(400); });
});
