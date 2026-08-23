import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateRobot6Axis } from './robotGenerator';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from './robotDemonstrator';
import { buildRobotCadIntegrationPacket } from './robotCadIntegrationPacket';

const enc = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`); const artifact = new TextEncoder().encode('integration evidence'); const hash = createHash('sha256').update(artifact).digest('hex');
const base = { manufacturer: 'M', revision: 'A', source: 'datasheet', artifactHash: hash, massSource: 'confirmed', interface: { axisRef: 'axis', mountingPlaneRef: 'face', shaftDiameterMm: 30 } };
const catalog = { schema: 'nexyfab.robot-component-catalog.v1', components: [{ ...base, id: 'M', model: 'M', kind: 'motor', massKg: 1, envelopeMm: { x: 60, y: 60, z: 100 }, ratedTorqueNm: 10, peakTorqueNm: 20, maxRpm: 5000, rotorInertiaKgM2: 0.01 }, { ...base, id: 'R', model: 'R', kind: 'reducer', massKg: 2, envelopeMm: { x: 90, y: 90, z: 80 }, ratio: 100, ratedOutputTorqueNm: 1000, peakOutputTorqueNm: 1500, maxInputRpm: 6000, efficiency: 0.9, backlashArcmin: 2 }, { ...base, id: 'B', model: 'B', kind: 'bearing', massKg: 0.5, envelopeMm: { x: 80, y: 80, z: 20 }, boreMm: 30, odMm: 80, widthMm: 20, dynamicLoadN: 20000, staticLoadN: 10000, limitingRpm: 5000 }], artifacts: [{ path: 'evidence.pdf', sha256: hash, source: 'datasheet' }] };
const requirements = { schema: 'nexyfab.robot-selection-requirements.v1', requirements: Array.from({ length: 6 }, (_, i) => ({ joint: i + 1, requiredOutputTorqueNm: 100, requiredOutputRpm: 10, radialLoadN: 1000, minShaftDiameterMm: 25, safetyFactor: 1.5 })) };
const housing = (z = 240) => ({ schema: 'nexyfab.robot-housing-capacities.v1', capacities: Array.from({ length: 6 }, (_, i) => ({ joint: i + 1, internalMm: { x: 110, y: 110, z }, radialClearanceMm: 5, axialClearanceMm: 10, source: 'measured CAD', artifactHash: hash })) });
const auxiliary = [
  { ...base, id: 'BR', model: 'Brake', kind: 'brake', massKg: 0.8, envelopeMm: { x: 70, y: 70, z: 30 }, holdingTorqueNm: 50, maxRpm: 5000, ratedVoltageV: 24, releasePowerW: 20, responseTimeMs: 50 },
  { ...base, id: 'EN', model: 'Encoder', kind: 'encoder', massKg: 0.2, envelopeMm: { x: 50, y: 50, z: 20 }, resolutionBits: 20, accuracyArcsec: 30, maxRpm: 6000, supplyVoltageV: 5 },
  { ...base, id: 'HA', model: 'Harness', kind: 'harness', massKg: 1, envelopeMm: { x: 20, y: 20, z: 500 }, conductorCount: 20, ratedVoltageV: 300, ratedCurrentA: 5, outerDiameterMm: 12, minimumBendRadiusMm: 80, flexLifeCycles: 10_000_000 },
  { ...base, id: 'TC', model: 'Tool connector', kind: 'tool_connector', massKg: 0.3, envelopeMm: { x: 60, y: 60, z: 30 }, contactCount: 12, ratedVoltageV: 60, ratedCurrentA: 3, matingCycles: 10_000, ipRating: 'IP67' },
];
const mount = (parentPartId: string, z: number) => ({ parentPartId, parentAxisRef: 'bbox_axis_z_max', parentPlaneRef: 'f.cap.top', positionMm: { x: 0, y: 0, z }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
const fullCatalog = () => ({ ...catalog, components: [...catalog.components, ...auxiliary] });
const fullRequirements = (brakeParent = 'base') => ({ ...requirements, auxiliarySelections: {
  brake: { componentId: 'BR', minimumHoldingTorqueNm: 40, minimumMaxRpm: 4000, requiredVoltageV: 24, mount: mount(brakeParent, 100) },
  encoder: { componentId: 'EN', minimumResolutionBits: 18, maximumAccuracyArcsec: 60, minimumMaxRpm: 5000, requiredSupplyVoltageV: 5, mount: mount('shoulder', 200) },
  harness: { componentId: 'HA', minimumConductorCount: 16, minimumRatedVoltageV: 250, minimumRatedCurrentA: 4, maximumMinimumBendRadiusMm: 100, minimumFlexLifeCycles: 5_000_000, mount: mount('upper-arm', 300) },
  toolConnector: { componentId: 'TC', minimumContactCount: 8, minimumRatedVoltageV: 48, minimumRatedCurrentA: 2, minimumMatingCycles: 5_000, minimumIpRating: 'IP65', mount: mount('tool-flange', 900) },
} });
function fixture(z = 240) { const programBytes = enc(generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC).program); const programHash = createHash('sha256').update(programBytes).digest('hex'); const revision = { schema: 'nexyfab.ai-assembly-revision-package.v1', lineageId: 'robot-lineage', revision: 2, baseProgramHash: 'a'.repeat(64), programHash, programArtifact: `editable-program-${programHash}.json`, createdAt: '2026-08-09T00:00:00.000Z', sideEffects: { sourceModified: false, quoteCreated: false, rfqSent: false } }; return { programBytes, revisionBytes: enc(revision), housingBytes: enc(housing(z)) }; }
const run = (z = 240) => { const f = fixture(z); return buildRobotCadIntegrationPacket(f.programBytes, f.revisionBytes, f.housingBytes, enc(requirements), enc(catalog), [{ name: 'evidence.pdf', bytes: artifact }]); };

describe('robot CAD integration review packet', () => {
  it('binds six replacement plans but applies nothing before expert review', () => { const result = run(); expect(result).toMatchObject({ readiness: 'review_pending', expertReviewRequired: true, cadIntegrationStatus: 'not_applied', releaseReady: false, errors: [], sideEffects: { persisted: false, sourceModified: false, cadModified: false, quoteCreated: false, rfqSent: false } }); expect(result.replacements).toHaveLength(6); expect(result.replacements[5]).toMatchObject({ joint: 6, selected: { motor: 'M', reducer: 'R', bearing: 'B' }, fitStatus: 'passed' }); expect(result.targetHash).toMatch(/^[a-f0-9]{64}$/); });
  it('fails closed when fit or revision binding is invalid', () => { expect(run(100)).toMatchObject({ readiness: 'not_ready', replacements: [], cadIntegrationStatus: 'not_applied' }); const f = fixture(); f.programBytes[0] ^= 1; const result = buildRobotCadIntegrationPacket(f.programBytes, f.revisionBytes, f.housingBytes, enc(requirements), enc(catalog), [{ name: 'evidence.pdf', bytes: artifact }]); expect(result.readiness).toBe('not_ready'); expect(result.errors.join(' ')).toContain('exact editable program bytes'); });
  it('binds four explicit auxiliary additions only when all catalog, rating and mount evidence passes', () => {
    const f = fixture(); const result = buildRobotCadIntegrationPacket(f.programBytes, f.revisionBytes, f.housingBytes, enc(fullRequirements()), enc(fullCatalog()), [{ name: 'evidence.pdf', bytes: artifact }]);
    expect(result).toMatchObject({ readiness: 'review_pending', errors: [], auxiliaryAdditions: [
      { kind: 'brake', selected: 'BR', occurrenceId: 'AUX:brake:BR', pendingComponentId: 'brake' },
      { kind: 'encoder', selected: 'EN', occurrenceId: 'AUX:encoder:EN', pendingComponentId: 'encoder' },
      { kind: 'harness', selected: 'HA', occurrenceId: 'AUX:harness:HA', pendingComponentId: 'internal_harness' },
      { kind: 'tool_connector', selected: 'TC', occurrenceId: 'AUX:tool_connector:TC', pendingComponentId: 'tool_connector' },
    ] });
    const invalidMount = buildRobotCadIntegrationPacket(f.programBytes, f.revisionBytes, f.housingBytes, enc(fullRequirements('fabricated-parent')), enc(fullCatalog()), [{ name: 'evidence.pdf', bytes: artifact }]);
    expect(invalidMount).toMatchObject({ readiness: 'not_ready', auxiliaryAdditions: [] }); expect(invalidMount.errors.join(' ')).toContain('explicit mount parent');
  });
});
