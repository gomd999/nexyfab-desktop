/**
 * edgeSmoothingFilter.ts — Smooth ONLY the boundary / feature edges
 * of a mesh while leaving interior vertices untouched.
 *
 * Laplacian smoothing flattens the entire mesh. When you want to
 * fix a jagged silhouette but keep the part's features intact,
 * you smooth only the edge polylines:
 *
 *   - Find boundary or feature-edge vertices (dihedral angle high).
 *   - Smooth each edge polyline independently with a 1D Laplacian.
 *   - Optionally taper the smoothing toward the polyline endpoints
 *     so they remain anchored.
 *
 * Module output:
 *
 *   - New mesh positions (only edge vertices moved).
 *   - Per-edge-polyline smoothing report.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface EdgeSmoothResult {
  mesh: MeshArrays;
  /** Edge polylines that were smoothed. */
  smoothedPolylines: number[][];
  /** Max vertex displacement (mm). */
  maxDisplacementMm: number;
  /** Edge vertices touched. */
  affectedVertexCount: number;
}

export interface SmoothOptions {
  /** Dihedral threshold (deg) for marking feature edge. */
  featureAngleDeg: number;
  /** Number of smoothing iterations. */
  iterations: number;
  /** Lambda per iteration (0..1). */
  lambda: number;
  /** Taper toward polyline endpoints (so corners stay fixed). */
  taperToEndpoints: boolean;
  /** Always smooth boundary (single-incident edges) too. */
  smoothBoundary: boolean;
}

export const DEFAULT_OPTIONS: SmoothOptions = {
  featureAngleDeg: 30,
  iterations: 5,
  lambda: 0.5,
  taperToEndpoints: true,
  smoothBoundary: true,
};

// ── Top-level entry ────────────────────────────────────────────

export function smoothEdges(mesh: MeshArrays, options: Partial<SmoothOptions> = {}): EdgeSmoothResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return {
      mesh: { positions: mesh.positions.slice(), indices: mesh.indices.slice() },
      smoothedPolylines: [],
      maxDisplacementMm: 0,
      affectedVertexCount: 0,
    };
  }
  const positions = mesh.positions.slice();
  const triangleNormals: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    triangleNormals.push(triangleNormal(getVertex(positions, i0), getVertex(positions, i1), getVertex(positions, i2)));
  }

  // Build edge → triangles.
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

  // Classify edges.
  const featureCos = Math.cos((opts.featureAngleDeg * Math.PI) / 180);
  const edgeKeys: string[] = [];
  for (const [key, tris] of edgeMap) {
    if (tris.length === 1 && opts.smoothBoundary) {
      edgeKeys.push(key);
    } else if (tris.length === 2) {
      const dot = vec3Dot(triangleNormals[tris[0]!]!, triangleNormals[tris[1]!]!);
      if (dot < featureCos) edgeKeys.push(key);
    }
  }

  // Chain feature edges into polylines.
  const polylines = chainEdges(edgeKeys);
  // Smooth each polyline in 1D.
  let maxDisp = 0;
  const affected = new Set<number>();
  const original = positions.slice();
  for (const poly of polylines) {
    if (poly.length < 3) continue;
    for (let iter = 0; iter < opts.iterations; iter++) {
      smoothPolyline1D(poly, positions, opts.lambda, opts.taperToEndpoints);
    }
    for (const v of poly) affected.add(v);
  }

  // Compute max displacement.
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i]! - original[i]!;
    const dy = positions[i + 1]! - original[i + 1]!;
    const dz = positions[i + 2]! - original[i + 2]!;
    const m = Math.hypot(dx, dy, dz);
    if (m > maxDisp) maxDisp = m;
  }

  return {
    mesh: { positions, indices: mesh.indices.slice() },
    smoothedPolylines: polylines,
    maxDisplacementMm: maxDisp,
    affectedVertexCount: affected.size,
  };
}

// ── Edge chaining ─────────────────────────────────────────────

function chainEdges(edgeKeys: string[]): number[][] {
  // Parse keys into adjacency.
  const edges: Array<[number, number]> = edgeKeys.map(k => k.split('-').map(Number) as [number, number]);
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const used = new Set<string>();
  const polylines: number[][] = [];
  for (const [start, neighbors] of adj) {
    if (neighbors.length === 0) continue;
    const chain: number[] = [start];
    let current = start;
    let prev = -1;
    while (true) {
      const candidates = (adj.get(current) ?? []).filter(n => n !== prev);
      let next: number | undefined;
      for (const c of candidates) {
        const key = current < c ? `${current}-${c}` : `${c}-${current}`;
        if (!used.has(key)) {
          next = c;
          used.add(key);
          break;
        }
      }
      if (next === undefined) break;
      chain.push(next);
      prev = current;
      current = next;
    }
    if (chain.length >= 3) polylines.push(chain);
  }
  return polylines;
}

// ── Smooth a 1D polyline ──────────────────────────────────────

function smoothPolyline1D(polyline: number[], positions: number[], lambda: number, taper: boolean): void {
  if (polyline.length < 3) return;
  const newCoords: Array<[number, number, number]> = polyline.map(v => getVertex(positions, v));
  for (let i = 1; i < polyline.length - 1; i++) {
    const taperFactor = taper ? 1 - Math.abs((i / (polyline.length - 1)) - 0.5) * 2 : 1;
    const prev = newCoords[i - 1]!;
    const cur = newCoords[i]!;
    const next = newCoords[i + 1]!;
    const avgX = (prev[0] + next[0]) / 2;
    const avgY = (prev[1] + next[1]) / 2;
    const avgZ = (prev[2] + next[2]) / 2;
    newCoords[i] = [
      cur[0] + (avgX - cur[0]) * lambda * taperFactor,
      cur[1] + (avgY - cur[1]) * lambda * taperFactor,
      cur[2] + (avgZ - cur[2]) * lambda * taperFactor,
    ];
  }
  for (let i = 0; i < polyline.length; i++) {
    const v = polyline[i]!;
    positions[v * 3] = newCoords[i]![0];
    positions[v * 3 + 1] = newCoords[i]![1];
    positions[v * 3 + 2] = newCoords[i]![2];
  }
}

// ── Geometry helpers ──────────────────────────────────────────

function getVertex(positions: number[], i: number): [number, number, number] {
  return [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
}

function vec3Dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function triangleNormal(p0: [number, number, number], p1: [number, number, number], p2: [number, number, number]): [number, number, number] {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const len = Math.hypot(cx, cy, cz);
  if (len < 1e-9) return [0, 0, 1];
  return [cx / len, cy / len, cz / len];
}

// ── Summary ────────────────────────────────────────────────────

export interface SmoothSummary {
  polylineCount: number;
  affectedVertexCount: number;
  maxDisplacementMm: number;
  averageDisplacementMm: number;
}

export function summarize(originalMesh: MeshArrays, result: EdgeSmoothResult): SmoothSummary {
  let total = 0;
  let touched = 0;
  for (let i = 0; i < originalMesh.positions.length; i += 3) {
    const dx = result.mesh.positions[i]! - originalMesh.positions[i]!;
    const dy = result.mesh.positions[i + 1]! - originalMesh.positions[i + 1]!;
    const dz = result.mesh.positions[i + 2]! - originalMesh.positions[i + 2]!;
    const m = Math.hypot(dx, dy, dz);
    if (m > 1e-9) {
      touched++;
      total += m;
    }
  }
  return {
    polylineCount: result.smoothedPolylines.length,
    affectedVertexCount: result.affectedVertexCount,
    maxDisplacementMm: result.maxDisplacementMm,
    averageDisplacementMm: touched > 0 ? total / touched : 0,
  };
}
