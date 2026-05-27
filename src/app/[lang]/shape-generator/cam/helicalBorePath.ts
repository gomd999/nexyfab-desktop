/**
 * helicalBorePath.ts — Generate a helical interpolation toolpath to bore
 * (enlarge) a hole from a pilot diameter up to a target diameter using an
 * end mill, instead of a dedicated boring bar.
 *
 * The cutter spirals outward+downward: each revolution advances Z by the
 * pitch and the helix radius ramps from (pilot/2 − tool/2) toward the
 * final (target/2 − tool/2). The axial pitch is limited by the ramp
 * angle the tool can plunge at:
 *
 *   pitch = π · D_helix · tan(rampAngle)
 *
 * After reaching depth at the final radius, an optional full-circle
 * "spring pass" cleans the wall.
 */

export interface HelicalBoreInput {
  pilotDiameterMm: number;
  targetDiameterMm: number;
  toolDiameterMm: number;
  depthMm: number;
  rampAngleDeg?: number;     // plunge ramp, default 3°
  pointsPerRev?: number;     // default 36
  springPass?: boolean;      // default true
}

export interface HelixPoint { x: number; y: number; z: number }

export interface HelicalBoreResult {
  path: HelixPoint[];
  revolutions: number;
  pitchMm: number;
  finalHelixRadiusMm: number;
  totalPathLengthMm: number;
  warnings: string[];
}

export function generatePath(input: HelicalBoreInput): HelicalBoreResult {
  const warnings: string[] = [];
  if (input.toolDiameterMm >= input.targetDiameterMm) {
    warnings.push('Tool diameter ≥ target: no helix radius; use a drill.');
  }
  if (input.targetDiameterMm <= input.pilotDiameterMm) {
    warnings.push('Target diameter must exceed pilot diameter.');
  }
  if (input.depthMm <= 0) warnings.push('Depth must be positive.');

  const ramp = (input.rampAngleDeg ?? 3) * Math.PI / 180;
  const ptsPerRev = Math.max(8, input.pointsPerRev ?? 36);

  const finalHelixR = Math.max(0, (input.targetDiameterMm - input.toolDiameterMm) / 2);
  const startHelixR = Math.max(0, (input.pilotDiameterMm - input.toolDiameterMm) / 2);

  if (finalHelixR <= 0 || input.depthMm <= 0) {
    return { path: [], revolutions: 0, pitchMm: 0, finalHelixRadiusMm: finalHelixR, totalPathLengthMm: 0, warnings };
  }

  // Pitch from ramp angle at the final (largest) helix circumference.
  const pitch = Math.max(1e-3, Math.PI * (2 * finalHelixR) * Math.tan(ramp));
  const revolutions = Math.max(1, Math.ceil(input.depthMm / pitch));

  const path: HelixPoint[] = [];
  const totalSteps = revolutions * ptsPerRev;
  for (let i = 0; i <= totalSteps; i++) {
    const frac = i / totalSteps;
    const z = -input.depthMm * frac;
    // Radius ramps from start to final over the descent.
    const radius = startHelixR + (finalHelixR - startHelixR) * frac;
    const theta = frac * revolutions * 2 * Math.PI;
    path.push({ x: radius * Math.cos(theta), y: radius * Math.sin(theta), z });
  }

  // Spring pass: a full circle at depth at the final radius.
  if (input.springPass ?? true) {
    for (let j = 0; j <= ptsPerRev; j++) {
      const theta = (j / ptsPerRev) * 2 * Math.PI;
      path.push({ x: finalHelixR * Math.cos(theta), y: finalHelixR * Math.sin(theta), z: -input.depthMm });
    }
  }

  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y, path[i]!.z - path[i - 1]!.z);
  }

  return {
    path,
    revolutions,
    pitchMm: pitch,
    finalHelixRadiusMm: finalHelixR,
    totalPathLengthMm: total,
    warnings,
  };
}

/** Material removal rate estimate (mm³/min) at a given feed. */
export function materialRemovalRate(input: HelicalBoreInput, feedMmPerMin: number): number {
  const annulus = Math.PI / 4 * (input.targetDiameterMm ** 2 - input.pilotDiameterMm ** 2);
  const volume = annulus * input.depthMm; // mm³ total
  const result = generatePath(input);
  if (result.totalPathLengthMm <= 0 || feedMmPerMin <= 0) return 0;
  const timeMin = result.totalPathLengthMm / feedMmPerMin;
  return timeMin > 0 ? volume / timeMin : 0;
}

export function summarize(r: HelicalBoreResult): { revolutions: number; pitchMm: number; totalPathLengthMm: number } {
  return { revolutions: r.revolutions, pitchMm: r.pitchMm, totalPathLengthMm: r.totalPathLengthMm };
}
