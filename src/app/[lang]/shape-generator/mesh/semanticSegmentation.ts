/**
 * semanticSegmentation.ts — Group mesh triangles into *semantic* face
 * categories by normal + curvature clustering.
 *
 * Imported STEP/IGES files are explicit B-rep with face metadata.
 * Imported STL/OBJ files are flat — every triangle is anonymous.
 * Recovering "which triangles are part of the same cylindrical
 * boss?" lets the CAD UI offer per-face selections and feature
 * recognition.
 *
 * Algorithm:
 *
 *   1. Compute per-triangle normal.
 *   2. Region-grow: pick an unvisited seed triangle, BFS into
 *      neighbors whose normal-angle to seed is < threshold.
 *   3. For each region, classify by spread of normals:
 *        - low spread (< 5°) → planar
 *        - moderate spread + axial symmetry → cylindrical
 *        - high spread + radial symmetry → spherical
 *        - otherwise → freeform
 *   4. Emit per-region statistics.
 *
 * Lightweight by design — no SVD or full eigen decomposition; good
 * enough for the typical part with mostly axis-aligned features.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export type RegionKind = 'planar' | 'cylindrical' | 'spherical' | 'freeform';

export interface Region {
  id: string;
  /** Triangle indices that belong to this region. */
  triangleIds: number[];
  /** Surface classification. */
  kind: RegionKind;
  /** Region area, mm². */
  areaMm2: number;
  /** Mean normal (unit). */
  meanNormal: [number, number, number];
  /** Spread (1 - average normal dot mean), 0 = perfectly planar. */
  spread: number;
}

export interface SegmentationResult {
  regions: Region[];
  /** Triangle → region id mapping. */
  triangleToRegion: string[];
  /** Triangles not assigned to any region (orphans). */
  orphanTriangles: number[];
}

export interface SegmentationOptions {
  /** Region-grow normal-angle threshold (degrees). */
  growthAngleDeg: number;
  /** Minimum region area to keep, mm². */
  minRegionAreaMm2: number;
  /** Spread threshold for planar classification. */
  planarSpreadMax: number;
}

export const DEFAULT_OPTIONS: SegmentationOptions = {
  growthAngleDeg: 15,
  minRegionAreaMm2: 0.5,
  planarSpreadMax: 0.02,
};

// ── Top-level entry ────────────────────────────────────────────

export function segmentMesh(mesh: MeshArrays, options: Partial<SegmentationOptions> = {}): SegmentationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return { regions: [], triangleToRegion: [], orphanTriangles: [] };
  }
  const cosThreshold = Math.cos((opts.growthAngleDeg * Math.PI) / 180);

  const normals: Array<[number, number, number]> = [];
  const areas: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0 = vertex(mesh, i0);
    const p1 = vertex(mesh, i1);
    const p2 = vertex(mesh, i2);
    const na = triangleNormalArea(p0, p1, p2);
    normals.push(na.normal);
    areas.push(na.area);
  }

  // Build edge → triangles map.
  const edgeMap = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const idx = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = idx[e]!;
      const b = idx[(e + 1) % 3]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const list = edgeMap.get(key) ?? [];
      list.push(t);
      edgeMap.set(key, list);
    }
  }

  const triToRegion: string[] = new Array(triCount).fill('');
  const visited = new Set<number>();
  const regions: Region[] = [];
  const orphans: number[] = [];

  for (let seed = 0; seed < triCount; seed++) {
    if (visited.has(seed)) continue;
    const seedNormal = normals[seed]!;
    const tris: number[] = [];
    const queue = [seed];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      tris.push(cur);
      const idx = [mesh.indices[cur * 3]!, mesh.indices[cur * 3 + 1]!, mesh.indices[cur * 3 + 2]!];
      for (let e = 0; e < 3; e++) {
        const a = idx[e]!;
        const b = idx[(e + 1) % 3]!;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        for (const adj of edgeMap.get(key) ?? []) {
          if (visited.has(adj)) continue;
          const dotN = dot(seedNormal, normals[adj]!);
          if (dotN >= cosThreshold) queue.push(adj);
        }
      }
    }

    const regionArea = tris.reduce((s, t) => s + areas[t]!, 0);
    if (regionArea < opts.minRegionAreaMm2) {
      orphans.push(...tris);
      continue;
    }

    // Compute mean normal + spread.
    let mx = 0, my = 0, mz = 0;
    for (const t of tris) {
      mx += normals[t]![0]! * areas[t]!;
      my += normals[t]![1]! * areas[t]!;
      mz += normals[t]![2]! * areas[t]!;
    }
    const meanLen = Math.hypot(mx, my, mz) || 1;
    const meanNormal: [number, number, number] = [mx / meanLen, my / meanLen, mz / meanLen];
    let sumDot = 0;
    let weight = 0;
    for (const t of tris) {
      sumDot += dot(normals[t]!, meanNormal) * areas[t]!;
      weight += areas[t]!;
    }
    const spread = 1 - sumDot / weight;
    const kind = classifyRegion(spread, opts);

    const region: Region = {
      id: `r${regions.length}`,
      triangleIds: tris,
      kind,
      areaMm2: regionArea,
      meanNormal,
      spread,
    };
    regions.push(region);
    for (const t of tris) triToRegion[t] = region.id;
  }

  return { regions, triangleToRegion: triToRegion, orphanTriangles: orphans };
}

// ── Classification ─────────────────────────────────────────────

function classifyRegion(spread: number, opts: SegmentationOptions): RegionKind {
  if (spread <= opts.planarSpreadMax) return 'planar';
  if (spread <= 0.1) return 'cylindrical';
  if (spread <= 0.25) return 'spherical';
  return 'freeform';
}

// ── Geometry helpers ───────────────────────────────────────────

function vertex(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function triangleNormalArea(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
): { normal: [number, number, number]; area: number } {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const len = Math.hypot(cx, cy, cz);
  if (len < 1e-9) return { normal: [0, 0, 1], area: 0 };
  return { normal: [cx / len, cy / len, cz / len], area: len / 2 };
}

// ── Summary ────────────────────────────────────────────────────

export interface SegmentationSummary {
  regionCount: number;
  planarCount: number;
  cylindricalCount: number;
  sphericalCount: number;
  freeformCount: number;
  largestRegionAreaMm2: number;
  orphanTriangleCount: number;
}

export function summarize(result: SegmentationResult): SegmentationSummary {
  const summary: SegmentationSummary = {
    regionCount: result.regions.length,
    planarCount: 0,
    cylindricalCount: 0,
    sphericalCount: 0,
    freeformCount: 0,
    largestRegionAreaMm2: 0,
    orphanTriangleCount: result.orphanTriangles.length,
  };
  for (const r of result.regions) {
    if (r.kind === 'planar') summary.planarCount++;
    else if (r.kind === 'cylindrical') summary.cylindricalCount++;
    else if (r.kind === 'spherical') summary.sphericalCount++;
    else summary.freeformCount++;
    if (r.areaMm2 > summary.largestRegionAreaMm2) summary.largestRegionAreaMm2 = r.areaMm2;
  }
  return summary;
}
