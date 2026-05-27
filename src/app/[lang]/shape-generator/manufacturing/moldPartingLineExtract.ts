/**
 * moldPartingLineExtract.ts — Extract the parting line of an injection-mold
 * part from a triangle mesh + pull direction.
 *
 * Definition: the parting line is the boundary between the *cavity-side*
 * faces (those visible from +pullAxis) and the *core-side* faces (visible
 * from -pullAxis). On a smooth surface it's the silhouette: the locus
 * where the face normal becomes perpendicular to the pull direction.
 *
 * On a tessellated mesh it's an edge polyline: every edge whose two
 * incident triangles disagree on cavity-vs-core classification.
 *
 * Approach:
 *
 *   1. Classify each triangle by sign of `dot(normal, pullAxis)`:
 *      +1 cavity, -1 core, 0 undercut (≈ side wall).
 *   2. For each edge shared by exactly two triangles, the edge is a
 *      parting-line edge iff the two triangles have different non-zero
 *      classes (or one is "side wall" and the other is cavity/core).
 *   3. Chain edges into ordered polylines by shared endpoints.
 *
 * Output: ordered chains + per-chain length + undercut warnings.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export type FaceClass = 'cavity' | 'core' | 'sidewall';

export interface PartingResult {
  /** Per-triangle classification. */
  triangleClass: FaceClass[];
  /** Parting-line edge polylines (ordered point chains). */
  polylines: Array<{ points: Array<[number, number, number]>; closed: boolean }>;
  /** Total cavity area (mm²). */
  cavityAreaMm2: number;
  /** Total core area. */
  coreAreaMm2: number;
  /** Total side-wall (undercut potential) area. */
  sidewallAreaMm2: number;
  /** Edges classified as parting-line. */
  partingEdgeCount: number;
  /** Triangles flagged as undercut (steep enough they need lifters/slides). */
  undercutTriangles: number[];
}

export interface PartingOptions {
  /** Sidewall threshold: |dot(n,pull)| below this counts as sidewall, default 0.05. */
  sidewallCosine: number;
  /** Triangles with normal opposite of pull and steep enough → undercut. */
  undercutThresholdDeg: number;
}

export const DEFAULT_OPTIONS: PartingOptions = {
  sidewallCosine: 0.05,
  undercutThresholdDeg: 5,
};

// ── Top-level entry ────────────────────────────────────────────

export function extractPartingLine(
  mesh: MeshArrays,
  pullAxis: [number, number, number],
  options: Partial<PartingOptions> = {},
): PartingResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const pull = normalize(pullAxis);
  const triCount = mesh.indices.length / 3;
  const triangleClass: FaceClass[] = [];
  const triangleArea: number[] = [];
  let cavityArea = 0, coreArea = 0, sidewallArea = 0;
  const undercutTris: number[] = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0 = vertex(mesh, i0);
    const p1 = vertex(mesh, i1);
    const p2 = vertex(mesh, i2);
    const { normal, area } = triangleNormalArea(p0, p1, p2);
    const d = dot(normal, pull);
    triangleArea.push(area);
    if (Math.abs(d) < opts.sidewallCosine) {
      triangleClass.push('sidewall');
      sidewallArea += area;
      // Check undercut: side wall + slight reverse → trouble.
      const angle = Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
      if (Math.abs(angle - 90) > opts.undercutThresholdDeg) {
        undercutTris.push(t);
      }
    } else if (d > 0) {
      triangleClass.push('cavity');
      cavityArea += area;
    } else {
      triangleClass.push('core');
      coreArea += area;
    }
  }

  // Build edge map.
  const edges = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const idx = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = idx[e]!;
      const b = idx[(e + 1) % 3]!;
      const key = edgeKey(a, b);
      const list = edges.get(key) ?? [];
      list.push(t);
      edges.set(key, list);
    }
  }

  // Collect parting edges.
  const partingEdgePoints: Array<{ a: [number, number, number]; b: [number, number, number] }> = [];
  for (const [key, tris] of edges) {
    if (tris.length !== 2) continue;
    const t0 = tris[0]!;
    const t1 = tris[1]!;
    const c0 = triangleClass[t0]!;
    const c1 = triangleClass[t1]!;
    if (c0 === c1) continue;
    if (c0 === 'cavity' && c1 === 'core' ||
        c0 === 'core' && c1 === 'cavity' ||
        c0 === 'sidewall' && c1 !== 'sidewall' ||
        c1 === 'sidewall' && c0 !== 'sidewall') {
      const [a, b] = key.split('-').map(Number) as [number, number];
      partingEdgePoints.push({ a: vertex(mesh, a), b: vertex(mesh, b) });
    }
  }

  const polylines = chainEdges(partingEdgePoints);

  return {
    triangleClass,
    polylines,
    cavityAreaMm2: cavityArea,
    coreAreaMm2: coreArea,
    sidewallAreaMm2: sidewallArea,
    partingEdgeCount: partingEdgePoints.length,
    undercutTriangles: undercutTris,
  };
}

// ── Edge chaining ─────────────────────────────────────────────

const EPS = 1e-6;

function chainEdges(
  edges: Array<{ a: [number, number, number]; b: [number, number, number] }>,
): Array<{ points: Array<[number, number, number]>; closed: boolean }> {
  const used = new Set<number>();
  const out: Array<{ points: Array<[number, number, number]>; closed: boolean }> = [];

  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const e = edges[i]!;
    const points: Array<[number, number, number]> = [e.a, e.b];

    let extended = true;
    while (extended) {
      extended = false;
      const tail = points[points.length - 1]!;
      for (let j = 0; j < edges.length; j++) {
        if (used.has(j)) continue;
        const ej = edges[j]!;
        if (vec3Eq(ej.a, tail)) { points.push(ej.b); used.add(j); extended = true; break; }
        if (vec3Eq(ej.b, tail)) { points.push(ej.a); used.add(j); extended = true; break; }
      }
    }

    let extendedBack = true;
    while (extendedBack) {
      extendedBack = false;
      const head = points[0]!;
      for (let j = 0; j < edges.length; j++) {
        if (used.has(j)) continue;
        const ej = edges[j]!;
        if (vec3Eq(ej.a, head)) { points.unshift(ej.b); used.add(j); extendedBack = true; break; }
        if (vec3Eq(ej.b, head)) { points.unshift(ej.a); used.add(j); extendedBack = true; break; }
      }
    }

    const closed = vec3Eq(points[0]!, points[points.length - 1]!) && points.length > 2;
    out.push({ points, closed });
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function vertex(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < EPS) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function vec3Eq(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS && Math.abs(a[2] - b[2]) < EPS;
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
  if (len < EPS) return { normal: [0, 0, 1], area: 0 };
  return { normal: [cx / len, cy / len, cz / len], area: len / 2 };
}

// ── Summary ───────────────────────────────────────────────────

export interface PartingSummary {
  cavityFraction: number;
  coreFraction: number;
  sidewallFraction: number;
  longestChainLength: number;
  closedLoopCount: number;
  hasUndercut: boolean;
  undercutCount: number;
}

export function summarize(result: PartingResult): PartingSummary {
  const total = result.cavityAreaMm2 + result.coreAreaMm2 + result.sidewallAreaMm2 || 1;
  let longest = 0;
  let closedCount = 0;
  for (const poly of result.polylines) {
    let len = 0;
    for (let i = 1; i < poly.points.length; i++) {
      const a = poly.points[i - 1]!;
      const b = poly.points[i]!;
      len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    if (len > longest) longest = len;
    if (poly.closed) closedCount++;
  }
  return {
    cavityFraction: result.cavityAreaMm2 / total,
    coreFraction: result.coreAreaMm2 / total,
    sidewallFraction: result.sidewallAreaMm2 / total,
    longestChainLength: longest,
    closedLoopCount: closedCount,
    hasUndercut: result.undercutTriangles.length > 0,
    undercutCount: result.undercutTriangles.length,
  };
}
