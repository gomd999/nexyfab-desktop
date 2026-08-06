import { createHash } from 'node:crypto';
import { parseStl } from '@/lib/cad-ir/ingestStl';
import { analyzeIndexed, trianglesToIndexed, type IndexedMesh } from '@/lib/cad-ir/meshAnalysis';

export interface CadNativeStlOccurrenceInput { occurrenceId: string; definitionId: string; bytes: Uint8Array; sha256: string; localToWorld: number[]; unitScaleMm: number | null; }
export interface CadNativeStlOccurrenceGeometry { occurrenceId: string; definitionId: string; sha256: string; localMesh: IndexedMesh; localToWorld: number[]; unitScaleMm: number; measurement: ReturnType<typeof analyzeIndexed>; }
export interface CadNativeStlLocalGeometryResult { status: 'pass' | 'fail' | 'not_run'; releaseReady: boolean; geometries: CadNativeStlOccurrenceGeometry[]; errors: string[]; unresolved: string[]; }

const rigid4 = (matrix: number[]) => {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) return false;
  const c0 = [matrix[0]!, matrix[4]!, matrix[8]!], c1 = [matrix[1]!, matrix[5]!, matrix[9]!], c2 = [matrix[2]!, matrix[6]!, matrix[10]!];
  const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index]!, 0);
  return Math.abs(dot(c0, c0) - 1) < 1e-7 && Math.abs(dot(c1, c1) - 1) < 1e-7 && Math.abs(dot(c2, c2) - 1) < 1e-7 && Math.abs(dot(c0, c1)) < 1e-7 && Math.abs(dot(c0, c2)) < 1e-7 && Math.abs(dot(c1, c2)) < 1e-7 && Math.abs(matrix[12]!) < 1e-9 && Math.abs(matrix[13]!) < 1e-9 && Math.abs(matrix[14]!) < 1e-9 && Math.abs(matrix[15]! - 1) < 1e-9;
};

/** Parses STL in definition-local coordinates and keeps the occurrence transform separate. */
export function buildCadNativeStlLocalGeometry(inputs: readonly CadNativeStlOccurrenceInput[]): CadNativeStlLocalGeometryResult {
  if (!inputs.length) return { status: 'not_run', releaseReady: false, geometries: [], errors: [], unresolved: ['native_stl_occurrences_missing'] };
  const errors: string[] = [], unresolved: string[] = [], geometries: CadNativeStlOccurrenceGeometry[] = [], ids = new Set<string>();
  for (const input of inputs) {
    if (!input.occurrenceId.trim() || ids.has(input.occurrenceId)) { errors.push(`native_stl_occurrence_id_invalid:${input.occurrenceId}`); continue; }
    ids.add(input.occurrenceId);
    if (createHash('sha256').update(input.bytes).digest('hex') !== input.sha256) { errors.push(`native_stl_hash_mismatch:${input.occurrenceId}`); continue; }
    if (!rigid4(input.localToWorld)) { errors.push(`native_stl_transform_invalid:${input.occurrenceId}`); continue; }
    if (input.unitScaleMm === null) { unresolved.push(`native_stl_units_unknown:${input.occurrenceId}`); continue; }
    if (!(input.unitScaleMm > 0) || !Number.isFinite(input.unitScaleMm)) { errors.push(`native_stl_unit_scale_invalid:${input.occurrenceId}`); continue; }
    const localMesh = trianglesToIndexed(parseStl(input.bytes).triangles);
    const measurement = analyzeIndexed(localMesh);
    if (!measurement.ok || !measurement.triangles) { errors.push(`native_stl_mesh_invalid:${input.occurrenceId}`); continue; }
    geometries.push({ occurrenceId: input.occurrenceId, definitionId: input.definitionId, sha256: input.sha256, localMesh, localToWorld: [...input.localToWorld], unitScaleMm: input.unitScaleMm, measurement });
  }
  const status = errors.length ? 'fail' : unresolved.length || geometries.length !== inputs.length ? 'not_run' : 'pass';
  return { status, releaseReady: status === 'pass', geometries, errors, unresolved };
}
