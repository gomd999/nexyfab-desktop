import { createHash } from 'node:crypto';

export const WELDED_FABRICATION_RELEASE_SCHEMA =
  'nexyfab.welded-fabrication-release.v1' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const EPSILON = 1e-8;

export interface WeldedFabricationSourceBindingV1 {
  assemblyId: string;
  brepPath: string;
  brepBytes: number;
  brepSha256: string;
  contentHash: string;
  revisionSha256: string;
  revision: number;
}

export interface WeldedMaterialProvenanceV1 {
  sourceId: string;
  sourceRef: string;
  capturedAt: string;
  revisionSha256: string;
}

export interface WeldedMemberV1 {
  id: string;
  materialId: string;
  grade: string;
  thicknessMm: number;
  provenance: WeldedMaterialProvenanceV1;
}

export type WeldedJointType = 'fillet' | 'groove' | 'butt' | 'lap';
export type WeldedContinuity = 'continuous' | 'intermittent';
export type WeldedProcess = 'GMAW' | 'GTAW' | 'SMAW' | 'FCAW' | 'SAW' | 'other';

export interface WeldedJointV1 {
  id: string;
  memberAId: string;
  memberBId: string;
  type: WeldedJointType;
  sizeMm: number;
  lengthMm: number;
  continuity: WeldedContinuity;
  pitchMm?: number;
  process: WeldedProcess;
  wpsReference: string;
  weldPathId: string;
}

export interface WeldedPointMmV1 {
  xMm: number;
  yMm: number;
  zMm: number;
}

export interface WeldedPathV1 {
  id: string;
  jointId: string;
  pointsMm: readonly WeldedPointMmV1[];
  geometryLengthMm: number;
}

export interface WeldedBomLineV1 {
  id: string;
  memberId: string;
  quantity: number;
}

export interface WeldedScheduleLineV1 {
  id: string;
  jointId: string;
  quantity: number;
  totalLengthMm: number;
}

export interface WeldedFabricationOutputV1 {
  format: 'json' | 'csv' | 'step';
  revision: number;
  content: string;
  bytes: number;
  sha256: string;
}

export interface WeldedFabricationReleaseInputV1 {
  schema: typeof WELDED_FABRICATION_RELEASE_SCHEMA;
  units: 'mm-N';
  revision: number;
  source: WeldedFabricationSourceBindingV1;
  members: readonly WeldedMemberV1[];
  joints: readonly WeldedJointV1[];
  weldPaths: readonly WeldedPathV1[];
  bom: readonly WeldedBomLineV1[];
  weldSchedule: readonly WeldedScheduleLineV1[];
  output: WeldedFabricationOutputV1;
}

export interface WeldedFabricationParserReadbackV1 {
  parserId: 'nexyfab.welded-fabrication-independent-parser.v1';
  parserSourceSha256: string;
  sourceAssemblyId: string;
  sourceBrepSha256: string;
  sourceContentHash: string;
  sourceRevision: number;
  outputSha256: string;
  memberIds: readonly string[];
  jointIds: readonly string[];
  weldPathIds: readonly string[];
  bomLineIds: readonly string[];
  scheduleLineIds: readonly string[];
  verificationSha256: string;
}

export interface WeldedFabricationValidationResult {
  valid: boolean;
  issues: string[];
}

export interface WeldedFabricationReleaseAssessment {
  schema: typeof WELDED_FABRICATION_RELEASE_SCHEMA;
  releaseReady: false;
  status: 'HOLD';
  parserVerified: boolean;
  blockers: string[];
  holdBoundary: readonly string[];
}

export interface WeldedFabricationReadbackResult {
  valid: boolean;
  issues: string[];
}

const holdBoundary = [
  'wps_pqr_qualification_not_run',
  'welder_qualification_not_verified',
  'ndt_and_dimensional_inspection_not_run',
  'field_fabrication_receipt_not_available',
] as const;

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const bounded = (value: unknown): value is number => finite(value) && Math.abs(value) <= 1_000_000_000;
const point = (value: unknown): value is WeldedPointMmV1 => Boolean(value && typeof value === 'object'
  && bounded((value as WeldedPointMmV1).xMm)
  && bounded((value as WeldedPointMmV1).yMm)
  && bounded((value as WeldedPointMmV1).zMm));
const distance = (a: WeldedPointMmV1, b: WeldedPointMmV1): number => Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm, a.zMm - b.zMm);
const equal = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(EPSILON, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);

function validProvenance(value: unknown, revisionSha256: string): value is WeldedMaterialProvenanceV1 {
  if (!value || typeof value !== 'object') return false;
  const provenance = value as WeldedMaterialProvenanceV1;
  return typeof provenance.sourceId === 'string' && provenance.sourceId.trim().length > 0
    && typeof provenance.sourceRef === 'string' && provenance.sourceRef.trim().length > 0
    && typeof provenance.capturedAt === 'string' && Number.isFinite(Date.parse(provenance.capturedAt))
    && provenance.revisionSha256 === revisionSha256 && SHA256.test(provenance.revisionSha256);
}

function registerIds(values: readonly { id?: unknown }[], label: string, issues: string[], all: Set<string>): void {
  for (const value of values) {
    if (!value || typeof value.id !== 'string' || !value.id.trim() || all.has(value.id)) issues.push(`${label}_id_invalid:${String(value?.id)}`);
    else all.add(value.id);
  }
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value].sort() : [];
}

export function validateWeldedFabricationRelease(
  input: WeldedFabricationReleaseInputV1 | null | undefined,
): WeldedFabricationValidationResult {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, issues: ['input_missing'] };
  if (input.schema !== WELDED_FABRICATION_RELEASE_SCHEMA) issues.push('schema_invalid');
  if (input.units !== 'mm-N') issues.push('canonical_units_required');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) issues.push('revision_invalid');
  const source = input.source;
  if (!source || typeof source !== 'object') issues.push('source_binding_missing');
  else {
    if (typeof source.assemblyId !== 'string' || !source.assemblyId.trim()) issues.push('source_assembly_id_invalid');
    if (typeof source.brepPath !== 'string' || !source.brepPath.trim() || source.brepPath.replaceAll('\\', '/').split('/').includes('..') || source.brepPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source.brepPath)) issues.push('source_brep_path_invalid');
    if (!Number.isSafeInteger(source.brepBytes) || source.brepBytes <= 0) issues.push('source_brep_bytes_invalid');
    if (!SHA256.test(source.brepSha256) || !SHA256.test(source.contentHash) || !SHA256.test(source.revisionSha256)) issues.push('source_hash_invalid');
    if (source.revision !== input.revision) issues.push('stale_source_revision');
  }
  const allIds = new Set<string>();
  const members = Array.isArray(input.members) ? input.members : [];
  const joints = Array.isArray(input.joints) ? input.joints : [];
  const paths = Array.isArray(input.weldPaths) ? input.weldPaths : [];
  const bom = Array.isArray(input.bom) ? input.bom : [];
  const schedule = Array.isArray(input.weldSchedule) ? input.weldSchedule : [];
  for (const [value, label] of [[input.members, 'members'], [input.joints, 'joints'], [input.weldPaths, 'weld_paths'], [input.bom, 'bom'], [input.weldSchedule, 'weld_schedule']] as const) {
    if (!Array.isArray(value)) issues.push(`${label}_array_required`);
  }
  registerIds(members, 'member', issues, allIds);
  registerIds(joints, 'joint', issues, allIds);
  registerIds(paths, 'weld_path', issues, allIds);
  registerIds(bom, 'bom_line', issues, allIds);
  registerIds(schedule, 'schedule_line', issues, allIds);
  const memberIds = new Set(members.map(item => item?.id).filter((id): id is string => typeof id === 'string'));
  const jointIds = new Set(joints.map(item => item?.id).filter((id): id is string => typeof id === 'string'));
  const pathById = new Map(paths.map(item => [item?.id, item]));
  for (const member of members) {
    if (!member || typeof member !== 'object') { issues.push('member_invalid'); continue; }
    if (typeof member.materialId !== 'string' || !member.materialId.trim() || typeof member.grade !== 'string' || !member.grade.trim()) issues.push(`member_material_invalid:${member.id}`);
    if (!finite(member.thicknessMm) || member.thicknessMm <= 0) issues.push(`member_thickness_invalid:${member.id}`);
    if (!validProvenance(member.provenance, source?.revisionSha256 ?? '')) issues.push(`member_provenance_invalid:${member.id}`);
  }
  for (const joint of joints) {
    if (!joint || typeof joint !== 'object') { issues.push('joint_invalid'); continue; }
    if (!memberIds.has(joint.memberAId) || !memberIds.has(joint.memberBId) || joint.memberAId === joint.memberBId) issues.push(`joint_member_ownership_invalid:${joint.id}`);
    if (!['fillet', 'groove', 'butt', 'lap'].includes(joint.type)) issues.push(`joint_type_invalid:${joint.id}`);
    if (!finite(joint.sizeMm) || joint.sizeMm <= 0 || !finite(joint.lengthMm) || joint.lengthMm <= 0) issues.push(`joint_geometry_invalid:${joint.id}`);
    if (!['continuous', 'intermittent'].includes(joint.continuity)) issues.push(`joint_continuity_invalid:${joint.id}`);
    if (joint.continuity === 'intermittent' && (!finite(joint.pitchMm) || joint.pitchMm <= 0 || joint.pitchMm < joint.sizeMm)) issues.push(`joint_pitch_invalid:${joint.id}`);
    if (!['GMAW', 'GTAW', 'SMAW', 'FCAW', 'SAW', 'other'].includes(joint.process) || typeof joint.wpsReference !== 'string' || !joint.wpsReference.trim()) issues.push(`joint_process_wps_invalid:${joint.id}`);
    const ownedPath = pathById.get(joint.weldPathId);
    if (!ownedPath) issues.push(`joint_weld_path_dangling:${joint.id}`);
    else if (ownedPath.jointId !== joint.id) issues.push(`joint_weld_path_ownership_invalid:${joint.id}`);
  }
  const representedJoints = new Set<string>();
  for (const path of paths) {
    if (!path || typeof path !== 'object') { issues.push('weld_path_invalid'); continue; }
    if (!jointIds.has(path.jointId)) issues.push(`weld_path_joint_dangling:${path.id}`);
    else if (representedJoints.has(path.jointId)) issues.push(`weld_path_duplicate_joint:${path.jointId}`);
    else representedJoints.add(path.jointId);
    if (!Array.isArray(path.pointsMm) || path.pointsMm.length < 2 || path.pointsMm.some((item: unknown) => !point(item))) issues.push(`weld_path_points_invalid:${path.id}`);
    const points = Array.isArray(path.pointsMm) ? path.pointsMm : [];
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!, b = points[index]!;
      if (point(a) && point(b)) {
        const segment = distance(a, b);
        if (segment <= EPSILON) issues.push(`weld_path_zero_length_segment:${path.id}`);
        length += segment;
      }
    }
    if (!finite(path.geometryLengthMm) || path.geometryLengthMm <= 0 || !equal(path.geometryLengthMm, length)) issues.push(`weld_path_length_mismatch:${path.id}`);
    const joint = joints.find(item => item?.id === path.jointId);
    if (joint && !equal(joint.lengthMm, path.geometryLengthMm)) issues.push(`joint_path_length_mismatch:${joint.id}`);
  }
  for (const joint of joints) if (joint && typeof joint === 'object' && !representedJoints.has(joint.id)) issues.push(`joint_path_missing:${joint.id}`);
  const bomMembers = new Set<string>();
  for (const line of bom) {
    if (!line || typeof line !== 'object') { issues.push('bom_line_invalid'); continue; }
    if (!memberIds.has(line.memberId) || bomMembers.has(line.memberId)) issues.push(`bom_member_dangling_or_duplicate:${line.id}`);
    bomMembers.add(line.memberId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) issues.push(`bom_quantity_invalid:${line.id}`);
  }
  for (const id of memberIds) if (!bomMembers.has(id)) issues.push(`bom_member_missing:${id}`);
  const scheduleJoints = new Set<string>();
  for (const line of schedule) {
    if (!line || typeof line !== 'object') { issues.push('schedule_line_invalid'); continue; }
    const joint = joints.find(item => item?.id === line.jointId);
    if (!joint || scheduleJoints.has(line.jointId)) issues.push(`schedule_joint_dangling_or_duplicate:${line.id}`);
    scheduleJoints.add(line.jointId);
    const path = joint ? pathById.get(joint.weldPathId) : undefined;
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !finite(line.totalLengthMm) || line.totalLengthMm <= 0 || !path || !equal(line.totalLengthMm, path.geometryLengthMm * line.quantity)) issues.push(`schedule_length_or_quantity_invalid:${line.id}`);
  }
  for (const id of jointIds) if (!scheduleJoints.has(id)) issues.push(`schedule_joint_missing:${id}`);
  const output = input.output;
  if (!output || !['json', 'csv', 'step'].includes(output.format)) issues.push('output_format_invalid');
  if (!output || output.revision !== input.revision) issues.push('stale_output_revision');
  if (!output || typeof output.content !== 'string' || !Number.isSafeInteger(output.bytes) || output.bytes <= 0 || !SHA256.test(output.sha256)) issues.push('output_binding_invalid');
  else {
    if (Buffer.byteLength(output.content, 'utf8') !== output.bytes) issues.push('output_bytes_mismatch');
    if (sha256(output.content) !== output.sha256) issues.push('output_hash_mismatch');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function verifyWeldedFabricationReadback(
  input: WeldedFabricationReleaseInputV1,
  readback: WeldedFabricationParserReadbackV1 | null | undefined,
): WeldedFabricationReadbackResult {
  const issues = validateWeldedFabricationRelease(input).issues;
  if (!readback) issues.push('parser_readback_missing');
  else {
    if (readback.parserId !== 'nexyfab.welded-fabrication-independent-parser.v1' || !SHA256.test(readback.parserSourceSha256)) issues.push('parser_identity_invalid');
    if (readback.sourceAssemblyId !== input.source.assemblyId || readback.sourceBrepSha256 !== input.source.brepSha256 || readback.sourceContentHash !== input.source.contentHash) issues.push('readback_source_hash_or_assembly_mismatch');
    if (readback.sourceRevision !== input.revision) issues.push('readback_source_revision_mismatch');
    if (readback.outputSha256 !== input.output.sha256) issues.push('readback_output_hash_mismatch');
    const expected = [input.members.map(item => item?.id), input.joints.map(item => item?.id), input.weldPaths.map(item => item?.id), input.bom.map(item => item?.id), input.weldSchedule.map(item => item?.id)];
    const actual = [readback.memberIds, readback.jointIds, readback.weldPathIds, readback.bomLineIds, readback.scheduleLineIds];
    const labels = ['member', 'joint', 'weld_path', 'bom_line', 'schedule_line'];
    actual.forEach((value, index) => {
      if (JSON.stringify(stringIds(value)) !== JSON.stringify(stringIds(expected[index]))) issues.push(`readback_${labels[index]}_identity_mismatch`);
    });
    if (!SHA256.test(readback.verificationSha256) || readback.verificationSha256 !== weldedFabricationReadbackVerificationSha256(readback)) issues.push('readback_verification_hash_mismatch');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function weldedFabricationReadbackVerificationSha256(
  readback: Omit<WeldedFabricationParserReadbackV1, 'verificationSha256'> | WeldedFabricationParserReadbackV1,
): string {
  return sha256(JSON.stringify({
    parserId: readback.parserId,
    parserSourceSha256: readback.parserSourceSha256,
    sourceAssemblyId: readback.sourceAssemblyId,
    sourceBrepSha256: readback.sourceBrepSha256,
    sourceContentHash: readback.sourceContentHash,
    sourceRevision: readback.sourceRevision,
    outputSha256: readback.outputSha256,
    memberIds: [...readback.memberIds].sort(),
    jointIds: [...readback.jointIds].sort(),
    weldPathIds: [...readback.weldPathIds].sort(),
    bomLineIds: [...readback.bomLineIds].sort(),
    scheduleLineIds: [...readback.scheduleLineIds].sort(),
  }));
}

export function assessWeldedFabricationRelease(
  input: WeldedFabricationReleaseInputV1 | null | undefined,
  readback?: WeldedFabricationParserReadbackV1 | null,
): WeldedFabricationReleaseAssessment {
  const validation = input ? validateWeldedFabricationRelease(input) : { valid: false, issues: ['input_missing'] };
  const parser = input ? verifyWeldedFabricationReadback(input, readback) : { valid: false, issues: ['input_missing'] };
  return {
    schema: WELDED_FABRICATION_RELEASE_SCHEMA,
    releaseReady: false,
    status: 'HOLD',
    parserVerified: parser.valid,
    blockers: [...new Set([...validation.issues, ...parser.issues, ...holdBoundary])],
    holdBoundary,
  };
}
