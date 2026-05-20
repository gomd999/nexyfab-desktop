/**
 * trochoidalSlotPath.ts — Generate a trochoidal (looping) toolpath for
 * cutting a slot, keeping radial engagement low so the cutter stays
 * cool and chip load stays constant.
 *
 * A trochoidal path advances the tool along the slot centreline while
 * cutting circular loops of radius r_loop. The step (pitch) between
 * loops controls the radial depth of cut (engagement):
 *
 *   ae = pitch  (approximately, for full-loop trochoids)
 *
 * Loop radius is chosen so the loop fits the slot:
 *   r_loop = (slotWidth − toolDiameter) / 2
 *
 * The path is: for each centre advancing by `pitch`, emit a full circle
 * of radius r_loop. The cutter only engages on the leading arc.
 */

export interface TrochoidalInput {
  slotStartMm: { x: number; y: number };
  slotEndMm: { x: number; y: number };
  slotWidthMm: number;
  toolDiameterMm: number;
  pitchMm: number; // advance per loop = radial engagement
  pointsPerLoop?: number; // default 32
}

export interface TrochoidalPoint { x: number; y: number; engaged: boolean }

export interface TrochoidalResult {
  path: TrochoidalPoint[];
  loopCount: number;
  loopRadiusMm: number;
  radialEngagementMm: number;
  totalPathLengthMm: number;
  warnings: string[];
}

export function generatePath(input: TrochoidalInput): TrochoidalResult {
  const warnings: string[] = [];
  if (input.toolDiameterMm >= input.slotWidthMm) {
    warnings.push('Tool diameter ≥ slot width: no room for trochoidal loops; use straight cut.');
  }
  if (input.pitchMm <= 0) warnings.push('Pitch must be positive.');

  const dx = input.slotEndMm.x - input.slotStartMm.x;
  const dy = input.slotEndMm.y - input.slotStartMm.y;
  const slotLen = Math.hypot(dx, dy);
  if (slotLen < 1e-9) {
    return { path: [], loopCount: 0, loopRadiusMm: 0, radialEngagementMm: 0, totalPathLengthMm: 0, warnings: [...warnings, 'Slot has zero length.'] };
  }
  const ux = dx / slotLen, uy = dy / slotLen;

  const loopR = Math.max(0, (input.slotWidthMm - input.toolDiameterMm) / 2);
  const pitch = Math.max(1e-6, input.pitchMm);
  const ptsPerLoop = Math.max(8, input.pointsPerLoop ?? 32);

  const loopCount = Math.max(1, Math.ceil(slotLen / pitch));
  const path: TrochoidalPoint[] = [];

  for (let i = 0; i < loopCount; i++) {
    const centreDist = Math.min(slotLen, i * pitch);
    const cx = input.slotStartMm.x + ux * centreDist;
    const cy = input.slotStartMm.y + uy * centreDist;
    for (let j = 0; j <= ptsPerLoop; j++) {
      const theta = (j / ptsPerLoop) * 2 * Math.PI;
      // engaged on the forward half of the loop (leading arc)
      const engaged = Math.cos(theta) > 0;
      path.push({
        x: cx + loopR * Math.cos(theta),
        y: cy + loopR * Math.sin(theta),
        engaged,
      });
    }
  }

  let totalLen = 0;
  for (let i = 1; i < path.length; i++) {
    totalLen += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  }

  return {
    path,
    loopCount,
    loopRadiusMm: loopR,
    radialEngagementMm: Math.min(pitch, 2 * loopR),
    totalPathLengthMm: totalLen,
    warnings,
  };
}

/** Recommend a pitch that keeps radial engagement ≤ a fraction of tool diameter. */
export function recommendPitch(toolDiameterMm: number, maxEngagementFraction: number = 0.1): number {
  return toolDiameterMm * Math.max(0.01, Math.min(1, maxEngagementFraction));
}

/** Estimate machining time (min) given a feed rate (mm/min). */
export function estimateTime(result: TrochoidalResult, feedMmPerMin: number): number {
  if (feedMmPerMin <= 0) return 0;
  return result.totalPathLengthMm / feedMmPerMin;
}

export function summarize(r: TrochoidalResult): { loopCount: number; loopRadiusMm: number; totalPathLengthMm: number } {
  return { loopCount: r.loopCount, loopRadiusMm: r.loopRadiusMm, totalPathLengthMm: r.totalPathLengthMm };
}
