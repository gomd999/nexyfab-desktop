// ─── Plan Limits & Feature Gates ─────────────────────────────────────────────

import type { UserPlan } from '@/hooks/useAuth';
import type { Stage } from '@/lib/stage-engine';
import { userMeetsBmMatrixFeatureStage } from '@/lib/bm-matrix-stage-ui';

/** §1.2 표 변경 시 UI·플래그 캐시 무효화용(향후 feature flag 레이어와 동기). */
export const BM_MATRIX_PLAN_STAGE_GATE_REVISION = 1;

export interface PlanLimits {
  projectCount: number;       // max saved projects (Infinity = unlimited)
  maxCartItems: number;       // max shapes addable to cart (Infinity = unlimited)
  dfmAnalysis: boolean;
  feaAnalysis: boolean;
  costEstimation: boolean;
  exportFormats: string[];    // allowed export formats
  cloudSave: boolean;
  collaboration: boolean;
  rfq: boolean;               // can request quotes from manufacturers
  ipShareLink: boolean;       // can create view-only IP-protected share links
  branchCompare: boolean;
  aiChat: boolean;
  pluginAccess: boolean;
}

/**
 * bm-matrix §1.2 **행 번호 → PlanLimits 불리언**만 명시한다 (하드코딩 분산 방지).
 * 나머지 플랜 필드는 Stage와 무관하다.
 * @see docs/strategy/BM_MATRIX_CODE_GAP.md G-U2
 */
export const BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS: ReadonlyArray<{
  readonly featureId: number;
  readonly planKey: keyof Pick<PlanLimits, 'collaboration' | 'ipShareLink' | 'branchCompare'>;
}> = [
  { featureId: 17, planKey: 'collaboration' },
  { featureId: 27, planKey: 'ipShareLink' },
  { featureId: 9, planKey: 'branchCompare' },
] as const;

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    projectCount: 1,
    maxCartItems: 1,
    dfmAnalysis: false,
    feaAnalysis: false,
    costEstimation: false,
    exportFormats: ['stl'],
    cloudSave: true,
    collaboration: false,
    rfq: false,
    ipShareLink: false,
    branchCompare: false,
    aiChat: true,       // limited AI chat
    pluginAccess: false,
  },
  pro: {
    projectCount: Infinity,
    maxCartItems: Infinity,
    dfmAnalysis: true,
    feaAnalysis: true,
    costEstimation: true,
    exportFormats: ['stl', 'step', 'obj', 'dxf', 'gltf', 'ply'],
    cloudSave: true,
    collaboration: false,
    rfq: true,
    ipShareLink: true,
    branchCompare: true,
    aiChat: true,
    pluginAccess: true,
  },
  team: {
    projectCount: Infinity,
    maxCartItems: Infinity,
    dfmAnalysis: true,
    feaAnalysis: true,
    costEstimation: true,
    exportFormats: ['stl', 'step', 'obj', 'dxf', 'gltf', 'ply', 'rhino', 'grasshopper'],
    cloudSave: true,
    collaboration: true,
    rfq: true,
    ipShareLink: true,
    branchCompare: true,
    aiChat: true,
    pluginAccess: true,
  },
  enterprise: {
    projectCount: Infinity,
    maxCartItems: Infinity,
    dfmAnalysis: true,
    feaAnalysis: true,
    costEstimation: true,
    exportFormats: ['stl', 'step', 'obj', 'dxf', 'gltf', 'ply', 'rhino', 'grasshopper'],
    cloudSave: true,
    collaboration: true,
    rfq: true,
    ipShareLink: true,
    branchCompare: true,
    aiChat: true,
    pluginAccess: true,
  },
};

export function getPlanLimits(plan: UserPlan | undefined): PlanLimits {
  return PLAN_LIMITS[plan ?? 'free'];
}

export function canUseFeature(plan: UserPlan | undefined, feature: keyof PlanLimits): boolean {
  const limits = getPlanLimits(plan);
  const val = limits[feature];
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val > 0;
  if (Array.isArray(val)) return val.length > 0;
  return false;
}

/**
 * 플랜 한도에 bm-matrix §1.2 Stage 게이트를 AND.
 * 매핑은 `BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS` 단일 표만 사용한다.
 */
export function mergePlanLimitsWithBmStage(limits: PlanLimits, stage: Stage): PlanLimits {
  let out: PlanLimits = { ...limits };
  for (const { featureId, planKey } of BM_MATRIX_STAGE_GATES_FOR_PLAN_LIMITS) {
    const base = limits[planKey];
    out = {
      ...out,
      [planKey]:
        typeof base === 'boolean'
          ? base && userMeetsBmMatrixFeatureStage(stage, featureId)
          : base,
    };
  }
  return out;
}
