/**
 * design-driver/interferenceGate — WB-4 / WB-4b: interference as a standard
 * assembly gate. Closes AI_COVERAGE_MATRIX ⑧ ("간섭 게이트 미포함 → 부품
 * 관통도 통과 가능").
 *
 * TWO-PHASE (WB-4b 정밀화):
 *   ① BROAD phase — `assemblyInterferences` (src/lib/assembly/interference)
 *      rotates each part's PART-frame AABB into the world frame using the
 *      SOLVED placement and reports pairwise world-AABB overlaps with a
 *      penetration depth. Cheap, CONSERVATIVE: an AABB overlap is a
 *      *candidate*, not a verdict (bounding boxes overlap for an L-bracket
 *      cradling a peg even though the solids never touch).
 *   ② NARROW phase — `preciseInterference` (interferencePrecise) runs the REAL
 *      geometric test on the tessellated solids `geometryGate` already built
 *      (each body's watertight `Polyhedron`), transformed by the solved pose:
 *      triangle–triangle intersection (SAT) + a containment guard. A candidate
 *      is FLAGGED only when the exact test confirms the solids really collide;
 *      an AABB-only overlap whose solids are disjoint is CLEARED (the old
 *      false positive — valid design no longer blocked).
 *
 * 판정 기준 (접촉 vs 관통):
 *   - MATED pairs (joined by any plan mate) are WHITELISTED — a mate's whole
 *     purpose is design-intended contact; a bounding box cannot separate
 *     intended mating contact from a collision, and neither should the narrow
 *     phase second-guess it. (Documented use of the engine's `whitelist`.)
 *   - A broad-phase overlap at or below `contactTol` on the shallowest axis is
 *     surface CONTACT (착좌) → allowed, narrow phase not even invoked.
 *   - A broad-phase overlap > `contactTol` is a CANDIDATE → narrow phase
 *     decides: solids intersect ⇒ FLAG (관통); solids disjoint ⇒ CLEAR.
 *
 * 근사·한계 (명시 — 날조 없음):
 *   - The narrow phase is EXACT for the tessellated geometry (triangle SAT +
 *     manifold ray-parity containment), so it never raises the AABB false
 *     positive and never silently misses a containment.
 *   - It needs BOTH parts fully meshed. If a body of either part is unmeshable
 *     (featureMesh cannot tessellate the feature kind), the narrow phase
 *     reports `available:false` and the gate FALLS BACK to the conservative
 *     AABB verdict for that pair (근사 명시 — the candidate stays flagged, we
 *     do NOT silently pass) and records the fallback + reason.
 *   - Reported penetration is the BROAD-phase AABB interpenetration (a bbox
 *     proxy, labelled), not a re-measured solid penetration depth. The narrow
 *     phase contributes the boolean collision verdict + a measured
 *     intersecting-triangle-pair count.
 *   - The gate runs ONLY on a converged solve (실행한 배치만 판정).
 */

import {
  assemblyInterferences,
  type AABB,
  type InterferencePair,
} from '@/lib/assembly/interference';
import type { PartInstance } from '@/lib/assembly/assemblyState';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import type { AssemblySolveArtifact } from './assemblyGate';
import type { PartGeometry } from './geometryGate';
import { preciseInterference } from './interferencePrecise';
import type { DesignPlan, GateResult, PlanPart } from './types';

/**
 * Penetration (mm) at or below which a world-AABB overlap counts as surface
 * contact (착좌), not a collision. Sized to absorb the mate solver's residual
 * (default convergence tolerance 1e-6 mm).
 */
export const INTERFERENCE_CONTACT_TOL = 1e-6;

/** Alphabetically-sorted pair key, matching interference.ts whitelist keys. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/** A candidate broad-phase overlap the narrow phase confirmed as a real collision. */
export interface ConfirmedPair {
  pair: string;
  /** Measured intersecting triangle-pair count (0 when confirmed by containment). */
  triPairs: number;
  byContainment: boolean;
}

/** A broad-phase overlap the narrow phase CLEARED (AABB false positive removed). */
export interface ClearedPair {
  pair: string;
  /** The broad-phase AABB interpenetration that WOULD have failed the old gate. */
  aabbPenetrationMm: number;
}

/** A candidate where the narrow phase could not run → conservative AABB fallback. */
export interface FallbackPair {
  pair: string;
  aabbPenetrationMm: number;
  reason: string;
}

export interface InterferenceArtifact {
  /** Overlaps that are REAL collisions (narrow-phase-confirmed OR AABB fallback). */
  flagged: InterferencePair[];
  /** ALL world-AABB overlaps (pre-filter), for transparency in the report. */
  rawOverlaps: InterferencePair[];
  /** Pair keys skipped because the two parts are joined by a mate. */
  whitelistedPairs: string[];
  /** Candidates confirmed as real collisions by the precise narrow phase. */
  confirmedPairs: ConfirmedPair[];
  /** Candidates CLEARED by the precise narrow phase (former AABB false positives). */
  clearedPairs: ClearedPair[];
  /** Candidates where the narrow phase could not run → AABB verdict retained. */
  fallbackPairs: FallbackPair[];
  contactTol: number;
  /** Part ids whose geometry AABB was unavailable (mesh failed upstream). */
  partsSkipped: string[];
  partsChecked: number;
  /** True when there was no converged solve to check (gate defers to assembly gate). */
  noSolve: boolean;
}

/**
 * Build the interference artifact from the SOLVED assembly placements:
 * broad-phase AABB candidates refined by the precise narrow phase.
 */
export function buildInterferenceArtifact(
  plan: DesignPlan,
  assembly: AssemblySolveArtifact | null,
  geometries: ReadonlyMap<string, PartGeometry>,
  contactTol: number = INTERFERENCE_CONTACT_TOL,
): InterferenceArtifact {
  const empty = (noSolve: boolean): InterferenceArtifact => ({
    flagged: [],
    rawOverlaps: [],
    whitelistedPairs: [],
    confirmedPairs: [],
    clearedPairs: [],
    fallbackPairs: [],
    contactTol,
    partsSkipped: [],
    partsChecked: 0,
    noSolve,
  });

  if (!plan.assembly || !assembly || !assembly.result || !assembly.result.converged) {
    return empty(true);
  }

  const state = assembly.result.state;

  // Whitelist every pair joined by a mate — intended mating contact.
  const whitelist = new Set<string>();
  for (const mate of plan.assembly.mates) {
    whitelist.add(pairKey(mate.a.partId, mate.b.partId));
  }

  // Lookups for the narrow phase: plan part + solved pose by id.
  const planParts = new Map<string, PlanPart>(plan.parts.map((p) => [p.partId, p]));
  const poses = new Map<string, PartInstance>(state.parts.map((p) => [p.id, p]));

  // PART-frame AABB per solved part (from the geometry build), keyed by part id.
  const localBoxes = new Map<string, AABB>();
  const partsSkipped: string[] = [];
  for (const part of state.parts) {
    const bb = geometries.get(part.id)?.bbox;
    if (!bb) {
      partsSkipped.push(part.id);
      continue;
    }
    localBoxes.set(part.id, {
      min: { x: bb.min[0], y: bb.min[1], z: bb.min[2] },
      max: { x: bb.max[0], y: bb.max[1], z: bb.max[2] },
    });
  }

  // ① BROAD phase — world-AABB overlap scan.
  const rawOverlaps = assemblyInterferences(state.parts, localBoxes);

  const flagged: InterferencePair[] = [];
  const confirmedPairs: ConfirmedPair[] = [];
  const clearedPairs: ClearedPair[] = [];
  const fallbackPairs: FallbackPair[] = [];
  const whitelistedHit = new Set<string>();

  for (const pair of rawOverlaps) {
    const key = pairKey(pair.partA, pair.partB);
    if (whitelist.has(key)) {
      whitelistedHit.add(key);
      continue; // mated — intended contact
    }
    if (pair.penetration <= contactTol) continue; // surface contact (착좌)

    // ② NARROW phase — precise refinement of this candidate.
    const pA = planParts.get(pair.partA);
    const pB = planParts.get(pair.partB);
    const gA = geometries.get(pair.partA);
    const gB = geometries.get(pair.partB);
    const poseA = poses.get(pair.partA);
    const poseB = poses.get(pair.partB);

    if (!pA || !pB || !gA || !gB || !poseA || !poseB) {
      // Plan/geometry/pose lookup broke — conservative fallback (keep flagged).
      flagged.push(pair);
      fallbackPairs.push({
        pair: key,
        aabbPenetrationMm: pair.penetration,
        reason: 'plan/geometry/pose lookup unavailable — AABB 근사 판정 유지',
      });
      continue;
    }

    const region: { min: Vec3; max: Vec3 } = {
      min: {
        x: Math.max(pair.bboxA.min.x, pair.bboxB.min.x),
        y: Math.max(pair.bboxA.min.y, pair.bboxB.min.y),
        z: Math.max(pair.bboxA.min.z, pair.bboxB.min.z),
      },
      max: {
        x: Math.min(pair.bboxA.max.x, pair.bboxB.max.x),
        y: Math.min(pair.bboxA.max.y, pair.bboxB.max.y),
        z: Math.min(pair.bboxA.max.z, pair.bboxB.max.z),
      },
    };

    const precise = preciseInterference(pA, gA, poseA, pB, gB, poseB, region);

    if (!precise.available) {
      // Unmeshable body — fall back to conservative AABB verdict (근사 명시).
      flagged.push(pair);
      fallbackPairs.push({
        pair: key,
        aabbPenetrationMm: pair.penetration,
        reason: precise.unavailableReason ?? '정밀 엔진 미실행 — AABB 근사 판정 유지',
      });
    } else if (precise.intersects) {
      flagged.push(pair);
      confirmedPairs.push({ pair: key, triPairs: precise.triPairsIntersecting, byContainment: precise.byContainment });
    } else {
      // Solids disjoint despite AABB overlap — clear the false positive.
      clearedPairs.push({ pair: key, aabbPenetrationMm: pair.penetration });
    }
  }

  return {
    flagged,
    rawOverlaps,
    whitelistedPairs: [...whitelistedHit].sort(),
    confirmedPairs,
    clearedPairs,
    fallbackPairs,
    contactTol,
    partsSkipped,
    partsChecked: localBoxes.size,
    noSolve: false,
  };
}

export function interferenceGate(
  plan: DesignPlan,
  artifact: InterferenceArtifact,
): GateResult {
  const notes: string[] = [
    '2단계 간섭: ① 광역=assemblyInterferences(src/lib/assembly/interference) 월드 AABB 겹침(후보) ' +
      '② 협역=preciseInterference(interferencePrecise) 테셀 솔리드 삼각형 교차(SAT)+포함 검사로 실제 관통만 flag. ' +
      'mate 연결 쌍은 화이트리스트(설계상 접촉). 접촉(관통≤contactTol)=허용.',
    'AABB는 보수적 후보 필터일 뿐 — 정밀 협역이 비-메이트 바운딩박스 겹침의 위양성(솔리드 미겹침)을 실측으로 제거. ' +
      '보고 penetration은 광역 AABB 관통(바운딩박스 근사, 라벨) — 협역은 관통 여부(boolean)+교차 삼각쌍 수를 실측 제공.',
  ];

  const flaggedByContainment = artifact.confirmedPairs.filter((c) => c.byContainment).length;
  const metrics: Record<string, number> = {
    partsChecked: artifact.partsChecked,
    partsSkipped: artifact.partsSkipped.length,
    rawOverlapPairs: artifact.rawOverlaps.length,
    matedPairsWhitelisted: artifact.whitelistedPairs.length,
    flaggedPairs: artifact.flagged.length,
    narrowPhaseConfirmed: artifact.confirmedPairs.length,
    narrowPhaseCleared: artifact.clearedPairs.length,
    aabbFallbackPairs: artifact.fallbackPairs.length,
    flaggedByContainment,
    contactTolMm: artifact.contactTol,
    maxPenetrationMm: artifact.flagged.reduce((m, p) => Math.max(m, p.penetration), 0),
  };

  if (artifact.noSolve) {
    notes.push('수렴된 해 배치 없음 — 간섭 검사 미실행(assembly 게이트가 수렴 실패를 판정).');
  }
  if (artifact.clearedPairs.length > 0) {
    const cd = artifact.clearedPairs
      .map((c) => `${c.pair}(AABB 관통 ${c.aabbPenetrationMm} mm)`)
      .join(', ');
    notes.push(`정밀 협역이 AABB 위양성 ${artifact.clearedPairs.length}쌍 제거(솔리드 실제 미겹침): ${cd}.`);
  }
  if (artifact.fallbackPairs.length > 0) {
    const fd = artifact.fallbackPairs
      .map((f) => `${f.pair}: ${f.reason}`)
      .join('; ');
    notes.push(`정밀 협역 미실행 → AABB 근사 판정으로 폴백(위양성 가능 명시) ${artifact.fallbackPairs.length}쌍: ${fd}.`);
  }

  if (artifact.flagged.length === 0) {
    return { id: 'interference', kind: 'interference', pass: true, metrics, notes };
  }

  const fallbackKeys = new Set(artifact.fallbackPairs.map((f) => f.pair));
  const detail = artifact.flagged
    .map((p) => {
      const key = pairKey(p.partA, p.partB);
      const basis = fallbackKeys.has(key) ? 'AABB 근사' : '정밀 협역 확정';
      return `${p.partA}↔${p.partB} 관통 ${p.penetration} mm(${basis})`;
    })
    .join(', ');
  return {
    id: 'interference',
    kind: 'interference',
    pass: false,
    metrics,
    reason: `비-메이트 부품 관통 ${artifact.flagged.length}쌍 (contactTol ${artifact.contactTol} mm): ${detail}`,
    notes,
  };
}
