/**
 * eng-domain/civil/module — CIVIL DomainModule (통합판: 새 스파인 + 기존 엔진).
 *
 * The multi-member plan → gate-chain → atomic package spine (this session's new
 * value) now drives the REAL, verified, KDS-cited engineering-core calculators
 * (`scripts/engineering-core`, audited correct + 121-test) via `engineAdapter`,
 * instead of the pure-TS re-derivations it shipped with. So each member's gates
 * carry the ENGINE's full check set:
 *   - beam           → simple_beam            (휨 + 전단 + 처짐)
 *   - column         → column_buckling        (Euler 휨좌굴 + 세장비)
 *   - retaining-wall → retaining_wall_stability(전도 + 활동 + 지지력 + 편심 + 지진)
 *   - slope          → slope_infinite         (무한사면 FS)
 *
 * Member IR fields are named for the calculator inputs (Sx/Aw/Fy/Ag/…) — the
 * planner must supply what the real calc needs; a missing load/input makes the
 * calc THROW (하중 날조 금지) and the gate FAILS with that reason (패키지 미산출).
 *
 * Ceiling (정직·불변): a VERIFIED DRAFT calc package — 법정 구조검토·날인은 면허
 * 보유자(구조기술사)의 책임. 코파일럿(단계 3~4)이지 "대체"(5)가 아님.
 */

import type { DomainGateResult, DomainModule } from '@/lib/domain-driver';
import { chatCompletionCivilPlanner } from './llmPlanner';
import { checkMetrics, runEngineCalc, type EngineCalcResult } from './engineAdapter';

// ─── IR (fields named for the engineering-core calculator inputs) ────────────

export interface CivilBrief {
  id: string;
  text?: string;
  params?: Record<string, number | string>;
}

/** simple_beam: required L, Fy, Sx, Aw, Ix + a load (w or P). */
export interface CivilBeamMember {
  kind: 'beam';
  id: string;
  name: string;
  spanMm: number;
  yieldStrengthMPa: number;
  sectionModulusMm3: number;
  webShearAreaMm2: number;
  inertiaMm4: number;
  udlKNpm?: number;
  pointLoadKN?: number;
}

/** column_buckling: required Fy, Ag, L, r, Pu + K. */
export interface CivilColumnMember {
  kind: 'column';
  id: string;
  name: string;
  yieldStrengthMPa: number;
  grossAreaMm2: number;
  unbracedLengthMm: number;
  radiusOfGyrationMm: number;
  axialDemandKN: number;
  effectiveLengthFactorK?: number;
}

/** retaining_wall_stability: overturning + sliding + bearing + eccentricity (+seismic). */
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
  baseFriction: number;
  allowableBearingKPa: number;
  seismicKh?: number;
}

/** slope_infinite: required slopeDeg, phiDeg, depthM, gamma, fsRequired. */
export interface CivilSlopeMember {
  kind: 'slope';
  id: string;
  name: string;
  slopeDeg: number;
  phiDeg: number;
  depthM: number;
  gammaKNm3: number;
  fsRequired: number;
  cohesionKPa?: number;
  waterDepthM?: number;
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
  /** Engineering-core honesty status ('검증'/'draft'), restated. */
  status?: string;
  checks: Array<{ id: string; pass: boolean; metrics: Record<string, number> }>;
}

export interface CivilPackage {
  planId: string;
  name: string;
  members: CivilMemberPackage[];
  disclaimer: string;
}

const CIVIL_DISCLAIMER =
  '검증된 초안 구조계산 — 법정 구조검토·날인은 면허 보유자(구조기술사)의 책임. ' +
  '본 패키지는 엔지니어 코파일럿 산출물이며 기존 설계의 "대체"가 아님. ' +
  '엔진: engineering-core(KDS 대조·공표예제 벤치).';

// ─── member → engineering-core calc mapping ──────────────────────────────────

interface CalcSpec {
  calcId: string;
  input: Record<string, number>;
}

function calcFor(m: CivilMember): CalcSpec {
  switch (m.kind) {
    case 'beam':
      return {
        calcId: 'simple_beam',
        input: {
          L: m.spanMm,
          Fy: m.yieldStrengthMPa,
          Sx: m.sectionModulusMm3,
          Aw: m.webShearAreaMm2,
          Ix: m.inertiaMm4,
          ...(m.udlKNpm !== undefined ? { w: m.udlKNpm } : {}),
          ...(m.pointLoadKN !== undefined ? { P: m.pointLoadKN } : {}),
        },
      };
    case 'column':
      return {
        calcId: 'column_buckling',
        input: {
          Fy: m.yieldStrengthMPa,
          Ag: m.grossAreaMm2,
          L: m.unbracedLengthMm,
          r: m.radiusOfGyrationMm,
          Pu: m.axialDemandKN,
          ...(m.effectiveLengthFactorK !== undefined ? { K: m.effectiveLengthFactorK } : {}),
        },
      };
    case 'retaining-wall':
      return {
        calcId: 'retaining_wall_stability',
        input: {
          H: m.heightM,
          stemThickness: m.stemThicknessM,
          baseWidth: m.baseWidthM,
          baseThickness: m.baseThicknessM,
          toeLength: m.toeLengthM,
          gammaBackfill: m.gammaBackfillKNm3,
          phiBackfill: m.phiBackfillDeg,
          baseFriction: m.baseFriction,
          allowableBearing: m.allowableBearingKPa,
          ...(m.seismicKh !== undefined ? { seismicKh: m.seismicKh } : {}),
        },
      };
    case 'slope':
      return {
        calcId: 'slope_infinite',
        input: {
          slopeDeg: m.slopeDeg,
          phiDeg: m.phiDeg,
          depthM: m.depthM,
          gamma: m.gammaKNm3,
          fsRequired: m.fsRequired,
          ...(m.cohesionKPa !== undefined ? { cohesion: m.cohesionKPa } : {}),
          ...(m.waterDepthM !== undefined ? { waterDepth: m.waterDepthM } : {}),
        },
      };
  }
}

/**
 * One member → ONE gate, whose pass/fail is the engine's authoritative VERDICT.
 * (Some calculator checks — e.g. column_buckling's ASD reference — are
 * informational and do NOT bind the verdict; treating each check as a hard gate
 * would wrongly reject a design the engine passes.) Every check's numbers ride
 * along as metrics (`{check}_{field}`) and its OK/NG in notes, so granularity is
 * preserved without over-refusing. A calc throw (missing load/input) → a failed
 * input gate (하중 날조 금지).
 */
function gateFromEngine(memberId: string, res: EngineCalcResult): DomainGateResult {
  const base = `structural:${memberId}`;
  if (!res.ok) {
    return {
      id: `${base}:input`,
      kind: 'structural',
      pass: false,
      metrics: {},
      reason: `엔진 검증 불가: ${res.reason ?? 'unknown'}`,
      notes: ['engineering-core INPUT_GATE / 하중 없음 — 값을 지어내지 않는다'],
    };
  }
  const checks = res.checks ?? {};
  const metrics: Record<string, number> = {};
  const checkNotes: string[] = [];
  const failed: string[] = [];
  for (const [name, chk] of Object.entries(checks)) {
    for (const [k, v] of Object.entries(checkMetrics(chk))) metrics[`${name}_${k}`] = v;
    checkNotes.push(`${name}: ${chk.pass ? 'OK' : 'NG'}`);
    if (chk.pass === false) failed.push(name);
  }
  const pass = res.verdict === 'PASS';
  return {
    id: base,
    kind: 'structural',
    pass,
    metrics,
    ...(pass ? {} : { reason: `engineering-core verdict FAIL — 미충족: ${failed.join(', ') || 'verdict'}` }),
    notes: [res.status ? `engineering-core: ${res.status}` : 'engineering-core', ...checkNotes],
  };
}

// ─── planner (deterministic fixtures — engine-input schema) ───────────────────

/** Steel beam L6.0 UDL20: Fy355, Sx1.5e6, Aw3000, Ix3e8 → simple_beam PASS. */
export function steelBeamPlan(): CivilPlan {
  return {
    planId: 'fixture-steel-beam',
    name: 'Simply-Supported Steel Beam L6.0 UDL20',
    members: [
      {
        kind: 'beam',
        id: 'B1',
        name: 'Floor Beam B1',
        spanMm: 6000,
        yieldStrengthMPa: 355,
        sectionModulusMm3: 1.5e6,
        webShearAreaMm2: 3000,
        inertiaMm4: 3e8,
        udlKNpm: 20,
      },
    ],
  };
}

/** One member of each kind — all adequately proportioned (engine PASS). */
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
        yieldStrengthMPa: 355,
        grossAreaMm2: 5000,
        unbracedLengthMm: 3000,
        radiusOfGyrationMm: 50, // KL/r = 60
        axialDemandKN: 500,
      },
      {
        kind: 'retaining-wall',
        id: 'W1',
        name: 'Cantilever Retaining Wall W1',
        heightM: 6,
        stemThicknessM: 0.4,
        baseWidthM: 4,
        baseThicknessM: 0.6,
        toeLengthM: 1.0,
        gammaBackfillKNm3: 18,
        phiBackfillDeg: 30,
        baseFriction: 0.5,
        allowableBearingKPa: 300,
      },
      {
        kind: 'slope',
        id: 'S1',
        name: 'Cut Slope S1',
        slopeDeg: 20,
        phiDeg: 30,
        depthM: 3,
        gammaKNm3: 18,
        fsRequired: 1.3,
        cohesionKPa: 5,
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

// ─── the module ───────────────────────────────────────────────────────────────

export const civilModule: DomainModule<CivilBrief, CivilPlan, CivilArtifacts, CivilPackage> = {
  name: 'civil',

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
    return { members: plan.members };
  },

  async gates(_plan, artifacts) {
    const all: DomainGateResult[] = [];
    for (const m of artifacts.members) {
      const { calcId, input } = calcFor(m);
      const res = await runEngineCalc(calcId, input);
      all.push(gateFromEngine(m.id, res));
    }
    return all;
  },

  package(plan, artifacts, gates) {
    const members: CivilMemberPackage[] = artifacts.members.map((m) => {
      // The member gate is `structural:{id}` (verdict) or `structural:{id}:input`.
      const g = gates.find((x) => x.id === `structural:${m.id}` || x.id === `structural:${m.id}:input`);
      const status = g?.notes.find((n) => n.startsWith('engineering-core:'))?.replace('engineering-core: ', '');
      // Per-check OK/NG lines were recorded in the gate notes ("bending: OK").
      const checks = (g?.notes ?? [])
        .filter((n) => n.includes(': OK') || n.includes(': NG'))
        .map((n) => {
          const [name, ok] = n.split(': ');
          return { id: name, pass: ok === 'OK', metrics: {} as Record<string, number> };
        });
      return {
        id: m.id,
        name: m.name,
        kind: m.kind,
        ...(status ? { status } : {}),
        checks,
      };
    });
    return { planId: plan.planId, name: plan.name, members, disclaimer: CIVIL_DISCLAIMER };
  },
};
