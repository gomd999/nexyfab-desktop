/**
 * bearingDefectFreq.ts — Rolling-element bearing characteristic defect frequencies.
 *
 *   f_r  = shaft speed [Hz] = rpm / 60
 *   BPFO = (N/2)·f_r·(1 − (d/D)·cosφ)        outer-race defect
 *   BPFI = (N/2)·f_r·(1 + (d/D)·cosφ)        inner-race defect
 *   BSF  = (D/2d)·f_r·(1 − ((d/D)·cosφ)²)     ball/roller spin
 *   FTF  = (1/2)·f_r·(1 − (d/D)·cosφ)         cage / fundamental train
 *
 * N = element count, d = element diameter, D = pitch diameter, φ = contact angle.
 */

export interface BearingDefectInput {
  shaftRpm: number;
  elementCount: number;        // N (balls/rollers)
  elementDiameterMm: number;   // d
  pitchDiameterMm: number;     // D
  contactAngleDeg?: number;    // φ, default 0 (deep-groove ball)
}

export interface BearingDefectResult {
  shaftFreqHz: number;
  bpfoHz: number;
  bpfiHz: number;
  bsfHz: number;
  ftfHz: number;
  bpfoOrders: number;          // BPFO / f_r  (multiple of shaft speed)
  bpfiOrders: number;
  warnings: string[];
}

export function compute(input: BearingDefectInput): BearingDefectResult {
  const warnings: string[] = [];
  const { shaftRpm, elementCount: N, elementDiameterMm: d, pitchDiameterMm: D } = input;
  const phi = (input.contactAngleDeg ?? 0) * Math.PI / 180;

  if (N <= 0) warnings.push('Element count must be positive.');
  if (D <= 0) warnings.push('Pitch diameter must be positive.');
  if (d >= D) warnings.push('Element diameter must be smaller than pitch diameter.');

  const fr = shaftRpm / 60;
  const ratio = D > 0 ? (d / D) * Math.cos(phi) : 0;

  const bpfo = (N / 2) * fr * (1 - ratio);
  const bpfi = (N / 2) * fr * (1 + ratio);
  const bsf = D > 0 ? (D / (2 * d)) * fr * (1 - ratio * ratio) : 0;
  const ftf = (1 / 2) * fr * (1 - ratio);

  return {
    shaftFreqHz: fr,
    bpfoHz: bpfo,
    bpfiHz: bpfi,
    bsfHz: bsf,
    ftfHz: ftf,
    bpfoOrders: fr > 0 ? bpfo / fr : 0,
    bpfiOrders: fr > 0 ? bpfi / fr : 0,
    warnings,
  };
}

/** Harmonics of a defect frequency (n×), useful for spectrum cursors. */
export function harmonics(baseHz: number, count: number): number[] {
  return Array.from({ length: Math.max(count, 0) }, (_, i) => baseHz * (i + 1));
}

export function summarize(r: BearingDefectResult): {
  bpfoHz: number; bpfiHz: number; bsfHz: number; ftfHz: number;
} {
  return { bpfoHz: r.bpfoHz, bpfiHz: r.bpfiHz, bsfHz: r.bsfHz, ftfHz: r.ftfHz };
}
