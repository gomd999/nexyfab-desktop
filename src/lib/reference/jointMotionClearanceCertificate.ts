/**
 * Joint motion clearance certificate — P2 "native motion sweep vs precise
 * collision" + "joint origin/axis/limits/occurrence hash 결속".
 *
 * native joint 증거(v1.1)를 (1) occurrence 단위 결정론 해시에 결속하고,
 * (2) 어댑터가 컴파일한 힌지를 계획된 범위로 스윕하면서 매 프레임 정밀
 * 메시 분리(preciseSeparation)로 충돌·최소 간극을 측정한다.
 *
 * fail-closed 원칙(감사 대상):
 * - 근사 기하(비수밀 mesh·기하 없음)로는 인증서를 발급하지 않는다 → not_run.
 * - pair-check 예산 소진은 pass가 아니라 not_run이다.
 * - 미수렴 프레임은 clear 주장 근거가 될 수 없다 → not_run.
 * - 미지원 joint를 fixed로 임의 변환하지 않는다(어댑터 unresolved를 그대로
 *   not_run으로 승계).
 */
import { createHash } from 'node:crypto';
import { preciseSeparation } from '@/lib/ai/design-driver/interferencePrecise';
import type { FeatureTreeCollisionGeometry } from '@/lib/assembly/featureTreePreciseInterference';
import { runMotionSweep } from '@/lib/assembly/motionStudy';
import type { CadNativeAssemblyAdapterResult } from './cadNativeAssemblyAdapter';
import type { CadNativeAssemblyEvidence, CadNativeAssemblyJoint, CadNativeAssemblyOccurrence } from './cadNativeAssemblyEvidence';
import type { CadNativeJointMotionPlan } from './cadNativeJointMotionPlan';

// ─── occurrence hash 결속 ────────────────────────────────────────────────

export interface BoundNativeJoint {
  jointId: string; type: CadNativeAssemblyJoint['type'];
  parentOccurrenceId: string; childOccurrenceId: string;
  parentOccurrenceHash: string; childOccurrenceHash: string;
  axis: [number, number, number] | null; originMm: [number, number, number] | null;
  lowerLimit: number | null; upperLimit: number | null;
}
export interface JointOccurrenceBinding { status: 'pass' | 'fail' | 'not_run'; joints: BoundNativeJoint[]; errors: string[]; }

/** 결정론 occurrence 해시 — 자세(transform)·정의·상태를 고정 정밀도로 직렬화.
 *  transform이 1e-9보다 크게 바뀌면 해시가 바뀐다(승인 무효화 근거). */
export function computeOccurrenceHash(occurrence: CadNativeAssemblyOccurrence): string {
  const canonical = JSON.stringify([
    occurrence.id, occurrence.definitionId, occurrence.parentOccurrenceId,
    occurrence.transform.map(value => value.toFixed(9)), occurrence.suppressed,
    occurrence.state ? [occurrence.state.resolved, occurrence.state.suppressed, occurrence.state.lightweight, occurrence.state.flexible, occurrence.state.hidden, occurrence.state.mirrored ?? false, occurrence.state.configuration ?? null, occurrence.state.referencedConfiguration ?? null] : null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

const JOINT_TYPES = new Set(['fixed', 'revolute', 'prismatic', 'cylindrical', 'planar', 'spherical']);

export function bindJointsToOccurrences(evidence: CadNativeAssemblyEvidence): JointOccurrenceBinding {
  const errors: string[] = [];
  const occurrenceById = new Map(evidence.occurrences.map(item => [item.id, item]));
  const hashes = new Map<string, string>();
  const hashOf = (id: string) => { const cached = hashes.get(id); if (cached) return cached; const value = computeOccurrenceHash(occurrenceById.get(id)!); hashes.set(id, value); return value; };
  const joints: BoundNativeJoint[] = [];
  for (const joint of evidence.joints) {
    // fixed 날조 금지: 선언된 타입 그대로만 결속하고 미지의 타입은 거부한다.
    if (!JOINT_TYPES.has(joint.type)) { errors.push(`joint_type_unknown:${joint.id}:${joint.type}`); continue; }
    if (!occurrenceById.has(joint.parentOccurrenceId)) { errors.push(`joint_parent_occurrence_missing:${joint.id}`); continue; }
    if (!occurrenceById.has(joint.childOccurrenceId)) { errors.push(`joint_child_occurrence_missing:${joint.id}`); continue; }
    if (joint.axis !== null && (joint.axis.length !== 3 || !joint.axis.every(Number.isFinite))) { errors.push(`joint_axis_invalid:${joint.id}`); continue; }
    if (joint.originMm !== null && (joint.originMm.length !== 3 || !joint.originMm.every(Number.isFinite))) { errors.push(`joint_origin_invalid:${joint.id}`); continue; }
    if ((joint.lowerLimit === null) !== (joint.upperLimit === null) || (joint.lowerLimit !== null && joint.upperLimit !== null && (!Number.isFinite(joint.lowerLimit) || !Number.isFinite(joint.upperLimit) || joint.lowerLimit > joint.upperLimit))) { errors.push(`joint_limits_invalid:${joint.id}`); continue; }
    joints.push({
      jointId: joint.id, type: joint.type,
      parentOccurrenceId: joint.parentOccurrenceId, childOccurrenceId: joint.childOccurrenceId,
      parentOccurrenceHash: hashOf(joint.parentOccurrenceId), childOccurrenceHash: hashOf(joint.childOccurrenceId),
      axis: joint.axis, originMm: joint.originMm, lowerLimit: joint.lowerLimit, upperLimit: joint.upperLimit,
    });
  }
  return { status: errors.length ? 'fail' : evidence.joints.length ? 'pass' : 'not_run', joints, errors };
}

// ─── 스윕 × 정밀 충돌 인증서 ─────────────────────────────────────────────

export interface JointSweepCollision { frameIndex: number; parameterValue: number; partA: string; partB: string; }
export interface JointSweepClearance {
  jointId: string; mateId: string | null; status: 'pass' | 'fail' | 'not_run';
  framesEvaluated: number; pairChecks: number;
  minimumClearanceMm: number | null; collision: JointSweepCollision | null; reason: string | null;
}
export interface JointMotionClearanceCertificate {
  schema: 'nexyfab.joint-motion-clearance-certificate.v1';
  status: 'pass' | 'fail' | 'not_run';
  lineageId: string;
  binding: JointOccurrenceBinding;
  sweeps: JointSweepClearance[];
  pairBudget: { maximumPairChecks: number; usedPairChecks: number; exhausted: boolean };
  policy: {
    approximateGeometryCertificationForbidden: true;
    budgetExhaustionIsNotRun: true;
    nonConvergedFrameCertificationForbidden: true;
    fixedJointFabricationForbidden: true;
  };
  errors: string[];
}

export function buildJointMotionClearanceCertificate(input: {
  evidence: CadNativeAssemblyEvidence;
  adapter: CadNativeAssemblyAdapterResult;
  plan: CadNativeJointMotionPlan;
  geometries: ReadonlyMap<string, FeatureTreeCollisionGeometry>;
  maximumPairChecks?: number;
}): JointMotionClearanceCertificate {
  const maximumPairChecks = input.maximumPairChecks ?? 200_000;
  const policy = { approximateGeometryCertificationForbidden: true, budgetExhaustionIsNotRun: true, nonConvergedFrameCertificationForbidden: true, fixedJointFabricationForbidden: true } as const;
  const binding = bindJointsToOccurrences(input.evidence);
  const base = (status: JointMotionClearanceCertificate['status'], sweeps: JointSweepClearance[], used: number, errors: string[]): JointMotionClearanceCertificate => ({
    schema: 'nexyfab.joint-motion-clearance-certificate.v1', status, lineageId: input.evidence.lineageId,
    binding, sweeps, pairBudget: { maximumPairChecks, usedPairChecks: used, exhausted: used >= maximumPairChecks }, policy, errors,
  });
  if (binding.status === 'fail') return base('fail', [], 0, ['joint_occurrence_binding_failed']);
  if (input.plan.status === 'fail') return base('fail', [], 0, ['joint_motion_plan_failed', ...input.plan.errors]);
  if (!input.adapter.state || !input.adapter.resolve) return base('not_run', [], 0, ['assembly_adapter_not_run']);

  const sweeps: JointSweepClearance[] = [];
  // 어댑터/플랜이 스윕까지 끌고 오지 못한 joint는 사유 그대로 not_run 승계 —
  // 여기서 fixed로 재해석하거나 pass로 승격하지 않는다.
  for (const unresolved of [...input.adapter.unresolvedJoints, ...input.plan.unresolved]) {
    const jointId = 'jointId' in unresolved ? unresolved.jointId : unresolved.id;
    sweeps.push({ jointId, mateId: null, status: 'not_run', framesEvaluated: 0, pairChecks: 0, minimumClearanceMm: null, collision: null, reason: unresolved.reason });
  }

  let usedPairChecks = 0;
  for (const item of input.plan.plans) {
    let frames;
    try {
      frames = runMotionSweep(input.adapter.state, input.adapter.resolve, item.request).frames;
    } catch (error) {
      sweeps.push({ jointId: item.jointId, mateId: item.mateId, status: 'fail', framesEvaluated: 0, pairChecks: 0, minimumClearanceMm: null, collision: null, reason: `motion_sweep_error:${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    let sweepStatus: JointSweepClearance['status'] = 'pass';
    let minimumClearanceMm: number | null = null;
    let collision: JointSweepCollision | null = null;
    let reason: string | null = null;
    let pairChecks = 0;
    outer: for (const frame of frames) {
      if (!frame.solve.success) { sweepStatus = 'not_run'; reason = `frame_not_converged:${frame.index}`; break; }
      const parts = frame.solve.state.parts;
      for (let a = 0; a < parts.length && sweepStatus === 'pass'; a++) {
        for (let b = a + 1; b < parts.length; b++) {
          const geometryA = input.geometries.get(parts[a]!.id), geometryB = input.geometries.get(parts[b]!.id);
          if (!geometryA?.available || !geometryB?.available) { sweepStatus = 'not_run'; reason = `collision_geometry_unavailable:${!geometryA?.available ? parts[a]!.id : parts[b]!.id}`; break outer; }
          if (usedPairChecks >= maximumPairChecks) { sweepStatus = 'not_run'; reason = 'pair_budget_exhausted'; break outer; }
          usedPairChecks++; pairChecks++;
          const separation = preciseSeparation(geometryA.part, geometryA.geometry, parts[a]!, geometryB.part, geometryB.geometry, parts[b]!);
          if (!separation.available || separation.minimumDistanceMm === null) { sweepStatus = 'not_run'; reason = separation.unavailableReason ?? 'precise_separation_unavailable'; break outer; }
          if (separation.intersects) { sweepStatus = 'fail'; collision = { frameIndex: frame.index, parameterValue: frame.parameterValue, partA: parts[a]!.id, partB: parts[b]!.id }; minimumClearanceMm = 0; break outer; }
          minimumClearanceMm = minimumClearanceMm === null ? separation.minimumDistanceMm : Math.min(minimumClearanceMm, separation.minimumDistanceMm);
        }
      }
    }
    if (sweepStatus !== 'pass') minimumClearanceMm = sweepStatus === 'fail' ? 0 : null;
    sweeps.push({ jointId: item.jointId, mateId: item.mateId, status: sweepStatus, framesEvaluated: frames.length, pairChecks, minimumClearanceMm, collision, reason });
  }

  const status: JointMotionClearanceCertificate['status'] = sweeps.some(item => item.status === 'fail') ? 'fail'
    : sweeps.some(item => item.status === 'not_run') || sweeps.length === 0 ? 'not_run' : 'pass';
  return base(status, sweeps, usedPairChecks, []);
}
