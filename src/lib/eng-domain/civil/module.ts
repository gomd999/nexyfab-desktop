/**
 * eng-domain/civil/module — CIVIL DomainModule (다분야 확장 Batch 2 + 어휘 확장).
 *
 * The FIRST non-mechanical domain to run the full driver end-to-end via the
 * domain-agnostic `runDomainDriver` spine. Member vocabulary (each = its own
 * measured code-check gate(s)):
 *   - beam           : bending stress + deflection
 *   - column         : Euler buckling (Pcr/SF + slenderness)
 *   - retaining-wall : overturning stability (Rankine)
 *   - slope          : infinite-slope factor of safety
 *
 * Ceiling (정직·불변): a VERIFIED DRAFT calc package. Civil/structural design is
 * legally a licensed engineer's stamped responsibility — engineer COPILOT
 * (단계 3~4), NOT replacement (5). The package carries that disclosure.
 *
 * A check THROWS on a structurally-invalid parameter (caller bug); the gate
 * wrapper (`safeGate`) converts that into a failed gate (clean verify refusal),
 * so the spine never sees an unhandled throw.
 */

import type { DomainGateResult, DomainModule } from '@/lib/domain-driver';
import { chatCompletionCivilPlanner } from './llmPlanner';
import {
  checkBeamBendingStress,
  checkBeamDeflection,
  checkColumnBucklingEuler,
  checkInfiniteSlopeStability,
  checkRetainingWallOverturning,
  maxSimpleSpanMomentKNm,
  STEEL_E_MPA,
  CONCRETE_E_MPA,
  type BeamLoad,
  type CivilCheckResult,
  type DeflectionLoad,
} from './checks';

// ─── IR ──────────────────────────────────────────────────────────────────────

export interface CivilBrief {
  id: string;
  text?: string;
  params?: Record<string, number | string>;
}

export interface CivilBeamMember {
  kind: 'beam';
  id: string;
  name: string;
  material?: 'steel' | 'concrete';
  spanM: number;
  load: BeamLoad;
  sectionModulusMm3: number;
  inertiaMm4: number;
  allowableStressMPa: number;
  deflectionLimitDenominator?: number;
}

export interface CivilColumnMember {
  kind: 'column';
  id: string;
  name: string;
  material?: 'steel' | 'concrete';
  inertiaMm4: number;
  effectiveLengthFactorK: number;
  unbracedLengthMm: number;
  radiusOfGyrationMm: number;
  axialDemandKN: number;
  requiredSF: number;
  slendernessLimit?: number;
}

export interface CivilWallMember {
  kind: 'retaining-wall';
  id: string;
  name: string;
  heightM: number;
  stemThicknessM: number;
  baseWidthM: number;
  baseThicknessM: number;
  toeLengthM: number;
  gammaBackfillKNm3: number;
  phiBackfillDeg: number;
  surchargeKPa?: number;
  requiredFS: number;
}

export interface CivilSlopeMember {
  kind: 'slope';
  id: string;
  name: string;
  slopeDeg: number;
  phiDeg: number;
  cohesionKPa?: number;
  depthM: number;
  gammaKNm3: number;
  waterDepthM?: number;
  requiredFS: number;
}

export type CivilMember = CivilBeamMember | CivilColumnMember | CivilWallMember | CivilSlopeMember;

export interface CivilPlan {
  planId: string;
  name: string;
  members: CivilMember[];
}

export interface CivilArtifacts {
  members: CivilMember[];
}

export interface CivilMemberPackage {
  id: string;
  name: string;
  kind: CivilMember['kind'];
  checks: Array<{ id: string; pass: boolean; metrics: Record<string, number>; basis: string }>;
}

export interface CivilPackage {
  planId: string;
  name: string;
  members: CivilMemberPackage[];
  disclaimer: string;
}

const CIVIL_DISCLAIMER =
  '검증된 초안 구조계산 — 법정 구조검토·날인은 면허 보유자(구조기술사)의 책임. ' +
  '본 패키지는 엔지니어 코파일럿 산출물이며 기존 설계의 "대체"가 아님.';

// ─── planner (deterministic fixtures) ─────────────────────────────────────────

/** Simply-supported steel beam: L6 UDL20, Z=1.5e6, I=3e8, σ_allow 160. */
export function steelBeamPlan(): CivilPlan {
  return {
    planId: 'fixture-steel-beam',
    name: 'Simply-Supported Steel Beam L6.0 UDL20',
    members: [
      {
        kind: 'beam',
        id: 'B1',
        name: 'Floor Beam B1',
        material: 'steel',
        spanM: 6,
        load: { type: 'udl', w_kNpm: 20, span_m: 6 },
        sectionModulusMm3: 1.5e6,
        inertiaMm4: 3e8,
        allowableStressMPa: 160,
        deflectionLimitDenominator: 360,
      },
    ],
  };
}

/** One member of each kind — all adequately proportioned (all gates pass). */
export function mixedStructurePlan(): CivilPlan {
  return {
    planId: 'fixture-mixed-structure',
    name: 'Mixed Structure (beam + column + wall + slope)',
    members: [
      steelBeamPlan().members[0]!,
      {
        kind: 'column',
        id: 'C1',
        name: 'Steel Column C1',
        material: 'steel',
        inertiaMm4: 3e8,
        effectiveLengthFactorK: 1.0,
        unbracedLengthMm: 3000,
        radiusOfGyrationMm: 100, // KL/r = 30 ≤ 200
        axialDemandKN: 500, // ≪ Pcr/SF
        requiredSF: 2.0,
      },
      {
        kind: 'retaining-wall',
        id: 'W1',
        name: 'Cantilever Retaining Wall W1',
        heightM: 4,
        stemThicknessM: 0.4,
        baseWidthM: 3.0, // generous base → comfortable overturning FS
        baseThicknessM: 0.4,
        toeLengthM: 0.8,
        gammaBackfillKNm3: 18,
        phiBackfillDeg: 30,
        requiredFS: 2.0,
      },
      {
        kind: 'slope',
        id: 'S1',
        name: 'Cut Slope S1',
        slopeDeg: 20,
        phiDeg: 30,
        cohesionKPa: 5,
        depthM: 3,
        gammaKNm3: 18,
        waterDepthM: 0,
        requiredFS: 1.3,
      },
    ],
  };
}

const CIVIL_FIXTURES: Record<string, (() => CivilPlan) | undefined> = {
  'steel-beam': steelBeamPlan,
  'mixed-structure': mixedStructurePlan,
};

export function civilFixturePlanner(brief: CivilBrief): CivilPlan {
  const key = String(brief.params?.fixture ?? brief.id);
  const build = CIVIL_FIXTURES[key];
  if (!build) {
    throw new Error(
      `civilFixturePlanner: unknown brief '${key}' — known: ${Object.keys(CIVIL_FIXTURES).join(', ')}. ` +
        '계획을 추측으로 만들지 않는다.',
    );
  }
  return build();
}

// ─── check → gate mapping (throw-safe) ────────────────────────────────────────

function memberE(m: { material?: 'steel' | 'concrete' }): number {
  return m.material === 'concrete' ? CONCRETE_E_MPA : STEEL_E_MPA;
}

function deflectionLoad(load: BeamLoad): DeflectionLoad | null {
  if (load.type === 'udl') return { type: 'udl', w_kNpm: load.w_kNpm };
  if (load.type === 'point') return { type: 'point', P_kN: load.P_kN };
  return null;
}

/**
 * Run a check and map to a gate. A check THROW (invalid param = caller bug)
 * becomes a FAILED gate (clean verify refusal) rather than an unhandled throw.
 */
function safeGate(id: string, produce: () => CivilCheckResult): DomainGateResult {
  try {
    const r = produce();
    return {
      id,
      kind: 'structural',
      pass: r.pass,
      metrics: r.metrics,
      ...(r.reason ? { reason: r.reason } : {}),
      notes: [r.basis],
    };
  } catch (e) {
    return {
      id,
      kind: 'structural',
      pass: false,
      metrics: {},
      reason: `invalid parameter: ${e instanceof Error ? e.message : String(e)}`,
      notes: ['parameter validation failed before the check could run'],
    };
  }
}

function memberGates(m: CivilMember): DomainGateResult[] {
  const base = `structural:${m.id}`;
  switch (m.kind) {
    case 'beam': {
      const gates = [
        safeGate(`${base}:beam-bending-stress`, () =>
          checkBeamBendingStress({ load: m.load, sectionModulus_mm3: m.sectionModulusMm3, allowableStress_MPa: m.allowableStressMPa }),
        ),
      ];
      const dl = deflectionLoad(m.load);
      if (dl) {
        gates.push(
          safeGate(`${base}:beam-deflection`, () =>
            checkBeamDeflection({
              load: dl,
              span_mm: m.spanM * 1000,
              E_MPa: memberE(m),
              I_mm4: m.inertiaMm4,
              ...(m.deflectionLimitDenominator !== undefined ? { limitDenominator: m.deflectionLimitDenominator } : {}),
            }),
          ),
        );
      }
      return gates;
    }
    case 'column':
      return [
        safeGate(`${base}:column-buckling-euler`, () =>
          checkColumnBucklingEuler({
            E_MPa: memberE(m),
            I_mm4: m.inertiaMm4,
            K: m.effectiveLengthFactorK,
            L_mm: m.unbracedLengthMm,
            r_mm: m.radiusOfGyrationMm,
            demand_kN: m.axialDemandKN,
            requiredSF: m.requiredSF,
            ...(m.slendernessLimit !== undefined ? { slendernessLimit: m.slendernessLimit } : {}),
          }),
        ),
      ];
    case 'retaining-wall':
      return [
        safeGate(`${base}:retaining-wall-overturning`, () =>
          checkRetainingWallOverturning({
            H: m.heightM,
            stemThickness_m: m.stemThicknessM,
            baseWidth_m: m.baseWidthM,
            baseThickness_m: m.baseThicknessM,
            toeLength_m: m.toeLengthM,
            gammaBackfill_kNm3: m.gammaBackfillKNm3,
            phiBackfillDeg: m.phiBackfillDeg,
            ...(m.surchargeKPa !== undefined ? { surcharge_kPa: m.surchargeKPa } : {}),
            requiredFS: m.requiredFS,
          }),
        ),
      ];
    case 'slope':
      return [
        safeGate(`${base}:slope-infinite-stability`, () =>
          checkInfiniteSlopeStability({
            slopeDeg: m.slopeDeg,
            phiDeg: m.phiDeg,
            ...(m.cohesionKPa !== undefined ? { cohesion_kPa: m.cohesionKPa } : {}),
            depth_m: m.depthM,
            gamma_kNm3: m.gammaKNm3,
            ...(m.waterDepthM !== undefined ? { waterDepth_m: m.waterDepthM } : {}),
            requiredFS: m.requiredFS,
          }),
        ),
      ];
  }
}

// ─── the module ───────────────────────────────────────────────────────────────

export const civilModule: DomainModule<CivilBrief, CivilPlan, CivilArtifacts, CivilPackage> = {
  name: 'civil',

  // Composite planner (mechanical DEFAULT_PLANNER pattern): a fixture key ⇒ the
  // deterministic fixture planner; free text ⇒ the LLM planner (#2). The LLM path
  // is exercised in tests via makeCivilLlmPlanner with an injected mock.
  plan(brief) {
    const hasFixture = typeof brief.params?.fixture === 'string' && brief.params.fixture.length > 0;
    if (hasFixture) return civilFixturePlanner(brief);
    return chatCompletionCivilPlanner()(brief);
  },

  structuralError(plan) {
    if (!plan.planId) return 'plan has no planId';
    if (plan.members.length === 0) return 'plan has no members';
    const ids = new Set<string>();
    for (const m of plan.members) {
      if (!m.id) return 'member with empty id';
      if (ids.has(m.id)) return `duplicate member id '${m.id}'`;
      ids.add(m.id);
    }
    return null;
  },

  build(plan) {
    // Deterministic pre-flight: beam moments throw on bad load/span (→ verify
    // refusal via the runner). Other members are validated inside their gates.
    for (const m of plan.members) {
      if (m.kind === 'beam') maxSimpleSpanMomentKNm(m.load);
    }
    return { members: plan.members };
  },

  gates(_plan, artifacts) {
    return artifacts.members.flatMap((m) => memberGates(m));
  },

  package(plan, artifacts, gates) {
    const members: CivilMemberPackage[] = artifacts.members.map((m) => {
      const prefix = `structural:${m.id}:`;
      const checks = gates
        .filter((g) => g.id.startsWith(prefix))
        .map((g) => ({ id: g.id.slice(prefix.length), pass: g.pass, metrics: g.metrics, basis: g.notes[0] ?? '' }));
      return { id: m.id, name: m.name, kind: m.kind, checks };
    });
    return { planId: plan.planId, name: plan.name, members, disclaimer: CIVIL_DISCLAIMER };
  },
};
