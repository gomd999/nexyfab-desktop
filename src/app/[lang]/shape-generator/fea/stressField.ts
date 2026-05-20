/**
 * stressField.ts — Per-vertex stress + displacement representation.
 *
 * Scope per `nexyfab-gtm` memory: FEA is "매우 어려움" for SW-grade
 * solver depth, so NexyFab stops at the **preview** layer. Real FEA
 * (mesh refinement, contact, nonlinearity) is done in Ansys / Comsol;
 * NexyFab consumes the results and visualises them, or runs a quick
 * linear-static approximation for first-pass safety checks.
 *
 * Data model is intentionally minimal:
 *   - vertex array (xyz) — already in the BufferGeometry.
 *   - vonMises array — one stress scalar per vertex, MPa.
 *   - displacement array — three numbers (dx, dy, dz) per vertex, mm.
 *
 * Helpers:
 *   - statisticsOf — quick summary (min / max / mean / p95).
 *   - hotspotsOf — top-N vertices ranked by stress.
 *   - interpolateAt — linear barycentric interp at an arbitrary point
 *     on a triangle. Used when the camera picks a face and we want
 *     the inspector to show the value under the cursor.
 *   - validateStressField — sanity-check the dimensions / NaN rates so
 *     a broken solver result doesn't display as a confidence-inspiring
 *     rainbow.
 */

export interface StressField {
  /** Vertex count — must match the host geometry's position attribute. */
  vertexCount: number;
  /** Per-vertex von Mises stress in MPa. */
  vonMises: Float32Array;
  /** Per-vertex displacement (dx, dy, dz) in mm. Length = vertexCount * 3. */
  displacement: Float32Array;
}

export interface StressStatistics {
  min: number;
  max: number;
  mean: number;
  /** 95th-percentile stress — the "stressed region" upper bound. */
  p95: number;
  /** Number of vertices flagged as NaN or non-finite. */
  invalidCount: number;
}

/** Compute summary statistics. Handles NaN / Infinity by tallying
 *  them and excluding them from the mean / p95. */
export function statisticsOf(field: StressField): StressStatistics {
  const arr = field.vonMises;
  let min = Infinity, max = -Infinity, sum = 0;
  let validCount = 0;
  let invalidCount = 0;
  const valid: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) { invalidCount++; continue; }
    valid.push(v);
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    validCount++;
  }
  const mean = validCount > 0 ? sum / validCount : 0;
  valid.sort((a, b) => a - b);
  const p95Idx = Math.max(0, Math.floor(valid.length * 0.95) - 1);
  const p95 = valid.length > 0 ? valid[p95Idx] : 0;
  return {
    min: validCount > 0 ? min : 0,
    max: validCount > 0 ? max : 0,
    mean,
    p95,
    invalidCount,
  };
}

export interface Hotspot {
  /** Vertex index in the host geometry. */
  vertexIndex: number;
  /** Stress at that vertex, MPa. */
  stress: number;
}

/** Return the top-N vertices by stress, sorted descending. NaN /
 *  Infinity values are excluded. */
export function hotspotsOf(field: StressField, count = 5): Hotspot[] {
  if (count <= 0) return [];
  const heap: Hotspot[] = [];
  for (let i = 0; i < field.vonMises.length; i++) {
    const v = field.vonMises[i];
    if (!Number.isFinite(v)) continue;
    if (heap.length < count) {
      heap.push({ vertexIndex: i, stress: v });
      heap.sort((a, b) => a.stress - b.stress);
      continue;
    }
    if (v > heap[0].stress) {
      heap[0] = { vertexIndex: i, stress: v };
      heap.sort((a, b) => a.stress - b.stress);
    }
  }
  return heap.sort((a, b) => b.stress - a.stress);
}

/** Linear barycentric interpolation of stress at a point inside a
 *  triangle. `bary` = (u, v, w) with u + v + w = 1. */
export function interpolateAt(
  field: StressField,
  triangleVertexIndices: [number, number, number],
  bary: [number, number, number],
): number {
  const [i0, i1, i2] = triangleVertexIndices;
  const [u, v, w] = bary;
  const s0 = field.vonMises[i0];
  const s1 = field.vonMises[i1];
  const s2 = field.vonMises[i2];
  if (!Number.isFinite(s0) || !Number.isFinite(s1) || !Number.isFinite(s2)) return NaN;
  return s0 * u + s1 * v + s2 * w;
}

/** Validate that the stress field matches a host vertex count and
 *  contains a reasonable fraction of finite values. */
export interface FieldValidation {
  ok: boolean;
  reason?: string;
  invalidFraction: number;
}

export function validateStressField(
  field: StressField,
  expectedVertexCount: number,
  maxInvalidFraction = 0.05,
): FieldValidation {
  if (field.vertexCount !== expectedVertexCount) {
    return { ok: false, reason: `vertexCount mismatch: field=${field.vertexCount}, geometry=${expectedVertexCount}`, invalidFraction: 1 };
  }
  if (field.vonMises.length !== field.vertexCount) {
    return { ok: false, reason: `vonMises length mismatch (${field.vonMises.length} vs ${field.vertexCount})`, invalidFraction: 1 };
  }
  if (field.displacement.length !== field.vertexCount * 3) {
    return { ok: false, reason: `displacement length mismatch (${field.displacement.length} vs ${field.vertexCount * 3})`, invalidFraction: 1 };
  }
  let invalid = 0;
  for (let i = 0; i < field.vonMises.length; i++) {
    if (!Number.isFinite(field.vonMises[i])) invalid++;
  }
  const fraction = field.vertexCount === 0 ? 0 : invalid / field.vertexCount;
  if (fraction > maxInvalidFraction) {
    return { ok: false, reason: `${(fraction * 100).toFixed(1)}% of vertices have non-finite stress`, invalidFraction: fraction };
  }
  return { ok: true, invalidFraction: fraction };
}
