/**
 * eng-domain/interior/module — INTERIOR DomainModule (다분야 확장 Batch 2, 인테리어 봉합).
 *
 * Runs the full driver via the shared `runDomainDriver` spine: interior brief →
 * space plan → occupancy build → building-code gate chain (eng-domain/interior
 * pure checks) → verified code-compliance package. The occupant load computed in
 * the build step feeds the egress-width + plumbing gates (a real derived-quantity
 * chain), mirroring how the mechanical build feeds its measurement gates.
 *
 * Ceiling (정직): interior design itself has a lighter legal ceiling than
 * structural (5 접근 가능), but a permit set is still reviewed by a licensed
 * 건축사 — the package carries that disclosure (인허가 확인 대상). No "대체" claim.
 */

import type { DomainGateResult, DomainModule } from '@/lib/domain-driver';
import {
  checkCeilingHeight,
  checkCorridorClearWidth,
  checkEgressTravelDistance,
  checkEgressWidth,
  checkOccupancyLoad,
  checkPlumbingFixtureCount,
  type InteriorCheckResult,
  type UseGroup,
} from './checks';

// ─── IR ──────────────────────────────────────────────────────────────────────

export interface InteriorBrief {
  id: string;
  text?: string;
  params?: Record<string, number | string>;
}

/** One occupiable space to code-check. */
export interface InteriorSpace {
  id: string;
  name: string;
  useGroup: UseGroup;
  floorAreaM2: number;
  sprinklered: boolean;
  measuredTravelM: number;
  providedEgressWidthMm: number;
  measuredCorridorWidthMm: number;
  providedWaterClosets: number;
  measuredCeilingHeightMm: number;
  /** posted maximum occupant capacity to gate the computed load against. */
  postedOccupantLimit?: number;
}

export interface InteriorPlan {
  planId: string;
  name: string;
  spaces: InteriorSpace[];
}

export interface InteriorArtifacts {
  spaces: Array<{ space: InteriorSpace; occupantLoad: number }>;
}

export interface InteriorSpacePackage {
  id: string;
  name: string;
  occupantLoad: number;
  checks: Array<{ id: string; pass: boolean; metrics: Record<string, number>; basis: string }>;
}

export interface InteriorPackage {
  planId: string;
  name: string;
  spaces: InteriorSpacePackage[];
  disclaimer: string;
}

const INTERIOR_DISCLAIMER =
  '검증된 초안 건축코드 검토 — 인허가 도서는 건축사 확인 대상. 대표 코드값 기반이며 ' +
  'AHJ(허가권자) 최종 확인 필요. 기존 설계의 "대체"가 아닌 코파일럿 산출물.';

// ─── planner (deterministic fixture — unknown briefs refused) ─────────────────

/** Business office floor: 500 m² (occ 36), sprinklered, adequate egress/corridor/WC/ceiling. */
export function officeFloorPlan(): InteriorPlan {
  return {
    planId: 'fixture-office-floor',
    name: 'Business Office Floor 500 m²',
    spaces: [
      {
        id: 'F1',
        name: 'Open Office F1',
        useGroup: 'business',
        floorAreaM2: 500,
        sprinklered: true,
        measuredTravelM: 40,
        providedEgressWidthMm: 1000,
        measuredCorridorWidthMm: 1200,
        providedWaterClosets: 3,
        measuredCeilingHeightMm: 2700,
        postedOccupantLimit: 50,
      },
    ],
  };
}

const INTERIOR_FIXTURES: Record<string, (() => InteriorPlan) | undefined> = {
  'office-floor': officeFloorPlan,
};

export function interiorFixturePlanner(brief: InteriorBrief): InteriorPlan {
  const key = String(brief.params?.fixture ?? brief.id);
  const build = INTERIOR_FIXTURES[key];
  if (!build) {
    throw new Error(
      `interiorFixturePlanner: unknown brief '${key}' — known: ${Object.keys(INTERIOR_FIXTURES).join(', ')}. ` +
        '계획을 추측으로 만들지 않는다.',
    );
  }
  return build();
}

// ─── check → gate mapping ─────────────────────────────────────────────────────

function toGate(spaceId: string, r: InteriorCheckResult): DomainGateResult {
  return {
    id: `code:${spaceId}:${r.id}`,
    kind: 'code',
    pass: r.pass,
    metrics: r.metrics,
    ...(r.reason ? { reason: r.reason } : {}),
    notes: [r.basis],
  };
}

// ─── the module ───────────────────────────────────────────────────────────────

export const interiorModule: DomainModule<InteriorBrief, InteriorPlan, InteriorArtifacts, InteriorPackage> = {
  name: 'interior',

  plan(brief) {
    return interiorFixturePlanner(brief);
  },

  structuralError(plan) {
    if (!plan.planId) return 'plan has no planId';
    if (plan.spaces.length === 0) return 'plan has no spaces';
    const ids = new Set<string>();
    for (const s of plan.spaces) {
      if (!s.id) return 'space with empty id';
      if (ids.has(s.id)) return `duplicate space id '${s.id}'`;
      ids.add(s.id);
    }
    return null;
  },

  build(plan) {
    // Derived quantity: occupant load per space (real-computed, feeds egress/plumbing).
    return {
      spaces: plan.spaces.map((space) => {
        const occ = checkOccupancyLoad({ floorAreaM2: space.floorAreaM2, useGroup: space.useGroup });
        return { space, occupantLoad: occ.metrics.occupantLoad };
      }),
    };
  },

  gates(_plan, artifacts) {
    const gates: DomainGateResult[] = [];
    for (const { space, occupantLoad } of artifacts.spaces) {
      gates.push(
        toGate(
          space.id,
          checkOccupancyLoad({
            floorAreaM2: space.floorAreaM2,
            useGroup: space.useGroup,
            ...(space.postedOccupantLimit !== undefined ? { postedOccupantLimit: space.postedOccupantLimit } : {}),
          }),
        ),
      );
      gates.push(
        toGate(space.id, checkEgressTravelDistance({ measuredTravelM: space.measuredTravelM, useGroup: space.useGroup, sprinklered: space.sprinklered })),
      );
      gates.push(toGate(space.id, checkEgressWidth({ occupantLoad, providedWidthMm: space.providedEgressWidthMm })));
      gates.push(
        toGate(space.id, checkCorridorClearWidth({ measuredClearWidthMm: space.measuredCorridorWidthMm, occupantLoadServed: occupantLoad })),
      );
      gates.push(
        toGate(space.id, checkPlumbingFixtureCount({ occupantLoad, providedFixtures: space.providedWaterClosets, useGroup: space.useGroup })),
      );
      gates.push(toGate(space.id, checkCeilingHeight({ measuredHeightMm: space.measuredCeilingHeightMm })));
    }
    return gates;
  },

  package(plan, artifacts, gates) {
    const spaces: InteriorSpacePackage[] = artifacts.spaces.map(({ space, occupantLoad }) => {
      const prefix = `code:${space.id}:`;
      const checks = gates
        .filter((g) => g.id.startsWith(prefix))
        .map((g) => ({ id: g.id.slice(prefix.length), pass: g.pass, metrics: g.metrics, basis: g.notes[0] ?? '' }));
      return { id: space.id, name: space.name, occupantLoad, checks };
    });
    return { planId: plan.planId, name: plan.name, spaces, disclaimer: INTERIOR_DISCLAIMER };
  },
};
