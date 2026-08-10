import type { NativeWorkerKind } from './nativeWorkerRouting';

export interface NativeWorkerExecutionJob {
  schema: 'nexyfab.native-worker-routing-job.v1';
  jobId: string;
  caseId: string;
  sourceHash: string;
  source: { kind: 'direct' | 'zip-member'; locator: string; member?: string; sha256: string; bytes: number; extension: string };
  workerKind: NativeWorkerKind;
  availability: 'local' | 'external-required';
  nativeSemanticsRequired: boolean;
  status: 'locally-routable' | 'not_run';
}

export interface NativeWorkerExecutionResult {
  schema: 'nexyfab.native-worker-execution-result.v1.1';
  jobId: string;
  caseId: string;
  sourceHash: string;
  sourceSha256: string;
  worker: { name: string; version: string; cadSystem: string };
  coordinateSystem: { handedness: 'right'; upAxis: 'x' | 'y' | 'z'; forwardAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'; matrixLayout: 'row-major'; vectorConvention: 'column-vector'; transformScope: 'local-to-parent' };
  units: { length: 'mm' | 'cm' | 'm' | 'in'; angle: 'deg' | 'rad' };
  definitions: Array<{ id: string; kind: 'assembly' | 'part'; bodyCount?: number }>;
  occurrences: Array<{ id: string; definitionId: string; parentOccurrenceId: string | null; localToParent: number[]; state: { resolved: boolean; suppressed: boolean; lightweight: boolean; flexible: boolean; hidden: boolean; mirrored: boolean } }>;
  joints: Array<{ id: string; kind: 'fixed' | 'revolute' | 'prismatic' | 'cylindrical' | 'planar' | 'spherical'; occurrenceA: string; occurrenceB: string; axis: [number, number, number] | null; originMm: [number, number, number] | null; lowerLimit: number | null; upperLimit: number | null; frame: 'world' }>;
  nativeSemantics: { complete: boolean; hierarchyRecovered: boolean; constraintsRecovered: boolean };
}

const SHA256 = /^[a-f0-9]{64}$/;
const LENGTH_UNITS = new Set(['mm', 'cm', 'm', 'in']);
const ANGLE_UNITS = new Set(['deg', 'rad']);
const DEFINITION_KINDS = new Set(['assembly', 'part']);
const JOINT_KINDS = new Set(['fixed', 'revolute', 'prismatic', 'cylindrical', 'planar', 'spherical']);
const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index]!, 0);
const determinant3 = (a: number[], b: number[], c: number[]) =>
  a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!)
  - b[0]! * (a[1]! * c[2]! - a[2]! * c[1]!)
  + c[0]! * (a[1]! * b[2]! - a[2]! * b[1]!);
const rigid = (matrix: number[], mirrored: boolean) => {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) return false;
  const columns = [[matrix[0]!, matrix[4]!, matrix[8]!], [matrix[1]!, matrix[5]!, matrix[9]!], [matrix[2]!, matrix[6]!, matrix[10]!]];
  return columns.every(column => Math.abs(dot(column, column) - 1) <= 1e-7)
    && Math.abs(dot(columns[0]!, columns[1]!)) <= 1e-7
    && Math.abs(dot(columns[0]!, columns[2]!)) <= 1e-7
    && Math.abs(dot(columns[1]!, columns[2]!)) <= 1e-7
    && Math.abs(determinant3(columns[0]!, columns[1]!, columns[2]!) - (mirrored ? -1 : 1)) <= 1e-7
    && Math.abs(matrix[12]!) <= 1e-9 && Math.abs(matrix[13]!) <= 1e-9
    && Math.abs(matrix[14]!) <= 1e-9 && Math.abs(matrix[15]! - 1) <= 1e-9;
};

export function validateNativeWorkerExecutionResult(job: NativeWorkerExecutionJob, result: NativeWorkerExecutionResult) {
  const errors: string[] = [];
  if (result.schema !== 'nexyfab.native-worker-execution-result.v1.1') errors.push('result_schema_invalid');
  if (result.jobId !== job.jobId) errors.push('job_id_mismatch');
  if (result.caseId !== job.caseId) errors.push('case_id_mismatch');
  if (result.sourceHash !== job.sourceHash || !SHA256.test(result.sourceHash)) errors.push('source_hash_mismatch');
  if (result.sourceSha256 !== job.source.sha256 || !SHA256.test(result.sourceSha256)) errors.push('source_payload_hash_mismatch');
  if (![result.worker?.name, result.worker?.version, result.worker?.cadSystem].every(value => typeof value === 'string' && value.trim())) errors.push('worker_identity_missing');
  if (result.coordinateSystem?.handedness !== 'right'
      || result.coordinateSystem?.matrixLayout !== 'row-major'
      || result.coordinateSystem?.vectorConvention !== 'column-vector'
      || result.coordinateSystem?.transformScope !== 'local-to-parent'
      || !['x', 'y', 'z'].includes(result.coordinateSystem?.upAxis)
      || !['+x', '-x', '+y', '-y', '+z', '-z'].includes(result.coordinateSystem?.forwardAxis)
      || result.coordinateSystem.forwardAxis.endsWith(result.coordinateSystem.upAxis)) errors.push('coordinate_system_invalid');
  if (!LENGTH_UNITS.has(result.units?.length) || !ANGLE_UNITS.has(result.units?.angle)) errors.push('units_invalid');
  const definitionIds = new Set<string>();
  for (const definition of result.definitions ?? []) {
    if (!definition.id?.trim() || definitionIds.has(definition.id)) errors.push(`definition_id_invalid:${definition.id}`);
    definitionIds.add(definition.id);
    if (!DEFINITION_KINDS.has(definition.kind)) errors.push(`definition_kind_invalid:${definition.id}`);
    if (definition.kind === 'part' && (!Number.isInteger(definition.bodyCount) || definition.bodyCount! < 1)) errors.push(`body_count_invalid:${definition.id}`);
    if (definition.kind === 'assembly' && definition.bodyCount !== undefined) errors.push(`assembly_body_count_forbidden:${definition.id}`);
  }
  if (![...definitionIds].length || !(result.definitions ?? []).some(item => item.kind === 'part')) errors.push('part_definitions_missing');
  const occurrenceIds = new Set<string>();
  for (const occurrence of result.occurrences ?? []) {
    if (!occurrence.id?.trim() || occurrenceIds.has(occurrence.id)) errors.push(`occurrence_id_invalid:${occurrence.id}`);
    occurrenceIds.add(occurrence.id);
    if (!definitionIds.has(occurrence.definitionId)) errors.push(`occurrence_definition_missing:${occurrence.id}`);
    const state = occurrence.state;
    if (!state || ![state.resolved, state.suppressed, state.lightweight, state.flexible, state.hidden, state.mirrored].every(value => typeof value === 'boolean')) errors.push(`occurrence_state_invalid:${occurrence.id}`);
    if (!rigid(occurrence.localToParent, state?.mirrored === true)) errors.push(`occurrence_transform_invalid:${occurrence.id}`);
  }
  for (const occurrence of result.occurrences ?? []) if (occurrence.parentOccurrenceId && !occurrenceIds.has(occurrence.parentOccurrenceId)) errors.push(`occurrence_parent_missing:${occurrence.id}`);
  const roots = (result.occurrences ?? []).filter(item => item.parentOccurrenceId === null);
  if (roots.length !== 1) errors.push('occurrence_root_count_invalid');
  const occurrenceById = new Map((result.occurrences ?? []).map(item => [item.id, item]));
  const reachesRoot = new Map<string, boolean>();
  const cycleReported = new Set<string>();
  for (const occurrence of result.occurrences ?? []) {
    if (reachesRoot.has(occurrence.id)) continue;
    const path: string[] = [];
    const position = new Map<string, number>();
    let cursorId: string | null = occurrence.id;
    let valid = false;
    while (cursorId) {
      const resolved = reachesRoot.get(cursorId);
      if (resolved !== undefined) { valid = resolved; break; }
      const cycleAt = position.get(cursorId);
      if (cycleAt !== undefined) {
        for (const id of path.slice(cycleAt)) {
          if (!cycleReported.has(id)) errors.push(`occurrence_cycle:${id}`);
          cycleReported.add(id);
          reachesRoot.set(id, false);
        }
        break;
      }
      const cursor = occurrenceById.get(cursorId);
      if (!cursor) break;
      position.set(cursorId, path.length);
      path.push(cursorId);
      if (cursor.parentOccurrenceId === null) {
        valid = roots.length === 1 && cursor.id === roots[0]!.id;
        break;
      }
      cursorId = cursor.parentOccurrenceId;
    }
    for (const id of path) if (!reachesRoot.has(id)) reachesRoot.set(id, valid);
    if (!valid && !cycleReported.has(occurrence.id)) errors.push(`occurrence_disconnected:${occurrence.id}`);
  }
  const jointIds = new Set<string>();
  for (const joint of result.joints ?? []) {
    if (!joint.id?.trim() || jointIds.has(joint.id)) errors.push(`joint_id_invalid:${joint.id}`);
    jointIds.add(joint.id);
    if (!JOINT_KINDS.has(joint.kind)) errors.push(`joint_kind_invalid:${joint.id}`);
    if (!occurrenceIds.has(joint.occurrenceA) || !occurrenceIds.has(joint.occurrenceB) || joint.occurrenceA === joint.occurrenceB) errors.push(`joint_occurrence_invalid:${joint.id}`);
    if (joint.frame !== 'world') errors.push(`joint_frame_invalid:${joint.id}`);
    if (joint.kind !== 'fixed') {
      if (!Array.isArray(joint.axis) || joint.axis.length !== 3 || !joint.axis.every(Number.isFinite) || Math.hypot(...joint.axis) <= 1e-12) errors.push(`joint_axis_invalid:${joint.id}`);
      if (!Array.isArray(joint.originMm) || joint.originMm.length !== 3 || !joint.originMm.every(Number.isFinite)) errors.push(`joint_origin_invalid:${joint.id}`);
    }
    if (joint.lowerLimit !== null && !Number.isFinite(joint.lowerLimit)) errors.push(`joint_lower_limit_invalid:${joint.id}`);
    if (joint.upperLimit !== null && !Number.isFinite(joint.upperLimit)) errors.push(`joint_upper_limit_invalid:${joint.id}`);
    if (joint.lowerLimit !== null && joint.upperLimit !== null && joint.lowerLimit > joint.upperLimit) errors.push(`joint_limits_invalid:${joint.id}`);
  }
  if (job.nativeSemanticsRequired && (!result.nativeSemantics?.complete || !result.nativeSemantics.hierarchyRecovered || !result.nativeSemantics.constraintsRecovered)) errors.push('native_semantics_incomplete');
  return { status: errors.length ? 'fail' as const : 'pass' as const, releaseReady: errors.length === 0, errors };
}
