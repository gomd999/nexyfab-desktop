import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateRobotHousingFitEvidence } from './robotHousingFitEvidence';

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)); const artifact = bytes('catalog and housing evidence'); const hash = createHash('sha256').update(artifact).digest('hex');
const base = { manufacturer: 'M', revision: 'A', source: 'verified evidence', artifactHash: hash, massSource: 'confirmed', interface: { axisRef: 'axis', mountingPlaneRef: 'face', shaftDiameterMm: 30 } };
const manifest = { schema: 'nexyfab.robot-component-catalog.v1', components: [{ ...base, id: 'M', model: 'M', kind: 'motor', massKg: 1, envelopeMm: { x: 60, y: 60, z: 100 }, ratedTorqueNm: 10, peakTorqueNm: 20, maxRpm: 5000, rotorInertiaKgM2: 0.01 }, { ...base, id: 'R', model: 'R', kind: 'reducer', massKg: 2, envelopeMm: { x: 90, y: 90, z: 80 }, ratio: 100, ratedOutputTorqueNm: 1000, peakOutputTorqueNm: 1500, maxInputRpm: 6000, efficiency: 0.9, backlashArcmin: 2 }, { ...base, id: 'B', model: 'B', kind: 'bearing', massKg: 0.5, envelopeMm: { x: 80, y: 80, z: 20 }, boreMm: 30, odMm: 80, widthMm: 20, dynamicLoadN: 20000, staticLoadN: 10000, limitingRpm: 5000 }], artifacts: [{ path: 'evidence.pdf', sha256: hash, source: 'verified evidence' }] };
const requirements = { schema: 'nexyfab.robot-selection-requirements.v1', requirements: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, requiredOutputTorqueNm: 100, requiredOutputRpm: 10, radialLoadN: 1000, minShaftDiameterMm: 25, safetyFactor: 1.5 })) };
const housing = (z = 240) => ({ schema: 'nexyfab.robot-housing-capacities.v1', capacities: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, internalMm: { x: 110, y: 110, z }, radialClearanceMm: 5, axialClearanceMm: 10, source: 'measured housing CAD', artifactHash: hash })) });
const run = (value: unknown) => evaluateRobotHousingFitEvidence(bytes(value), bytes(requirements), bytes(manifest), [{ name: 'evidence.pdf', bytes: artifact }]);

describe('robot housing fit evidence', () => {
  it('passes six traceable capacities without modifying CAD or releasing', () => { const result = run(housing()); expect(result).toMatchObject({ selectionReady: true, housingStatus: 'passed', releaseReady: false, cadIntegrationStatus: 'not_run', sideEffects: { persisted: false, catalogActivated: false, cadModified: false, quoteCreated: false, rfqSent: false } }); expect(result.fits).toHaveLength(6); });
  it('reports dimensional insufficiency as failed', () => { const result = run(housing(100)); expect(result.housingStatus).toBe('failed'); expect(result.errors.join(' ')).toContain('z requires'); });
  it('keeps missing provenance or governed axes at not_run', () => { const unbound = housing(); unbound.capacities[0]!.artifactHash = 'a'.repeat(64); expect(run(unbound)).toMatchObject({ housingStatus: 'not_run', fits: [] }); const duplicate = housing(); duplicate.capacities[5]!.joint = 5; expect(run(duplicate).errors.join(' ')).toContain('J1..J6 exactly once'); });
});
