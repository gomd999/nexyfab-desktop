import { createHash } from 'node:crypto';

export const MECHANICAL_PRODUCT_CONTRACT_SCHEMA = 'nexyfab.mechanical.motor-gearbox-drive-module.v1' as const;

export type MechanicalUnit = 'mm' | 'N' | 'N.m' | 'rpm' | 's' | 'h' | 'percent' | 'deg' | 'kg' | 'MPa';
export type MechanicalPartRole = 'base' | 'shaft' | 'bearing-support' | 'coupling' | 'fastener' | 'guard' | 'motor-interface' | 'gearbox-interface' | 'spacer' | 'other';
export type MechanicalDuty = 'continuous' | 'intermittent' | 'cyclic' | 'standby';

export interface MechanicalProvenance {
  sourceId: string;
  sourceRef: string;
  contentSha256: string;
  rightsReceiptSha256: string;
  origin: 'ORIGINAL' | 'LICENSED' | 'CLIENT_PROVIDED' | 'PUBLIC_STANDARD_FACT';
  rightsStatus: 'APPROVED';
  authorityStatus: 'APPROVED';
}

export interface MechanicalProcurement {
  mode: 'MAKE' | 'BUY' | 'STANDARD';
  source: MechanicalProvenance;
}

export interface MechanicalIdentity { id: string; revision: string; contentSha256: string }
export interface MechanicalUnits { length: 'mm'; force: 'N'; torque: 'N.m'; speed: 'rpm'; time: 's' | 'h'; angle: 'deg'; mass: 'kg'; stress: 'MPa' }
export interface MechanicalRequirements { ratedTorqueNm: number; ratedSpeedRpm: number; duty: MechanicalDuty; serviceFactor: number; designLifeHours: number; alignmentToleranceMm: number }

export interface MechanicalPart {
  id: string;
  role: MechanicalPartRole;
  material: MechanicalProvenance;
  process: MechanicalProvenance;
  procurement: MechanicalProcurement;
  geometryHash: string;
  sourceRevision: string;
}

export interface MechanicalInterface {
  id: string;
  fromPartId: string;
  toPartId: string;
  kind: 'shaft' | 'bolt' | 'mounting' | 'bearing' | 'guard' | 'coupling' | 'datum';
  nominal: number;
  tolerance: number;
  unit: MechanicalUnit;
  sourceRevision: string;
}

export interface MechanicalCriticalDimension {
  id: string;
  partId: string;
  datumId: string;
  nominal: number;
  plusTolerance: number;
  minusTolerance: number;
  unit: MechanicalUnit;
  inspectionMethod: 'caliper' | 'micrometer' | 'cmm' | 'gauge' | 'visual';
  sourceRevision: string;
}

export interface MechanicalDatum { id: string; partId: string; axis: 'X' | 'Y' | 'Z'; description: string; sourceRevision: string }

export interface MotorGearboxDriveModuleContract {
  schema: typeof MECHANICAL_PRODUCT_CONTRACT_SCHEMA;
  identity: MechanicalIdentity;
  units: MechanicalUnits;
  requirements: MechanicalRequirements;
  parts: MechanicalPart[];
  datums: MechanicalDatum[];
  interfaces: MechanicalInterface[];
  criticalDimensions: MechanicalCriticalDimension[];
  authoritative: true;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX = 128;
const CONTRACT_KEYS = ['schema', 'identity', 'units', 'requirements', 'parts', 'datums', 'interfaces', 'criticalDimensions', 'authoritative'];
const IDENTITY_KEYS = ['id', 'revision', 'contentSha256'];
const UNIT_KEYS = ['length', 'force', 'torque', 'speed', 'time', 'angle', 'mass', 'stress'];
const REQUIREMENT_KEYS = ['ratedTorqueNm', 'ratedSpeedRpm', 'duty', 'serviceFactor', 'designLifeHours', 'alignmentToleranceMm'];
const PROVENANCE_KEYS = ['sourceId', 'sourceRef', 'contentSha256', 'rightsReceiptSha256', 'origin', 'rightsStatus', 'authorityStatus'];
const PROCUREMENT_KEYS = ['mode', 'source'];
const PART_KEYS = ['id', 'role', 'material', 'process', 'procurement', 'geometryHash', 'sourceRevision'];
const DATUM_KEYS = ['id', 'partId', 'axis', 'description', 'sourceRevision'];
const INTERFACE_KEYS = ['id', 'fromPartId', 'toPartId', 'kind', 'nominal', 'tolerance', 'unit', 'sourceRevision'];
const DIMENSION_KEYS = ['id', 'partId', 'datumId', 'nominal', 'plusTolerance', 'minusTolerance', 'unit', 'inspectionMethod', 'sourceRevision'];

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const finite = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const text = (value: unknown, pattern: RegExp, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && pattern.test(value);
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : isRecord(value)
    ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';

function validateProvenance(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value) || !exact(value, PROVENANCE_KEYS)) { issues.push(`${path}:keys`); return; }
  if (!text(value.sourceId, ID)) issues.push(`${path}.sourceId`);
  if (!text(value.sourceRef, /^(?!ai:|preview:|catalog-unverified:).+$/i, 1024)) issues.push(`${path}.sourceRef`);
  if (!text(value.contentSha256, SHA)) issues.push(`${path}.contentSha256`);
  if (!text(value.rightsReceiptSha256, SHA)) issues.push(`${path}.rightsReceiptSha256`);
  if (!['ORIGINAL', 'LICENSED', 'CLIENT_PROVIDED', 'PUBLIC_STANDARD_FACT'].includes(value.origin as string)) issues.push(`${path}.origin`);
  if (value.rightsStatus !== 'APPROVED' || value.authorityStatus !== 'APPROVED') issues.push(`${path}:not_authoritative`);
}

function validateProcurement(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value) || !exact(value, PROCUREMENT_KEYS)) { issues.push(`${path}:keys`); return; }
  if (!['MAKE', 'BUY', 'STANDARD'].includes(value.mode as string)) issues.push(`${path}.mode`);
  validateProvenance(value.source, `${path}.source`, issues);
}

export function canonicalMotorGearboxDriveModuleJson(contract: MotorGearboxDriveModuleContract, includeHash = true): string {
  return canonical(includeHash ? contract : { ...contract, identity: { ...contract.identity, contentSha256: undefined } });
}

export function hashMotorGearboxDriveModuleContract(contract: MotorGearboxDriveModuleContract): string {
  return createHash('sha256').update(canonicalMotorGearboxDriveModuleJson(contract, false), 'utf8').digest('hex');
}

export function validateMotorGearboxDriveModuleContract(input: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(input) || !exact(input, CONTRACT_KEYS)) return ['contract:keys'];
  if (input.schema !== MECHANICAL_PRODUCT_CONTRACT_SCHEMA || input.authoritative !== true) issues.push('contract:not_authoritative');

  if (!isRecord(input.identity) || !exact(input.identity, IDENTITY_KEYS)) issues.push('identity:keys');
  else {
    if (!text(input.identity.id, ID)) issues.push('identity.id');
    if (!text(input.identity.revision, REVISION)) issues.push('identity.revision');
    if (!text(input.identity.contentSha256, SHA)) issues.push('identity.contentSha256');
    else if (input.identity.contentSha256 !== hashMotorGearboxDriveModuleContract(input as unknown as MotorGearboxDriveModuleContract)) issues.push('identity.contentSha256:mismatch');
  }
  const revision = isRecord(input.identity) ? input.identity.revision : undefined;

  if (!isRecord(input.units) || !exact(input.units, UNIT_KEYS)) issues.push('units:keys');
  else {
    const fixed = { length: 'mm', force: 'N', torque: 'N.m', speed: 'rpm', angle: 'deg', mass: 'kg', stress: 'MPa' } as const;
    for (const [key, expected] of Object.entries(fixed)) if (input.units[key] !== expected) issues.push(`units.${key}`);
    if (!['s', 'h'].includes(input.units.time as string)) issues.push('units.time');
  }

  if (!isRecord(input.requirements) || !exact(input.requirements, REQUIREMENT_KEYS)) issues.push('requirements:keys');
  else {
    if (!finite(input.requirements.ratedTorqueNm, Number.MIN_VALUE, 1e9)) issues.push('requirements.ratedTorqueNm');
    if (!finite(input.requirements.ratedSpeedRpm, Number.MIN_VALUE, 1e7)) issues.push('requirements.ratedSpeedRpm');
    if (!['continuous', 'intermittent', 'cyclic', 'standby'].includes(input.requirements.duty as string)) issues.push('requirements.duty');
    if (!finite(input.requirements.serviceFactor, 1, 10)) issues.push('requirements.serviceFactor');
    if (!finite(input.requirements.designLifeHours, 1, 1e9)) issues.push('requirements.designLifeHours');
    if (!finite(input.requirements.alignmentToleranceMm, 0, 100)) issues.push('requirements.alignmentToleranceMm');
  }

  const parts = Array.isArray(input.parts) ? input.parts : [];
  if (parts.length === 0 || parts.length > MAX) issues.push('parts:count');
  const partIds = new Set<string>();
  const roleCounts = new Map<string, number>();
  parts.forEach((part, index) => {
    const path = `parts[${index}]`;
    if (!isRecord(part) || !exact(part, PART_KEYS)) { issues.push(`${path}:keys`); return; }
    if (!text(part.id, ID) || partIds.has(part.id as string)) issues.push(`${path}.id`); else partIds.add(part.id);
    if (!['base', 'shaft', 'bearing-support', 'coupling', 'fastener', 'guard', 'motor-interface', 'gearbox-interface', 'spacer', 'other'].includes(part.role as string)) issues.push(`${path}.role`);
    else roleCounts.set(part.role as string, (roleCounts.get(part.role as string) ?? 0) + 1);
    validateProvenance(part.material, `${path}.material`, issues);
    validateProvenance(part.process, `${path}.process`, issues);
    validateProcurement(part.procurement, `${path}.procurement`, issues);
    if (!text(part.geometryHash, SHA)) issues.push(`${path}.geometryHash`);
    if (!text(part.sourceRevision, REVISION) || part.sourceRevision !== revision) issues.push(`${path}.sourceRevision`);
  });
  for (const role of ['base', 'shaft', 'coupling', 'fastener', 'guard']) if ((roleCounts.get(role) ?? 0) < 1) issues.push(`parts:required_role_missing:${role}`);
  if ((roleCounts.get('bearing-support') ?? 0) < 2) issues.push('parts:required_role_missing:bearing-support:2');

  const datums = Array.isArray(input.datums) ? input.datums : [];
  if (datums.length === 0 || datums.length > MAX) issues.push('datums:count');
  const datumIds = new Set<string>();
  datums.forEach((datum, index) => {
    const path = `datums[${index}]`;
    if (!isRecord(datum) || !exact(datum, DATUM_KEYS)) { issues.push(`${path}:keys`); return; }
    if (!text(datum.id, ID) || datumIds.has(datum.id as string)) issues.push(`${path}.id`); else datumIds.add(datum.id);
    if (!partIds.has(datum.partId as string)) issues.push(`${path}.partId`);
    if (!['X', 'Y', 'Z'].includes(datum.axis as string)) issues.push(`${path}.axis`);
    if (!text(datum.description, /./, 512)) issues.push(`${path}.description`);
    if (!text(datum.sourceRevision, REVISION) || datum.sourceRevision !== revision) issues.push(`${path}.sourceRevision`);
  });

  const interfaces = Array.isArray(input.interfaces) ? input.interfaces : [];
  if (interfaces.length === 0 || interfaces.length > MAX) issues.push('interfaces:count');
  const interfaceIds = new Set<string>();
  interfaces.forEach((item, index) => {
    const path = `interfaces[${index}]`;
    if (!isRecord(item) || !exact(item, INTERFACE_KEYS)) { issues.push(`${path}:keys`); return; }
    if (!text(item.id, ID) || interfaceIds.has(item.id as string)) issues.push(`${path}.id`); else interfaceIds.add(item.id);
    if (!partIds.has(item.fromPartId as string) || !partIds.has(item.toPartId as string) || item.fromPartId === item.toPartId) issues.push(`${path}:part_ref`);
    if (!['shaft', 'bolt', 'mounting', 'bearing', 'guard', 'coupling', 'datum'].includes(item.kind as string)) issues.push(`${path}.kind`);
    if (!finite(item.nominal, 0, 1e9) || !finite(item.tolerance, 0, 1e6) || (item.nominal !== 0 && item.tolerance > item.nominal)) issues.push(`${path}:bounds`);
    if (!['mm', 'N', 'N.m', 'rpm', 's', 'h', 'percent', 'deg', 'kg', 'MPa'].includes(item.unit as string)) issues.push(`${path}.unit`);
    if (!text(item.sourceRevision, REVISION) || item.sourceRevision !== revision) issues.push(`${path}.sourceRevision`);
  });

  const dimensions = Array.isArray(input.criticalDimensions) ? input.criticalDimensions : [];
  if (dimensions.length === 0 || dimensions.length > MAX) issues.push('criticalDimensions:count');
  const dimensionIds = new Set<string>();
  dimensions.forEach((dimension, index) => {
    const path = `criticalDimensions[${index}]`;
    if (!isRecord(dimension) || !exact(dimension, DIMENSION_KEYS)) { issues.push(`${path}:keys`); return; }
    if (!text(dimension.id, ID) || dimensionIds.has(dimension.id as string)) issues.push(`${path}.id`); else dimensionIds.add(dimension.id);
    if (!partIds.has(dimension.partId as string)) issues.push(`${path}.partId`);
    if (!datumIds.has(dimension.datumId as string)) issues.push(`${path}.datumId`);
    if (!finite(dimension.nominal, 0, 1e9) || !finite(dimension.plusTolerance, 0, 1e6) || !finite(dimension.minusTolerance, 0, 1e6)
      || dimension.plusTolerance + dimension.minusTolerance > Math.max(dimension.nominal, 1) * 2) issues.push(`${path}:bounds`);
    if (!['mm', 'N', 'N.m', 'rpm', 's', 'h', 'percent', 'deg', 'kg', 'MPa'].includes(dimension.unit as string)) issues.push(`${path}.unit`);
    if (!['caliper', 'micrometer', 'cmm', 'gauge', 'visual'].includes(dimension.inspectionMethod as string)) issues.push(`${path}.inspectionMethod`);
    if (!text(dimension.sourceRevision, REVISION) || dimension.sourceRevision !== revision) issues.push(`${path}.sourceRevision`);
  });
  return [...new Set(issues)];
}

export function createMotorGearboxDriveModuleContract(
  input: Omit<MotorGearboxDriveModuleContract, 'identity'> & { identity: Omit<MechanicalIdentity, 'contentSha256'> },
): MotorGearboxDriveModuleContract {
  const draft = { ...input, identity: { ...input.identity, contentSha256: '0'.repeat(64) } } as MotorGearboxDriveModuleContract;
  const contract = { ...draft, identity: { ...draft.identity, contentSha256: hashMotorGearboxDriveModuleContract(draft) } };
  const issues = validateMotorGearboxDriveModuleContract(contract);
  if (issues.length) throw new Error(`invalid_motor_gearbox_drive_module_contract:${issues.join(',')}`);
  return contract;
}
