import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { selectRobotCatalogBytes } from './robotCatalogSelection';

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const artifact = bytes('joint catalog datasheet'); const hash = createHash('sha256').update(artifact).digest('hex');
const base = { manufacturer: 'Maker', revision: 'A', source: 'manufacturer datasheet', artifactHash: hash, massSource: 'confirmed', interface: { axisRef: 'axis', mountingPlaneRef: 'face', shaftDiameterMm: 30 } };
const manifest = { schema: 'nexyfab.robot-component-catalog.v1', components: [
  { ...base, id: 'M1', model: 'M1', kind: 'motor', massKg: 2, envelopeMm: { x: 60, y: 60, z: 100 }, ratedTorqueNm: 10, peakTorqueNm: 20, maxRpm: 5000, rotorInertiaKgM2: 0.001 },
  { ...base, id: 'R1', model: 'R1', kind: 'reducer', massKg: 3, envelopeMm: { x: 90, y: 90, z: 80 }, ratio: 100, ratedOutputTorqueNm: 1000, peakOutputTorqueNm: 1500, maxInputRpm: 6000, efficiency: 0.9, backlashArcmin: 2 },
  { ...base, id: 'B1', model: 'B1', kind: 'bearing', massKg: 1, envelopeMm: { x: 80, y: 80, z: 20 }, boreMm: 30, odMm: 80, widthMm: 20, dynamicLoadN: 20000, staticLoadN: 10000, limitingRpm: 5000 },
], artifacts: [{ path: 'catalog.pdf', sha256: hash, source: 'manufacturer datasheet', mediaType: 'application/pdf' }] };
const requirements = (torque = 100) => ({ schema: 'nexyfab.robot-selection-requirements.v1', requirements: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, requiredOutputTorqueNm: torque, requiredOutputRpm: 10, radialLoadN: 1000, minShaftDiameterMm: 25, safetyFactor: 1.5 })) });

describe('robot production catalog selection evidence', () => {
  it('selects exactly six governed joints without applying them to CAD', () => {
    const result = selectRobotCatalogBytes(bytes(requirements()), bytes(manifest), [{ name: 'catalog.pdf', bytes: artifact }]);
    expect(result).toMatchObject({ admissionEligible: true, selectionReady: true, selectionStatus: 'passed', releaseReady: false, cadIntegrationStatus: 'not_run', sideEffects: { persisted: false, catalogActivated: false, cadModified: false, quoteCreated: false, rfqSent: false } });
    expect(result.selections.map(item => item.joint)).toEqual([1, 2, 3, 4, 5, 6]); expect(result.selections.every(item => item.margins.torque >= 1.5)).toBe(true);
  });
  it('fails when a governed joint is duplicated or a required margin is unavailable', () => {
    const duplicate = requirements(); duplicate.requirements[5]!.joint = 5;
    expect(selectRobotCatalogBytes(bytes(duplicate), bytes(manifest), [{ name: 'catalog.pdf', bytes: artifact }]).errors.join(' ')).toContain('J1..J6 exactly once');
    const insufficient = selectRobotCatalogBytes(bytes(requirements(1000)), bytes(manifest), [{ name: 'catalog.pdf', bytes: artifact }]);
    expect(insufficient).toMatchObject({ admissionEligible: true, selectionReady: false, selectionStatus: 'failed', selections: [] });
  });
  it('does not select from hash-mismatched artifact evidence', () => {
    const result = selectRobotCatalogBytes(bytes(requirements()), bytes(manifest), [{ name: 'catalog.pdf', bytes: bytes('changed') }]);
    expect(result).toMatchObject({ admissionEligible: false, selectionReady: false, releaseReady: false }); expect(result.errors.join(' ')).toContain('SHA-256 mismatch');
  });
});
