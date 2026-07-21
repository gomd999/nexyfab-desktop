/**
 * eng-domain/landscape/module — LANDSCAPE DomainModule (다분야 확장 Batch 3).
 *
 * Runs the full driver via the shared `runDomainDriver` spine: landscape brief →
 * site/planting plan → derived-quantity build → design-code gate chain
 * (eng-domain/landscape pure checks) → verified landscape package.
 *
 * Ceiling (정직): landscape design has a lighter legal ceiling than structural
 * (design-verifiable code checks, 5 접근 가능), but 조경면적·배수 등은 지자체 조례가
 * 실제 기준을 정하므로 AHJ/조례 확인이 필요 — the package carries that disclosure.
 *
 * Scope: a single landscaped site (irrigation + drainage + planting spacing +
 * green-area ratio + soil depth) as the first class.
 */

import type { DomainGateResult, DomainModule } from '@/lib/domain-driver';
import {
  checkDrainageSlope,
  checkGreenAreaRatio,
  checkIrrigationCoverage,
  checkPlantingSpacing,
  checkSoilDepth,
  type DrainageSurface,
  type LandUseZone,
  type LandscapeCheckResult,
  type SoilCategory,
  type SpacingCategory,
} from './checks';

// ─── IR ──────────────────────────────────────────────────────────────────────

export interface LandscapeBrief {
  id: string;
  text?: string;
  params?: Record<string, number | string>;
}

export interface LandscapePlan {
  planId: string;
  name: string;
  siteAreaM2: number;
  landscapedAreaM2: number;
  zone?: LandUseZone;
  greenMinRatioOverride?: number;
  irrigation: {
    headCount: number;
    coverageRadiusM: number;
    targetAreaM2: number;
    overlapFactor?: number;
    requiredUniformity?: number;
  };
  drainage: { measuredGradePct: number; surfaceType?: DrainageSurface };
  planting: { plantCount: number; areaM2: number; category?: SpacingCategory; minSpacingMOverride?: number };
  soil: { category: SoilCategory; providedDepthM: number };
}

export interface LandscapeArtifacts {
  greenRatio: number;
}

export interface LandscapePackage {
  planId: string;
  name: string;
  greenRatio: number;
  checks: Array<{ id: string; pass: boolean; metrics: Record<string, number>; basis: string }>;
  disclaimer: string;
}

const LANDSCAPE_DISCLAIMER =
  '검증된 초안 조경 설계 — 조경면적·배수 등 실제 기준은 지자체 조례/AHJ가 정함(대표값 기반). ' +
  '인허가 도서는 조경/건축 전문가 확인 대상. 기존 설계의 "대체"가 아닌 코파일럿 산출물.';

// ─── planner (deterministic fixture) ──────────────────────────────────────────

/** Neighborhood park plaza: adequate irrigation / drainage / spacing / green-area / soil. */
export function parkPlazaPlan(): LandscapePlan {
  return {
    planId: 'fixture-park-plaza',
    name: 'Neighborhood Park Plaza',
    siteAreaM2: 1000,
    landscapedAreaM2: 200, // ratio 0.20
    greenMinRatioOverride: 0.15, // ≥ 0.15 ✓
    irrigation: { headCount: 20, coverageRadiusM: 3, targetAreaM2: 300, overlapFactor: 0.55, requiredUniformity: 0.9 },
    drainage: { measuredGradePct: 1.5, surfaceType: 'paving' }, // 0.5–2% band ✓
    planting: { plantCount: 30, areaM2: 300, category: '관목', minSpacingMOverride: 1.0 }, // √10 ≈ 3.16 ≥ 1.0 ✓
    soil: { category: '교목', providedDepthM: 1.2 }, // ≥ 1.0 m (표 3.1-1) ✓
  };
}

const LANDSCAPE_FIXTURES: Record<string, (() => LandscapePlan) | undefined> = {
  'park-plaza': parkPlazaPlan,
};

export function landscapeFixturePlanner(brief: LandscapeBrief): LandscapePlan {
  const key = String(brief.params?.fixture ?? brief.id);
  const build = LANDSCAPE_FIXTURES[key];
  if (!build) {
    throw new Error(
      `landscapeFixturePlanner: unknown brief '${key}' — known: ${Object.keys(LANDSCAPE_FIXTURES).join(', ')}. ` +
        '계획을 추측으로 만들지 않는다.',
    );
  }
  return build();
}

// ─── check → gate mapping ─────────────────────────────────────────────────────

function toGate(scope: string, r: LandscapeCheckResult): DomainGateResult {
  return {
    id: `landscape:${scope}:${r.id}`,
    kind: 'landscape',
    pass: r.pass,
    metrics: r.metrics,
    ...(r.reason ? { reason: r.reason } : {}),
    notes: [r.basis],
  };
}

// ─── the module ───────────────────────────────────────────────────────────────

export const landscapeModule: DomainModule<LandscapeBrief, LandscapePlan, LandscapeArtifacts, LandscapePackage> = {
  name: 'landscape',

  plan(brief) {
    return landscapeFixturePlanner(brief);
  },

  structuralError(plan) {
    if (!plan.planId) return 'plan has no planId';
    if (!(plan.siteAreaM2 > 0)) return 'site area must be positive';
    return null;
  },

  build(plan) {
    return { greenRatio: plan.landscapedAreaM2 / plan.siteAreaM2 };
  },

  gates(plan) {
    return [
      toGate('site', checkGreenAreaRatio({
        landscapedAreaM2: plan.landscapedAreaM2,
        siteAreaM2: plan.siteAreaM2,
        ...(plan.zone !== undefined ? { zone: plan.zone } : {}),
        ...(plan.greenMinRatioOverride !== undefined ? { minRatioOverride: plan.greenMinRatioOverride } : {}),
      })),
      toGate('irrigation', checkIrrigationCoverage({
        headCount: plan.irrigation.headCount,
        coverageRadiusM: plan.irrigation.coverageRadiusM,
        targetAreaM2: plan.irrigation.targetAreaM2,
        ...(plan.irrigation.overlapFactor !== undefined ? { overlapFactor: plan.irrigation.overlapFactor } : {}),
        ...(plan.irrigation.requiredUniformity !== undefined ? { requiredUniformity: plan.irrigation.requiredUniformity } : {}),
      })),
      toGate('drainage', checkDrainageSlope({
        measuredGradePct: plan.drainage.measuredGradePct,
        ...(plan.drainage.surfaceType !== undefined ? { surfaceType: plan.drainage.surfaceType } : {}),
      })),
      toGate('planting', checkPlantingSpacing({
        plantCount: plan.planting.plantCount,
        areaM2: plan.planting.areaM2,
        ...(plan.planting.category !== undefined ? { category: plan.planting.category } : {}),
        ...(plan.planting.minSpacingMOverride !== undefined ? { minSpacingMOverride: plan.planting.minSpacingMOverride } : {}),
      })),
      toGate('soil', checkSoilDepth({ category: plan.soil.category, providedDepthM: plan.soil.providedDepthM })),
    ];
  },

  package(plan, artifacts, gates) {
    return {
      planId: plan.planId,
      name: plan.name,
      greenRatio: artifacts.greenRatio,
      checks: gates.map((g) => ({ id: g.id, pass: g.pass, metrics: g.metrics, basis: g.notes[0] ?? '' })),
      disclaimer: LANDSCAPE_DISCLAIMER,
    };
  },
};
