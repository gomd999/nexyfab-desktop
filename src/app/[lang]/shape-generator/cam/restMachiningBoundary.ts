/**
 * restMachiningBoundary.ts — Generate the boundary curve enclosing
 * material left over after a roughing tool's pass, ready for a smaller
 * tool to clean up.
 *
 * Concept: previous tool R_prev cleared everything except concave
 * features it couldn't fit into (radii < R_prev). A smaller tool
 * R_next is needed where the local concave radius < R_prev. The rest
 * boundary is the locus of points where the *medial-axis radius* of
 * the part profile drops below R_prev.
 *
 * Simplified 2-D model: given a profile polygon and a sample grid,
 * mark grid cells where the inscribed disk of radius R_prev cannot fit,
 * then return the boundary of the marked region.
 */

export interface Point2D { x: number; y: number }
export type Profile = Point2D[]; // closed polygon

export interface RestBoundaryInput {
  profile: Profile;
  previousToolRadiusMm: number;
  gridStepMm?: number; // default 1.0
}

export interface RestBoundaryResult {
  restRegions: Profile[];
  totalRestAreaMm2: number;
  cellsMarkedCount: number;
  warnings: string[];
}

export function generateBoundary(input: RestBoundaryInput): RestBoundaryResult {
  const warnings: string[] = [];
  if (input.profile.length < 3) warnings.push('Profile must have at least 3 points.');
  if (input.previousToolRadiusMm <= 0) warnings.push('Previous tool radius must be positive.');

  const grid = input.gridStepMm ?? 1.0;
  const bounds = computeBounds(input.profile);
  const cells: { x: number; y: number; marked: boolean }[] = [];
  const Rprev = input.previousToolRadiusMm;

  let count = 0;
  for (let y = bounds.minY + grid / 2; y <= bounds.maxY; y += grid) {
    for (let x = bounds.minX + grid / 2; x <= bounds.maxX; x += grid) {
      if (!pointInPolygon({ x, y }, input.profile)) continue;
      const r = distanceToBoundary({ x, y }, input.profile);
      const marked = r < Rprev; // tool can't reach this cell
      cells.push({ x, y, marked });
      if (marked) count++;
    }
  }

  // Group marked cells into connected regions and emit simple bbox outlines per region.
  const regions = clusterMarked(cells.filter(c => c.marked), grid);
  const totalArea = count * grid * grid;

  return {
    restRegions: regions,
    totalRestAreaMm2: totalArea,
    cellsMarkedCount: count,
    warnings,
  };
}

function computeBounds(profile: Profile) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of profile) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(p: Point2D, polygon: Profile): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    if (((pi.y > p.y) !== (pj.y > p.y))
      && (p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y + 1e-12) + pi.x)) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToBoundary(p: Point2D, profile: Profile): number {
  let best = Infinity;
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i]!;
    const b = profile[(i + 1) % profile.length]!;
    best = Math.min(best, distanceToSegment(p, a, b));
  }
  return best;
}

function distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const px = a.x + t * abx;
  const py = a.y + t * aby;
  return Math.hypot(p.x - px, p.y - py);
}

function clusterMarked(marked: { x: number; y: number }[], grid: number): Profile[] {
  if (marked.length === 0) return [];
  // Single cluster — emit bbox; multi-cluster connectivity is a follow-up.
  // For now, just return one polygon hull per disjoint group via simple grid flood.
  const cellKey = (p: { x: number; y: number }) => `${Math.round(p.x / grid)},${Math.round(p.y / grid)}`;
  const set = new Map<string, { x: number; y: number }>();
  for (const m of marked) set.set(cellKey(m), m);

  const visited = new Set<string>();
  const regions: Profile[] = [];
  for (const m of marked) {
    const k = cellKey(m);
    if (visited.has(k)) continue;
    const stack = [m];
    const group: { x: number; y: number }[] = [];
    while (stack.length > 0) {
      const c = stack.pop()!;
      const ck = cellKey(c);
      if (visited.has(ck)) continue;
      visited.add(ck);
      group.push(c);
      for (const [dx, dy] of [[grid, 0], [-grid, 0], [0, grid], [0, -grid]]) {
        const nb = { x: c.x + dx!, y: c.y + dy! };
        const nk = cellKey(nb);
        if (set.has(nk) && !visited.has(nk)) stack.push(set.get(nk)!);
      }
    }
    if (group.length > 0) {
      regions.push(boundingBoxPolygon(group, grid));
    }
  }
  return regions;
}

function boundingBoxPolygon(pts: { x: number; y: number }[], grid: number): Profile {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const half = grid / 2;
  return [
    { x: minX - half, y: minY - half },
    { x: maxX + half, y: minY - half },
    { x: maxX + half, y: maxY + half },
    { x: minX - half, y: maxY + half },
  ];
}

export function recommendNextToolRadius(result: RestBoundaryResult, previousRadius: number): number {
  if (result.restRegions.length === 0) return previousRadius;
  // Half the previous radius until we have something specific (medial-axis solver follow-up).
  return previousRadius / 2;
}

export function summarize(r: RestBoundaryResult): { regionCount: number; totalRestAreaMm2: number; cellsMarked: number } {
  return { regionCount: r.restRegions.length, totalRestAreaMm2: r.totalRestAreaMm2, cellsMarked: r.cellsMarkedCount };
}
