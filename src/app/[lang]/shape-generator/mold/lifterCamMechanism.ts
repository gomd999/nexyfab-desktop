/**
 * lifterCamMechanism.ts — Design parameters for a lifter cam mechanism
 * in an injection mold (for undercut release).
 *
 * Lifter geometry:
 *
 *   - Slide travel S (mm): how far the lifter must move radially to
 *     clear the undercut.
 *   - Lift angle α (deg): typically 5-20°.
 *   - Lifter rod length L (mm): drives required mold opening.
 *
 * Relationships:
 *
 *   Vertical opening = L · cos(α)
 *   Horizontal slide = L · sin(α) ≥ S (release condition).
 *
 * Module computes the required lifter geometry, ejection force, and
 * checks against mold opening stroke.
 */

export interface LifterInputs {
  /** Undercut depth requiring radial release (mm). */
  undercutMm: number;
  /** Lift angle (deg). */
  liftAngleDeg: number;
  /** Available mold opening stroke (mm). */
  availableStrokeMm: number;
  /** Lifter mass (kg). */
  lifterMassKg: number;
  /** Coefficient of friction between lifter and core. */
  friction: number;
}

export const DEFAULT_INPUTS: LifterInputs = {
  undercutMm: 5,
  liftAngleDeg: 10,
  availableStrokeMm: 100,
  lifterMassKg: 0.2,
  friction: 0.15,
};

export interface LifterDesign {
  /** Lifter rod length required to achieve the radial release (mm). */
  rodLengthMm: number;
  /** Vertical travel produced when ejector advances by rod-length (mm). */
  verticalTravelMm: number;
  /** Ejection force at given mass + friction (N). */
  ejectionForceN: number;
  feasible: boolean;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function designLifter(inputs: Partial<LifterInputs> = {}): LifterDesign {
  const i = { ...DEFAULT_INPUTS, ...inputs };
  const warnings: string[] = [];
  const alphaRad = (i.liftAngleDeg * Math.PI) / 180;
  if (i.liftAngleDeg <= 0 || i.liftAngleDeg >= 90) {
    warnings.push('Lift angle must be between 0 and 90 deg.');
    return { rodLengthMm: 0, verticalTravelMm: 0, ejectionForceN: 0, feasible: false, warnings };
  }
  // Required rod length so that horizontal slide ≥ undercut.
  const rodLength = i.undercutMm / Math.sin(alphaRad);
  const vertical = rodLength * Math.cos(alphaRad);

  // Ejection force: lifter weight + friction along inclined rod.
  // F_axial = m·g·(sin α + μ·cos α) approximately.
  const g = 9.81;
  const forceN = i.lifterMassKg * g * (Math.sin(alphaRad) + i.friction * Math.cos(alphaRad));

  let feasible = vertical <= i.availableStrokeMm;
  if (!feasible) {
    warnings.push(`Required vertical ${vertical.toFixed(2)} mm exceeds available stroke ${i.availableStrokeMm} mm.`);
  }
  if (i.liftAngleDeg < 5) {
    warnings.push('Lift angle < 5° may cause sliding friction lock.');
    feasible = false;
  }
  if (i.liftAngleDeg > 20) {
    warnings.push('Lift angle > 20° increases bending stress on lifter rod.');
  }
  return {
    rodLengthMm: rodLength,
    verticalTravelMm: vertical,
    ejectionForceN: forceN,
    feasible,
    warnings,
  };
}

// ── Optimise lift angle ──────────────────────────────────────

export interface AngleOptimisation {
  bestAngleDeg: number;
  rodLengthMm: number;
  ejectionForceN: number;
}

export function findOptimalAngle(inputs: Omit<LifterInputs, 'liftAngleDeg'>, range: { min: number; max: number; step: number }): AngleOptimisation {
  let bestAngle = range.min;
  let bestScore = Infinity;
  let bestRod = 0;
  let bestForce = 0;
  for (let a = range.min; a <= range.max; a += range.step) {
    const d = designLifter({ ...inputs, liftAngleDeg: a });
    if (!d.feasible) continue;
    // Score = rod-length + 0.1·force.
    const score = d.rodLengthMm + 0.1 * d.ejectionForceN;
    if (score < bestScore) {
      bestScore = score;
      bestAngle = a;
      bestRod = d.rodLengthMm;
      bestForce = d.ejectionForceN;
    }
  }
  return { bestAngleDeg: bestAngle, rodLengthMm: bestRod, ejectionForceN: bestForce };
}

// ── Cam profile (Archimedean) ────────────────────────────────

export interface CamProfile {
  pointCount: number;
  riseMm: number;
  /** Cam dwell angle (deg) for hold-at-top. */
  dwellAngleDeg: number;
}

export function buildCamProfile(stroke: number, dwellDeg: number = 20): CamProfile {
  return {
    pointCount: 36,
    riseMm: stroke,
    dwellAngleDeg: dwellDeg,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface LifterSummary {
  rodLengthMm: number;
  ejectionForceN: number;
  feasible: boolean;
  warningCount: number;
}

export function summarize(result: LifterDesign): LifterSummary {
  return {
    rodLengthMm: result.rodLengthMm,
    ejectionForceN: result.ejectionForceN,
    feasible: result.feasible,
    warningCount: result.warnings.length,
  };
}
