import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admitRobotCatalogBytes } from './robotCatalogAdmission';

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const artifact = bytes('manufacturer datasheet bytes');
const hash = createHash('sha256').update(artifact).digest('hex');
const manifest = (overrides: Record<string, unknown> = {}) => ({
  schema: 'nexyfab.robot-component-catalog.v1',
  components: [{ id: 'motor-1', kind: 'motor', manufacturer: 'Maker', model: 'M1', revision: 'A', source: 'manufacturer datasheet', artifactHash: hash, massKg: 1.2, massSource: 'confirmed', envelopeMm: { x: 40, y: 40, z: 80 }, interface: { axisRef: 'shaft_axis', mountingPlaneRef: 'mount_face', shaftDiameterMm: 10 }, ratedTorqueNm: 2, peakTorqueNm: 4, maxRpm: 3000, rotorInertiaKgM2: 0.001 }],
  artifacts: [{ path: 'motor.pdf', sha256: hash, source: 'manufacturer datasheet', mediaType: 'application/pdf' }], ...overrides,
});
const auxiliaryBase = { manufacturer: 'Aux Maker', revision: 'A', source: 'manufacturer datasheet', artifactHash: hash, massKg: 0.4, massSource: 'confirmed', envelopeMm: { x: 40, y: 40, z: 30 }, interface: { axisRef: 'axis', mountingPlaneRef: 'mount_face' } };
const auxiliaryComponents = () => [
  { ...auxiliaryBase, id: 'BR1', model: 'Brake', kind: 'brake', holdingTorqueNm: 50, maxRpm: 5000, ratedVoltageV: 24, releasePowerW: 20, responseTimeMs: 50 },
  { ...auxiliaryBase, id: 'EN1', model: 'Encoder', kind: 'encoder', resolutionBits: 20, accuracyArcsec: 30, maxRpm: 6000, supplyVoltageV: 5 },
  { ...auxiliaryBase, id: 'HA1', model: 'Harness', kind: 'harness', conductorCount: 20, ratedVoltageV: 300, ratedCurrentA: 5, outerDiameterMm: 12, minimumBendRadiusMm: 80, flexLifeCycles: 10_000_000 },
  { ...auxiliaryBase, id: 'TC1', model: 'Tool connector', kind: 'tool_connector', contactCount: 12, ratedVoltageV: 60, ratedCurrentA: 3, matingCycles: 10_000, ipRating: 'IP67' },
];

describe('robot catalog byte admission', () => {
  it('admits exact bytes without persisting or activating the catalog', () => {
    const result = admitRobotCatalogBytes(bytes(manifest()), [{ name: 'motor.pdf', bytes: artifact }]);
    expect(result).toMatchObject({ valid: true, productionEligible: true, selectionReady: false, selectionStatus: 'not_run', componentCount: 1, artifactCount: 1, artifacts: [{ verified: true, actualSha256: hash }], sideEffects: { persisted: false, catalogActivated: false, quoteCreated: false, rfqSent: false } });
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/); expect(result.artifactSetSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('fails closed on changed bytes and estimated mass', () => {
    const changed = admitRobotCatalogBytes(bytes(manifest()), [{ name: 'motor.pdf', bytes: bytes('changed') }]);
    expect(changed.productionEligible).toBe(false); expect(changed.errors.join(' ')).toContain('SHA-256 mismatch');
    const estimated = manifest(); estimated.components[0]!.massSource = 'estimated';
    expect(admitRobotCatalogBytes(bytes(estimated), [{ name: 'motor.pdf', bytes: artifact }]).errors.join(' ')).toContain('mass must be confirmed');
  });
  it('rejects unsafe, duplicate, missing and undeclared artifact names', () => {
    const unsafe = manifest({ artifacts: [{ path: '../motor.pdf', sha256: hash, source: 'manufacturer' }] });
    expect(admitRobotCatalogBytes(bytes(unsafe), [{ name: 'extra.pdf', bytes: artifact }, { name: 'extra.pdf', bytes: artifact }]).errors.join(' ')).toMatch(/safe basename|duplicate uploaded|not declared|missing/);
  });
  it('rejects malformed UTF-8 JSON and invalid interfaces', () => {
    expect(admitRobotCatalogBytes(new Uint8Array([0xff]), [{ name: 'motor.pdf', bytes: artifact }]).errors[0]).toContain('UTF-8 JSON');
    const bad = manifest(); bad.components[0]!.interface.axisRef = '';
    expect(admitRobotCatalogBytes(bytes(bad), [{ name: 'motor.pdf', bytes: artifact }]).valid).toBe(false);
  });
  it('admits all four traceable auxiliary kinds only with their strict required ratings', () => {
    const admitted = admitRobotCatalogBytes(bytes(manifest({ components: auxiliaryComponents() })), [{ name: 'motor.pdf', bytes: artifact }]);
    expect(admitted).toMatchObject({ valid: true, productionEligible: true, componentCount: 4, errors: [] });

    const missingRating = auxiliaryComponents(); delete (missingRating[0] as { releasePowerW?: number }).releasePowerW;
    expect(admitRobotCatalogBytes(bytes(manifest({ components: missingRating })), [{ name: 'motor.pdf', bytes: artifact }]).valid).toBe(false);
    const impossibleHarness = auxiliaryComponents(); Object.assign(impossibleHarness[2]!, { outerDiameterMm: 20, minimumBendRadiusMm: 10 });
    expect(admitRobotCatalogBytes(bytes(manifest({ components: impossibleHarness })), [{ name: 'motor.pdf', bytes: artifact }]).errors.join(' ')).toContain('invalid harness ratings');
    const extraField = auxiliaryComponents(); Object.assign(extraField[3]!, { inferredPinout: true });
    expect(admitRobotCatalogBytes(bytes(manifest({ components: extraField })), [{ name: 'motor.pdf', bytes: artifact }]).valid).toBe(false);
  });
});
