/**
 * eng-domain/civil/module — CIVIL DomainModule (다분야 확장 Batch 2, 토목 봉합).
 *
 * The FIRST non-mechanical domain to run the full driver end-to-end: a civil
 * brief → structural plan → deterministic demand build → code-check gate chain
 * (eng-domain/civil pure checks) → verified structural package. It plugs into
 * the domain-agnostic `runDomainDriver` (src/lib/domain-driver) unchanged — same
 * refusal IR, same honesty invariants the mechanical driver hard-codes.
 *
 * Ceiling (정직·불변): this produces a VERIFIED DRAFT calc package. Civil/
 * structural design is legally a licensed engineer's stamped responsibility —
 * this is an engineer COPILOT (단계 3~4), NOT a replacement (5). The package
 * carries that disclosure; "대체" 언어 금지.
 *
 * Scope: beam members (bending + deflection) as the first member class. Column /
 * retaining-wall / slope checks exist in ./checks and become further gates as
 * the plan vocabulary is extended.
 */

import type { DomainGateResult, DomainModule } from '@/lib/domain-driver';
import {
  checkBeamBendingStress,
  checkBeamDeflection,
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

/** A simply-supported beam member to verify (bending + deflection). */
export interface CivilBeamMember {
  id: string;
  name: string;
  material?: 'steel' | 'concrete';
  /** clear span, m. */
  spanM: number;
  /** load case (udl/point drive both bending + deflection; moment = bending only). */
  load: BeamLoad;
  /** elastic section modulus Z, mm³. */
  sectionModulusMm3: number;
  /** second moment of area I, mm⁴. */
  inertiaMm4: number;
  /** allowable bending stress σ_allow, MPa. */
  allowableStressMPa: number;
  /** deflection limit denominator n in δ_lim = L/n. Default 360. */
  deflectionLimitDenominator?: number;
}

export interface CivilPlan {
  planId: string;
  name: string;
  members: CivilBeamMember[];
}

export interface CivilArtifacts {
  members: Array<{ member: CivilBeamMember; demandMomentKNm: number }>;
}

export interface CivilMemberPackage {
  id: string;
  name: string;
  demandMomentKNm: number;
  checks: Array<{ id: string; pass: boolean; metrics: Record<string, number>; basis: string }>;
}

export interface CivilPackage {
  planId: string;
  name: string;
  members: CivilMemberPackage[];
  /** Fixed honesty disclosure (면허자 최종 책임). */
  disclaimer: string;
}

const CIVIL_DISCLAIMER =
  '검증된 초안 구조계산 — 법정 구조검토·날인은 면허 보유자(구조기술사)의 책임. ' +
  '본 패키지는 엔지니어 코파일럿 산출물이며 기존 설계의 "대체"가 아님.';

// ─── planner (deterministic fixtures — unknown briefs refused, 날조 금지) ──────

/** W600-ish steel beam: span 6 m, UDL 20 kN/m, Z=1.5e6 mm³, I=3e8 mm⁴, σ_allow 160. */
export function steelBeamPlan(): CivilPlan {
  return {
    planId: 'fixture-steel-beam',
    name: 'Simply-Supported Steel Beam L6.0 UDL20',
    members: [
      {
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

const CIVIL_FIXTURES: Record<string, (() => CivilPlan) | undefined> = {
  'steel-beam': steelBeamPlan,
};

/** Deterministic planner: dispatches on `brief.params.fixture` (fallback id). */
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

// ─── check → gate mapping ─────────────────────────────────────────────────────

function toGate(memberId: string, r: CivilCheckResult): DomainGateResult {
  return {
    id: `structural:${memberId}:${r.id}`,
    kind: 'structural',
    pass: r.pass,
    metrics: r.metrics,
    ...(r.reason ? { reason: r.reason } : {}),
    notes: [r.basis],
  };
}

/** Derive a deflection load from the beam load (moment-only ⇒ no deflection gate). */
function deflectionLoad(load: BeamLoad): DeflectionLoad | null {
  if (load.type === 'udl') return { type: 'udl', w_kNpm: load.w_kNpm };
  if (load.type === 'point') return { type: 'point', P_kN: load.P_kN };
  return null;
}

function memberE(member: CivilBeamMember): number {
  return member.material === 'concrete' ? CONCRETE_E_MPA : STEEL_E_MPA;
}

// ─── the module ───────────────────────────────────────────────────────────────

export const civilModule: DomainModule<CivilBrief, CivilPlan, CivilArtifacts, CivilPackage> = {
  name: 'civil',

  plan(brief) {
    return civilFixturePlanner(brief);
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
    // Deterministic demand: max simple-span moment per member (throws on bad params).
    return {
      members: plan.members.map((member) => ({
        member,
        demandMomentKNm: maxSimpleSpanMomentKNm(member.load),
      })),
    };
  },

  gates(_plan, artifacts) {
    const gates: DomainGateResult[] = [];
    for (const { member } of artifacts.members) {
      // Bending gate (always applicable).
      gates.push(
        toGate(
          member.id,
          checkBeamBendingStress({
            load: member.load,
            sectionModulus_mm3: member.sectionModulusMm3,
            allowableStress_MPa: member.allowableStressMPa,
          }),
        ),
      );
      // Deflection gate (udl/point only — a pure-moment load has no deflection form).
      const dl = deflectionLoad(member.load);
      if (dl) {
        gates.push(
          toGate(
            member.id,
            checkBeamDeflection({
              load: dl,
              span_mm: member.spanM * 1000,
              E_MPa: memberE(member),
              I_mm4: member.inertiaMm4,
              ...(member.deflectionLimitDenominator !== undefined
                ? { limitDenominator: member.deflectionLimitDenominator }
                : {}),
            }),
          ),
        );
      }
    }
    return gates;
  },

  package(plan, artifacts, gates) {
    const members: CivilMemberPackage[] = artifacts.members.map(({ member, demandMomentKNm }) => {
      const prefix = `structural:${member.id}:`;
      const checks = gates
        .filter((g) => g.id.startsWith(prefix))
        .map((g) => ({
          id: g.id.slice(prefix.length),
          pass: g.pass,
          metrics: g.metrics,
          basis: g.notes[0] ?? '',
        }));
      return { id: member.id, name: member.name, demandMomentKNm, checks };
    });
    return { planId: plan.planId, name: plan.name, members, disclaimer: CIVIL_DISCLAIMER };
  },
};
