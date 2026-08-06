import type { AssemblyState, PartInstance, Quat } from '@/lib/assembly/assemblyState';
import type { GeometryResolver, ResolvedGeometry } from '@/lib/assembly/iterativeSolver';
import type { HingeMate } from '@/lib/assembly/mate';
import { rotateVec } from '@/lib/assembly/mateSolver';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { validateCadNativeAssemblyEvidence, type CadNativeAssemblyEvidence, type CadNativeAssemblyJoint } from './cadNativeAssemblyEvidence';
import type { CadProductBundleManifest } from './cadCorpusProductBundle';

type Matrix4 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
type LocalAxis = { origin: Vec3; direction: Vec3 };
export interface CadNativeAssemblyAdapterResult {
  status: 'pass' | 'fail' | 'not_run'; releaseReady: boolean; state: AssemblyState | null; resolve: GeometryResolver | null;
  occurrenceMap: Record<string, string>; compiledJointIds: string[]; unresolvedJoints: Array<{ id: string; type: string; reason: string }>; errors: string[]; warnings: string[];
}
const multiply = (a: number[], b: number[]): Matrix4 => Array.from({ length: 16 }, (_, index) => { const row = Math.floor(index / 4), column = index % 4; let sum = 0; for (let k = 0; k < 4; k++) sum += a[row * 4 + k]! * b[k * 4 + column]!; return sum; }) as Matrix4;
const normalized = (value: number[]): Vec3 => { const length = Math.hypot(...value); if (!(length > 0)) throw new Error('zero_axis'); return { x: value[0]! / length, y: value[1]! / length, z: value[2]! / length }; };
const transposeRotate = (matrix: number[], value: number[]): Vec3 => ({ x: matrix[0]! * value[0]! + matrix[4]! * value[1]! + matrix[8]! * value[2]!, y: matrix[1]! * value[0]! + matrix[5]! * value[1]! + matrix[9]! * value[2]!, z: matrix[2]! * value[0]! + matrix[6]! * value[1]! + matrix[10]! * value[2]! });
function quaternion(matrix: number[]): Quat {
  const m00 = matrix[0]!, m11 = matrix[5]!, m22 = matrix[10]!, trace = m00 + m11 + m22; let x: number, y: number, z: number, w: number;
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; w = s / 4; x = (matrix[9]! - matrix[6]!) / s; y = (matrix[2]! - matrix[8]!) / s; z = (matrix[4]! - matrix[1]!) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (matrix[9]! - matrix[6]!) / s; x = s / 4; y = (matrix[1]! + matrix[4]!) / s; z = (matrix[2]! + matrix[8]!) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (matrix[2]! - matrix[8]!) / s; x = (matrix[1]! + matrix[4]!) / s; y = s / 4; z = (matrix[6]! + matrix[9]!) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (matrix[4]! - matrix[1]!) / s; x = (matrix[2]! + matrix[8]!) / s; y = (matrix[6]! + matrix[9]!) / s; z = s / 4; }
  const length = Math.hypot(x, y, z, w); return { x: x / length, y: y / length, z: z / length, w: w / length };
}
const scaleFor = (unit: string) => unit === 'mm' ? 1 : unit === 'cm' ? 10 : unit === 'm' ? 1000 : unit === 'in' ? 25.4 : NaN;
function stablePerpendicular(axis: Vec3): Vec3 { const seed = Math.abs(axis.x) <= Math.abs(axis.y) && Math.abs(axis.x) <= Math.abs(axis.z) ? { x: 1, y: 0, z: 0 } : Math.abs(axis.y) <= Math.abs(axis.z) ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }; return normalized([axis.y * seed.z - axis.z * seed.y, axis.z * seed.x - axis.x * seed.z, axis.x * seed.y - axis.y * seed.x]); }

export function adaptCadNativeAssembly(bundle: CadProductBundleManifest, evidence?: CadNativeAssemblyEvidence): CadNativeAssemblyAdapterResult {
  const validation = validateCadNativeAssemblyEvidence(bundle, evidence);
  if (!evidence || validation.status !== 'pass') return { status: validation.status, releaseReady: false, state: null, resolve: null, occurrenceMap: {}, compiledJointIds: [], unresolvedJoints: [], errors: validation.errors, warnings: validation.warnings };
  if (evidence.schema !== 'nexyfab.native-assembly-evidence.v1.1' || !evidence.coordinateSystem || !evidence.units) return { status: 'not_run', releaseReady: false, state: null, resolve: null, occurrenceMap: {}, compiledJointIds: [], unresolvedJoints: [], errors: ['native_assembly_adapter_requires_v1.1'], warnings: [] };
  if (evidence.coordinateSystem.handedness !== 'right' || evidence.coordinateSystem.upAxis !== 'z') return { status: 'not_run', releaseReady: false, state: null, resolve: null, occurrenceMap: {}, compiledJointIds: [], unresolvedJoints: [], errors: ['native_assembly_coordinate_conversion_not_run'], warnings: [] };
  const lengthScale = scaleFor(evidence.units.length), byId = new Map(evidence.occurrences.map(item => [item.id, item])), world = new Map<string, Matrix4>();
  const worldOf = (id: string): Matrix4 => { const cached = world.get(id); if (cached) return cached; const occurrence = byId.get(id)!; const local = occurrence.transform as Matrix4; const result = evidence.coordinateSystem!.transformScope === 'local-to-world' || occurrence.parentOccurrenceId === null ? local : multiply(worldOf(occurrence.parentOccurrenceId), local); world.set(id, result); return result; };
  const active = evidence.occurrences.filter(item => !item.suppressed), occurrenceMap: Record<string, string> = {}, parts: PartInstance[] = [];
  for (const occurrence of active) { const matrix = worldOf(occurrence.id), id = `native:${occurrence.id}`; occurrenceMap[occurrence.id] = id; parts.push({ id, name: evidence.definitions.find(item => item.id === occurrence.definitionId)?.name ?? occurrence.id, partTemplateId: occurrence.definitionId, position: { x: matrix[3]! * lengthScale, y: matrix[7]! * lengthScale, z: matrix[11]! * lengthScale }, orientation: quaternion(matrix), fixed: occurrence.parentOccurrenceId === null }); }
  const registry = new Map<string, Map<string, LocalAxis>>(), mates: HingeMate[] = [], unresolvedJoints: CadNativeAssemblyAdapterResult['unresolvedJoints'] = [];
  const registerAxis = (joint: CadNativeAssemblyJoint, occurrenceId: string, suffix: string) => { const matrix = worldOf(occurrenceId), origin = joint.originMm!, delta = [(origin[0] - matrix[3]!) * lengthScale, (origin[1] - matrix[7]!) * lengthScale, (origin[2] - matrix[11]!) * lengthScale], localOrigin = transposeRotate(matrix, delta), localDirection = normalized(Object.values(transposeRotate(matrix, joint.axis!))); const refId = `native-joint:${joint.id}:${suffix}`, partId = occurrenceMap[occurrenceId]!; const refs = registry.get(partId) ?? new Map<string, LocalAxis>(); refs.set(refId, { origin: localOrigin, direction: localDirection }); registry.set(partId, refs); return { partId, refId, refKind: 'axis' as const, localDirection }; };
  for (const joint of evidence.joints) {
    if (!occurrenceMap[joint.parentOccurrenceId] || !occurrenceMap[joint.childOccurrenceId]) { unresolvedJoints.push({ id: joint.id, type: joint.type, reason: 'joint_occurrence_inactive' }); continue; }
    if (joint.type !== 'revolute' || !joint.axis || !joint.originMm) { unresolvedJoints.push({ id: joint.id, type: joint.type, reason: `native_joint_${joint.type}_unsupported` }); continue; }
    const a = registerAxis(joint, joint.parentOccurrenceId, 'parent'), b = registerAxis(joint, joint.childOccurrenceId, 'child'), worldPerpendicular = stablePerpendicular(normalized(joint.axis));
    const parentMatrix = worldOf(joint.parentOccurrenceId), childMatrix = worldOf(joint.childOccurrenceId), zeroA = transposeRotate(parentMatrix, [worldPerpendicular.x, worldPerpendicular.y, worldPerpendicular.z]), zeroB = transposeRotate(childMatrix, [worldPerpendicular.x, worldPerpendicular.y, worldPerpendicular.z]);
    const angleScale = evidence.units.angle === 'rad' ? 180 / Math.PI : 1;
    mates.push({ id: `native:${joint.id}`, kind: 'hinge', a, b, ...(joint.lowerLimit !== null && joint.upperLimit !== null ? { limit: { minAngleDeg: joint.lowerLimit * angleScale, maxAngleDeg: joint.upperLimit * angleScale } } : {}), zeroAngleRef: { a: zeroA, b: zeroB, axisA: a.localDirection, axisB: b.localDirection } });
  }
  const state: AssemblyState = { parts, mates };
  const resolve: GeometryResolver = (ref, part): ResolvedGeometry | null => { const local = registry.get(ref.partId)?.get(ref.refId); if (!local) return null; const direction = rotateVec(local.direction, part.orientation), offset = rotateVec(local.origin, part.orientation); return { kind: 'axis', world: { origin: { x: part.position.x + offset.x, y: part.position.y + offset.y, z: part.position.z + offset.z }, direction } }; };
  const warnings = [...validation.warnings];
  for (const occurrence of active) if (occurrence.state?.lightweight || occurrence.state?.flexible || occurrence.state?.mirrored) warnings.push(`native_occurrence_pose_not_solver_ready:${occurrence.id}`);
  const status = unresolvedJoints.length || warnings.some(item => item.startsWith('native_occurrence_pose_not_solver_ready')) ? 'not_run' : 'pass';
  return { status, releaseReady: status === 'pass', state, resolve, occurrenceMap, compiledJointIds: mates.map(item => item.id), unresolvedJoints, errors: [], warnings };
}
