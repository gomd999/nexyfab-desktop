/**
 * circularRunoutEvaluator.ts — Evaluate ASME Y14.5 / ISO 1101 circular
 * runout tolerance on a rotating feature.
 *
 * Setup: a part is rotated about a datum axis. At each angular position
 * a probe touches the surface and records radial distance from the
 * datum axis. Runout = (max − min) of the radial readings AT EACH
 * AXIAL SECTION (circular runout, NOT total runout).
 *
 * For total runout, see [[totalRunoutEvaluator]] (future module).
 *
 * Input format: a list of measurements per axial section, each a list
 * of (angleDeg, radius). For each section we compute runout, then return
 * the worst section.
 */

export interface RunoutMeasurement {
  angleDeg: number;
  radiusMm: number;
}

export interface SectionMeasurements {
  axialPositionMm: number;
  readings: RunoutMeasurement[];
}

export interface RunoutInput {
  sections: SectionMeasurements[];
  toleranceMm: number;
}

export interface SectionRunoutResult {
  axialPositionMm: number;
  runoutMm: number;
  minRadiusMm: number;
  maxRadiusMm: number;
  meanRadiusMm: number;
  withinTolerance: boolean;
  highSpotAngleDeg: number; // angle of max radius
  lowSpotAngleDeg: number;  // angle of min radius
}

export interface RunoutResult {
  perSection: SectionRunoutResult[];
  worstRunoutMm: number;
  worstSectionAxialMm: number;
  passed: boolean;
  warnings: string[];
}

export function evaluate(input: RunoutInput): RunoutResult {
  const warnings: string[] = [];
  if (input.sections.length === 0) warnings.push('No sections provided.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  const perSection: SectionRunoutResult[] = input.sections.map(sec => {
    if (sec.readings.length === 0) {
      return {
        axialPositionMm: sec.axialPositionMm,
        runoutMm: 0,
        minRadiusMm: 0,
        maxRadiusMm: 0,
        meanRadiusMm: 0,
        withinTolerance: true,
        highSpotAngleDeg: 0,
        lowSpotAngleDeg: 0,
      };
    }
    let min = Infinity, max = -Infinity, sum = 0;
    let minAng = 0, maxAng = 0;
    for (const r of sec.readings) {
      if (r.radiusMm < min) { min = r.radiusMm; minAng = r.angleDeg; }
      if (r.radiusMm > max) { max = r.radiusMm; maxAng = r.angleDeg; }
      sum += r.radiusMm;
    }
    const runout = max - min;
    return {
      axialPositionMm: sec.axialPositionMm,
      runoutMm: runout,
      minRadiusMm: min,
      maxRadiusMm: max,
      meanRadiusMm: sum / sec.readings.length,
      withinTolerance: runout <= input.toleranceMm + 1e-9,
      highSpotAngleDeg: maxAng,
      lowSpotAngleDeg: minAng,
    };
  });

  let worst = 0, worstAxial = 0;
  for (const s of perSection) {
    if (s.runoutMm > worst) { worst = s.runoutMm; worstAxial = s.axialPositionMm; }
  }
  const passed = perSection.every(s => s.withinTolerance);

  return {
    perSection,
    worstRunoutMm: worst,
    worstSectionAxialMm: worstAxial,
    passed,
    warnings,
  };
}

/** Fit a 1st-order eccentricity model: r(θ) ≈ r0 + e·cos(θ − φ). */
export interface EccentricityFit {
  meanRadiusMm: number;
  eccentricityMm: number;
  phaseDeg: number;
}

export function fitEccentricity(section: SectionMeasurements): EccentricityFit {
  if (section.readings.length === 0) {
    return { meanRadiusMm: 0, eccentricityMm: 0, phaseDeg: 0 };
  }
  // Least squares: r = a + b·cos(θ) + c·sin(θ)
  let sR = 0, sC = 0, sS = 0, sCC = 0, sSS = 0, sCS = 0, sRC = 0, sRS = 0;
  const n = section.readings.length;
  for (const m of section.readings) {
    const t = m.angleDeg * Math.PI / 180;
    const c = Math.cos(t), s = Math.sin(t);
    sR += m.radiusMm;
    sC += c; sS += s;
    sCC += c * c; sSS += s * s; sCS += c * s;
    sRC += m.radiusMm * c; sRS += m.radiusMm * s;
  }
  // Solve 3x3:
  // [ n    sC   sS  ] [a]   [sR ]
  // [ sC   sCC  sCS ] [b] = [sRC]
  // [ sS   sCS  sSS ] [c]   [sRS]
  const m = [
    [n, sC, sS, sR],
    [sC, sCC, sCS, sRC],
    [sS, sCS, sSS, sRS],
  ];
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(m[k]![i]!) > Math.abs(m[pivot]![i]!)) pivot = k;
    if (pivot !== i) { const tmp = m[i]!; m[i] = m[pivot]!; m[pivot] = tmp; }
    if (Math.abs(m[i]![i]!) < 1e-12) return { meanRadiusMm: sR / n, eccentricityMm: 0, phaseDeg: 0 };
    for (let k = i + 1; k < 3; k++) {
      const f = m[k]![i]! / m[i]![i]!;
      for (let j = i; j < 4; j++) m[k]![j] = m[k]![j]! - f * m[i]![j]!;
    }
  }
  const c3 = m[2]![3]! / m[2]![2]!;
  const c2 = (m[1]![3]! - m[1]![2]! * c3) / m[1]![1]!;
  const c1 = (m[0]![3]! - m[0]![1]! * c2 - m[0]![2]! * c3) / m[0]![0]!;
  const ecc = Math.hypot(c2, c3);
  const phaseDeg = Math.atan2(c3, c2) * 180 / Math.PI;
  return { meanRadiusMm: c1, eccentricityMm: ecc, phaseDeg };
}

export function summarize(r: RunoutResult): { passed: boolean; worstRunoutMm: number; sectionCount: number } {
  return { passed: r.passed, worstRunoutMm: r.worstRunoutMm, sectionCount: r.perSection.length };
}
