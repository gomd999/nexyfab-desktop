/**
 * threadWhirlingPath.ts — Generate a thread-whirling toolpath. Whirling
 * cuts a thread with a ring of inserts orbiting eccentrically around the
 * workpiece while the part rotates slowly and the whirling head advances
 * one pitch per part revolution. It's used for long screws (lead screws,
 * bone screws, worms) because it cuts a full thread in one pass with
 * excellent chip control.
 *
 * Kinematics:
 *   - workpiece rotates at n_w (rpm), advancing the head by `pitch` per rev
 *   - whirling ring rotates fast at n_r (rpm), inserts orbit at radius
 *     R_ring eccentric to the part by e = R_ring − threadRadius
 *   - the cut helix is the part thread; insert engagement is intermittent
 *
 * We emit the head-centre path (helix along the part axis) plus the
 * eccentric orbit parameters and an engagement-arc estimate per insert.
 */

export interface ThreadWhirlingInput {
  threadMajorDiameterMm: number;
  pitchMm: number;
  threadLengthMm: number;
  ringInsertCount: number;
  ringRadiusMm: number;       // orbit radius of the inserts
  workpieceRpm: number;
  ringRpm: number;
  hand?: 'right' | 'left';
  pointsPerRev?: number;      // sampling of the head helix, default 36
  eccentricityMm?: number;    // head-centre offset from part axis; default ringRadius − threadRadius (tangent)
}

export interface WhirlPoint { x: number; y: number; z: number }

export interface ThreadWhirlingResult {
  headHelix: WhirlPoint[];    // centre of whirling ring along part axis
  eccentricityMm: number;
  revolutions: number;
  engagementArcDeg: number;   // per insert per orbit
  feedMmPerMin: number;       // axial advance
  chipsPerMin: number;        // insert engagements per minute
  warnings: string[];
}

export function generatePath(input: ThreadWhirlingInput): ThreadWhirlingResult {
  const warnings: string[] = [];
  if (input.pitchMm <= 0) warnings.push('Pitch must be positive.');
  if (input.threadLengthMm <= 0) warnings.push('Thread length must be positive.');
  if (input.ringInsertCount <= 0) warnings.push('Ring needs at least one insert.');

  const threadRadius = input.threadMajorDiameterMm / 2;
  const ecc = input.eccentricityMm ?? (input.ringRadiusMm - threadRadius);
  if (ecc <= 0) warnings.push('Ring radius must exceed the thread radius (eccentric setup).');

  // Guard against degenerate inputs that would make the helix infinite.
  if (input.pitchMm <= 0 || input.threadLengthMm <= 0 || input.ringInsertCount <= 0) {
    return {
      headHelix: [],
      eccentricityMm: ecc,
      revolutions: 0,
      engagementArcDeg: 0,
      feedMmPerMin: input.pitchMm > 0 ? input.workpieceRpm * input.pitchMm : 0,
      chipsPerMin: input.ringRpm * Math.max(0, input.ringInsertCount),
      warnings,
    };
  }

  const ptsPerRev = Math.max(8, input.pointsPerRev ?? 36);
  const revolutions = Math.max(1, input.threadLengthMm / input.pitchMm);
  const hand = input.hand ?? 'right';
  const dirSign = hand === 'right' ? 1 : -1;

  const headHelix: WhirlPoint[] = [];
  const totalSteps = Math.ceil(revolutions * ptsPerRev);
  for (let i = 0; i <= totalSteps; i++) {
    const frac = i / totalSteps;
    const z = -input.threadLengthMm * frac;
    const theta = dirSign * frac * revolutions * 2 * Math.PI;
    // Head centre rides offset from the part axis by the eccentricity.
    headHelix.push({ x: ecc * Math.cos(theta), y: ecc * Math.sin(theta), z });
  }

  // Engagement arc: inserts cut only over the arc where the orbit dips into
  // the part. cos(half) = (R_ring² + e² − r_thread²)/(2·R_ring·e) ... use
  // the depth of cut geometry. Approximate via the eccentric overlap.
  const Rr = input.ringRadiusMm;
  const cosHalf = Math.max(-1, Math.min(1, (Rr * Rr + ecc * ecc - threadRadius * threadRadius) / (2 * Rr * ecc)));
  const engagementArc = 2 * Math.acos(cosHalf) * 180 / Math.PI;

  const feed = input.workpieceRpm * input.pitchMm; // mm/min axial
  const chipsPerMin = input.ringRpm * input.ringInsertCount; // engagements/min

  return {
    headHelix,
    eccentricityMm: ecc,
    revolutions,
    engagementArcDeg: Number.isFinite(engagementArc) ? engagementArc : 0,
    feedMmPerMin: feed,
    chipsPerMin,
    warnings,
  };
}

/** Chip load per insert (mm) = axial advance per ring revolution / inserts. */
export function chipLoadPerInsert(input: ThreadWhirlingInput): number {
  if (input.ringRpm <= 0 || input.ringInsertCount <= 0) return 0;
  const advancePerRingRev = (input.workpieceRpm * input.pitchMm) / input.ringRpm; // mm
  return advancePerRingRev / input.ringInsertCount;
}

/** Cutting speed at the insert orbit (m/min). */
export function cuttingSpeedMPerMin(input: ThreadWhirlingInput): number {
  const circumferenceM = (2 * Math.PI * input.ringRadiusMm) / 1000;
  return circumferenceM * input.ringRpm;
}

export function summarize(r: ThreadWhirlingResult): { revolutions: number; eccentricityMm: number; feedMmPerMin: number } {
  return { revolutions: r.revolutions, eccentricityMm: r.eccentricityMm, feedMmPerMin: r.feedMmPerMin };
}
