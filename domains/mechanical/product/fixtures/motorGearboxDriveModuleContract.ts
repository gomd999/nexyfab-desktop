import { createHash } from 'node:crypto';

import {
  createMotorGearboxDriveModuleContract,
  type MechanicalPartRole,
  type MechanicalProvenance,
  type MotorGearboxDriveModuleContract,
} from '../contract';
import { motorGearboxDriveModuleFixture, type MotorGearboxDriveModuleFixture } from './motorGearboxDriveModule';

/**
 * Converts the independently authored fixture into the mechanical product
 * contract.  This adapter proves only rights provenance and contract
 * completeness; it deliberately does not turn the fixture's educational
 * values into manufacturing approval.
 */

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';

const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value), 'utf8').digest('hex');

const revision = motorGearboxDriveModuleFixture.provenance.sourceRevision;
const fixtureRightsReceiptSha256 = sha256({
  schema: motorGearboxDriveModuleFixture.schema,
  fixtureId: motorGearboxDriveModuleFixture.fixtureId,
  sourceId: motorGearboxDriveModuleFixture.provenance.sourceId,
  sourceRevision: revision,
  rightsStatus: motorGearboxDriveModuleFixture.provenance.rightsStatus,
  rightsBasis: motorGearboxDriveModuleFixture.provenance.rightsBasis,
  externalSourcesUsed: motorGearboxDriveModuleFixture.provenance.externalSourcesUsed,
  restrictions: motorGearboxDriveModuleFixture.provenance.restrictions,
});

const componentFor = (fixture: MotorGearboxDriveModuleFixture, componentId: string) => {
  const component = fixture.components.find((candidate) => candidate.id === componentId);
  if (!component) throw new Error(`fixture_component_missing:${componentId}`);
  return component;
};

const provenanceFor = (
  kind: 'material' | 'process' | 'procurement',
  componentId: string,
  description: string,
): MechanicalProvenance => {
  const component = componentFor(motorGearboxDriveModuleFixture, componentId);
  const value = kind === 'material' ? component.material : kind === 'process' ? component.process : 'abstract fixture procurement envelope';
  const source = {
    fixtureId: motorGearboxDriveModuleFixture.fixtureId,
    componentId,
    kind,
    value,
    description,
    sourceRevision: revision,
  };
  return {
    sourceId: `${motorGearboxDriveModuleFixture.provenance.sourceId}:${componentId}:${kind}`,
    sourceRef: `fixture:${motorGearboxDriveModuleFixture.fixtureId}/${componentId}/${kind}`,
    contentSha256: sha256(source),
    // This receipt attests only original authorship/rights, never a supplier,
    // material certificate, process qualification, or expert sign-off.
    rightsReceiptSha256: fixtureRightsReceiptSha256,
    origin: 'ORIGINAL',
    rightsStatus: 'APPROVED',
    authorityStatus: 'APPROVED',
  };
};

const roleMap: Record<string, MechanicalPartRole> = {
  base: 'base',
  shaft: 'shaft',
  bearing_support: 'bearing-support',
  coupling: 'coupling',
  fasteners: 'fastener',
  guard: 'guard',
};

const datumForRole: Record<MechanicalPartRole, { axis: 'X' | 'Y' | 'Z'; description: string }> = {
  base: { axis: 'Z', description: 'base mounting plane datum' },
  shaft: { axis: 'X', description: 'driven shaft centerline datum' },
  'bearing-support': { axis: 'Z', description: 'bearing support seating datum' },
  coupling: { axis: 'X', description: 'coupling pilot axis datum' },
  fastener: { axis: 'Z', description: 'fastener mounting axis datum' },
  guard: { axis: 'Y', description: 'guard clearance reference datum' },
  'motor-interface': { axis: 'Z', description: 'motor interface mounting datum' },
  'gearbox-interface': { axis: 'Z', description: 'gearbox interface mounting datum' },
  spacer: { axis: 'X', description: 'spacer centerline datum' },
  other: { axis: 'Z', description: 'component reference datum' },
};

const inspectionMethod = (name: string): 'caliper' | 'micrometer' | 'cmm' | 'gauge' | 'visual' => {
  if (name.includes('flatness')) return 'cmm';
  if (name.includes('Diameter') || name.includes('diameter')) return 'micrometer';
  if (name.includes('runout') || name.includes('alignment')) return 'gauge';
  return 'caliper';
};

export function buildMotorGearboxDriveModuleFixtureContract(): MotorGearboxDriveModuleContract {
  const fixture = motorGearboxDriveModuleFixture;
  if (fixture.provenance.rightsStatus !== 'RIGHTS_CLEARED_ORIGINAL' || fixture.provenance.externalSourcesUsed.length !== 0) {
    throw new Error('fixture_rights_not_cleared_original');
  }
  if (fixture.manufacturingApproval.approved !== false || fixture.verificationStatus.independentReview !== 'NOT_RUN') {
    throw new Error('fixture_must_remain_unapproved_and_unverified');
  }

  const parts = fixture.components.map((component) => {
    const role = roleMap[component.role];
    if (!role) throw new Error(`fixture_role_unmapped:${component.role}`);
    const material = provenanceFor('material', component.id, component.description);
    const process = provenanceFor('process', component.id, component.description);
    const procurement = provenanceFor('procurement', component.id, component.description);
    return {
      id: component.id,
      role,
      material,
      process,
      procurement: { mode: role === 'fastener' ? 'BUY' as const : 'MAKE' as const, source: procurement },
      geometryHash: sha256({ fixtureId: fixture.fixtureId, component }),
      sourceRevision: revision,
    };
  });
  const partId = (role: MechanicalPartRole): string => {
    const part = parts.find((candidate) => candidate.role === role);
    if (!part) throw new Error(`contract_part_missing:${role}`);
    return part.id;
  };
  const datums = parts.map((part) => ({ id: `datum-${part.id}`, partId: part.id, ...datumForRole[part.role], sourceRevision: revision }));
  const datumId = (role: MechanicalPartRole): string => `datum-${partId(role)}`;

  return createMotorGearboxDriveModuleContract({
    schema: 'nexyfab.mechanical.motor-gearbox-drive-module.v1',
    units: { length: 'mm', force: 'N', torque: 'N.m', speed: 'rpm', time: 'h', angle: 'deg', mass: 'kg', stress: 'MPa' },
    requirements: {
      ratedTorqueNm: fixture.requirements.ratedTorqueNm,
      ratedSpeedRpm: fixture.requirements.operatingSpeedRpm.max,
      duty: 'cyclic',
      serviceFactor: fixture.requirements.serviceFactor,
      designLifeHours: fixture.requirements.designLifeHours,
      alignmentToleranceMm: fixture.requirements.shaftAlignmentMmPerMm,
    },
    parts,
    datums,
    interfaces: [
      { id: 'interface-base-mounting', fromPartId: partId('base'), toPartId: partId('fastener'), kind: 'mounting', nominal: fixture.interfaces.baseMounting.spacingX, tolerance: 0.1, unit: 'mm', sourceRevision: revision },
      { id: 'interface-shaft-bearing', fromPartId: partId('shaft'), toPartId: partId('bearing-support'), kind: 'bearing', nominal: fixture.interfaces.drivenShaft.diameter, tolerance: 0.013, unit: 'mm', sourceRevision: revision },
      { id: 'interface-shaft-coupling', fromPartId: partId('shaft'), toPartId: partId('coupling'), kind: 'coupling', nominal: fixture.interfaces.drivenShaft.diameter, tolerance: 0.02, unit: 'mm', sourceRevision: revision },
      { id: 'interface-base-guard', fromPartId: partId('base'), toPartId: partId('guard'), kind: 'guard', nominal: 12, tolerance: 1, unit: 'mm', sourceRevision: revision },
    ],
    criticalDimensions: fixture.components.flatMap((component) => component.criticalDimensions.map((dimension, index) => ({
      id: `critical-${component.id}-${index + 1}`,
      partId: component.id,
      datumId: datumId(roleMap[component.role]),
      nominal: dimension.nominal,
      plusTolerance: dimension.tolerance,
      minusTolerance: dimension.tolerance,
      unit: 'mm' as const,
      inspectionMethod: inspectionMethod(dimension.name),
      sourceRevision: revision,
    }))),
    authoritative: true,
    identity: { id: fixture.fixtureId, revision },
  });
}

export { fixtureRightsReceiptSha256 };
