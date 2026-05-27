/**
 * restMachiningDetector.ts — Detect rest-material regions left by a
 * previous CAM operation, so a smaller cutter can clean them up.
 *
 * After a roughing pass with a Ø10 tool, every internal corner with
 * radius < 5 mm has uncut material. To finish the part, a Ø3 cutter
 * runs only in those corners — this is rest machining.
 *
 * Module:
 *   - Takes the result of a prior tool's reach (a 2D occupancy map
 *     of "machined" cells).
 *   - Compares to the part outline.
 *   - Returns connected regions of un-machined material → tool path
 *     seeds for the rest cutter.
 *
 * Output:
 *   - List of rest-regions with bounding box + area + recommended
 *     tool diameter (twice the inscribed-circle radius of the region).
 */

export type Cell = 0 | 1;  // 0 = part, 1 = machined

export interface OccupancyGrid {
  cellsX: number;
  cellsY: number;
  /** Cell pitch (mm). */
  pitchMm: number;
  /** Origin offset of cell (0,0). */
  origin: { x: number; y: number };
  /** Row-major cells. cells[y * cellsX + x] = 0 (uncut/part) or 1 (already machined). */
  cells: Cell[];
}

export interface RestRegion {
  id: number;
  /** AABB in mm. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Total cells. */
  cellCount: number;
  /** Area, mm². */
  areaMm2: number;
  /** Largest inscribed-circle radius (mm) — proxy for recommended cutter radius. */
  inscribedRadiusMm: number;
  recommendedToolDiameterMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function detectRestMaterial(grid: OccupancyGrid): RestRegion[] {
  const { cellsX, cellsY, pitchMm, cells, origin } = grid;
  const visited = new Uint8Array(cellsX * cellsY);
  const regions: RestRegion[] = [];
  let regionId = 0;
  for (let y = 0; y < cellsY; y++) {
    for (let x = 0; x < cellsX; x++) {
      const idx = y * cellsX + x;
      if (cells[idx] === 0 && !visited[idx]) {
        const cluster = flood(grid, x, y, visited);
        const region = buildRegion(regionId++, cluster, pitchMm, origin);
        regions.push(region);
      }
    }
  }
  return regions;
}

function flood(grid: OccupancyGrid, startX: number, startY: number, visited: Uint8Array): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const stack: { x: number; y: number }[] = [{ x: startX, y: startY }];
  const { cellsX, cellsY, cells } = grid;
  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    if (x < 0 || x >= cellsX || y < 0 || y >= cellsY) continue;
    const idx = y * cellsX + x;
    if (visited[idx]) continue;
    if (cells[idx] !== 0) continue;
    visited[idx] = 1;
    out.push({ x, y });
    stack.push({ x: x + 1, y });
    stack.push({ x: x - 1, y });
    stack.push({ x, y: y + 1 });
    stack.push({ x, y: y - 1 });
  }
  return out;
}

function buildRegion(
  id: number,
  cluster: { x: number; y: number }[],
  pitchMm: number,
  origin: { x: number; y: number },
): RestRegion {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cluster) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  // Inscribed circle radius approximated by half the smallest bbox dimension.
  const widthCells = maxX - minX + 1;
  const heightCells = maxY - minY + 1;
  const inscribedRadius = Math.min(widthCells, heightCells) / 2 * pitchMm;
  return {
    id,
    bbox: {
      minX: origin.x + minX * pitchMm,
      minY: origin.y + minY * pitchMm,
      maxX: origin.x + (maxX + 1) * pitchMm,
      maxY: origin.y + (maxY + 1) * pitchMm,
    },
    cellCount: cluster.length,
    areaMm2: cluster.length * pitchMm * pitchMm,
    inscribedRadiusMm: inscribedRadius,
    recommendedToolDiameterMm: inscribedRadius * 2 * 0.9,
  };
}

// ── Filter trivial regions ────────────────────────────────────

export function filterRegions(regions: RestRegion[], minAreaMm2: number): RestRegion[] {
  return regions.filter(r => r.areaMm2 >= minAreaMm2);
}

// ── Compute total uncut area vs total part area ───────────────

export function computeUncutFraction(grid: OccupancyGrid): number {
  let uncut = 0;
  for (const c of grid.cells) {
    if (c === 0) uncut++;
  }
  return uncut / grid.cells.length;
}

// ── Summary ────────────────────────────────────────────────────

export interface RestSummary {
  regionCount: number;
  totalUncutAreaMm2: number;
  smallestRecommendedToolMm: number;
  largestRegionAreaMm2: number;
}

export function summarize(regions: RestRegion[]): RestSummary {
  let totalArea = 0;
  let smallestTool = Infinity;
  let largest = 0;
  for (const r of regions) {
    totalArea += r.areaMm2;
    if (r.recommendedToolDiameterMm < smallestTool) smallestTool = r.recommendedToolDiameterMm;
    if (r.areaMm2 > largest) largest = r.areaMm2;
  }
  return {
    regionCount: regions.length,
    totalUncutAreaMm2: totalArea,
    smallestRecommendedToolMm: regions.length === 0 ? Infinity : smallestTool,
    largestRegionAreaMm2: largest,
  };
}
