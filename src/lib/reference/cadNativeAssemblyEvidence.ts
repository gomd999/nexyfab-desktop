import type { CadProductBundleManifest } from './cadCorpusProductBundle';

export interface CadNativeAssemblySource { relativePath: string; sha256: string; }
export interface CadNativeAssemblyDefinition { id: string; name: string; sourceMember: string | null; kind?: 'assembly' | 'part'; }
export interface CadNativeAssemblyCoordinateSystem { handedness: 'right' | 'left'; upAxis: 'x' | 'y' | 'z'; forwardAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'; matrixLayout: 'row-major'; vectorConvention: 'column-vector'; transformScope: 'local-to-parent' | 'local-to-world'; }
export interface CadNativeAssemblyUnits { length: 'mm' | 'cm' | 'm' | 'in'; angle: 'deg' | 'rad'; }
export interface CadNativeAssemblyOccurrenceState { resolved: boolean; suppressed: boolean; lightweight: boolean; flexible: boolean; hidden: boolean; mirrored?: boolean; configuration?: string; referencedConfiguration?: string; }
export interface CadNativeAssemblyOccurrence { id: string; definitionId: string; parentOccurrenceId: string | null; transform: number[]; suppressed: boolean; state?: CadNativeAssemblyOccurrenceState; }
export interface CadNativeAssemblyJoint { id: string; type: 'fixed' | 'revolute' | 'prismatic' | 'cylindrical' | 'planar' | 'spherical'; parentOccurrenceId: string; childOccurrenceId: string; axis: [number, number, number] | null; originMm: [number, number, number] | null; lowerLimit: number | null; upperLimit: number | null; frame?: 'world'; }
export interface CadNativeAssemblyEvidence {
  schema: 'nexyfab.native-assembly-evidence.v1' | 'nexyfab.native-assembly-evidence.v1.1'; lineageId: string;
  extractor: { name: string; version: string; cadSystem: string; cadVersion: string | null; };
  coordinateSystem?: CadNativeAssemblyCoordinateSystem; units?: CadNativeAssemblyUnits;
  sources: CadNativeAssemblySource[]; definitions: CadNativeAssemblyDefinition[]; occurrences: CadNativeAssemblyOccurrence[]; joints: CadNativeAssemblyJoint[];
}
export interface CadNativeAssemblyValidation { status: 'pass' | 'fail' | 'not_run'; releaseReady: boolean; errors: string[]; warnings: string[]; }

const finiteVector = (value: unknown, length: number): boolean => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index]!, 0);
const determinant3 = (m: number[]) => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
function rigidTransformIssue(matrix: number[], mirrored: boolean): string | null {
  if (!finiteVector(matrix, 16)) return 'not_finite_4x4';
  if (Math.abs(matrix[12]!) > 1e-9 || Math.abs(matrix[13]!) > 1e-9 || Math.abs(matrix[14]!) > 1e-9 || Math.abs(matrix[15]! - 1) > 1e-9) return 'affine_row_invalid';
  const columns = [[matrix[0]!, matrix[4]!, matrix[8]!], [matrix[1]!, matrix[5]!, matrix[9]!], [matrix[2]!, matrix[6]!, matrix[10]!]];
  if (columns.some(column => Math.abs(dot(column, column) - 1) > 1e-7) || Math.abs(dot(columns[0]!, columns[1]!)) > 1e-7 || Math.abs(dot(columns[0]!, columns[2]!)) > 1e-7 || Math.abs(dot(columns[1]!, columns[2]!)) > 1e-7) return 'scale_or_shear';
  const det = determinant3([matrix[0]!, matrix[1]!, matrix[2]!, matrix[4]!, matrix[5]!, matrix[6]!, matrix[8]!, matrix[9]!, matrix[10]!]);
  if (Math.abs(det - (mirrored ? -1 : 1)) > 1e-7) return mirrored ? 'mirror_determinant_invalid' : det < 0 ? 'mirror_not_declared' : 'rotation_determinant_invalid';
  return null;
}

export function validateCadNativeAssemblyEvidence(bundle: CadProductBundleManifest, evidence?: CadNativeAssemblyEvidence): CadNativeAssemblyValidation {
  if (!evidence) return { status: 'not_run', releaseReady: false, errors: ['native_assembly_evidence_not_run'], warnings: [] };
  const errors: string[] = [], warnings: string[] = [];
  if (evidence.schema !== 'nexyfab.native-assembly-evidence.v1' && evidence.schema !== 'nexyfab.native-assembly-evidence.v1.1') errors.push('native_assembly_evidence_schema_invalid');
  const v11 = evidence.schema === 'nexyfab.native-assembly-evidence.v1.1';
  if (v11 && !evidence.coordinateSystem) errors.push('native_assembly_coordinate_system_missing');
  if (v11 && !evidence.units) errors.push('native_assembly_units_missing');
  if (evidence.coordinateSystem && (evidence.coordinateSystem.matrixLayout !== 'row-major' || evidence.coordinateSystem.vectorConvention !== 'column-vector')) errors.push('native_assembly_transform_convention_unsupported');
  if (evidence.coordinateSystem && evidence.coordinateSystem.forwardAxis.endsWith(evidence.coordinateSystem.upAxis)) errors.push('native_assembly_axes_not_independent');
  if (evidence.lineageId !== bundle.lineageId) errors.push('native_assembly_evidence_lineage_mismatch');
  if (!evidence.extractor?.name?.trim() || !evidence.extractor?.version?.trim() || !evidence.extractor?.cadSystem?.trim()) errors.push('native_assembly_extractor_identity_missing');
  const nativeMembers = new Map(bundle.members.filter(member => member.role === 'native_assembly').map(member => [member.relativePath, member]));
  const sourcePaths = new Set<string>();
  for (const source of evidence.sources ?? []) {
    if (sourcePaths.has(source.relativePath)) errors.push(`native_assembly_source_duplicate:${source.relativePath}`);
    sourcePaths.add(source.relativePath);
    const member = nativeMembers.get(source.relativePath);
    if (!member) errors.push(`native_assembly_source_outside_bundle:${source.relativePath}`);
    else if (member.sha256 !== source.sha256) errors.push(`native_assembly_source_hash_mismatch:${source.relativePath}`);
  }
  if (!evidence.sources?.length) errors.push('native_assembly_sources_missing');
  const definitionIds = new Set<string>();
  for (const definition of evidence.definitions ?? []) {
    if (!definition.id || definitionIds.has(definition.id)) errors.push(`native_assembly_definition_id_invalid:${definition.id}`);
    definitionIds.add(definition.id);
    if (definition.sourceMember && !bundle.members.some(member => member.relativePath === definition.sourceMember)) errors.push(`native_assembly_definition_source_missing:${definition.id}`);
    if (v11 && !definition.kind) errors.push(`native_assembly_definition_kind_missing:${definition.id}`);
  }
  const occurrenceIds = new Set<string>();
  for (const occurrence of evidence.occurrences ?? []) {
    if (!occurrence.id || occurrenceIds.has(occurrence.id)) errors.push(`native_assembly_occurrence_id_invalid:${occurrence.id}`);
    occurrenceIds.add(occurrence.id);
    if (!definitionIds.has(occurrence.definitionId)) errors.push(`native_assembly_occurrence_definition_missing:${occurrence.id}`);
    const transformIssue = rigidTransformIssue(occurrence.transform, occurrence.state?.mirrored === true);
    if (transformIssue) errors.push(`native_assembly_transform_invalid:${occurrence.id}:${transformIssue}`);
    if (v11 && !occurrence.state) errors.push(`native_assembly_occurrence_state_missing:${occurrence.id}`);
    if (occurrence.state && occurrence.state.suppressed !== occurrence.suppressed) errors.push(`native_assembly_suppression_conflict:${occurrence.id}`);
    if (occurrence.state?.flexible && !occurrence.state.resolved) warnings.push(`native_assembly_flexible_unresolved:${occurrence.id}`);
  }
  for (const occurrence of evidence.occurrences ?? []) if (occurrence.parentOccurrenceId && !occurrenceIds.has(occurrence.parentOccurrenceId)) errors.push(`native_assembly_parent_missing:${occurrence.id}`);
  const roots = (evidence.occurrences ?? []).filter(item => item.parentOccurrenceId === null);
  if (!evidence.occurrences?.length) errors.push('native_assembly_occurrences_missing');
  else if (roots.length !== 1) errors.push(`native_assembly_root_count_invalid:${roots.length}`);
  const occurrenceById = new Map((evidence.occurrences ?? []).map(item => [item.id, item]));
  const reachesRoot = new Map<string, boolean>();
  const cycleReported = new Set<string>();
  for (const occurrence of evidence.occurrences ?? []) {
    if (reachesRoot.has(occurrence.id)) continue;
    const path: string[] = [], position = new Map<string, number>();
    let cursorId: string | null = occurrence.id, valid = false;
    while (cursorId) {
      const resolved = reachesRoot.get(cursorId);
      if (resolved !== undefined) { valid = resolved; break; }
      const cycleAt = position.get(cursorId);
      if (cycleAt !== undefined) {
        for (const id of path.slice(cycleAt)) {
          if (!cycleReported.has(id)) errors.push(`native_assembly_parent_cycle:${id}`);
          cycleReported.add(id); reachesRoot.set(id, false);
        }
        break;
      }
      const cursor = occurrenceById.get(cursorId); if (!cursor) break;
      position.set(cursorId, path.length); path.push(cursorId);
      if (cursor.parentOccurrenceId === null) { valid = roots.length === 1 && cursor.id === roots[0]!.id; break; }
      cursorId = cursor.parentOccurrenceId;
    }
    for (const id of path) if (!reachesRoot.has(id)) reachesRoot.set(id, valid);
    if (!valid && !cycleReported.has(occurrence.id)) errors.push(`native_assembly_disconnected:${occurrence.id}`);
  }
  const jointIds = new Set<string>();
  for (const joint of evidence.joints ?? []) {
    if (!joint.id || jointIds.has(joint.id)) errors.push(`native_assembly_joint_id_invalid:${joint.id}`);
    jointIds.add(joint.id);
    if (!occurrenceIds.has(joint.parentOccurrenceId) || !occurrenceIds.has(joint.childOccurrenceId)) errors.push(`native_assembly_joint_occurrence_missing:${joint.id}`);
    if (joint.type !== 'fixed' && (!finiteVector(joint.axis, 3) || !finiteVector(joint.originMm, 3))) errors.push(`native_assembly_joint_frame_missing:${joint.id}`);
    if (joint.type !== 'fixed' && joint.axis && Math.hypot(...joint.axis) <= 1e-12) errors.push(`native_assembly_joint_axis_zero:${joint.id}`);
    if (v11 && joint.type !== 'fixed' && joint.frame !== 'world') errors.push(`native_assembly_joint_frame_scope_missing:${joint.id}`);
    if (joint.lowerLimit !== null && joint.upperLimit !== null && joint.lowerLimit > joint.upperLimit) errors.push(`native_assembly_joint_limits_invalid:${joint.id}`);
  }
  if (!(evidence.joints ?? []).length) warnings.push('native_assembly_joints_not_supplied');
  return { status: errors.length ? 'fail' : 'pass', releaseReady: errors.length === 0, errors, warnings };
}
