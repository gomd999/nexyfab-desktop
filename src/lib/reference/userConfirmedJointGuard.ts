/**
 * 사용자 확정 joint/치수 보호 + 국소 repair — P2 "사용자 확정 joint/치수 보호
 * 및 국소 repair".
 *
 * 확정 레코드는 값이 아니라 **정의 해시**에 결속된다: joint는 타입·축·원점·
 * 한계·부모/자식 occurrence 해시의 결정론 해시, 치수는 (part, feature,
 * parameter, value, unit) 튜플. 기반 정의가 바뀌면 해시가 어긋나 확정이
 * 자동 실효(stale)되고, 실효된 확정을 근거로 보호를 주장할 수 없다.
 *
 * fail-closed 원칙(감사 대상):
 * - 확정 joint/치수를 겨냥한 편집 연산은 사용자 명시 해제(override) 없이 거부.
 * - repair는 실패한 joint만 제안한다(국소성) — 확정 joint는 자동 수정 금지,
 *   'user_input'으로만 표면화.
 * - 모든 repair 제안은 재인증(requiresRecertification) 전까지 clear 주장 아님.
 */
import { createHash } from 'node:crypto';
import type { CadEditOperation } from '@/lib/ai/aiEditTransaction';
import type { CadNativeJointMotionPlan } from './cadNativeJointMotionPlan';
import type { BoundNativeJoint, JointMotionClearanceCertificate } from './jointMotionClearanceCertificate';

// ─── 확정 레지스트리 ─────────────────────────────────────────────────────

export interface ConfirmedJointRecord { jointId: string; jointDefinitionHash: string; }
export interface ConfirmedDimensionRecord { partId: string; featureId: string; parameter: string; value: number; unit: 'mm' | 'deg' | '1'; }
export interface UserConfirmationRegistry { joints: ConfirmedJointRecord[]; dimensions: ConfirmedDimensionRecord[]; }

/** 확정 시점 joint 정의의 결정론 해시 — occurrence 해시까지 포함하므로
 *  부품 자세·구조가 바뀌면 확정이 실효된다. */
export function computeJointDefinitionHash(joint: BoundNativeJoint): string {
  const canonical = JSON.stringify([
    joint.jointId, joint.type,
    joint.parentOccurrenceHash, joint.childOccurrenceHash,
    joint.axis ? joint.axis.map(value => value.toFixed(9)) : null,
    joint.originMm ? joint.originMm.map(value => value.toFixed(9)) : null,
    joint.lowerLimit !== null ? joint.lowerLimit.toFixed(9) : null,
    joint.upperLimit !== null ? joint.upperLimit.toFixed(9) : null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export interface ConfirmationValidity { jointId: string; status: 'valid' | 'stale' | 'unknown_joint'; }

/** 레지스트리의 각 확정이 현재 결속된 joint 정의와 아직 일치하는지 판정. */
export function validateConfirmations(registry: UserConfirmationRegistry, boundJoints: readonly BoundNativeJoint[]): ConfirmationValidity[] {
  const byId = new Map(boundJoints.map(joint => [joint.jointId, joint]));
  return registry.joints.map(record => {
    const joint = byId.get(record.jointId);
    if (!joint) return { jointId: record.jointId, status: 'unknown_joint' };
    return { jointId: record.jointId, status: computeJointDefinitionHash(joint) === record.jointDefinitionHash ? 'valid' : 'stale' };
  });
}

// ─── 편집 가드 ───────────────────────────────────────────────────────────

export interface ConfirmationGuardVerdict { allowed: boolean; violations: string[]; }

const jointIdOfMate = (mateId: string) => mateId.startsWith('native:') ? mateId.slice('native:'.length) : mateId;

/** 편집 연산 목록을 확정 레지스트리에 대조한다. overrides에 명시된 확정만
 *  사용자 해제로 인정한다(해제=확정 폐기이지 조용한 우회가 아니다). */
export function evaluateEditAgainstConfirmations(
  operations: readonly CadEditOperation[],
  registry: UserConfirmationRegistry,
  overrides: readonly string[] = [],
): ConfirmationGuardVerdict {
  const released = new Set(overrides);
  const confirmedJoints = new Set(registry.joints.map(record => record.jointId));
  const violations: string[] = [];
  for (const operation of operations) {
    if (operation.kind === 'set_mate_parameter' || operation.kind === 'remove_mate') {
      const jointId = jointIdOfMate(operation.mateId);
      if (confirmedJoints.has(jointId) && !released.has(jointId)) violations.push(`user_confirmed_joint_protected:${jointId}:${operation.kind}`);
    }
    if (operation.kind === 'set_feature_parameter') {
      const match = registry.dimensions.find(record => record.partId === operation.partId && record.featureId === operation.featureId && record.parameter === operation.parameter);
      const key = match ? `${match.partId}/${match.featureId}/${match.parameter}` : null;
      if (match && !released.has(key!) && !(operation.value === match.value && operation.unit === match.unit)) violations.push(`user_confirmed_dimension_protected:${key}`);
    }
  }
  return { allowed: violations.length === 0, violations };
}

// ─── 국소 repair 플래너 ──────────────────────────────────────────────────

export interface LocalJointRepairAction {
  jointId: string;
  action: 'reduce_upper_limit';
  /** 스윕 격자에서 마지막으로 clear 실측된 파라미터 값. 격자 해상도 한계
   *  안에서만 검증된 값이므로 적용 후 재인증 전에는 clear 주장이 아니다. */
  newUpperLimit: number;
  previousUpperLimit: number;
  requiresRecertification: true;
}
export interface LocalJointRepairItem {
  jointId: string;
  disposition: 'propose' | 'user_input' | 'manual_review';
  action: LocalJointRepairAction | null;
  reason: string;
}
export interface LocalJointRepairPlan {
  status: 'pass' | 'not_run' | 'fail';
  items: LocalJointRepairItem[];
  /** 국소성 증명: 제안이 건드리는 joint 집합 == 실패한 joint 집합의 부분집합. */
  touchedJointIds: string[];
  errors: string[];
}

/** 클리어런스 인증서의 실패 joint에 한해 국소 repair를 제안한다.
 *  확정 joint는 자동 제안 대신 user_input, 확정이 stale이면 fail. */
export function planLocalJointRepair(
  certificate: JointMotionClearanceCertificate,
  plan: CadNativeJointMotionPlan,
  registry: UserConfirmationRegistry,
): LocalJointRepairPlan {
  const errors: string[] = [];
  const validity = validateConfirmations(registry, certificate.binding.joints);
  for (const entry of validity) if (entry.status === 'stale') errors.push(`user_confirmation_stale:${entry.jointId}`);
  if (errors.length) return { status: 'fail', items: [], touchedJointIds: [], errors };

  const confirmedJoints = new Set(registry.joints.map(record => record.jointId));
  const planById = new Map(plan.plans.map(item => [item.jointId, item]));
  const items: LocalJointRepairItem[] = [];
  for (const sweep of certificate.sweeps) {
    if (sweep.status !== 'fail') continue; // 국소성: 실패한 joint 외에는 손대지 않는다.
    if (confirmedJoints.has(sweep.jointId)) {
      items.push({ jointId: sweep.jointId, disposition: 'user_input', action: null, reason: 'user_confirmed_joint_requires_decision' });
      continue;
    }
    const planned = planById.get(sweep.jointId);
    if (!planned || !sweep.collision || sweep.collision.frameIndex < 1) {
      items.push({ jointId: sweep.jointId, disposition: 'manual_review', action: null, reason: !planned ? 'sweep_plan_unavailable' : 'no_verified_clear_range_before_collision' });
      continue;
    }
    const { fromValue, toValue, steps } = planned.request;
    const lastClearValue = fromValue + ((toValue - fromValue) * (sweep.collision.frameIndex - 1)) / steps;
    items.push({
      jointId: sweep.jointId, disposition: 'propose',
      action: { jointId: sweep.jointId, action: 'reduce_upper_limit', newUpperLimit: lastClearValue, previousUpperLimit: toValue, requiresRecertification: true },
      reason: `collision_at:${sweep.collision.parameterValue}`,
    });
  }
  return {
    status: items.length ? 'pass' : 'not_run',
    items,
    touchedJointIds: items.filter(item => item.action).map(item => item.jointId).sort(),
    errors: [],
  };
}
