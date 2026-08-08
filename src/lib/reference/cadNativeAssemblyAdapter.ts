import type { AssemblyState, PartInstance, Quat } from '@/lib/assembly/assemblyState';
import type { GeometryResolver, ResolvedGeometry } from '@/lib/assembly/iterativeSolver';
import type { DistanceMate, HingeMate } from '@/lib/assembly/mate';
import { rotateVec } from '@/lib/assembly/mateSolver';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { validateCadNativeAssemblyEvidence, type CadNativeAssemblyEvidence, type CadNativeAssemblyJoint } from './cadNativeAssemblyEvidence';
import type { CadProductBundleManifest } from './cadCorpusProductBundle';

type Matrix4 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
type LocalAxis = { origin: Vec3; direction?: Vec3; kind: 'axis' | 'point' };
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
/** K6 — travel distance mate 의 부모 앵커 바이어스(mm 단위, 원단위 좌표계 기준). */
export const TRAVEL_BIAS_MM = 1000;
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
  const registry = new Map<string, Map<string, LocalAxis>>(), mates: Array<HingeMate | DistanceMate> = [], unresolvedJoints: CadNativeAssemblyAdapterResult['unresolvedJoints'] = [];
  const registerAxis = (joint: CadNativeAssemblyJoint, occurrenceId: string, suffix: string) => { const matrix = worldOf(occurrenceId), origin = joint.originMm!, delta = [(origin[0] - matrix[3]!) * lengthScale, (origin[1] - matrix[7]!) * lengthScale, (origin[2] - matrix[11]!) * lengthScale], localOrigin = transposeRotate(matrix, delta), localDirection = normalized(Object.values(transposeRotate(matrix, joint.axis!))); const refId = `native-joint:${joint.id}:${suffix}`, partId = occurrenceMap[occurrenceId]!; const refs = registry.get(partId) ?? new Map<string, LocalAxis>(); refs.set(refId, { origin: localOrigin, direction: localDirection, kind: 'axis' }); registry.set(partId, refs); return { partId, refId, refKind: 'axis' as const, localDirection }; };
  /**
   * K6(260808) — 프리즘/실린더 travel 앵커 점 등록. 부모 앵커는 조인트 원점에서
   * 축 반대방향으로 BIAS 만큼 물러난 점이다: 점-점 distance mate 는 부호가 없어
   * 원점 겹침(travel 0) 근방에서 진행 방향이 모호해지는데, 큰 바이어스는 근접해
   * (warm-start 반복해)가 유일해지게 만든다 — v = BIAS + travel (travel 은 +축 방향).
   */
  const registerPoint = (joint: CadNativeAssemblyJoint, occurrenceId: string, suffix: string, biasAlongAxisMm: number) => {
    const matrix = worldOf(occurrenceId), axis = normalized(joint.axis!);
    // biasAlongAxisMm 는 mm — 원단위 좌표(origin)에 넣을 땐 lengthScale 로 되돌린다.
    const biasNative = biasAlongAxisMm / lengthScale;
    const origin = [joint.originMm![0] + axis.x * biasNative, joint.originMm![1] + axis.y * biasNative, joint.originMm![2] + axis.z * biasNative];
    const delta = [(origin[0]! - matrix[3]!) * lengthScale, (origin[1]! - matrix[7]!) * lengthScale, (origin[2]! - matrix[11]!) * lengthScale];
    const localOrigin = transposeRotate(matrix, delta);
    const refId = `native-joint:${joint.id}:${suffix}`, partId = occurrenceMap[occurrenceId]!;
    const refs = registry.get(partId) ?? new Map<string, LocalAxis>();
    refs.set(refId, { origin: localOrigin, kind: 'point' });
    registry.set(partId, refs);
    return { partId, refId, refKind: 'point' as const };
  };
  for (const joint of evidence.joints) {
    if (!occurrenceMap[joint.parentOccurrenceId] || !occurrenceMap[joint.childOccurrenceId]) { unresolvedJoints.push({ id: joint.id, type: joint.type, reason: 'joint_occurrence_inactive' }); continue; }
    const supported = joint.type === 'revolute' || joint.type === 'prismatic' || joint.type === 'cylindrical';
    if (!supported || !joint.axis || !joint.originMm) { unresolvedJoints.push({ id: joint.id, type: joint.type, reason: `native_joint_${joint.type}_unsupported` }); continue; }
    const a = registerAxis(joint, joint.parentOccurrenceId, 'parent'), b = registerAxis(joint, joint.childOccurrenceId, 'child'), worldPerpendicular = stablePerpendicular(normalized(joint.axis));
    const parentMatrix = worldOf(joint.parentOccurrenceId), childMatrix = worldOf(joint.childOccurrenceId), zeroA = transposeRotate(parentMatrix, [worldPerpendicular.x, worldPerpendicular.y, worldPerpendicular.z]), zeroB = transposeRotate(childMatrix, [worldPerpendicular.x, worldPerpendicular.y, worldPerpendicular.z]);
    const angleScale = evidence.units.angle === 'rad' ? 180 / Math.PI : 1;
    /**
     * K6(260808) — 컴파일 규약:
     *  · revolute    → hinge(각 구동, 한계 승계)
     *  · prismatic   → hinge(각 0 고정 — 회전 잠금; hinge 는 축방향 슬라이드를 자유로
     *                  둔다, iterativeSolver "free axial slide") + 바이어스 앵커
     *                  distance(`native:{id}:travel`, v = BIAS + travel)
     *  · cylindrical → 같은 두 mate — 회전 스윕은 hinge 구동, 이동 스윕은 distance 구동
     *                  (각 DOF 단면 스윕 — 2-DOF 결합 공간 전수는 아니다, 플랜에 명시)
     */
    const hingeLimit = joint.type === 'revolute' && joint.lowerLimit !== null && joint.upperLimit !== null
      ? { limit: { minAngleDeg: joint.lowerLimit * angleScale, maxAngleDeg: joint.upperLimit * angleScale } } : {};
    mates.push({ id: `native:${joint.id}`, kind: 'hinge', a, b, ...hingeLimit, zeroAngleRef: { a: zeroA, b: zeroB, axisA: a.localDirection, axisB: b.localDirection } });
    if (joint.type === 'prismatic' || joint.type === 'cylindrical') {
      const pa = registerPoint(joint, joint.parentOccurrenceId, 'parent-anchor', -TRAVEL_BIAS_MM);
      const pb = registerPoint(joint, joint.childOccurrenceId, 'child-origin', 0);
      mates.push({ id: `native:${joint.id}:travel`, kind: 'distance', a: pa, b: pb, value: TRAVEL_BIAS_MM });
    }
  }
  const state: AssemblyState = { parts, mates };
  const resolve: GeometryResolver = (ref, part): ResolvedGeometry | null => {
    const local = registry.get(ref.partId)?.get(ref.refId);
    if (!local) return null;
    const offset = rotateVec(local.origin, part.orientation);
    const position = { x: part.position.x + offset.x, y: part.position.y + offset.y, z: part.position.z + offset.z };
    if (local.kind === 'point') return { kind: 'point', world: position };
    return { kind: 'axis', world: { origin: position, direction: rotateVec(local.direction!, part.orientation) } };
  };
  const warnings = [...validation.warnings];
  for (const occurrence of active) if (occurrence.state?.lightweight || occurrence.state?.flexible || occurrence.state?.mirrored) warnings.push(`native_occurrence_pose_not_solver_ready:${occurrence.id}`);
  const status = unresolvedJoints.length || warnings.some(item => item.startsWith('native_occurrence_pose_not_solver_ready')) ? 'not_run' : 'pass';
  return { status, releaseReady: status === 'pass', state, resolve, occurrenceMap, compiledJointIds: mates.map(item => item.id), unresolvedJoints, errors: [], warnings };
}
