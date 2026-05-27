/**
 * totalRunoutEvaluator.ts — Evaluate ASME Y14.5 / ISO 1101 TOTAL runout
 * of a cylindrical surface about a datum axis.
 *
 * Where circular runout (see [[circularRunoutEvaluator]]) is evaluated
 * one axial section at a time, TOTAL runout uses the FULL field of
 * readings across the WHOLE surface simultaneously:
 *
 *   total_runout = (max radius over ALL points) − (min radius over ALL points)
 *
 * This catches taper, barrel/hourglass, and bow that per-section runout
 * misses, because the single tolerance zone is a pair of coaxial
 * cylinders the entire surface must lie between.
 *
 * For a face (perpendicular to axis) the analogous quantity uses axial
 * (Z) readings instead of radial — supported via `mode: 'face'`.
 */

export interface SurfaceReading {
  axialPositionMm: number;
  angleDeg: number;
  valueMm: number; // radius (surface mode) or axial height (face mode)
}

export type RunoutMode = 'surface' | 'face';

export interface TotalRunoutInput {
  readings: SurfaceReading[];
  toleranceMm: number;
  mode?: RunoutMode; // default 'surface'
}

export interface TotalRunoutResult {
  totalRunoutMm: number;
  minValueMm: number;
  maxValueMm: number;
  highSpot: SurfaceReading | null;
  lowSpot: SurfaceReading | null;
  passed: boolean;
  taperMmPerMm: number; // best-fit slope of value vs axial position
  mode: RunoutMode;
  warnings: string[];
}

export function evaluate(input: TotalRunoutInput): TotalRunoutResult {
  const warnings: string[] = [];
  const mode = input.mode ?? 'surface';
  if (input.readings.length === 0) warnings.push('No readings provided.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  if (input.readings.length === 0) {
    return {
      totalRunoutMm: 0, minValueMm: 0, maxValueMm: 0,
      highSpot: null, lowSpot: null, passed: true, taperMmPerMm: 0, mode, warnings,
    };
  }

  let min = Infinity, max = -Infinity;
  let highSpot: SurfaceReading | null = null;
  let lowSpot: SurfaceReading | null = null;
  for (const r of input.readings) {
    if (r.valueMm > max) { max = r.valueMm; highSpot = r; }
    if (r.valueMm < min) { min = r.valueMm; lowSpot = r; }
  }
  const total = max - min;
  const taper = fitTaper(input.readings);

  return {
    totalRunoutMm: total,
    minValueMm: min,
    maxValueMm: max,
    highSpot,
    lowSpot,
    passed: total <= input.toleranceMm + 1e-9,
    taperMmPerMm: taper,
    mode,
    warnings,
  };
}

/** Least-squares slope of value vs axial position (detects taper / coning). */
function fitTaper(readings: SurfaceReading[]): number {
  const n = readings.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const r of readings) {
    sx += r.axialPositionMm;
    sy += r.valueMm;
    sxx += r.axialPositionMm * r.axialPositionMm;
    sxy += r.axialPositionMm * r.valueMm;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return 0;
  return (n * sxy - sx * sy) / denom;
}

/** Classify the dominant error form from the reading field. */
export type ErrorForm = 'taper' | 'barrel' | 'hourglass' | 'eccentric' | 'within-noise';

export function classifyForm(input: TotalRunoutInput): ErrorForm {
  const r = evaluate(input);
  if (r.totalRunoutMm < 1e-6) return 'within-noise';

  // Taper dominates when slope × axial-span explains most of the runout.
  const axialSpan = axialRange(input.readings);
  const taperContribution = Math.abs(r.taperMmPerMm) * axialSpan;
  if (taperContribution > 0.6 * r.totalRunoutMm) return 'taper';

  // Compare mid-section mean radius to ends → barrel (mid larger) / hourglass (mid smaller).
  const { endsMean, midMean } = endsVsMid(input.readings);
  if (midMean - endsMean > 0.2 * r.totalRunoutMm) return 'barrel';
  if (endsMean - midMean > 0.2 * r.totalRunoutMm) return 'hourglass';

  return 'eccentric';
}

function axialRange(readings: SurfaceReading[]): number {
  let min = Infinity, max = -Infinity;
  for (const r of readings) { min = Math.min(min, r.axialPositionMm); max = Math.max(max, r.axialPositionMm); }
  return max - min;
}

function endsVsMid(readings: SurfaceReading[]): { endsMean: number; midMean: number } {
  let zmin = Infinity, zmax = -Infinity;
  for (const r of readings) { zmin = Math.min(zmin, r.axialPositionMm); zmax = Math.max(zmax, r.axialPositionMm); }
  const span = zmax - zmin || 1;
  const lowBand: number[] = [];
  const midBand: number[] = [];
  const highBand: number[] = [];
  for (const r of readings) {
    const frac = (r.axialPositionMm - zmin) / span;
    if (frac < 0.25) lowBand.push(r.valueMm);
    else if (frac > 0.75) highBand.push(r.valueMm);
    else midBand.push(r.valueMm);
  }
  const mean = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const ends = [...lowBand, ...highBand];
  return { endsMean: mean(ends), midMean: mean(midBand) };
}

export function summarize(r: TotalRunoutResult): { passed: boolean; totalRunoutMm: number; taperMmPerMm: number } {
  return { passed: r.passed, totalRunoutMm: r.totalRunoutMm, taperMmPerMm: r.taperMmPerMm };
}
