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
const auxiliaryComponents = [
  { ...base, id: 'BR1', model: 'Brake', kind: 'brake', massKg: 0.8, envelopeMm: { x: 70, y: 70, z: 30 }, holdingTorqueNm: 50, maxRpm: 5000, ratedVoltageV: 24, releasePowerW: 20, responseTimeMs: 50 },
  { ...base, id: 'EN1', model: 'Encoder', kind: 'encoder', massKg: 0.2, envelopeMm: { x: 50, y: 50, z: 20 }, resolutionBits: 20, accuracyArcsec: 30, maxRpm: 6000, supplyVoltageV: 5 },
  { ...base, id: 'HA1', model: 'Harness', kind: 'harness', massKg: 1, envelopeMm: { x: 20, y: 20, z: 500 }, conductorCount: 20, ratedVoltageV: 300, ratedCurrentA: 5, outerDiameterMm: 12, minimumBendRadiusMm: 80, flexLifeCycles: 10_000_000 },
  { ...base, id: 'TC1', model: 'Tool connector', kind: 'tool_connector', massKg: 0.3, envelopeMm: { x: 60, y: 60, z: 30 }, contactCount: 12, ratedVoltageV: 60, ratedCurrentA: 3, matingCycles: 10_000, ipRating: 'IP67' },
];
const mount = (parentPartId: string) => ({ parentPartId, parentAxisRef: 'bbox_axis_z_max', parentPlaneRef: 'f.cap.top', positionMm: { x: 0, y: 0, z: 100 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
const auxiliarySelections = () => ({
  brake: { componentId: 'BR1', minimumHoldingTorqueNm: 40, minimumMaxRpm: 4000, requiredVoltageV: 24, mount: mount('base') },
  encoder: { componentId: 'EN1', minimumResolutionBits: 18, maximumAccuracyArcsec: 60, minimumMaxRpm: 5000, requiredSupplyVoltageV: 5, mount: mount('shoulder') },
  harness: { componentId: 'HA1', minimumConductorCount: 16, minimumRatedVoltageV: 250, minimumRatedCurrentA: 4, maximumMinimumBendRadiusMm: 100, minimumFlexLifeCycles: 5_000_000, mount: mount('upper-arm') },
  toolConnector: { componentId: 'TC1', minimumContactCount: 8, minimumRatedVoltageV: 48, minimumRatedCurrentA: 2, minimumMatingCycles: 5_000, minimumIpRating: 'IP65', mount: mount('tool-flange') },
});
const fullManifest = () => ({ ...manifest, components: [...manifest.components, ...auxiliaryComponents] });
const fullRequirements = () => ({ ...requirements(), auxiliarySelections: auxiliarySelections() });

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
  it('requires all four auxiliary component IDs explicitly and verifies their governed ratings', () => {
    const result = selectRobotCatalogBytes(bytes(fullRequirements()), bytes(fullManifest()), [{ name: 'catalog.pdf', bytes: artifact }]);
    expect(result).toMatchObject({ selectionReady: true, auxiliarySelectionReady: true, auxiliarySelectionStatus: 'passed', errors: [] });
    expect(result.auxiliarySelections.map(item => [item.kind, item.component.id])).toEqual([
      ['brake', 'BR1'], ['encoder', 'EN1'], ['harness', 'HA1'], ['tool_connector', 'TC1'],
    ]);
    expect(result.auxiliarySelections.every(item => item.evidence.some(value => value.includes(item.component.artifactHash)))).toBe(true);
  });
  it('never auto-selects auxiliary components and fails closed on partial, wrong-kind or insufficient choices', () => {
    const omitted = selectRobotCatalogBytes(bytes(requirements()), bytes(fullManifest()), [{ name: 'catalog.pdf', bytes: artifact }]);
    expect(omitted).toMatchObject({ selectionReady: true, auxiliarySelectionReady: false, auxiliarySelectionStatus: 'not_run', auxiliarySelections: [] });

    const partial = fullRequirements(); delete (partial.auxiliarySelections as Partial<typeof partial.auxiliarySelections>).encoder;
    expect(selectRobotCatalogBytes(bytes(partial), bytes(fullManifest()), [{ name: 'catalog.pdf', bytes: artifact }])).toMatchObject({ selectionReady: false, auxiliarySelectionStatus: 'failed', auxiliarySelections: [] });
    const wrongKind = fullRequirements(); wrongKind.auxiliarySelections.brake.componentId = 'M1';
    expect(selectRobotCatalogBytes(bytes(wrongKind), bytes(fullManifest()), [{ name: 'catalog.pdf', bytes: artifact }]).errors.join(' ')).toContain('wrong kind');
    const insufficient = fullRequirements(); insufficient.auxiliarySelections.brake.minimumHoldingTorqueNm = 500;
    expect(selectRobotCatalogBytes(bytes(insufficient), bytes(fullManifest()), [{ name: 'catalog.pdf', bytes: artifact }]).errors.join(' ')).toContain('holding torque');
  });
});
