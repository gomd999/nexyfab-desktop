/**
 * eng-domain/construction/module — CONSTRUCTION DomainModule
 * (다분야 확장 Batch 3 + 어휘 확장).
 *
 * Runs the full driver via the shared `runDomainDriver` spine. Element/gate
 * vocabulary:
 *   - concrete volume takeoff (always)   - rebar weight takeoff (always)
 *   - schedule feasibility / CPM (always)
 *   - formwork area takeoff  (when formworkElements present)
 *   - cost rollup vs budget  (when costLineItems present)
 *   - earthwork cut-fill balance (when earthwork present)
 *
 * Ceiling (정직): quantity takeoff & scheduling have a lighter legal ceiling than
 * structural design (no stamp on a BOQ) — those outputs can approach 단계 5. Any
 * structural member quantified is still a licensed engineer's responsibility.
 *
 * A check THROWS on invalid params (caller bug); `safeGate` converts that into a
 * failed gate (clean verify refusal) so the spine never sees an unhandled throw.
 */

import type { DomainGateResult, DomainModule } from '@/lib/domain-driver';
import {
  checkConcreteVolumeTakeoff,
  checkCostRollup,
  checkEarthworkCutFillBalance,
  checkFormworkAreaTakeoff,
  checkRebarWeightTakeoff,
  checkScheduleFeasibility,
  concreteVolume_m3,
  rebarWeight_kg,
  scheduleForwardPass,
  type Activity,
  type ConcreteElement,
  type ConstructionCheckResult,
  type CostLineItem,
  type FormworkElement,
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
  claimedConcreteM3: number;
  wasteFactor?: number;
  rebarGroups: RebarGroup[];
  claimedRebarKg: number;
  rebarToleranceKg?: number;
  activities: Activity[];
  deadlineDays?: number;
  // ── vocabulary expansion (optional gates) ──
  formworkElements?: FormworkElement[];
  claimedFormworkM2?: number;
  formworkToleranceM2?: number;
  costLineItems?: CostLineItem[];
  budget?: number;
  contingencyFactor?: number;
  earthwork?: { cutBankM3: number; fillCompactedM3: number; compactionFactor?: number; toleranceM3?: number };
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

/** RC frame bay: concrete + rebar + schedule + formwork + cost + earthwork (all pass). */
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
    claimedRebarKg: 295,
    rebarToleranceKg: 10,
    activities: [
      { id: 'excavate', duration_days: 5 },
      { id: 'pour', duration_days: 6, predecessors: ['excavate'] },
    ],
    deadlineDays: 15,
    // formwork: beams (2·0.6+0.3)·6=9 ×2 + columns 2(0.4+0.4)·3=4.8 ×2 = 18 + 9.6 = 27.6 m²
    formworkElements: [
      { type: 'beam', count: 2, b_m: 0.3, h_m: 0.6, L_m: 6 },
      { type: 'column', count: 2, b_m: 0.4, h_m: 0.4, L_m: 3 },
    ],
    claimedFormworkM2: 27.6,
    // cost: concrete 3.5×150000 + rebar 295×1500 + formwork 27.6×60000 = 2,623,500 (·1.1 ≤ 3.5M)
    costLineItems: [
      { description: 'concrete m³', quantity: 3.5, unitRate: 150000 },
      { description: 'rebar kg', quantity: 295, unitRate: 1500 },
      { description: 'formwork m²', quantity: 27.6, unitRate: 60000 },
    ],
    budget: 3_500_000,
    contingencyFactor: 0.1,
    // earthwork: required bank = 90/0.9 = 100 = cut → net 0 ✓
    earthwork: { cutBankM3: 100, fillCompactedM3: 90, compactionFactor: 0.9 },
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

// ─── check → gate mapping (throw-safe) ────────────────────────────────────────

function safeGate(kind: string, scope: string, produce: () => ConstructionCheckResult): DomainGateResult {
  const id = `${kind}:${scope}`;
  try {
    const r = produce();
    return { id, kind, pass: r.pass, metrics: r.metrics, ...(r.reason ? { reason: r.reason } : {}), notes: [r.basis] };
  } catch (e) {
    return { id, kind, pass: false, metrics: {}, reason: `invalid parameter: ${e instanceof Error ? e.message : String(e)}`, notes: ['parameter validation failed'] };
  }
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
    return {
      concreteVolumeM3: concreteVolume_m3(plan.concreteElements),
      rebarWeightKg: rebarWeight_kg(plan.rebarGroups),
      criticalPathDays: scheduleForwardPass(plan.activities).criticalPathDays,
    };
  },

  gates(plan) {
    const gates: DomainGateResult[] = [
      safeGate('quantity', 'concrete', () =>
        checkConcreteVolumeTakeoff({
          elements: plan.concreteElements,
          claimedVolume_m3: plan.claimedConcreteM3,
          ...(plan.wasteFactor !== undefined ? { wasteFactor: plan.wasteFactor } : {}),
        }),
      ),
      safeGate('quantity', 'rebar', () =>
        checkRebarWeightTakeoff({
          groups: plan.rebarGroups,
          claimedWeight_kg: plan.claimedRebarKg,
          ...(plan.rebarToleranceKg !== undefined ? { toleranceKg: plan.rebarToleranceKg } : {}),
        }),
      ),
      safeGate('schedule', 'critical-path', () =>
        checkScheduleFeasibility({
          activities: plan.activities,
          ...(plan.deadlineDays !== undefined ? { deadline_days: plan.deadlineDays } : {}),
        }),
      ),
    ];
    if (plan.formworkElements && plan.claimedFormworkM2 !== undefined) {
      gates.push(
        safeGate('quantity', 'formwork', () =>
          checkFormworkAreaTakeoff({
            elements: plan.formworkElements!,
            claimedArea_m2: plan.claimedFormworkM2!,
            ...(plan.formworkToleranceM2 !== undefined ? { toleranceM2: plan.formworkToleranceM2 } : {}),
          }),
        ),
      );
    }
    if (plan.costLineItems && plan.budget !== undefined) {
      gates.push(
        safeGate('cost', 'rollup', () =>
          checkCostRollup({
            lineItems: plan.costLineItems!,
            budget: plan.budget!,
            ...(plan.contingencyFactor !== undefined ? { contingencyFactor: plan.contingencyFactor } : {}),
          }),
        ),
      );
    }
    if (plan.earthwork) {
      gates.push(
        safeGate('earthwork', 'cut-fill', () =>
          checkEarthworkCutFillBalance({
            cutBank_m3: plan.earthwork!.cutBankM3,
            fillCompacted_m3: plan.earthwork!.fillCompactedM3,
            ...(plan.earthwork!.compactionFactor !== undefined ? { compactionFactor: plan.earthwork!.compactionFactor } : {}),
            ...(plan.earthwork!.toleranceM3 !== undefined ? { toleranceM3: plan.earthwork!.toleranceM3 } : {}),
          }),
        ),
      );
    }
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
