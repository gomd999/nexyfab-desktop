/**
 * attributeTransfer.ts — Transfer per-vertex attributes between meshes.
 *
 * After remeshing, simplification, or CSG, the mesh topology changes
 * but the *attributes* (vertex colors, UVs, weights, material ids)
 * need to follow. This module:
 *
 *   - For each target vertex, finds the closest point on the source
 *     mesh and reads the attribute via barycentric interpolation.
 *   - Supports RGB / UV / scalar / vec3 attributes.
 *   - Per-target accuracy report (distance from source).
 *
 * Used by:
 *   - Bake vertex colors onto a decimated LOD.
 *   - Carry over per-face material ids after CSG output.
 *   - Project UVs from a parameterized reference onto re-meshed
 *     output before texturing.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export type AttributeKind = 'scalar' | 'vec2' | 'vec3' | 'rgb' | 'rgba';

export interface VertexAttribute {
  /** Channel name. */
  name: string;
  /** Component count: 1=scalar, 2=vec2, 3=vec3/rgb, 4=rgba. */
  kind: AttributeKind;
  /** Flat per-vertex data. */
  data: number[];
}

export interface AttributeTransferOptions {
  /** Snap target points within this distance to source surface. */
  snapDistanceMm: number;
}

export const DEFAULT_TRANSFER_OPTIONS: AttributeTransferOptions = {
  snapDistanceMm: 1,
};

export interface TransferResult {
  attributes: VertexAttribute[];
  /** Per-target-vertex distance to source surface. */
  perVertexDistance: number[];
  averageDistance: number;
  maxDistance: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function transferAttributes(
  source: MeshArrays,
  sourceAttributes: VertexAttribute[],
  target: MeshArrays,
  options: Partial<AttributeTransferOptions> = {},
): TransferResult {
  const opts = { ...DEFAULT_TRANSFER_OPTIONS, ...options };
  void opts;
  const targetVertexCount = target.positions.length / 3;
  const resultAttrs: VertexAttribute[] = sourceAttributes.map(a => ({
    name: a.name,
    kind: a.kind,
    data: new Array(targetVertexCount * componentCount(a.kind)).fill(0),
  }));
  const perVertexDistance: number[] = new Array(targetVertexCount);

  for (let v = 0; v < targetVertexCount; v++) {
    const p: [number, number, number] = [
      target.positions[v * 3]!,
      target.positions[v * 3 + 1]!,
      target.positions[v * 3 + 2]!,
    ];
    const hit = closestPointOnMesh(p, source);
    perVertexDistance[v] = hit.distance;
    for (let a = 0; a < sourceAttributes.length; a++) {
      const sourceAttr = sourceAttributes[a]!;
      const targetAttr = resultAttrs[a]!;
      const components = componentCount(sourceAttr.kind);
      const i0 = source.indices[hit.triangleIndex * 3]!;
      const i1 = source.indices[hit.triangleIndex * 3 + 1]!;
      const i2 = source.indices[hit.triangleIndex * 3 + 2]!;
      for (let c = 0; c < components; c++) {
        const va = sourceAttr.data[i0 * components + c] ?? 0;
        const vb = sourceAttr.data[i1 * components + c] ?? 0;
        const vc = sourceAttr.data[i2 * components + c] ?? 0;
        targetAttr.data[v * components + c] = hit.barycentric.u * va + hit.barycentric.v * vb + hit.barycentric.w * vc;
      }
    }
  }

  let sum = 0;
  let max = 0;
  for (const d of perVertexDistance) {
    sum += d;
    if (d > max) max = d;
  }
  return {
    attributes: resultAttrs,
    perVertexDistance,
    averageDistance: perVertexDistance.length > 0 ? sum / perVertexDistance.length : 0,
    maxDistance: max,
  };
}

function componentCount(kind: AttributeKind): number {
  switch (kind) {
    case 'scalar': return 1;
    case 'vec2': return 2;
    case 'vec3': case 'rgb': return 3;
    case 'rgba': return 4;
  }
}

// ── Closest point on mesh ─────────────────────────────────────

interface ClosestHit {
  triangleIndex: number;
  /** Barycentric coordinates u + v + w = 1. */
  barycentric: { u: number; v: number; w: number };
  /** Distance from query point. */
  distance: number;
  /** World position of closest point. */
  point: [number, number, number];
}

export function closestPointOnMesh(p: [number, number, number], mesh: MeshArrays): ClosestHit {
  const triCount = mesh.indices.length / 3;
  let best: ClosestHit = {
    triangleIndex: 0,
    barycentric: { u: 1, v: 0, w: 0 },
    distance: Infinity,
    point: [0, 0, 0],
  };
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const a: [number, number, number] = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const b: [number, number, number] = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const c: [number, number, number] = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    const hit = closestPointOnTriangle(p, a, b, c);
    if (hit.distance < best.distance) {
      best = { triangleIndex: t, ...hit };
    }
  }
  return best;
}

function closestPointOnTriangle(p: [number, number, number], a: [number, number, number], b: [number, number, number], c: [number, number, number]): Omit<ClosestHit, 'triangleIndex'> {
  // Eberly's closest-point-on-triangle.
  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap: [number, number, number] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2];
  const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2];

  if (d1 <= 0 && d2 <= 0) return barycentricResult(p, a, 1, 0, 0);
  const bp: [number, number, number] = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2];
  const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2];
  if (d3 >= 0 && d4 <= d3) return barycentricResult(p, b, 0, 1, 0);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const pt: [number, number, number] = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    return barycentricResult(p, pt, 1 - t, t, 0);
  }

  const cp: [number, number, number] = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2];
  const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2];
  if (d6 >= 0 && d5 <= d6) return barycentricResult(p, c, 0, 0, 1);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const pt: [number, number, number] = [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t];
    return barycentricResult(p, pt, 1 - t, 0, t);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const pt: [number, number, number] = [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, b[2] + (c[2] - b[2]) * t];
    return barycentricResult(p, pt, 0, 1 - t, t);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const u = 1 - v - w;
  const pt: [number, number, number] = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  return barycentricResult(p, pt, u, v, w);
}

function barycentricResult(p: [number, number, number], pt: [number, number, number], u: number, v: number, w: number): Omit<ClosestHit, 'triangleIndex'> {
  return {
    barycentric: { u, v, w },
    distance: Math.hypot(p[0] - pt[0], p[1] - pt[1], p[2] - pt[2]),
    point: pt,
  };
}

// ── Convenience: bake vertex colors ───────────────────────────

export function bakeVertexColors(source: MeshArrays, sourceColors: number[], target: MeshArrays): TransferResult {
  const attr: VertexAttribute = { name: 'color', kind: 'rgb', data: sourceColors };
  return transferAttributes(source, [attr], target);
}

// ── Stats ─────────────────────────────────────────────────────

export interface TransferStats {
  targetVertexCount: number;
  attributeCount: number;
  averageDistance: number;
  maxDistance: number;
  /** Fraction of target verts within snapDistance. */
  withinSnap: number;
}

export function summarize(result: TransferResult, snapDistanceMm: number = 1): TransferStats {
  let within = 0;
  for (const d of result.perVertexDistance) if (d <= snapDistanceMm) within++;
  return {
    targetVertexCount: result.perVertexDistance.length,
    attributeCount: result.attributes.length,
    averageDistance: result.averageDistance,
    maxDistance: result.maxDistance,
    withinSnap: result.perVertexDistance.length > 0 ? within / result.perVertexDistance.length : 0,
  };
}
