/**
 * tappingCycle.ts — Generate a rigid-tapping canned cycle (Fanuc G84
 * right-hand / G74 left-hand) for cutting an internal thread, with
 * synchronized spindle + feed.
 *
 * Rigid tapping requires feed per revolution = thread pitch exactly:
 *   feed [mm/min] = spindleRpm × pitch
 *
 * The cycle: rapid to R-plane, tap to depth at synchronized feed,
 * spindle reverse, retract to R-plane. Tapping depth must clear the
 * usable thread plus a few pitches of lead-in chamfer; for a blind hole
 * we warn if the hole bottom is too close.
 */

export type TapHand = 'right' | 'left';

export interface TappingInput {
  threadPitchMm: number;
  spindleRpm: number;
  threadDepthMm: number;     // usable thread length
  holeDepthMm?: number;      // blind hole bottom (omit for through hole)
  rPlaneMm?: number;         // retract plane above surface, default 3
  hand?: TapHand;
  chamferPitches?: number;   // lead-in chamfer length in pitches, default 3
}

export interface TappingResult {
  feedMmPerMin: number;
  gCode: string;             // canned-cycle line
  tappingDepthMm: number;    // depth the tap travels (incl. chamfer clearance)
  cycleTimeSec: number;
  hand: TapHand;
  blindHoleClearanceMm: number | null;
  warnings: string[];
}

export function generate(input: TappingInput): TappingResult {
  const warnings: string[] = [];
  if (input.threadPitchMm <= 0) warnings.push('Thread pitch must be positive.');
  if (input.spindleRpm <= 0) warnings.push('Spindle RPM must be positive.');
  if (input.threadDepthMm <= 0) warnings.push('Thread depth must be positive.');

  const hand = input.hand ?? 'right';
  const rPlane = input.rPlaneMm ?? 3;
  const chamferPitches = input.chamferPitches ?? 3;

  const feed = input.spindleRpm * input.threadPitchMm; // mm/min, = synced feed
  const chamferClear = chamferPitches * input.threadPitchMm;
  const tappingDepth = input.threadDepthMm + chamferClear;

  let blindClearance: number | null = null;
  if (input.holeDepthMm != null) {
    blindClearance = input.holeDepthMm - tappingDepth;
    if (blindClearance < 0) {
      warnings.push('Tapping depth exceeds hole bottom; deepen the hole or reduce thread depth.');
    } else if (blindClearance < input.threadPitchMm) {
      warnings.push('Less than one pitch clearance at hole bottom; risk of tap bottoming.');
    }
  }

  const code = hand === 'right' ? 'G84' : 'G74';
  // total travel: rapid in (rPlane), tap down (tappingDepth + rPlane), reverse out same.
  const travel = tappingDepth + rPlane;
  // time ≈ down at feed + up at feed (rigid reverse ≈ same feed).
  const cycleTimeSec = feed > 0 ? (2 * travel / feed) * 60 : 0;

  const gCode = `${code} Z-${input.threadDepthMm.toFixed(3)} R${rPlane.toFixed(1)} F${feed.toFixed(1)} S${input.spindleRpm}`;

  return {
    feedMmPerMin: feed,
    gCode,
    tappingDepthMm: tappingDepth,
    cycleTimeSec,
    hand,
    blindHoleClearanceMm: blindClearance,
    warnings,
  };
}

/** Recommended tap drill diameter for ~75% thread engagement (metric). */
export function tapDrillDiameterMm(nominalDiameterMm: number, pitchMm: number, engagementFraction: number = 0.75): number {
  // For metric: drill ≈ D − (engagement × 1.0825 × pitch). Standard 75% ≈ D − pitch.
  return nominalDiameterMm - engagementFraction * 1.0825 * pitchMm;
}

/** Thread-engagement % achieved for a given drilled hole. */
export function engagementPercent(nominalDiameterMm: number, pitchMm: number, drilledDiameterMm: number): number {
  const denom = 1.0825 * pitchMm;
  if (denom <= 0) return 0;
  return Math.max(0, Math.min(100, ((nominalDiameterMm - drilledDiameterMm) / denom) * 100));
}

export function summarize(r: TappingResult): { feedMmPerMin: number; tappingDepthMm: number; hand: TapHand } {
  return { feedMmPerMin: r.feedMmPerMin, tappingDepthMm: r.tappingDepthMm, hand: r.hand };
}
