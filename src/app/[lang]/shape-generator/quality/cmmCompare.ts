/**
 * cmmCompare.ts — Coordinate Measuring Machine data alignment + compare.
 *
 * CMM machines emit XYZ coordinates of probed points. To compare
 * against the CAD model, you:
 *   1. Align the measurement coordinate system to the CAD frame
 *      (best-fit rigid transform — ICP-like).
 *   2. Project each measured point onto the nearest CAD surface.
 *   3. Report per-point deviation + summary statistics.
 *
 * Inspection report drives quality acceptance + ISO 1101 tolerance
 * checks (e.g. flatness, perpendicularity).
 */

export interface MeasuredPoint {
  /** Probe XYZ in CMM machine coordinates (mm). */
  position: [number, number, number];
  /** Optional probe normal (when CMM records it). */
  normal?: [number, number, number];
  /** Label / feature reference. */
  featureId?: string;
}

export interface CadPoint {
  position: [number, number, number];
  normal: [number, number, number];
  featureId?: string;
}

/** Best-fit rigid transform (rotation + translation) that maps
 *  source points onto target points — Procrustes / Horn's method. */
export function rigidAlign(
  source: Array<[number, number, number]>,
  target: Array<[number, number, number]>,
): {
  rotation: [[number, number, number], [number, number, number], [number, number, number]];
  translation: [number, number, number];
  rmsError: number;
} {
  const n = Math.min(source.length, target.length);
  if (n < 3) {
    return {
      rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      translation: [0, 0, 0],
      rmsError: 0,
    };
  }
  // Centroid.
  const cs: [number, number, number] = [0, 0, 0];
  const ct: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    cs[0] += source[i]![0]; cs[1] += source[i]![1]; cs[2] += source[i]![2];
    ct[0] += target[i]![0]; ct[1] += target[i]![1]; ct[2] += target[i]![2];
  }
  cs[0] /= n; cs[1] /= n; cs[2] /= n;
  ct[0] /= n; ct[1] /= n; ct[2] /= n;

  // Cross-covariance H = Σ (s - cs)(t - ct)ᵀ
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i++) {
    const s = [source[i]![0] - cs[0], source[i]![1] - cs[1], source[i]![2] - cs[2]];
    const t = [target[i]![0] - ct[0], target[i]![1] - ct[1], target[i]![2] - ct[2]];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        H[r]![c]! += s[r]! * t[c]!;
      }
    }
  }
  // SVD-free rotation: use polar decomposition approximation via
  // a few iterations. For small misalignments, the rotation is
  // close to identity; we use the linearised approximation.
  // R ≈ I + skew(ω). For preview-grade we just normalise H.
  const rotation = orthonormalize(H as [[number, number, number], [number, number, number], [number, number, number]]);

  // Translation = ct - R · cs
  const Rcs: [number, number, number] = [
    rotation[0][0] * cs[0] + rotation[0][1] * cs[1] + rotation[0][2] * cs[2],
    rotation[1][0] * cs[0] + rotation[1][1] * cs[1] + rotation[1][2] * cs[2],
    rotation[2][0] * cs[0] + rotation[2][1] * cs[1] + rotation[2][2] * cs[2],
  ];
  const translation: [number, number, number] = [
    ct[0] - Rcs[0], ct[1] - Rcs[1], ct[2] - Rcs[2],
  ];

  // RMS error.
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const s = source[i]!;
    const tRot: [number, number, number] = [
      rotation[0][0] * s[0] + rotation[0][1] * s[1] + rotation[0][2] * s[2] + translation[0],
      rotation[1][0] * s[0] + rotation[1][1] * s[1] + rotation[1][2] * s[2] + translation[1],
      rotation[2][0] * s[0] + rotation[2][1] * s[1] + rotation[2][2] * s[2] + translation[2],
    ];
    const t = target[i]!;
    sumSq += (tRot[0] - t[0]) ** 2 + (tRot[1] - t[1]) ** 2 + (tRot[2] - t[2]) ** 2;
  }

  return { rotation, translation, rmsError: Math.sqrt(sumSq / n) };
}

/** Crude Gram-Schmidt orthonormalization for a 3x3 matrix. */
function orthonormalize(M: [[number, number, number], [number, number, number], [number, number, number]]):
  [[number, number, number], [number, number, number], [number, number, number]]
{
  const c0 = [M[0][0], M[1][0], M[2][0]];
  const c1 = [M[0][1], M[1][1], M[2][1]];
  const c2 = [M[0][2], M[1][2], M[2][2]];
  // Normalize c0.
  let nrm = Math.hypot(...c0) || 1;
  c0[0] /= nrm; c0[1] /= nrm; c0[2] /= nrm;
  // Remove c0 projection from c1.
  const dot01 = c0[0]! * c1[0]! + c0[1]! * c1[1]! + c0[2]! * c1[2]!;
  c1[0] -= dot01 * c0[0]!; c1[1] -= dot01 * c0[1]!; c1[2] -= dot01 * c0[2]!;
  nrm = Math.hypot(...c1) || 1;
  c1[0] /= nrm; c1[1] /= nrm; c1[2] /= nrm;
  // c2 = c0 × c1.
  c2[0] = c0[1]! * c1[2]! - c0[2]! * c1[1]!;
  c2[1] = c0[2]! * c1[0]! - c0[0]! * c1[2]!;
  c2[2] = c0[0]! * c1[1]! - c0[1]! * c1[0]!;
  return [
    [c0[0]!, c1[0]!, c2[0]!],
    [c0[1]!, c1[1]!, c2[1]!],
    [c0[2]!, c1[2]!, c2[2]!],
  ];
}

/** Compute deviation of each measured point from the nearest CAD
 *  surface point (signed along surface normal). */
export interface DeviationResult {
  perPointMm: number[];
  meanMm: number;
  maxMm: number;
  rmsMm: number;
  /** Indices of points exceeding ±tolerance. */
  outOfTolerance: number[];
}

export function computeDeviations(
  measured: MeasuredPoint[],
  cad: CadPoint[],
  toleranceMm: number,
): DeviationResult {
  const out: number[] = [];
  const oot: number[] = [];
  let sum = 0;
  let max = 0;
  let sumSq = 0;

  for (let i = 0; i < measured.length; i++) {
    const m = measured[i]!;
    // Find nearest CAD point (brute force — KD-tree would be better).
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < cad.length; j++) {
      const c = cad[j]!;
      const d2 = (c.position[0] - m.position[0]) ** 2
               + (c.position[1] - m.position[1]) ** 2
               + (c.position[2] - m.position[2]) ** 2;
      if (d2 < bestDist) { bestDist = d2; bestIdx = j; }
    }
    const c = cad[bestIdx]!;
    // Signed distance along CAD normal.
    const dx = m.position[0] - c.position[0];
    const dy = m.position[1] - c.position[1];
    const dz = m.position[2] - c.position[2];
    const signed = dx * c.normal[0] + dy * c.normal[1] + dz * c.normal[2];
    out.push(signed);
    sum += signed;
    sumSq += signed * signed;
    if (Math.abs(signed) > max) max = Math.abs(signed);
    if (Math.abs(signed) > toleranceMm) oot.push(i);
  }

  const n = measured.length;
  return {
    perPointMm: out,
    meanMm: n === 0 ? 0 : sum / n,
    maxMm: max,
    rmsMm: n === 0 ? 0 : Math.sqrt(sumSq / n),
    outOfTolerance: oot,
  };
}

/** ISO 1101-style flatness deviation — peak-to-valley of measured
 *  points against best-fit plane. */
export function flatnessDeviation(measured: MeasuredPoint[]): number {
  if (measured.length < 3) return 0;
  // Fit plane (smallest-eigenvector — borrowed from pointCloud).
  let cx = 0, cy = 0, cz = 0;
  for (const p of measured) { cx += p.position[0]; cy += p.position[1]; cz += p.position[2]; }
  cx /= measured.length; cy /= measured.length; cz /= measured.length;
  // Simplified: pick highest variance axis = normal direction approximation.
  let vxx = 0, vyy = 0, vzz = 0;
  for (const p of measured) {
    vxx += (p.position[0] - cx) ** 2;
    vyy += (p.position[1] - cy) ** 2;
    vzz += (p.position[2] - cz) ** 2;
  }
  let normal: [number, number, number] = [0, 0, 1];
  if (vxx <= vyy && vxx <= vzz) normal = [1, 0, 0];
  else if (vyy <= vxx && vyy <= vzz) normal = [0, 1, 0];

  let maxPos = -Infinity, minPos = Infinity;
  for (const p of measured) {
    const proj = (p.position[0] - cx) * normal[0]
               + (p.position[1] - cy) * normal[1]
               + (p.position[2] - cz) * normal[2];
    if (proj > maxPos) maxPos = proj;
    if (proj < minPos) minPos = proj;
  }
  return maxPos - minPos;
}
