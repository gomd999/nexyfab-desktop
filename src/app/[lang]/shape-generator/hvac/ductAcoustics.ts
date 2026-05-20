/**
 * ductAcoustics.ts — Estimate sound attenuation through HVAC ductwork:
 * lined-duct insertion loss, end reflection, elbow + plenum losses, and
 * the net sound power reaching the room vs an NC target.
 *
 * Lined straight duct attenuation (per metre) ≈ empirical:
 *   ΔL/m ≈ 1.05 · (P/A)^0.75 · t^0.5     (dB/m, mid-band)
 * where P/A = perimeter/area ratio (more lining surface per flow area →
 * more loss), t = lining thickness (mm). Bigger ducts attenuate less.
 *
 * Total attenuation = lined runs + elbows·elbowLoss + plenum + end
 * reflection. Room sound power = source PWL − total attenuation.
 */

export interface DuctAcousticsInput {
  sourcePWLdB: number;          // fan/source sound power level
  ductWidthMm: number;
  ductHeightMm: number;
  linedLengthM: number;
  liningThicknessMm: number;
  linedElbows?: number;         // number of lined 90° elbows
  plenumLossDB?: number;
  endReflectionDB?: number;     // low-freq end reflection at outlet
  ncTargetDB?: number;          // room NC criterion (approx as dB)
}

export interface DuctAcousticsResult {
  linedAttenuationPerMdB: number;
  linedAttenuationDB: number;
  elbowAttenuationDB: number;
  totalAttenuationDB: number;
  roomPWLdB: number;
  meetsTarget: boolean | null;
  warnings: string[];
}

const ELBOW_LINED_LOSS_DB = 6; // per lined 90° elbow (mid-band)

export function compute(input: DuctAcousticsInput): DuctAcousticsResult {
  const warnings: string[] = [];
  const w = input.ductWidthMm / 1000, h = input.ductHeightMm / 1000; // m
  if (w <= 0 || h <= 0) warnings.push('Duct dimensions must be positive.');

  const area = w * h;
  const perim = 2 * (w + h);
  const pa = area > 0 ? perim / area : 0; // 1/m

  // Lined attenuation per metre (empirical mid-band).
  const t = Math.max(0, input.liningThicknessMm);
  const perM = 1.05 * Math.pow(pa, 0.75) * Math.sqrt(t / 25.4); // normalise t by 25mm
  const lined = perM * Math.max(0, input.linedLengthM);

  const elbow = (input.linedElbows ?? 0) * ELBOW_LINED_LOSS_DB;
  const plenum = input.plenumLossDB ?? 0;
  const endRefl = input.endReflectionDB ?? 0;

  const total = lined + elbow + plenum + endRefl;
  const roomPWL = input.sourcePWLdB - total;

  let meets: boolean | null = null;
  if (input.ncTargetDB != null) {
    meets = roomPWL <= input.ncTargetDB;
    if (!meets) warnings.push(`Room PWL ${roomPWL.toFixed(1)} dB exceeds NC target ${input.ncTargetDB} dB; add lining/silencer.`);
  }

  return {
    linedAttenuationPerMdB: perM,
    linedAttenuationDB: lined,
    elbowAttenuationDB: elbow,
    totalAttenuationDB: total,
    roomPWLdB: roomPWL,
    meetsTarget: meets,
    warnings,
  };
}

/** Lined length needed to reach a target room PWL (m). */
export function linedLengthForTarget(input: Omit<DuctAcousticsInput, 'linedLengthM'>, targetRoomPWLdB: number): number {
  const probe = compute({ ...input, linedLengthM: 0 });
  const needed = probe.roomPWLdB - targetRoomPWLdB; // dB still to attenuate via lining
  if (needed <= 0) return 0;
  return probe.linedAttenuationPerMdB > 0 ? needed / probe.linedAttenuationPerMdB : Infinity;
}

export function summarize(r: DuctAcousticsResult): { totalAttenuationDB: number; roomPWLdB: number; meetsTarget: boolean | null } {
  return { totalAttenuationDB: r.totalAttenuationDB, roomPWLdB: r.roomPWLdB, meetsTarget: r.meetsTarget };
}
