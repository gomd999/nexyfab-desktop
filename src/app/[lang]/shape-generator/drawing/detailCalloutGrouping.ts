/**
 * detailCalloutGrouping.ts — Group nearby detail-view callouts on a
 * drawing so they share a single detail bubble + label.
 *
 * On a complex drawing, a user often places several DETAIL A
 * callouts at features that sit within one visual cluster. Standard
 * practice: collapse them into one larger detail view rather than
 * scatter many small bubbles. The module:
 *
 *   - Clusters callouts by proximity (DBSCAN-style).
 *   - For each cluster, picks a representative bubble + magnification.
 *   - Suggests a label (A, B, C…).
 *   - Emits warnings if clusters overlap or get too large.
 *
 * Used inside the drawing route to auto-suggest detail-view groupings.
 */

export interface Callout {
  id: string;
  /** Centre point on the drawing (mm). */
  point: { x: number; y: number };
  /** Bubble radius (mm). */
  radiusMm: number;
  /** Feature it points to. */
  featureId?: string;
  /** Currently assigned detail label, if any. */
  label?: string;
}

export interface GroupOptions {
  /** Cluster radius (mm): callouts closer than this are grouped. */
  clusterRadiusMm: number;
  /** Maximum number of callouts in one cluster (warning above this). */
  maxClusterSize: number;
  /** Magnification factor for the new detail view. */
  defaultMagnification: number;
}

export const DEFAULT_OPTIONS: GroupOptions = {
  clusterRadiusMm: 30,
  maxClusterSize: 8,
  defaultMagnification: 2,
};

export interface CalloutGroup {
  label: string;
  callouts: Callout[];
  centre: { x: number; y: number };
  enclosingRadiusMm: number;
  magnification: number;
  warning?: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function groupCallouts(
  callouts: Callout[],
  options: Partial<GroupOptions> = {},
): CalloutGroup[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const clusters = clusterByProximity(callouts, opts.clusterRadiusMm);
  return clusters.map((cluster, idx) => buildGroup(cluster, idx, opts));
}

// ── Clustering ────────────────────────────────────────────────

function clusterByProximity(callouts: Callout[], radius: number): Callout[][] {
  const remaining = new Set(callouts);
  const clusters: Callout[][] = [];
  for (const seed of callouts) {
    if (!remaining.has(seed)) continue;
    const cluster: Callout[] = [seed];
    remaining.delete(seed);
    const queue: Callout[] = [seed];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const other of Array.from(remaining)) {
        if (distance(current.point, other.point) <= radius) {
          cluster.push(other);
          remaining.delete(other);
          queue.push(other);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Group construction ────────────────────────────────────────

function buildGroup(cluster: Callout[], idx: number, opts: GroupOptions): CalloutGroup {
  const centre = centroid(cluster);
  const enclosing = cluster.reduce(
    (max, c) => Math.max(max, distance(centre, c.point) + c.radiusMm),
    0,
  );
  const label = indexToLabel(idx);
  const group: CalloutGroup = {
    label,
    callouts: cluster,
    centre,
    enclosingRadiusMm: enclosing,
    magnification: opts.defaultMagnification,
  };
  if (cluster.length > opts.maxClusterSize) {
    group.warning = `Cluster ${label} has ${cluster.length} callouts (max ${opts.maxClusterSize}). Consider splitting.`;
  }
  return group;
}

function centroid(cluster: Callout[]): { x: number; y: number } {
  if (cluster.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const c of cluster) {
    sx += c.point.x;
    sy += c.point.y;
  }
  return { x: sx / cluster.length, y: sy / cluster.length };
}

function indexToLabel(idx: number): string {
  // 0 → A, 25 → Z, 26 → AA, etc.
  const letters: string[] = [];
  let n = idx;
  do {
    letters.unshift(String.fromCharCode(65 + (n % 26)));
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters.join('');
}

// ── Overlap detection ─────────────────────────────────────────

export interface GroupOverlap {
  groupA: string;
  groupB: string;
  overlapMm: number;
}

export function findGroupOverlaps(groups: CalloutGroup[]): GroupOverlap[] {
  const overlaps: GroupOverlap[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]!;
      const b = groups[j]!;
      const d = distance(a.centre, b.centre);
      const reqClearance = a.enclosingRadiusMm + b.enclosingRadiusMm;
      if (d < reqClearance) {
        overlaps.push({ groupA: a.label, groupB: b.label, overlapMm: reqClearance - d });
      }
    }
  }
  return overlaps;
}

// ── Apply labels ──────────────────────────────────────────────

export function applyLabels(groups: CalloutGroup[]): void {
  for (const group of groups) {
    for (const c of group.callouts) {
      c.label = group.label;
    }
  }
}

// ── Summary ────────────────────────────────────────────────────

export interface GroupSummary {
  groupCount: number;
  totalCallouts: number;
  largestGroupSize: number;
  warningCount: number;
}

export function summarize(groups: CalloutGroup[]): GroupSummary {
  let total = 0;
  let largest = 0;
  let warnings = 0;
  for (const g of groups) {
    total += g.callouts.length;
    if (g.callouts.length > largest) largest = g.callouts.length;
    if (g.warning) warnings++;
  }
  return {
    groupCount: groups.length,
    totalCallouts: total,
    largestGroupSize: largest,
    warningCount: warnings,
  };
}
