// Drawing-diff scorer — the verification loop's loss function
// (methodology §7 "역투영 도면 diff", §12.4 station-wise section compare,
// §13 #4 two-track: this is the deterministic measurement track).
//
// Key idea: the intent profile IS the drawing. We slice the BUILT mesh at
// measurement stations and compare against what the drawing says the section
// must be. Errors come back as millimetres, per station — an objective,
// machine-checkable score instead of "looks right".
//
//   expected  = section of the intent drawing (profileMaxX at station y)
//   actual    = section of the real geometry  (sliceOuterRadius at station z)
//   loss      = |actual − expected|,  pass = loss ≤ tolerance
//
// Tolerance note: the draft mesh is a $fn-gon approximation — for $fn=96 at
// r=330 the chord sag is ~0.18mm, so station tolerances below ~0.2mm would
// fail on tessellation alone. Default 0.5mm. The exact-HLR/record-kernel
// track owns tighter tolerances (§13 #4).

import type { Pt2 } from './schema';

// ─── Binary STL parsing (pure, no fs) ───────────────────────────────────────

/** Parse binary STL → flat triangle array [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...]. */
export function parseBinStl(data: Uint8Array): Float32Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = dv.getUint32(80, true);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12; // skip normal
    for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  return out;
}

// ─── Mesh measurements ("actual") ────────────────────────────────────────────

export interface Bbox3 { min: [number, number, number]; max: [number, number, number] }

export function meshBbox(tris: Float32Array): Bbox3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * Max radial extent √(x²+y²) of the mesh section at plane z=station.
 * Walks every triangle edge that crosses the plane and takes the farthest
 * intersection from the Z axis. Returns -Infinity if nothing crosses.
 */
export function sliceOuterRadius(tris: Float32Array, station: number): number {
  let maxR = -Infinity;
  for (let t = 0; t < tris.length; t += 9) {
    for (let e = 0; e < 3; e++) {
      const a = t + e * 3;
      const b = t + ((e + 1) % 3) * 3;
      const za = tris[a + 2];
      const zb = tris[b + 2];
      if ((za - station) * (zb - station) > 0) continue; // both same side
      if (za === zb) {
        // edge lies in the plane — take both endpoints
        for (const p of [a, b]) {
          const r = Math.hypot(tris[p], tris[p + 1]);
          if (r > maxR) maxR = r;
        }
        continue;
      }
      const s = (station - za) / (zb - za);
      if (s < 0 || s > 1) continue;
      const x = tris[a] + s * (tris[b] - tris[a]);
      const y = tris[a + 1] + s * (tris[b + 1] - tris[a + 1]);
      const r = Math.hypot(x, y);
      if (r > maxR) maxR = r;
    }
  }
  return maxR;
}

// ─── Drawing expectations ("expected") ───────────────────────────────────────

/**
 * Max x of the closed profile's boundary at height y — i.e. the outer radius
 * the drawing dictates at that station. Returns -Infinity if the line misses
 * the profile.
 */
export function profileMaxX(points: Pt2[], y: number): number {
  let maxX = -Infinity;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if ((a.y - y) * (b.y - y) > 0) continue;
    if (a.y === b.y) {
      if (a.y === y) maxX = Math.max(maxX, a.x, b.x);
      continue;
    }
    const s = (y - a.y) / (b.y - a.y);
    if (s < 0 || s > 1) continue;
    const x = a.x + s * (b.x - a.x);
    if (x > maxX) maxX = x;
  }
  return maxX;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export interface DiffItem {
  label: string;
  expected: number;
  actual: number;
  errorMm: number;
  pass: boolean;
}

export interface DiffReport {
  pass: boolean;
  maxErrorMm: number;
  items: DiffItem[];
}

function report(items: DiffItem[]): DiffReport {
  return {
    items,
    pass: items.every((i) => i.pass),
    maxErrorMm: items.reduce((m, i) => Math.max(m, Math.abs(i.errorMm)), 0),
  };
}

/**
 * Score a revolved solid against its drawing profile at radial stations,
 * plus overall height and max radius. `stations` are z heights in the same
 * frame as the profile's y.
 */
export function scoreRevolveAgainstProfile(
  tris: Float32Array,
  profilePoints: Pt2[],
  stations: number[],
  tolMm = 0.5,
): DiffReport {
  const items: DiffItem[] = [];
  for (const z of stations) {
    const expected = profileMaxX(profilePoints, z);
    const actual = sliceOuterRadius(tris, z);
    const errorMm = actual - expected;
    items.push({ label: `outerR@z=${z}`, expected, actual, errorMm, pass: Math.abs(errorMm) <= tolMm });
  }
  const bb = meshBbox(tris);
  const profTop = Math.max(...profilePoints.map((p) => p.y));
  items.push({
    label: 'totalHeight',
    expected: profTop,
    actual: bb.max[2],
    errorMm: bb.max[2] - profTop,
    pass: Math.abs(bb.max[2] - profTop) <= tolMm,
  });
  return report(items);
}

/** Score overall bounding box against drawing envelope dims (GA/skid check). */
export function scoreBboxDims(
  tris: Float32Array,
  expected: { L: number; W: number; H: number },
  tolMm = 0.5,
): DiffReport {
  const bb = meshBbox(tris);
  const dims: Array<[string, number, number]> = [
    ['L(x)', expected.L, bb.max[0] - bb.min[0]],
    ['W(y)', expected.W, bb.max[1] - bb.min[1]],
    ['H(z)', expected.H, bb.max[2] - bb.min[2]],
  ];
  return report(dims.map(([label, exp, act]) => ({
    label, expected: exp, actual: act, errorMm: act - exp, pass: Math.abs(act - exp) <= tolMm,
  })));
}
