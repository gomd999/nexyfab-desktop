import type { MotionSweepRequest } from '@/lib/assembly/motionStudy';
import { TRAVEL_BIAS_MM } from './cadNativeAssemblyAdapter';
import type { CadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';

export interface CadNativeJointMotionPlanItem {
  jointId: string; mateId: string; request: MotionSweepRequest;
  /** 프레임 간 파라미터 간격 — 각도 스윕은 deg, 이동 스윕은 mm. */
  stepDegrees: number;
  /** K6 — 이동(distance) 스윕의 파라미터 바이어스: 실제 travel = parameterValue − bias. */
  parameterBiasMm?: number;
  /** K6 — cylindrical 은 DOF 단면 스윕(회전/이동 각각) — 결합 2-DOF 공간 전수가 아니다. */
  sectionNote?: string;
}
export interface CadNativeJointMotionPlan { status: 'pass' | 'not_run' | 'fail'; plans: CadNativeJointMotionPlanItem[]; unresolved: Array<{ jointId: string; reason: string }>; errors: string[]; }

export function planCadNativeJointMotion(evidence: CadNativeAssemblyEvidence, compiledJointIds: readonly string[], options: { maximumStepDegrees?: number; maximumStepMm?: number; maximumSteps?: number } = {}): CadNativeJointMotionPlan {
  const maximumStepDegrees = options.maximumStepDegrees ?? 5, maximumStepMm = options.maximumStepMm ?? 2, maximumSteps = options.maximumSteps ?? 360;
  if (!(maximumStepDegrees > 0) || !Number.isFinite(maximumStepDegrees) || !(maximumStepMm > 0) || !Number.isFinite(maximumStepMm) || !Number.isInteger(maximumSteps) || maximumSteps < 1) return { status: 'fail', plans: [], unresolved: [], errors: ['native_motion_plan_options_invalid'] };
  const compiled = new Set(compiledJointIds), plans: CadNativeJointMotionPlanItem[] = [], unresolved: CadNativeJointMotionPlan['unresolved'] = [], errors: string[] = [];
  const lengthScale = evidence.units?.length === 'mm' ? 1 : evidence.units?.length === 'cm' ? 10 : evidence.units?.length === 'm' ? 1000 : evidence.units?.length === 'in' ? 25.4 : NaN;
  for (const joint of evidence.joints) {
    const hingeMateId = `native:${joint.id}`, travelMateId = `native:${joint.id}:travel`;
    if (!compiled.has(hingeMateId)) { unresolved.push({ jointId: joint.id, reason: `joint_not_compiled:${joint.type}` }); continue; }

    const planRotation = (fromValue: number, toValue: number, sectionNote?: string): boolean => {
      const range = toValue - fromValue;
      if (!(range >= 0) || !Number.isFinite(range)) { errors.push(`joint_range_invalid:${joint.id}`); return false; }
      const requiredSteps = Math.max(1, Math.ceil(range / maximumStepDegrees));
      if (requiredSteps > maximumSteps) { unresolved.push({ jointId: joint.id, reason: `joint_step_budget_exceeded:${requiredSteps}/${maximumSteps}` }); return false; }
      plans.push({ jointId: joint.id, mateId: hingeMateId, request: { mateId: hingeMateId, fromValue, toValue, steps: requiredSteps }, stepDegrees: range / requiredSteps, ...(sectionNote ? { sectionNote } : {}) });
      return true;
    };
    const planTravel = (lowerMm: number, upperMm: number, sectionNote?: string): boolean => {
      const range = upperMm - lowerMm;
      if (!(range >= 0) || !Number.isFinite(range)) { errors.push(`joint_range_invalid:${joint.id}`); return false; }
      const requiredSteps = Math.max(1, Math.ceil(range / maximumStepMm));
      if (requiredSteps > maximumSteps) { unresolved.push({ jointId: joint.id, reason: `joint_step_budget_exceeded:${requiredSteps}/${maximumSteps}` }); return false; }
      plans.push({
        jointId: joint.id, mateId: travelMateId,
        request: { mateId: travelMateId, fromValue: TRAVEL_BIAS_MM + lowerMm, toValue: TRAVEL_BIAS_MM + upperMm, steps: requiredSteps },
        stepDegrees: range / requiredSteps, parameterBiasMm: TRAVEL_BIAS_MM, ...(sectionNote ? { sectionNote } : {}),
      });
      return true;
    };

    if (joint.type === 'revolute') {
      if (joint.lowerLimit === null || joint.upperLimit === null) { unresolved.push({ jointId: joint.id, reason: 'joint_range_not_run' }); continue; }
      const angleScale = evidence.units?.angle === 'rad' ? 180 / Math.PI : 1;
      planRotation(joint.lowerLimit * angleScale, joint.upperLimit * angleScale);
      continue;
    }
    if (joint.type === 'prismatic') {
      if (!compiled.has(travelMateId)) { unresolved.push({ jointId: joint.id, reason: 'joint_travel_mate_missing' }); continue; }
      if (joint.lowerLimit === null || joint.upperLimit === null) { unresolved.push({ jointId: joint.id, reason: 'joint_range_not_run' }); continue; }
      if (!Number.isFinite(lengthScale)) { unresolved.push({ jointId: joint.id, reason: 'joint_length_unit_unknown' }); continue; }
      planTravel(joint.lowerLimit * lengthScale, joint.upperLimit * lengthScale);
      continue;
    }
    if (joint.type === 'cylindrical') {
      if (!compiled.has(travelMateId)) { unresolved.push({ jointId: joint.id, reason: 'joint_travel_mate_missing' }); continue; }
      // 회전은 폐구간(0..360°) — 한계 정보가 없어도 전 원주가 정의역이다.
      planRotation(0, 360, 'cylindrical_rotation_section:translation_pinned_at_initial');
      /**
       * 원본 lower/upperLimit 는 어느 DOF 의 한계인지 스키마가 구분하지 않는다 —
       * 임의 해석은 날조다. 한계가 있으면 "이동 한계"로 읽는 관례(SolidWorks
       * LimitMate 병기)가 있으나 근거가 파일에 없으므로 이동 스윕은 한계가
       * 명시된 경우에도 not_run 사유로 남긴다(전용 travelLimit 필드가 생기면 해제).
       */
      unresolved.push({ jointId: joint.id, reason: 'cylindrical_travel_limits_ambiguous_not_run' });
      continue;
    }
    unresolved.push({ jointId: joint.id, reason: `joint_motion_unsupported:${joint.type}` });
  }
  return { status: errors.length ? 'fail' : unresolved.length ? 'not_run' : plans.length ? 'pass' : 'not_run', plans, unresolved, errors };
}
