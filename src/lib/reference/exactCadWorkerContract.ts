export type ExactCadWorkerKind = 'dwg-exact' | 'revit-native';
export type ExactGeometryEvidence = 'native-brep' | 'indexed-closed-mesh';

export interface ExactCadWorkerRequest {
  schema: 'nexyfab.exact-cad-worker-request.v1'; jobId: string; caseId: string; sourceHash: string;
  sourceMember: { path: string; sha256: string }; workerKind: ExactCadWorkerKind;
  required: { exactGeometry: true; nativeSemantics: boolean };
}
export interface ExactCadWorkerResult {
  schema: 'nexyfab.exact-cad-worker-result.v1'; jobId: string; caseId: string; sourceHash: string;
  sourceMember: { path: string; sha256: string }; worker: { name: string; version: string; cadSystem: string };
  units: { length: 'mm' | 'cm' | 'm' | 'in'; angle: 'deg' | 'rad' };
  definitions: Array<{ id: string; kind: 'assembly' | 'part'; bodyCount?: number; geometry?: { evidence: ExactGeometryEvidence; faceCount: number; volumeMm3: number; watertight?: boolean } }>;
  occurrences: Array<{ id: string; definitionId: string; parentOccurrenceId: string | null; localToParent: number[] }>;
  nativeSemantics: { complete: boolean; definitionOccurrenceSeparated: boolean; hierarchyRecovered: boolean; parametersRecovered: boolean; constraintsRecovered: boolean };
}
export interface ExactCadWorkerValidation { status: 'pass' | 'fail'; releaseReady: boolean; exactGeometryReady: boolean; nativeSemanticsReady: boolean; errors: string[]; }

const SHA256 = /^[a-f0-9]{64}$/;
const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index]!, 0);
const rigid = (matrix: number[]) => {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) return false;
  const columns = [[matrix[0]!, matrix[4]!, matrix[8]!], [matrix[1]!, matrix[5]!, matrix[9]!], [matrix[2]!, matrix[6]!, matrix[10]!]];
  return columns.every(column => Math.abs(dot(column, column) - 1) <= 1e-7) && Math.abs(dot(columns[0]!, columns[1]!)) <= 1e-7 && Math.abs(dot(columns[0]!, columns[2]!)) <= 1e-7 && Math.abs(dot(columns[1]!, columns[2]!)) <= 1e-7 && Math.abs(matrix[12]!) <= 1e-9 && Math.abs(matrix[13]!) <= 1e-9 && Math.abs(matrix[14]!) <= 1e-9 && Math.abs(matrix[15]! - 1) <= 1e-9;
};

export function validateExactCadWorkerResult(request: ExactCadWorkerRequest, result: ExactCadWorkerResult): ExactCadWorkerValidation {
  const errors: string[] = [];
  if (request.jobId !== result.jobId) errors.push('job_id_mismatch');
  if (request.caseId !== result.caseId) errors.push('case_id_mismatch');
  if (request.sourceHash !== result.sourceHash || !SHA256.test(result.sourceHash)) errors.push('source_hash_mismatch');
  if (request.sourceMember.path !== result.sourceMember.path || request.sourceMember.sha256 !== result.sourceMember.sha256 || !SHA256.test(result.sourceMember.sha256)) errors.push('source_member_mismatch');
  if (![result.worker.name, result.worker.version, result.worker.cadSystem].every(value => value.trim())) errors.push('worker_identity_missing');
  const parts = result.definitions.filter(item => item.kind === 'part');
  if (!parts.length) errors.push('parts_missing');
  const definitionIds = new Set<string>();
  for (const definition of result.definitions) {
    if (!definition.id.trim() || definitionIds.has(definition.id)) errors.push(`definition_id_invalid:${definition.id}`);
    definitionIds.add(definition.id);
    if (definition.kind === 'assembly') {
      if (definition.bodyCount !== undefined || definition.geometry !== undefined) errors.push(`assembly_geometry_forbidden:${definition.id}`);
    } else {
      if (!Number.isInteger(definition.bodyCount) || definition.bodyCount! < 1) errors.push(`body_count_invalid:${definition.id}`);
      if (!definition.geometry || !Number.isInteger(definition.geometry.faceCount) || definition.geometry.faceCount < 4 || !Number.isFinite(definition.geometry.volumeMm3) || definition.geometry.volumeMm3 <= 0) errors.push(`exact_geometry_measurement_invalid:${definition.id}`);
      if (definition.geometry?.evidence === 'indexed-closed-mesh' && definition.geometry.watertight !== true) errors.push(`closed_mesh_not_watertight:${definition.id}`);
    }
  }
  const occurrenceIds = new Set<string>();
  for (const occurrence of result.occurrences) {
    if (!occurrence.id.trim() || occurrenceIds.has(occurrence.id)) errors.push(`occurrence_id_invalid:${occurrence.id}`);
    occurrenceIds.add(occurrence.id);
    if (!definitionIds.has(occurrence.definitionId)) errors.push(`occurrence_definition_missing:${occurrence.id}`);
    if (!rigid(occurrence.localToParent)) errors.push(`occurrence_transform_invalid:${occurrence.id}`);
  }
  for (const occurrence of result.occurrences) if (occurrence.parentOccurrenceId && !occurrenceIds.has(occurrence.parentOccurrenceId)) errors.push(`occurrence_parent_missing:${occurrence.id}`);
  const roots = result.occurrences.filter(item => item.parentOccurrenceId === null);
  if (roots.length !== 1) errors.push(`occurrence_root_count:${roots.length}`);
  const parents = new Map(result.occurrences.map(item => [item.id, item.parentOccurrenceId]));
  for (const occurrence of result.occurrences) { const seen = new Set<string>(); let cursor: string | null = occurrence.id; while (cursor) { if (seen.has(cursor)) { errors.push(`occurrence_cycle:${occurrence.id}`); break; } seen.add(cursor); cursor = parents.get(cursor) ?? null; } }
  for (const part of parts) if (!result.occurrences.some(item => item.definitionId === part.id)) errors.push(`part_occurrence_missing:${part.id}`);
  const exactGeometryReady = parts.length > 0 && !errors.some(error => error.includes('geometry') || error.includes('mesh') || error.includes('body_count') || error === 'parts_missing' || error.includes('part_occurrence'));
  const semantics = result.nativeSemantics;
  const nativeSemanticsReady = semantics.complete && semantics.definitionOccurrenceSeparated && semantics.hierarchyRecovered && semantics.parametersRecovered && semantics.constraintsRecovered;
  if (request.required.nativeSemantics && !nativeSemanticsReady) errors.push('native_semantics_incomplete');
  const status = errors.length ? 'fail' : 'pass';
  return { status, releaseReady: status === 'pass' && exactGeometryReady && (!request.required.nativeSemantics || nativeSemanticsReady), exactGeometryReady, nativeSemanticsReady, errors };
}
