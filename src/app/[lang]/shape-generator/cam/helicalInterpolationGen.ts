/**
 * helicalInterpolationGen.ts — Generate G-code helical interpolation
 * for milling a hole or boring a pocket.
 *
 * Helical interpolation: tool circles around a hole while descending.
 * Used for holes Ø > tool dia × 1.2 (cuts faster than peck drilling),
 * and for entry into pockets.
 *
 * Geometry parameters:
 *
 *   - boreCentre, boreDiameter
 *   - toolDiameter (helix radius = (boreDia - toolDia)/2)
 *   - rampAngleDeg or descendPerRevMm
 *   - direction: climb (CW for outside, CCW for inside) or conventional
 *
 * Module emits:
 *   - Fanuc/ISO G02/G03 helical block(s)
 *   - Plus a polyline approximation for visualization.
 *   - Estimated cycle time using feed rate.
 */

export type HelixDirection = 'climb' | 'conventional';

export interface HelicalParams {
  centre: { x: number; y: number };
  /** Final Z to reach. */
  finalZ: number;
  /** Z at which helix begins (usually clearance plane). */
  startZ: number;
  boreDiameterMm: number;
  toolDiameterMm: number;
  /** Either rampAngleDeg or descendPerRevMm — one is computed from the other. */
  rampAngleDeg?: number;
  descendPerRevMm?: number;
  direction: HelixDirection;
  /** Feed rate (mm/min) for the helical move. */
  feedMmMin: number;
}

export interface HelicalResult {
  /** Helix radius (mm). */
  radiusMm: number;
  /** Number of full revolutions. */
  revolutions: number;
  /** Descend per revolution (mm). */
  descendPerRevMm: number;
  /** Total travel along helix (mm). */
  totalTravelMm: number;
  /** Estimated time in seconds. */
  estimatedTimeSec: number;
  /** G-code lines (Fanuc). */
  gcode: string[];
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateHelical(params: HelicalParams): HelicalResult {
  const warnings: string[] = [];
  const radius = (params.boreDiameterMm - params.toolDiameterMm) / 2;
  if (radius <= 0) {
    warnings.push(`Bore ${params.boreDiameterMm} mm <= tool ${params.toolDiameterMm} mm — cannot helix.`);
    return {
      radiusMm: 0, revolutions: 0, descendPerRevMm: 0, totalTravelMm: 0,
      estimatedTimeSec: 0, gcode: [], warnings,
    };
  }

  const depth = params.startZ - params.finalZ;
  if (depth <= 0) {
    warnings.push('finalZ ≥ startZ; nothing to descend.');
    return {
      radiusMm: radius, revolutions: 0, descendPerRevMm: 0, totalTravelMm: 0,
      estimatedTimeSec: 0, gcode: [], warnings,
    };
  }

  let descendPerRev: number;
  if (params.descendPerRevMm !== undefined) {
    descendPerRev = params.descendPerRevMm;
  } else if (params.rampAngleDeg !== undefined) {
    // Per revolution travel along circumference = 2πr. Descend = circumference · tan(angle).
    descendPerRev = 2 * Math.PI * radius * Math.tan(params.rampAngleDeg * Math.PI / 180);
  } else {
    descendPerRev = radius * 0.1;
  }
  if (descendPerRev <= 0) {
    warnings.push('descendPerRev <= 0; clamping to small positive value.');
    descendPerRev = 0.001;
  }

  const revolutions = depth / descendPerRev;
  const circumPerRev = 2 * Math.PI * radius;
  const slantPerRev = Math.hypot(circumPerRev, descendPerRev);
  const totalTravel = revolutions * slantPerRev;
  const timeMin = totalTravel / Math.max(0.001, params.feedMmMin);
  const timeSec = timeMin * 60;

  // Emit G-code: a sequence of full helical turns.
  const code: string[] = [];
  const gCode = params.direction === 'climb' ? 'G03' : 'G02';
  const entryPoint = { x: params.centre.x + radius, y: params.centre.y };
  code.push(`G0 X${entryPoint.x.toFixed(3)} Y${entryPoint.y.toFixed(3)}`);
  code.push(`G0 Z${params.startZ.toFixed(3)}`);
  // For each revolution, emit one helical block ending at start + descend.
  let curZ = params.startZ;
  const fullRevs = Math.floor(revolutions);
  for (let i = 0; i < fullRevs; i++) {
    curZ -= descendPerRev;
    code.push(`${gCode} X${entryPoint.x.toFixed(3)} Y${entryPoint.y.toFixed(3)} I${(-radius).toFixed(3)} J0 Z${curZ.toFixed(3)} F${params.feedMmMin.toFixed(1)}`);
  }
  // Partial final revolution.
  const partial = revolutions - fullRevs;
  if (partial > 0) {
    const angle = partial * 2 * Math.PI;
    const endX = entryPoint.x + radius * (Math.cos(angle) - 1);
    const endY = entryPoint.y + radius * Math.sin(angle) * (params.direction === 'climb' ? 1 : -1);
    code.push(`${gCode} X${endX.toFixed(3)} Y${endY.toFixed(3)} I${(-radius).toFixed(3)} J0 Z${params.finalZ.toFixed(3)} F${params.feedMmMin.toFixed(1)}`);
  }
  // Cleanup full circle at final depth (optional — finish bore).
  code.push(`${gCode} X${entryPoint.x.toFixed(3)} Y${entryPoint.y.toFixed(3)} I${(-radius).toFixed(3)} J0 F${params.feedMmMin.toFixed(1)}`);

  if (params.rampAngleDeg !== undefined && params.rampAngleDeg > 5) {
    warnings.push(`Ramp angle ${params.rampAngleDeg}° > 5°; may stress tool centre.`);
  }

  return {
    radiusMm: radius,
    revolutions,
    descendPerRevMm: descendPerRev,
    totalTravelMm: totalTravel,
    estimatedTimeSec: timeSec,
    gcode: code,
    warnings,
  };
}

// ── Polyline for preview ──────────────────────────────────────

export function helixPolyline(params: HelicalParams, samplesPerRev: number = 32): { x: number; y: number; z: number }[] {
  const radius = (params.boreDiameterMm - params.toolDiameterMm) / 2;
  if (radius <= 0) return [];
  const depth = params.startZ - params.finalZ;
  let descendPerRev: number;
  if (params.descendPerRevMm !== undefined) descendPerRev = params.descendPerRevMm;
  else if (params.rampAngleDeg !== undefined) descendPerRev = 2 * Math.PI * radius * Math.tan(params.rampAngleDeg * Math.PI / 180);
  else descendPerRev = radius * 0.1;
  const revolutions = depth / Math.max(0.001, descendPerRev);
  const total = Math.ceil(revolutions * samplesPerRev);
  const direction = params.direction === 'climb' ? 1 : -1;
  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= total; i++) {
    const frac = i / total;
    const angle = frac * revolutions * 2 * Math.PI * direction;
    const x = params.centre.x + radius * Math.cos(angle);
    const y = params.centre.y + radius * Math.sin(angle);
    const z = params.startZ - frac * depth;
    points.push({ x, y, z });
  }
  return points;
}

// ── Summary ────────────────────────────────────────────────────

export interface HelicalSummary {
  radiusMm: number;
  revolutions: number;
  totalTravelMm: number;
  estimatedTimeSec: number;
  warningCount: number;
}

export function summarize(result: HelicalResult): HelicalSummary {
  return {
    radiusMm: result.radiusMm,
    revolutions: result.revolutions,
    totalTravelMm: result.totalTravelMm,
    estimatedTimeSec: result.estimatedTimeSec,
    warningCount: result.warnings.length,
  };
}
