/**
 * eng-domain/construction/module — CONSTRUCTION DomainModule (다분야 확장 Batch 3).
 *
 * Runs the full driver via the shared `runDomainDriver` spine: construction brief
 * → project plan → quantity/schedule build → takeoff + CPM gate chain
 * (eng-domain/construction pure checks) → verified quantity/schedule package.
 *
 * Ceiling (정직): quantity takeoff & scheduling have a LIGHTER legal ceiling than
 * structural design (no stamp on a BOQ), so this domain can approach 단계 5 for
 * those outputs — but any structural member it quantifies is still a licensed
 * engineer's design responsibility. The package carries that split disclosure.
 *
 * Scope: concrete volume + rebar weight + schedule feasibility as the first
 * class. Formwork / cost / earthwork checks exist in ./checks and become further
 * gates as the plan vocabulary is extended.
 */

import type { DomainGateResult, DomainModule } from '@/lib/domain-driver';
import {
  checkConcreteVolumeTakeoff,
  checkRebarWeightTakeoff,
  checkScheduleFeasibility,
  concreteVolume_m3,
  rebarWeight_kg,
  scheduleForwardPass,
  type Activity,
  type ConcreteElement,
  type ConstructionCheckResult,
  type RebarGroup,
} from './checks';

// ─── IR ──────────────────────────────────────────────────────────────────────

export interface ConstructionBrief {
  id: string;
  text?: string;
  params?: Record<string, number | string>;
}

export interface ConstructionPlan {
  planId: string;
  name: string;
  concreteElements: ConcreteElement[];
  /** ordered concrete volume (m³) to reconcile. */
  claimedConcreteM3: number;
  /** order = computed·(1+waste); pass iff ordered ≥ required. */
  wasteFactor?: number;
  rebarGroups: RebarGroup[];
  /** delivered rebar weight (kg) to reconcile. */
  claimedRebarKg: number;
  /** absolute rebar tolerance (kg). */
  rebarToleranceKg?: number;
  activities: Activity[];
  /** optional project deadline (days). */
  deadlineDays?: number;
}

export interface ConstructionArtifacts {
  concreteVolumeM3: number;
  rebarWeightKg: number;
  criticalPathDays: number;
}

export interface ConstructionPackage {
  planId: string;
  name: string;
  concreteVolumeM3: number;
  rebarWeightKg: number;
  criticalPathDays: number;
  checks: Array<{ id: string; pass: boolean; metrics: Record<string, number>; basis: string }>;
  disclaimer: string;
}

const CONSTRUCTION_DISCLAIMER =
  '검증된 물량·공정 산출 — 물량/공정표는 시공 관리용(법정 날인 무관). 다만 정량화된 ' +
  '구조부재의 설계는 면허 보유자(구조기술사)의 책임. "대체"가 아닌 코파일럿 산출물.';

// ─── planner (deterministic fixture) ──────────────────────────────────────────

/** Small RC frame: 2 beams (0.3×0.6×6) + 2 columns (0.4×0.4×3), rebar, 2-activity schedule. */
export function rcFramePlan(): ConstructionPlan {
  return {
    planId: 'fixture-rc-frame',
    name: 'RC Frame Bay (2 beams + 2 columns)',
    concreteElements: [
      { tag: 'beam', count: 2, b_m: 0.3, h_m: 0.6, L_m: 6 }, // 2.16 m³
      { tag: 'column', count: 2, b_m: 0.4, h_m: 0.4, L_m: 3 }, // 0.96 m³
    ],
    claimedConcreteM3: 3.5, // required = 3.12·1.05 = 3.276 ≤ 3.5 ✓
    wasteFactor: 0.05,
    rebarGroups: [
      { tag: 'beam-main', nominalDia_mm: 16, length_m: 12, count: 8 },
      { tag: 'column-main', nominalDia_mm: 22, length_m: 3, count: 16 },
    ],
    claimedRebarKg: 295, // computed ≈ 294.75; tol 10 ✓
    rebarToleranceKg: 10,
    activities: [
      { id: 'excavate', duration_days: 5 },
      { id: 'pour', duration_days: 6, predecessors: ['excavate'] },
    ],
    deadlineDays: 15, // critical path 11 ≤ 15 ✓
  };
}

const CONSTRUCTION_FIXTURES: Record<string, (() => ConstructionPlan) | undefined> = {
  'rc-frame': rcFramePlan,
};

export function constructionFixturePlanner(brief: ConstructionBrief): ConstructionPlan {
  const key = String(brief.params?.fixture ?? brief.id);
  const build = CONSTRUCTION_FIXTURES[key];
  if (!build) {
    throw new Error(
      `constructionFixturePlanner: unknown brief '${key}' — known: ${Object.keys(CONSTRUCTION_FIXTURES).join(', ')}. ` +
        '계획을 추측으로 만들지 않는다.',
    );
  }
  return build();
}

// ─── check → gate mapping ─────────────────────────────────────────────────────

function toGate(kind: string, scope: string, r: ConstructionCheckResult): DomainGateResult {
  return {
    id: `${kind}:${scope}`,
    kind,
    pass: r.pass,
    metrics: r.metrics,
    ...(r.reason ? { reason: r.reason } : {}),
    notes: [r.basis],
  };
}

// ─── the module ───────────────────────────────────────────────────────────────

export const constructionModule: DomainModule<
  ConstructionBrief,
  ConstructionPlan,
  ConstructionArtifacts,
  ConstructionPackage
> = {
  name: 'construction',

  plan(brief) {
    return constructionFixturePlanner(brief);
  },

  structuralError(plan) {
    if (!plan.planId) return 'plan has no planId';
    if (plan.concreteElements.length === 0) return 'plan has no concrete elements';
    if (plan.activities.length === 0) return 'plan has no schedule activities';
    return null;
  },

  build(plan) {
    // Deterministic takeoff (throws on bad params → verify-stage refusal).
    return {
      concreteVolumeM3: concreteVolume_m3(plan.concreteElements),
      rebarWeightKg: rebarWeight_kg(plan.rebarGroups),
      criticalPathDays: scheduleForwardPass(plan.activities).criticalPathDays,
    };
  },

  gates(plan) {
    const gates: DomainGateResult[] = [];
    gates.push(
      toGate(
        'quantity',
        'concrete',
        checkConcreteVolumeTakeoff({
          elements: plan.concreteElements,
          claimedVolume_m3: plan.claimedConcreteM3,
          ...(plan.wasteFactor !== undefined ? { wasteFactor: plan.wasteFactor } : {}),
        }),
      ),
    );
    gates.push(
      toGate(
        'quantity',
        'rebar',
        checkRebarWeightTakeoff({
          groups: plan.rebarGroups,
          claimedWeight_kg: plan.claimedRebarKg,
          ...(plan.rebarToleranceKg !== undefined ? { toleranceKg: plan.rebarToleranceKg } : {}),
        }),
      ),
    );
    gates.push(
      toGate(
        'schedule',
        'critical-path',
        checkScheduleFeasibility({
          activities: plan.activities,
          ...(plan.deadlineDays !== undefined ? { deadline_days: plan.deadlineDays } : {}),
        }),
      ),
    );
    return gates;
  },

  package(plan, artifacts, gates) {
    return {
      planId: plan.planId,
      name: plan.name,
      concreteVolumeM3: artifacts.concreteVolumeM3,
      rebarWeightKg: artifacts.rebarWeightKg,
      criticalPathDays: artifacts.criticalPathDays,
      checks: gates.map((g) => ({ id: g.id, pass: g.pass, metrics: g.metrics, basis: g.notes[0] ?? '' })),
      disclaimer: CONSTRUCTION_DISCLAIMER,
    };
  },
};
