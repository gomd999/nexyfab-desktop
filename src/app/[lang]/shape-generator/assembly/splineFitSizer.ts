/**
 * splineFitSizer.ts — Size a straight-sided / involute spline coupling
 * for torque transmission and check its torque capacity.
 *
 * A spline transmits torque through N teeth bearing on their flanks at
 * the pitch radius. The torque capacity limited by allowable bearing
 * pressure on the tooth flanks (SAE/Niemann approach):
 *
 *   T = p_allow · (N · h · L · r_m) · K_app
 *
 * where:
 *   N    = number of teeth
 *   h    = working tooth height (radial flank contact depth)
 *   L    = engagement length
 *   r_m  = mean (pitch) radius
 *   K_app= application/contact factor (≈0.75 to account for uneven load
 *          sharing — only ~75 % of teeth carry load on real splines)
 *
 * For an involute spline, pitch diameter = module × number of teeth.
 */

export type SplineType = 'involute' | 'straight-sided';

export interface SplineInput {
  numberOfTeeth: number;
  moduleMm?: number;          // involute: PD = m·N
  pitchDiameterMm?: number;   // straight-sided: given directly
  toothHeightMm: number;      // working (radial contact) height
  engagementLengthMm: number;
  allowableBearingMpa: number;
  loadSharingFactor?: number; // K_app, default 0.75
  type?: SplineType;
}

export interface SplineResult {
  pitchDiameterMm: number;
  meanRadiusMm: number;
  torqueCapacityNm: number;
  contactAreaMm2: number;
  type: SplineType;
  warnings: string[];
}

export function size(input: SplineInput): SplineResult {
  const warnings: string[] = [];
  const type = input.type ?? 'involute';
  if (input.numberOfTeeth <= 0) warnings.push('Number of teeth must be positive.');
  if (input.toothHeightMm <= 0) warnings.push('Tooth height must be positive.');
  if (input.engagementLengthMm <= 0) warnings.push('Engagement length must be positive.');

  let pd: number;
  if (type === 'involute') {
    if (input.moduleMm == null || input.moduleMm <= 0) {
      warnings.push('Involute spline needs a positive module.');
      pd = input.pitchDiameterMm ?? 0;
    } else {
      pd = input.moduleMm * input.numberOfTeeth;
    }
  } else {
    pd = input.pitchDiameterMm ?? 0;
    if (pd <= 0) warnings.push('Straight-sided spline needs a positive pitch diameter.');
  }

  const rm = pd / 2;
  const K = input.loadSharingFactor ?? 0.75;

  // Contact area = N teeth × height × length (one flank per tooth carrying).
  const contactArea = input.numberOfTeeth * input.toothHeightMm * input.engagementLengthMm;
  // Torque capacity (N·mm) = p · area · rm · K ; convert to N·m.
  const torqueNmm = input.allowableBearingMpa * contactArea * rm * K;
  const torqueNm = torqueNmm / 1000;

  return {
    pitchDiameterMm: pd,
    meanRadiusMm: rm,
    torqueCapacityNm: torqueNm,
    contactAreaMm2: contactArea,
    type,
    warnings,
  };
}

/** Minimum engagement length to carry a target torque. */
export function minEngagementLength(input: Omit<SplineInput, 'engagementLengthMm'>, targetTorqueNm: number): number {
  const type = input.type ?? 'involute';
  let pd: number;
  if (type === 'involute' && input.moduleMm) pd = input.moduleMm * input.numberOfTeeth;
  else pd = input.pitchDiameterMm ?? 0;
  const rm = pd / 2;
  const K = input.loadSharingFactor ?? 0.75;
  const denom = input.allowableBearingMpa * input.numberOfTeeth * input.toothHeightMm * rm * K;
  if (denom <= 0) return Infinity;
  return (targetTorqueNm * 1000) / denom;
}

/** Safety factor at a given applied torque. */
export function safetyFactor(result: SplineResult, appliedTorqueNm: number): number {
  if (appliedTorqueNm <= 0) return Infinity;
  return result.torqueCapacityNm / appliedTorqueNm;
}

export function summarize(r: SplineResult): { pitchDiameterMm: number; torqueCapacityNm: number; type: SplineType } {
  return { pitchDiameterMm: r.pitchDiameterMm, torqueCapacityNm: r.torqueCapacityNm, type: r.type };
}
