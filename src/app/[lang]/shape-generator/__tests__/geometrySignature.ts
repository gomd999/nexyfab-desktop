/**
 * Deterministic geometry signature for regression tests.
 *
 * Computing a hash over every triangle vertex would be fragile — floating
 * point jitter between THREE.js versions and platform math differences would
 * cause spurious diffs. Instead we quantize positions to 3 decimal places (μm
 * precision for a part measured in mm) and hash the quantized stream with
 * FNV-1a. Bbox / volume / surface area catch the common regressions (a shape
 * that accidentally ships at wrong scale or with a missing face); the hash
 * catches subtler ones (vertex reordering, silent geometry swaps).
 *
 * This helper must stay dependency-light — it runs in every test and cannot
 * pull in anything heavyweight.
 */

import type * as THREE from 'three';

export interface GeometrySignature {
  vertexCount: number;
  triangleCount: number;
  indexed: boolean;
  hasNormals: boolean;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Divergence theorem volume in mm³ (geometry's native units). */
  volume_mm3: number;
  /** Triangle-based surface area in mm². */
  surfaceArea_mm2: number;
  /** FNV-1a hash of the quantized position stream, hex. */
  positionHash: string;
}

function quantize(n: number, decimals = 3): number {
  if (!Number.isFinite(n)) return 0;
  const m = Math.pow(10, decimals);
  const r = Math.round(n * m) / m;
  return Object.is(r, -0) ? 0 : r;
}

function fnv1aHex(input: string): string {
  // FNV-1a 32-bit. Sufficient to detect accidental geometry changes; we're
  // not defending against adversarial collisions.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function computeSignature(geo: THREE.BufferGeometry): GeometrySignature {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const vertexCount = pos?.count ?? 0;
  const triangleCount = idx ? idx.count / 3 : vertexCount / 3;

  // Bbox (don't mutate the geometry's cached bbox).
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // Volume (divergence theorem) and triangle surface area in one pass.
  let vol = 0, area = 0;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = idx ? idx.getX(t * 3)     : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);

    vol += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by));

    // surface area: 0.5 * |AB × AC|
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const crx = aby * acz - abz * acy;
    const cry = abz * acx - abx * acz;
    const crz = abx * acy - aby * acx;
    area += 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
  }

  // Build the position hash from quantized values. Include the index order so
  // a triangle reordering counts as a change.
  const parts: string[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const i0 = idx ? idx.getX(t * 3)     : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    for (const i of [i0, i1, i2]) {
      parts.push(
        `${quantize(pos.getX(i))},${quantize(pos.getY(i))},${quantize(pos.getZ(i))}`,
      );
    }
  }
  const positionHash = fnv1aHex(parts.join('|'));

  return {
    vertexCount,
    triangleCount: Math.round(triangleCount),
    indexed: idx !== null,
    hasNormals: !!geo.attributes.normal,
    bbox: {
      min: [quantize(minX), quantize(minY), quantize(minZ)],
      max: [quantize(maxX), quantize(maxY), quantize(maxZ)],
    },
    volume_mm3: quantize(Math.abs(vol / 6)),
    surfaceArea_mm2: quantize(area),
    positionHash,
  };
}
