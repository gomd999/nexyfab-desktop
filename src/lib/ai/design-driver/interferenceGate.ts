/**
 * design-driver/interferenceGate — WB-4: promote interference detection to a
 * standard assembly gate. Closes the AI_COVERAGE_MATRIX ⑧ boundary
 * ("간섭 게이트 미포함 → 부품 관통도 통과 가능").
 *
 * Consumes (수정 없음):
 *   - `assemblyInterferences` + `transformAabb` (src/lib/assembly/interference)
 *     — the existing AABB interference engine (Phase 3.4). It rotates each
 *     part's LOCAL AABB into the world frame using the solved placement and
 *     reports pairwise world-AABB overlaps with a penetration depth.
 *   - the SOLVED assembly state from `solvePlanAssembly` (assemblyGate) — the
 *     placements the mate solver actually converged to (실측 배치, 날조 아님).
 *   - each part's PART-frame AABB from `buildPartGeometry` (geometryGate).
 *
 * 판정 기준 (접촉 vs 관통):
 *   - Two parts CONTACT when their world AABBs touch or interpenetrate by
 *     ≤ `contactTol` on the shallowest axis → allowed (착좌/면 접촉).
 *   - Two parts INTERFERE (fail) when their world AABBs interpenetrate by
 *     > `contactTol` → 관통.
 *   - MATED pairs (any pair joined by a plan mate — concentric / coincident /
 *     …) are WHITELISTED: a mate's whole purpose is design-intended contact
 *     (a pin concentric in a boss shares the boss's AABB by construction),
 *     and a bounding box cannot separate intended mating contact from a
 *     collision. This is the documented use of the interference engine's
 *     `whitelist` ("mate-mated parts often touch by design"). The gate
 *     therefore verifies that parts NOT joined by a mate do not collide.
 *
 * 근사 (명시):
 *   - AABB is a CONSERVATIVE proxy: it can raise a FALSE positive when two
 *     non-mated bounding boxes overlap while the solids do not (e.g. an
 *     L-shaped part cradling another). It never MISSES a true solid overlap
 *     of non-mated parts within its own scope. Exact BRep intersection is
 *     interference.ts Phase 3.4.2 (not wired here).
 *   - The gate runs ONLY on a converged solve (실행한 배치만 판정). When the
 *     solver did not converge the assembly gate already refuses the plan.
 */

import {
  assemblyInterferences,
  type AABB,
  type InterferencePair,
} from '@/lib/assembly/interference';
import type { AssemblySolveArtifact } from './assemblyGate';
import type { PartGeometry } from './geometryGate';
import type { DesignPlan, GateResult } from './types';

/**
 * Penetration (mm) at or below which a world-AABB overlap counts as surface
 * contact (착좌), not a collision. Sized to absorb the mate solver's residual
 * (default convergence tolerance 1e-6 mm) so a seated face that converged to
 * within tolerance is not mis-flagged as interference.
 */
export const INTERFERENCE_CONTACT_TOL = 1e-6;

/** Alphabetically-sorted pair key, matching interference.ts whitelist keys. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export interface InterferenceArtifact {
  /** Overlaps that survive whitelist + contact-tol filtering — real collisions. */
  flagged: InterferencePair[];
  /** ALL world-AABB overlaps (pre-filter), for transparency in the report. */
  rawOverlaps: InterferencePair[];
  /** Pair keys skipped because the two parts are joined by a mate. */
  whitelistedPairs: string[];
  contactTol: number;
  /** Part ids whose geometry AABB was unavailable (mesh failed upstream). */
  partsSkipped: string[];
  partsChecked: number;
  /** True when there was no converged solve to check (gate defers to assembly gate). */
  noSolve: boolean;
}

/**
 * Build the interference artifact from the SOLVED assembly placements.
 * `assembly` is the artifact produced by `solvePlanAssembly`; when it carries
 * no converged result the artifact is `noSolve` (the assembly gate owns that
 * failure — we do not fabricate an interference verdict on a garbage pose).
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

  // PART-frame AABB per solved part (from the geometry build), keyed by part id.
  const localBoxes = new Map<string, AABB>();
  const partsSkipped: string[] = [];
  for (const part of state.parts) {
    const geo = geometries.get(part.id);
    const bb = geo?.bbox;
    if (!bb) {
      partsSkipped.push(part.id);
      continue;
    }
    localBoxes.set(part.id, {
      min: { x: bb.min[0], y: bb.min[1], z: bb.min[2] },
      max: { x: bb.max[0], y: bb.max[1], z: bb.max[2] },
    });
  }

  // World-AABB overlap scan (interference.ts rotates local→world via the pose).
  const rawOverlaps = assemblyInterferences(state.parts, localBoxes);

  const flagged: InterferencePair[] = [];
  const whitelistedHit = new Set<string>();
  for (const pair of rawOverlaps) {
    const key = pairKey(pair.partA, pair.partB);
    if (whitelist.has(key)) {
      whitelistedHit.add(key);
      continue; // mated — intended contact
    }
    if (pair.penetration <= contactTol) continue; // surface contact (착좌)
    flagged.push(pair);
  }

  return {
    flagged,
    rawOverlaps,
    whitelistedPairs: [...whitelistedHit].sort(),
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
    'assemblyInterferences(src/lib/assembly/interference) 소비 — 해 배치의 부품 월드 AABB 쌍 관통 실측. ' +
      '접촉(관통≤contactTol)=허용·관통(>contactTol)=fail. mate로 연결된 쌍은 화이트리스트(설계상 접촉).',
    'AABB 근사(보수적): 비-메이트 쌍의 실제 솔리드 미겹침에도 바운딩박스 겹침 시 위양성 가능 — 정밀 BRep 교차는 interference.ts Phase 3.4.2(미배선).',
  ];

  const metrics: Record<string, number> = {
    partsChecked: artifact.partsChecked,
    partsSkipped: artifact.partsSkipped.length,
    rawOverlapPairs: artifact.rawOverlaps.length,
    matedPairsWhitelisted: artifact.whitelistedPairs.length,
    flaggedPairs: artifact.flagged.length,
    contactTolMm: artifact.contactTol,
    maxPenetrationMm: artifact.flagged.reduce((m, p) => Math.max(m, p.penetration), 0),
  };

  if (artifact.noSolve) {
    notes.push('수렴된 해 배치 없음 — 간섭 검사 미실행(assembly 게이트가 수렴 실패를 판정).');
  }

  if (artifact.flagged.length === 0) {
    return { id: 'interference', kind: 'interference', pass: true, metrics, notes };
  }

  const detail = artifact.flagged
    .map((p) => `${p.partA}↔${p.partB} 관통 ${p.penetration} mm`)
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
