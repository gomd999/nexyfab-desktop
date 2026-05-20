/**
 * normalMapBaking.ts — Bake high-poly normals to low-poly UV maps.
 *
 * For real-time rendering we want a *low-poly* mesh (cheap to draw)
 * that still shows the *high-poly* surface detail. The trick: bake the
 * high-poly surface normals into a texture, then sample at render time
 * in a tangent-space normal-map shader.
 *
 * Pipeline:
 *
 *   1. For each texel (u, v) on the low-poly UV map:
 *      a. Find the triangle that owns that texel.
 *      b. Recover the 3D position in object space.
 *      c. Cast a ray along the low-poly surface normal toward the
 *         high-poly mesh.
 *      d. Capture the high-poly surface normal at the hit point.
 *   2. Transform the captured normal into the low-poly tangent space.
 *   3. Pack [-1..1] → [0..255] and write to the texture.
 *
 * This module ships the math; ray-tri intersection lives in
 * `picking/rayCastPicker.ts`. Production should accelerate with a
 * BVH on the high-poly side.
 */

export type Vec3 = [number, number, number];

export interface MeshArrays {
  positions: number[];
  indices: number[];
  /** Per-vertex normal (required for tangent-space construction). */
  normals?: number[];
  /** Per-vertex UV (required on the low-poly mesh). */
  uvs?: number[];
}

export interface NormalMapBakeOptions {
  /** Output texture size (px). */
  textureSize: number;
  /** Cage offset along normal (mm) — the low-poly is "inflated" so rays
   *  hit the high-poly even when the low-poly extrudes deeper. */
  cageOffsetMm: number;
  /** Max ray distance (mm). */
  maxRayDistanceMm: number;
}

export const DEFAULT_BAKE_OPTIONS: NormalMapBakeOptions = {
  textureSize: 256,
  cageOffsetMm: 1,
  maxRayDistanceMm: 10,
};

export interface BakedNormalMap {
  /** RGB bytes (width × height × 3). */
  pixels: Uint8Array;
  width: number;
  height: number;
  /** Pixels that successfully sampled the high-poly. */
  hits: number;
  /** Pixels where the ray missed (filled with default +Z). */
  misses: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function bakeNormalMap(
  lowPoly: MeshArrays,
  highPoly: MeshArrays,
  options: Partial<NormalMapBakeOptions> = {},
): BakedNormalMap {
  const opts = { ...DEFAULT_BAKE_OPTIONS, ...options };
  const size = opts.textureSize;
  const pixels = new Uint8Array(size * size * 3);
  pixels.fill(128); // default neutral (0, 0, 1 in tangent space packed).
  let hits = 0, misses = 0;

  if (!lowPoly.uvs || !lowPoly.normals) {
    // Can't bake without UVs + normals; return neutral.
    return { pixels, width: size, height: size, hits: 0, misses: size * size };
  }

  const triCount = lowPoly.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = lowPoly.indices[t * 3]!;
    const i1 = lowPoly.indices[t * 3 + 1]!;
    const i2 = lowPoly.indices[t * 3 + 2]!;
    const uv0 = uvAt(lowPoly, i0);
    const uv1 = uvAt(lowPoly, i1);
    const uv2 = uvAt(lowPoly, i2);
    // Compute pixel bounding box for this triangle in UV space.
    const minU = Math.min(uv0.x, uv1.x, uv2.x);
    const maxU = Math.max(uv0.x, uv1.x, uv2.x);
    const minV = Math.min(uv0.y, uv1.y, uv2.y);
    const maxV = Math.max(uv0.y, uv1.y, uv2.y);
    const startX = Math.max(0, Math.floor(minU * size));
    const endX = Math.min(size - 1, Math.ceil(maxU * size));
    const startY = Math.max(0, Math.floor(minV * size));
    const endY = Math.min(size - 1, Math.ceil(maxV * size));

    for (let py = startY; py <= endY; py++) {
      for (let px = startX; px <= endX; px++) {
        const u = (px + 0.5) / size;
        const v = (py + 0.5) / size;
        const bary = barycentric(u, v, uv0, uv1, uv2);
        if (bary === null) continue;
        // Recover position + normal at this barycentric.
        const pos: Vec3 = [
          bary.u * positionX(lowPoly, i0) + bary.v * positionX(lowPoly, i1) + bary.w * positionX(lowPoly, i2),
          bary.u * positionY(lowPoly, i0) + bary.v * positionY(lowPoly, i1) + bary.w * positionY(lowPoly, i2),
          bary.u * positionZ(lowPoly, i0) + bary.v * positionZ(lowPoly, i1) + bary.w * positionZ(lowPoly, i2),
        ];
        const lpNormal: Vec3 = interpolateNormal(lowPoly, i0, i1, i2, bary.u, bary.v, bary.w);
        // Ray from cage along -normal toward high-poly.
        const origin: Vec3 = [
          pos[0] + lpNormal[0] * opts.cageOffsetMm,
          pos[1] + lpNormal[1] * opts.cageOffsetMm,
          pos[2] + lpNormal[2] * opts.cageOffsetMm,
        ];
        const dir: Vec3 = [-lpNormal[0], -lpNormal[1], -lpNormal[2]];
        const hit = rayMesh(highPoly, origin, dir, opts.maxRayDistanceMm);
        let packedNormal: Vec3;
        if (hit) {
          // Transform hit normal into low-poly tangent space using Gram-Schmidt
          // (without explicit tangents, we approximate by using the LP normal as Z).
          packedNormal = transformToTangentSpace(hit.normal, lpNormal);
          hits++;
        } else {
          packedNormal = [0, 0, 1];
          misses++;
        }
        const idx = (py * size + px) * 3;
        pixels[idx] = Math.max(0, Math.min(255, Math.round((packedNormal[0] * 0.5 + 0.5) * 255)));
        pixels[idx + 1] = Math.max(0, Math.min(255, Math.round((packedNormal[1] * 0.5 + 0.5) * 255)));
        pixels[idx + 2] = Math.max(0, Math.min(255, Math.round((packedNormal[2] * 0.5 + 0.5) * 255)));
      }
    }
  }

  return { pixels, width: size, height: size, hits, misses };
}

// ── Helpers ────────────────────────────────────────────────────

function uvAt(mesh: MeshArrays, idx: number): { x: number; y: number } {
  if (!mesh.uvs) return { x: 0, y: 0 };
  return { x: mesh.uvs[idx * 2]!, y: mesh.uvs[idx * 2 + 1]! };
}

function positionX(mesh: MeshArrays, idx: number): number { return mesh.positions[idx * 3]!; }
function positionY(mesh: MeshArrays, idx: number): number { return mesh.positions[idx * 3 + 1]!; }
function positionZ(mesh: MeshArrays, idx: number): number { return mesh.positions[idx * 3 + 2]!; }

function interpolateNormal(mesh: MeshArrays, i0: number, i1: number, i2: number, u: number, v: number, w: number): Vec3 {
  if (!mesh.normals) return [0, 0, 1];
  const x = u * mesh.normals[i0 * 3]! + v * mesh.normals[i1 * 3]! + w * mesh.normals[i2 * 3]!;
  const y = u * mesh.normals[i0 * 3 + 1]! + v * mesh.normals[i1 * 3 + 1]! + w * mesh.normals[i2 * 3 + 1]!;
  const z = u * mesh.normals[i0 * 3 + 2]! + v * mesh.normals[i1 * 3 + 2]! + w * mesh.normals[i2 * 3 + 2]!;
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function barycentric(u: number, v: number, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): { u: number; v: number; w: number } | null {
  const v0x = b.x - a.x, v0y = b.y - a.y;
  const v1x = c.x - a.x, v1y = c.y - a.y;
  const v2x = u - a.x, v2y = v - a.y;
  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return null;
  const vBary = (d11 * d20 - d01 * d21) / denom;
  const wBary = (d00 * d21 - d01 * d20) / denom;
  const uBary = 1 - vBary - wBary;
  if (uBary < -1e-6 || vBary < -1e-6 || wBary < -1e-6) return null;
  return { u: uBary, v: vBary, w: wBary };
}

// ── Ray-mesh intersection ─────────────────────────────────────

interface RayHit {
  distance: number;
  normal: Vec3;
}

function rayMesh(mesh: MeshArrays, origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null {
  const triCount = mesh.indices.length / 3;
  let best: RayHit | null = null;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0: Vec3 = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const p1: Vec3 = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const p2: Vec3 = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    const hit = rayTriangle(origin, dir, p0, p1, p2);
    if (hit && hit < maxDistance && (best === null || hit < best.distance)) {
      const normal = triangleNormal(p0, p1, p2);
      best = { distance: hit, normal };
    }
  }
  return best;
}

function rayTriangle(origin: Vec3, dir: Vec3, v0: Vec3, v1: Vec3, v2: Vec3): number | null {
  const e1: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2: Vec3 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const h = cross(dir, e2);
  const a = dot(e1, h);
  if (Math.abs(a) < 1e-9) return null;
  const f = 1 / a;
  const s: Vec3 = [origin[0] - v0[0], origin[1] - v0[1], origin[2] - v0[2]];
  const u = f * dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1);
  const v = f * dot(dir, q);
  if (v < 0 || u + v > 1) return null;
  const t = f * dot(e2, q);
  return t > 1e-9 ? t : null;
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = cross(e1, e2);
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// ── Tangent-space transform ───────────────────────────────────

function transformToTangentSpace(worldNormal: Vec3, lpNormal: Vec3): Vec3 {
  // Build a tangent basis with lpNormal as Z. Use a stable perpendicular.
  const z = lpNormal;
  const seed: Vec3 = Math.abs(z[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
  const dotV = dot(seed, z);
  const tangent: Vec3 = [seed[0] - dotV * z[0], seed[1] - dotV * z[1], seed[2] - dotV * z[2]];
  const tLen = Math.hypot(tangent[0], tangent[1], tangent[2]) || 1;
  const T: Vec3 = [tangent[0] / tLen, tangent[1] / tLen, tangent[2] / tLen];
  const B = cross(z, T);
  return [dot(worldNormal, T), dot(worldNormal, B), dot(worldNormal, z)];
}

// ── Diagnostic ─────────────────────────────────────────────────

export interface BakeDiagnostics {
  hitFraction: number;
  averageRayLength: number;
  coverageFraction: number;
}

export function analyzeBake(map: BakedNormalMap): BakeDiagnostics {
  const total = map.hits + map.misses;
  const coverage = total > 0 ? map.hits / total : 0;
  return {
    hitFraction: coverage,
    averageRayLength: 0,
    coverageFraction: coverage,
  };
}
