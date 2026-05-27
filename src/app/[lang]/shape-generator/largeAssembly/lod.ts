/**
 * lod.ts — Level-of-detail policy for large-assembly rendering.
 *
 * A 10k-part assembly streams 10k full-resolution meshes by default;
 * that overwhelms the GPU. LOD swaps in lower-poly proxies for parts
 * far from the camera, so the frame budget is spent where the user
 * is actually looking.
 *
 * This module is the policy layer: given camera distance + a budget,
 * decide which LOD tier each part should render at. The actual
 * decimated meshes come from `meshSimplify` (already shipped) — we
 * just decide *when* to switch.
 *
 * LOD tiers:
 *   - 0 = full resolution (close-up, inspection)
 *   - 1 = ~50% triangles
 *   - 2 = ~25% triangles
 *   - 3 = ~10% triangles
 *   - 4 = imposter (single quad with the AABB silhouette)
 */

export type LodTier = 0 | 1 | 2 | 3 | 4;

export interface LodThresholds {
  /** Distance (world units) at or beyond which to bump to tier 1. */
  tier1At: number;
  tier2At: number;
  tier3At: number;
  /** Distance at which to render as imposter. */
  tier4At: number;
}

export const DEFAULT_THRESHOLDS: LodThresholds = {
  tier1At: 100,
  tier2At: 300,
  tier3At: 800,
  tier4At: 2000,
};

/** Pick a tier for a part at the given distance. Optional `partSize`
 *  scales the thresholds — a 1m wing of an aircraft assembly doesn't
 *  need the same distance to be considered "far" as a 5mm screw. */
export function pickLodTier(
  distance: number,
  thresholds: LodThresholds = DEFAULT_THRESHOLDS,
  partSize = 1,
): LodTier {
  const scale = Math.max(0.1, partSize);
  if (distance < thresholds.tier1At * scale) return 0;
  if (distance < thresholds.tier2At * scale) return 1;
  if (distance < thresholds.tier3At * scale) return 2;
  if (distance < thresholds.tier4At * scale) return 3;
  return 4;
}

/** Triangle-count multiplier for each tier — what fraction of the
 *  original mesh to keep. Imposter (tier 4) is "essentially zero". */
export function tierMultiplier(tier: LodTier): number {
  switch (tier) {
    case 0: return 1.0;
    case 1: return 0.5;
    case 2: return 0.25;
    case 3: return 0.1;
    case 4: return 0.02;
  }
}

/** Compute the target triangle budget for a part given its raw count
 *  and the assigned tier. */
export function targetTriangles(rawCount: number, tier: LodTier): number {
  return Math.max(8, Math.round(rawCount * tierMultiplier(tier)));
}

/** Bulk policy: assign a tier to every (id, distance, rawTriCount)
 *  entry, additionally clamping the global sum to a frame budget.
 *  Strategy: assign tiers by distance first, then if total triangles
 *  still exceed budget, walk back from the closest tier-0 parts and
 *  bump them up. */
export interface PartLodInput {
  id: string;
  distance: number;
  rawTriCount: number;
  /** Part bbox diagonal — drives the size scaling on thresholds. */
  size: number;
}

export interface PartLodAssignment {
  id: string;
  tier: LodTier;
  targetTris: number;
}

export interface LodBudgetOptions {
  thresholds?: LodThresholds;
  /** Hard limit on total target triangles across the whole assembly. */
  triangleBudget?: number;
}

export function assignLodTiers(
  parts: PartLodInput[],
  opts: LodBudgetOptions = {},
): PartLodAssignment[] {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const assignments: PartLodAssignment[] = parts.map(p => {
    const tier = pickLodTier(p.distance, thresholds, p.size);
    return { id: p.id, tier, targetTris: targetTriangles(p.rawTriCount, tier) };
  });

  const budget = opts.triangleBudget;
  if (typeof budget !== 'number' || budget <= 0) return assignments;

  // Sum + back-off loop.
  let total = assignments.reduce((s, a) => s + a.targetTris, 0);
  if (total <= budget) return assignments;

  // Sort by distance descending — bump the farthest tier-0 parts first.
  const idToDistance = new Map(parts.map(p => [p.id, p.distance]));
  const byDistance = [...assignments].sort((a, b) =>
    (idToDistance.get(b.id) ?? 0) - (idToDistance.get(a.id) ?? 0));

  for (const a of byDistance) {
    if (total <= budget) break;
    while (a.tier < 4 && total > budget) {
      const oldTris = a.targetTris;
      a.tier = (a.tier + 1) as LodTier;
      a.targetTris = targetTriangles(
        parts.find(p => p.id === a.id)!.rawTriCount,
        a.tier,
      );
      total -= oldTris - a.targetTris;
    }
  }
  return assignments;
}
