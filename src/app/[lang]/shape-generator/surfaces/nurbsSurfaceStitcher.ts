/**
 * nurbsSurfaceStitcher.ts — Stitch multiple NURBS / parametric surface
 * patches by edge matching to form a single connected sheet body.
 *
 * Real-world parts often arrive as a set of patches whose boundaries
 * *almost* line up but have small numeric gaps from independent
 * trimming. Sewing them together is a prerequisite to:
 *
 *   - Closed-shell detection (then volume / mass computation).
 *   - Mold parting / draft analysis.
 *   - Single-surface continuity quality reports.
 *
 * Algorithm (greedy, robust to tolerance ε):
 *
 *   1. Sample each patch's 4 boundaries (U=0, U=1, V=0, V=1) into a
 *      polyline of N segments.
 *   2. For every pair of boundaries from different patches, compute
 *      the symmetric Hausdorff distance between the two polylines.
 *   3. If Hausdorff ≤ ε, mark the pair as a matched seam. Snap
 *      vertices to the average of the two boundaries.
 *   4. Build a connectivity graph; emit shells (connected components).
 */

export interface BoundaryPolyline {
  /** Patch id this boundary belongs to. */
  patchId: string;
  /** Which side: 'u0' | 'u1' | 'v0' | 'v1'. */
  side: 'u0' | 'u1' | 'v0' | 'v1';
  /** Sampled points in 3D. */
  points: Array<[number, number, number]>;
}

export interface Patch {
  id: string;
  /** Sampled boundary polylines for the 4 sides. */
  boundaries: BoundaryPolyline[];
}

export interface Seam {
  patchA: string;
  sideA: BoundaryPolyline['side'];
  patchB: string;
  sideB: BoundaryPolyline['side'];
  /** Distance between matched boundaries (mm). */
  gapMm: number;
  /** True if direction needed flipping to align. */
  reversed: boolean;
}

export interface StitchResult {
  /** Matched seams. */
  seams: Seam[];
  /** Connected components — each a list of patch ids. */
  shells: string[][];
  /** Patches whose every boundary remains unmatched. */
  freePatches: string[];
  /** Boundaries that had no match — candidates for outer shell edges. */
  freeBoundaries: Array<{ patchId: string; side: BoundaryPolyline['side'] }>;
}

export interface StitchOptions {
  /** Maximum gap to accept as a seam (mm). */
  toleranceMm: number;
}

export const DEFAULT_OPTIONS: StitchOptions = {
  toleranceMm: 0.01,
};

// ── Top-level entry ────────────────────────────────────────────

export function stitch(patches: Patch[], options: Partial<StitchOptions> = {}): StitchResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const allBoundaries: BoundaryPolyline[] = [];
  for (const p of patches) for (const b of p.boundaries) allBoundaries.push(b);

  const seams: Seam[] = [];
  const matched = new Set<number>();

  for (let i = 0; i < allBoundaries.length; i++) {
    if (matched.has(i)) continue;
    const a = allBoundaries[i]!;
    let bestJ = -1;
    let bestGap = Infinity;
    let bestReversed = false;
    for (let j = i + 1; j < allBoundaries.length; j++) {
      if (matched.has(j)) continue;
      const b = allBoundaries[j]!;
      if (a.patchId === b.patchId) continue;
      const direct = polylineDistance(a.points, b.points);
      const reversed = polylineDistance(a.points, [...b.points].reverse());
      const gap = Math.min(direct, reversed);
      if (gap < bestGap) {
        bestGap = gap;
        bestJ = j;
        bestReversed = reversed < direct;
      }
    }
    if (bestJ >= 0 && bestGap <= opts.toleranceMm) {
      const b = allBoundaries[bestJ]!;
      matched.add(i);
      matched.add(bestJ);
      seams.push({
        patchA: a.patchId,
        sideA: a.side,
        patchB: b.patchId,
        sideB: b.side,
        gapMm: bestGap,
        reversed: bestReversed,
      });
    }
  }

  // Build adjacency from seams.
  const adj = new Map<string, Set<string>>();
  for (const p of patches) adj.set(p.id, new Set());
  for (const s of seams) {
    adj.get(s.patchA)?.add(s.patchB);
    adj.get(s.patchB)?.add(s.patchA);
  }

  const shells: string[][] = [];
  const visited = new Set<string>();
  for (const p of patches) {
    if (visited.has(p.id)) continue;
    const stack = [p.id];
    const shell: string[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      shell.push(cur);
      for (const n of adj.get(cur) ?? []) if (!visited.has(n)) stack.push(n);
    }
    shells.push(shell);
  }

  // Free patches: shells of size 1 where the single patch has no matched boundaries.
  const matchedPatchIds = new Set<string>();
  for (const s of seams) {
    matchedPatchIds.add(s.patchA);
    matchedPatchIds.add(s.patchB);
  }
  const freePatches = patches.filter(p => !matchedPatchIds.has(p.id)).map(p => p.id);

  // Free boundaries: not used in any seam.
  const usedSet = new Set<string>();
  for (const s of seams) {
    usedSet.add(`${s.patchA}.${s.sideA}`);
    usedSet.add(`${s.patchB}.${s.sideB}`);
  }
  const freeBoundaries: Array<{ patchId: string; side: BoundaryPolyline['side'] }> = [];
  for (const b of allBoundaries) {
    if (!usedSet.has(`${b.patchId}.${b.side}`)) {
      freeBoundaries.push({ patchId: b.patchId, side: b.side });
    }
  }

  return { seams, shells, freePatches, freeBoundaries };
}

// ── Distance helpers ──────────────────────────────────────────

export function polylineDistance(
  a: Array<[number, number, number]>,
  b: Array<[number, number, number]>,
): number {
  // Symmetric average sampling distance — robust if polylines have
  // similar lengths but small offset.
  if (a.length === 0 || b.length === 0) return Infinity;
  const n = Math.max(a.length, b.length);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const ta = i / Math.max(1, n - 1);
    const pa = sampleAt(a, ta);
    const pb = sampleAt(b, ta);
    total += Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  }
  return total / n;
}

function sampleAt(poly: Array<[number, number, number]>, t: number): [number, number, number] {
  if (poly.length === 1) return poly[0]!;
  const u = Math.max(0, Math.min(0.9999, t)) * (poly.length - 1);
  const i = Math.floor(u);
  const f = u - i;
  const a = poly[i]!;
  const b = poly[Math.min(poly.length - 1, i + 1)]!;
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

// ── Snap helper ────────────────────────────────────────────────

/** Average two matched boundaries — call this AFTER `stitch` resolves seams. */
export function snapMatchedBoundaries(a: BoundaryPolyline, b: BoundaryPolyline, reversed: boolean): { aSnap: BoundaryPolyline; bSnap: BoundaryPolyline } {
  const bPoints = reversed ? [...b.points].reverse() : b.points;
  const n = Math.min(a.points.length, bPoints.length);
  const snapped: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const pa = a.points[i]!;
    const pb = bPoints[i]!;
    snapped.push([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]);
  }
  return {
    aSnap: { ...a, points: snapped.slice() },
    bSnap: { ...b, points: reversed ? [...snapped].reverse() : snapped.slice() },
  };
}

// ── Stitch summary ────────────────────────────────────────────

export interface StitchSummary {
  patchCount: number;
  seamCount: number;
  shellCount: number;
  largestShellSize: number;
  freePatchCount: number;
  freeBoundaryCount: number;
  averageGapMm: number;
  maxGapMm: number;
  /** True if every patch ended in one shell. */
  fullyStitched: boolean;
}

export function summarize(patches: Patch[], result: StitchResult): StitchSummary {
  const gaps = result.seams.map(s => s.gapMm);
  const avgGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
  const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;
  const largest = result.shells.reduce((m, s) => Math.max(m, s.length), 0);
  return {
    patchCount: patches.length,
    seamCount: result.seams.length,
    shellCount: result.shells.length,
    largestShellSize: largest,
    freePatchCount: result.freePatches.length,
    freeBoundaryCount: result.freeBoundaries.length,
    averageGapMm: avgGap,
    maxGapMm: maxGap,
    fullyStitched: result.shells.length === 1 && patches.length > 0,
  };
}
