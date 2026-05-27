/**
 * twoPlaneBalancing.ts — Solve the two-plane (dynamic) rotor balancing
 * problem using the influence-coefficient method.
 *
 * We measure the original vibration (complex amplitude·phase) at two
 * bearings, then add a known trial mass in each balancing plane and
 * re-measure. From the response changes we form the 2×2 complex
 * influence-coefficient matrix and solve for the correction masses that
 * cancel the original vibration:
 *
 *   [V1] = [a11 a12] [U1]      →   [U_corr] = −A⁻¹ · [V0]
 *   [V2]   [a21 a22] [U2]
 *
 * where aij = (V_with_trial_j − V0) / trialMass_j.
 *
 * Vibration vectors are complex (magnitude ∠ phase). We do complex 2×2
 * inversion. Output: correction mass magnitude + angular position per
 * plane.
 */

export interface Complex { re: number; im: number }

export interface VibrationReading {
  magnitude: number; // µm or mils
  phaseDeg: number;
}

export interface TwoPlaneInput {
  // original vibration at bearings 1 and 2
  v0: [VibrationReading, VibrationReading];
  // trial mass run in plane 1: resulting vibration at both bearings + trial mass info
  trial1: { massG: number; angleDeg: number; response: [VibrationReading, VibrationReading] };
  trial2: { massG: number; angleDeg: number; response: [VibrationReading, VibrationReading] };
}

export interface CorrectionMass {
  massG: number;
  angleDeg: number;
}

export interface TwoPlaneResult {
  plane1: CorrectionMass;
  plane2: CorrectionMass;
  predictedResidual: [number, number]; // residual vibration magnitude per bearing (≈0)
  warnings: string[];
}

export function solve(input: TwoPlaneInput): TwoPlaneResult {
  const warnings: string[] = [];
  const V0 = [toComplex(input.v0[0]), toComplex(input.v0[1])] as const;
  const U1 = polarToComplex(input.trial1.massG, input.trial1.angleDeg);
  const U2 = polarToComplex(input.trial2.massG, input.trial2.angleDeg);

  if (input.trial1.massG <= 0 || input.trial2.massG <= 0) {
    warnings.push('Trial masses must be positive.');
  }

  // Influence coefficients: aij = (V_trial_j[i] − V0[i]) / U_j
  const a11 = cdiv(csub(toComplex(input.trial1.response[0]), V0[0]), U1);
  const a21 = cdiv(csub(toComplex(input.trial1.response[1]), V0[1]), U1);
  const a12 = cdiv(csub(toComplex(input.trial2.response[0]), V0[0]), U2);
  const a22 = cdiv(csub(toComplex(input.trial2.response[1]), V0[1]), U2);

  // Solve A·Ucorr = −V0  →  Ucorr = A⁻¹·(−V0)
  const det = csub(cmul(a11, a22), cmul(a12, a21));
  if (cabs(det) < 1e-12) {
    warnings.push('Influence matrix is singular; trial masses may be ineffective or runs too similar.');
    return {
      plane1: { massG: 0, angleDeg: 0 },
      plane2: { massG: 0, angleDeg: 0 },
      predictedResidual: [input.v0[0].magnitude, input.v0[1].magnitude],
      warnings,
    };
  }

  const negV0 = [cneg(V0[0]), cneg(V0[1])] as const;
  // Cramer's rule for 2×2 complex.
  const u1 = cdiv(csub(cmul(negV0[0], a22), cmul(a12, negV0[1])), det);
  const u2 = cdiv(csub(cmul(a11, negV0[1]), cmul(negV0[0], a21)), det);

  // Predicted residual = V0 + A·Ucorr (should be ~0).
  const r1 = cadd(V0[0], cadd(cmul(a11, u1), cmul(a12, u2)));
  const r2 = cadd(V0[1], cadd(cmul(a21, u1), cmul(a22, u2)));

  return {
    plane1: complexToPolar(u1),
    plane2: complexToPolar(u2),
    predictedResidual: [cabs(r1), cabs(r2)],
    warnings,
  };
}

function toComplex(v: VibrationReading): Complex {
  return polarToComplex(v.magnitude, v.phaseDeg);
}
function polarToComplex(mag: number, deg: number): Complex {
  const t = deg * Math.PI / 180;
  return { re: mag * Math.cos(t), im: mag * Math.sin(t) };
}
function complexToPolar(c: Complex): CorrectionMass {
  const mag = Math.hypot(c.re, c.im);
  let deg = Math.atan2(c.im, c.re) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return { massG: mag, angleDeg: deg };
}
function cadd(a: Complex, b: Complex): Complex { return { re: a.re + b.re, im: a.im + b.im }; }
function csub(a: Complex, b: Complex): Complex { return { re: a.re - b.re, im: a.im - b.im }; }
function cmul(a: Complex, b: Complex): Complex { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
function cneg(a: Complex): Complex { return { re: -a.re, im: -a.im }; }
function cabs(a: Complex): number { return Math.hypot(a.re, a.im); }
function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  if (d < 1e-18) return { re: 0, im: 0 };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** ISO 1940 permissible residual unbalance (g·mm) for a balance grade G. */
export function permissibleUnbalanceGmm(gradeMmS: number, rotorMassKg: number, serviceRpm: number): number {
  if (serviceRpm <= 0) return Infinity;
  const omega = (2 * Math.PI * serviceRpm) / 60;
  // e_per = G·1000/ω (µm), U_per = e_per·m. Returns g·mm.
  const ePerMm = (gradeMmS * 1000 / omega) / 1000; // mm
  return ePerMm * rotorMassKg * 1000; // (mm)·(kg→g) = g·mm
}

export function summarize(r: TwoPlaneResult): { plane1: CorrectionMass; plane2: CorrectionMass; maxResidual: number } {
  return { plane1: r.plane1, plane2: r.plane2, maxResidual: Math.max(r.predictedResidual[0], r.predictedResidual[1]) };
}
