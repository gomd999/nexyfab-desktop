import type { MotionSweepRequest } from '@/lib/assembly/motionStudy';
import type { CadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';

export interface CadNativeJointMotionPlanItem { jointId: string; mateId: string; request: MotionSweepRequest; stepDegrees: number; }
export interface CadNativeJointMotionPlan { status: 'pass' | 'not_run' | 'fail'; plans: CadNativeJointMotionPlanItem[]; unresolved: Array<{ jointId: string; reason: string }>; errors: string[]; }

export function planCadNativeJointMotion(evidence: CadNativeAssemblyEvidence, compiledJointIds: readonly string[], options: { maximumStepDegrees?: number; maximumSteps?: number } = {}): CadNativeJointMotionPlan {
  const maximumStepDegrees = options.maximumStepDegrees ?? 5, maximumSteps = options.maximumSteps ?? 360;
  if (!(maximumStepDegrees > 0) || !Number.isFinite(maximumStepDegrees) || !Number.isInteger(maximumSteps) || maximumSteps < 1) return { status: 'fail', plans: [], unresolved: [], errors: ['native_motion_plan_options_invalid'] };
  const compiled = new Set(compiledJointIds), plans: CadNativeJointMotionPlanItem[] = [], unresolved: CadNativeJointMotionPlan['unresolved'] = [], errors: string[] = [];
  for (const joint of evidence.joints) {
    const mateId = `native:${joint.id}`;
    if (!compiled.has(mateId)) { unresolved.push({ jointId: joint.id, reason: `joint_not_compiled:${joint.type}` }); continue; }
    if (joint.type !== 'revolute') { unresolved.push({ jointId: joint.id, reason: `joint_motion_unsupported:${joint.type}` }); continue; }
    if (joint.lowerLimit === null || joint.upperLimit === null) { unresolved.push({ jointId: joint.id, reason: 'joint_range_not_run' }); continue; }
    const angleScale = evidence.units?.angle === 'rad' ? 180 / Math.PI : 1, fromValue = joint.lowerLimit * angleScale, toValue = joint.upperLimit * angleScale, range = toValue - fromValue;
    if (!(range >= 0) || !Number.isFinite(range)) { errors.push(`joint_range_invalid:${joint.id}`); continue; }
    const requiredSteps = Math.max(1, Math.ceil(range / maximumStepDegrees));
    if (requiredSteps > maximumSteps) { unresolved.push({ jointId: joint.id, reason: `joint_step_budget_exceeded:${requiredSteps}/${maximumSteps}` }); continue; }
    plans.push({ jointId: joint.id, mateId, request: { mateId, fromValue, toValue, steps: requiredSteps }, stepDegrees: range / requiredSteps });
  }
  return { status: errors.length ? 'fail' : unresolved.length ? 'not_run' : plans.length ? 'pass' : 'not_run', plans, unresolved, errors };
}
