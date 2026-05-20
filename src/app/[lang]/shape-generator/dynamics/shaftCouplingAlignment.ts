/**
 * shaftCouplingAlignment.ts — Evaluate shaft-coupling misalignment
 * (parallel offset + angular) against tolerance bands and estimate the
 * reaction force / moment a flexible coupling imposes on the bearings.
 *
 * Misalignment types:
 *   - parallel (offset) δ  [mm]   — axes parallel but displaced
 *   - angular θ           [deg]   — axes meet at an angle
 *   - axial (end-float)   [mm]    — separation change
 *
 * Tolerance bands scale INVERSELY with speed (faster → tighter):
 *   excellent: offset ≤ 0.05·(3600/rpm)^0.5 mm  (illustrative)
 *
 * Reaction (for an elastomeric / disc coupling of radial stiffness k_r
 * and angular stiffness k_θ):
 *   F = k_r · δ ,  M = k_θ · θ_rad
 * These feed bearing-load + life calcs.
 */

export type AlignmentGrade = 'excellent' | 'acceptable' | 'rough' | 'unacceptable';

export interface CouplingAlignmentInput {
  parallelOffsetMm: number;
  angularMisalignmentDeg: number;
  speedRpm: number;
  radialStiffnessNmm?: number;   // k_r, for reaction force
  angularStiffnessNmPerDeg?: number; // k_θ
  couplingType?: 'rigid' | 'elastomeric' | 'disc' | 'gear' | 'jaw';
}

export interface CouplingAlignmentResult {
  offsetGrade: AlignmentGrade;
  angularGrade: AlignmentGrade;
  overallGrade: AlignmentGrade;
  reactionForceN: number | null;
  reactionMomentNm: number | null;
  offsetToleranceMm: number;   // the 'acceptable' band at this speed
  angularToleranceDeg: number;
  warnings: string[];
}

export function evaluate(input: CouplingAlignmentInput): CouplingAlignmentResult {
  const warnings: string[] = [];
  if (input.speedRpm <= 0) warnings.push('Speed must be positive.');

  // Speed-scaled tolerance bands (tighter as rpm rises).
  const speedFactor = input.speedRpm > 0 ? Math.sqrt(3600 / input.speedRpm) : 1;
  const offsetAcceptable = 0.1 * speedFactor;   // mm
  const angularAcceptable = 0.1 * speedFactor;  // deg

  const offsetGrade = gradeFromRatio(input.parallelOffsetMm / offsetAcceptable);
  const angularGrade = gradeFromRatio(input.angularMisalignmentDeg / angularAcceptable);
  const overallGrade = worstGrade(offsetGrade, angularGrade);

  if (input.couplingType === 'rigid' && (input.parallelOffsetMm > 0.02 || input.angularMisalignmentDeg > 0.02)) {
    warnings.push('Rigid coupling with measurable misalignment: high bearing load. Use a flexible coupling or re-align.');
  }

  let reactionForce: number | null = null;
  let reactionMoment: number | null = null;
  if (input.radialStiffnessNmm != null) {
    reactionForce = input.radialStiffnessNmm * input.parallelOffsetMm;
  }
  if (input.angularStiffnessNmPerDeg != null) {
    reactionMoment = input.angularStiffnessNmPerDeg * input.angularMisalignmentDeg;
  }

  if (overallGrade === 'unacceptable') warnings.push('Misalignment unacceptable: realign before running to avoid coupling/bearing failure.');

  return {
    offsetGrade,
    angularGrade,
    overallGrade,
    reactionForceN: reactionForce,
    reactionMomentNm: reactionMoment,
    offsetToleranceMm: offsetAcceptable,
    angularToleranceDeg: angularAcceptable,
    warnings,
  };
}

function gradeFromRatio(ratio: number): AlignmentGrade {
  if (ratio <= 0.5) return 'excellent';
  if (ratio <= 1.0) return 'acceptable';
  if (ratio <= 2.0) return 'rough';
  return 'unacceptable';
}

const GRADE_ORDER: AlignmentGrade[] = ['excellent', 'acceptable', 'rough', 'unacceptable'];

function worstGrade(a: AlignmentGrade, b: AlignmentGrade): AlignmentGrade {
  return GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b;
}

/** Rim-and-face dial-indicator readings → parallel + angular misalignment. */
export function fromDialReadings(rimTIRmm: number, faceTIRmm: number, faceDiameterMm: number): { parallelOffsetMm: number; angularMisalignmentDeg: number } {
  // parallel offset = rim TIR / 2; angular = atan(face TIR / face diameter).
  const parallel = rimTIRmm / 2;
  const angular = faceDiameterMm > 0 ? Math.atan(faceTIRmm / faceDiameterMm) * 180 / Math.PI : 0;
  return { parallelOffsetMm: parallel, angularMisalignmentDeg: angular };
}

export function summarize(r: CouplingAlignmentResult): { overallGrade: AlignmentGrade; reactionForceN: number | null } {
  return { overallGrade: r.overallGrade, reactionForceN: r.reactionForceN };
}
