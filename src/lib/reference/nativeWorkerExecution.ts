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
  schema: 'nexyfab.native-worker-execution-result.v1';
  jobId: string;
  caseId: string;
  sourceHash: string;
  sourceSha256: string;
  worker: { name: string; version: string; cadSystem: string };
  units: { length: 'mm' | 'cm' | 'm' | 'in'; angle: 'deg' | 'rad' };
  definitions: Array<{ id: string; kind: 'assembly' | 'part'; bodyCount?: number }>;
  occurrences: Array<{ id: string; definitionId: string; parentOccurrenceId: string | null; localToParent: number[]; suppressed?: boolean }>;
  joints: Array<{ id: string; kind: 'fixed' | 'revolute' | 'prismatic' | 'cylindrical' | 'planar' | 'spherical'; occurrenceA: string; occurrenceB: string }>;
  nativeSemantics: { complete: boolean; hierarchyRecovered: boolean; constraintsRecovered: boolean };
}

const SHA256 = /^[a-f0-9]{64}$/;
const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index]!, 0);
const rigid = (matrix: number[]) => {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) return false;
  const columns = [[matrix[0]!, matrix[4]!, matrix[8]!], [matrix[1]!, matrix[5]!, matrix[9]!], [matrix[2]!, matrix[6]!, matrix[10]!]];
  return columns.every(column => Math.abs(dot(column, column) - 1) <= 1e-7)
    && Math.abs(dot(columns[0]!, columns[1]!)) <= 1e-7
    && Math.abs(dot(columns[0]!, columns[2]!)) <= 1e-7
    && Math.abs(dot(columns[1]!, columns[2]!)) <= 1e-7
    && Math.abs(matrix[12]!) <= 1e-9 && Math.abs(matrix[13]!) <= 1e-9
    && Math.abs(matrix[14]!) <= 1e-9 && Math.abs(matrix[15]! - 1) <= 1e-9;
};

export function validateNativeWorkerExecutionResult(job: NativeWorkerExecutionJob, result: NativeWorkerExecutionResult) {
  const errors: string[] = [];
  if (result.schema !== 'nexyfab.native-worker-execution-result.v1') errors.push('result_schema_invalid');
  if (result.jobId !== job.jobId) errors.push('job_id_mismatch');
  if (result.caseId !== job.caseId) errors.push('case_id_mismatch');
  if (result.sourceHash !== job.sourceHash || !SHA256.test(result.sourceHash)) errors.push('source_hash_mismatch');
  if (result.sourceSha256 !== job.source.sha256 || !SHA256.test(result.sourceSha256)) errors.push('source_payload_hash_mismatch');
  if (![result.worker?.name, result.worker?.version, result.worker?.cadSystem].every(value => typeof value === 'string' && value.trim())) errors.push('worker_identity_missing');
  const definitionIds = new Set<string>();
  for (const definition of result.definitions ?? []) {
    if (!definition.id?.trim() || definitionIds.has(definition.id)) errors.push(`definition_id_invalid:${definition.id}`);
    definitionIds.add(definition.id);
    if (definition.kind === 'part' && (!Number.isInteger(definition.bodyCount) || definition.bodyCount! < 1)) errors.push(`body_count_invalid:${definition.id}`);
    if (definition.kind === 'assembly' && definition.bodyCount !== undefined) errors.push(`assembly_body_count_forbidden:${definition.id}`);
  }
  if (![...definitionIds].length || !(result.definitions ?? []).some(item => item.kind === 'part')) errors.push('part_definitions_missing');
  const occurrenceIds = new Set<string>();
  for (const occurrence of result.occurrences ?? []) {
    if (!occurrence.id?.trim() || occurrenceIds.has(occurrence.id)) errors.push(`occurrence_id_invalid:${occurrence.id}`);
    occurrenceIds.add(occurrence.id);
    if (!definitionIds.has(occurrence.definitionId)) errors.push(`occurrence_definition_missing:${occurrence.id}`);
    if (!rigid(occurrence.localToParent)) errors.push(`occurrence_transform_invalid:${occurrence.id}`);
  }
  for (const occurrence of result.occurrences ?? []) if (occurrence.parentOccurrenceId && !occurrenceIds.has(occurrence.parentOccurrenceId)) errors.push(`occurrence_parent_missing:${occurrence.id}`);
  if ((result.occurrences ?? []).filter(item => item.parentOccurrenceId === null).length !== 1) errors.push('occurrence_root_count_invalid');
  for (const joint of result.joints ?? []) if (!occurrenceIds.has(joint.occurrenceA) || !occurrenceIds.has(joint.occurrenceB) || joint.occurrenceA === joint.occurrenceB) errors.push(`joint_occurrence_invalid:${joint.id}`);
  if (job.nativeSemanticsRequired && (!result.nativeSemantics?.complete || !result.nativeSemantics.hierarchyRecovered || !result.nativeSemantics.constraintsRecovered)) errors.push('native_semantics_incomplete');
  return { status: errors.length ? 'fail' as const : 'pass' as const, releaseReady: errors.length === 0, errors };
}
