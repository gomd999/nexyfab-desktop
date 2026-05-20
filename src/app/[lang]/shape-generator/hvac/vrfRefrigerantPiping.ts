/**
 * vrfRefrigerantPiping.ts — Size VRF/VRV refrigerant line-set pipe and
 * apply the capacity derating from total piping length + height
 * difference (longer/taller runs lose capacity).
 *
 * Line sizing is by connected capacity (kW) → liquid + gas (suction) bore
 * from a lookup band. Capacity correction:
 *   correction = 1 − (equivLength − refLength)·lossPerM − heightDiff·heightLoss
 *
 * Oil return needs minimum gas velocity on risers; we flag if the run is
 * beyond manufacturer-typical max equivalent length.
 */

export interface VrfPipingInput {
  capacityKW: number;
  actualLengthM: number;
  fittingsEquivLengthM?: number; // elbows etc, default 0.3×actual
  indoorAboveOutdoorM: number;   // + indoor higher, − lower
  maxEquivLengthM?: number;      // manufacturer limit, default 150
  maxHeightM?: number;           // default 50
}

export interface VrfPipingResult {
  equivalentLengthM: number;
  liquidLineMm: number;
  gasLineMm: number;
  capacityCorrection: number;    // 0..1 multiplier
  correctedCapacityKW: number;
  withinLimits: boolean;
  warnings: string[];
}

// Capacity band → (liquid OD mm, gas OD mm).
const LINE_SIZES: { maxKW: number; liquid: number; gas: number }[] = [
  { maxKW: 5,  liquid: 6.4,  gas: 12.7 },
  { maxKW: 8,  liquid: 9.5,  gas: 15.9 },
  { maxKW: 12, liquid: 9.5,  gas: 19.1 },
  { maxKW: 16, liquid: 9.5,  gas: 22.2 },
  { maxKW: 22, liquid: 12.7, gas: 25.4 },
  { maxKW: 33, liquid: 12.7, gas: 28.6 },
  { maxKW: 45, liquid: 15.9, gas: 31.8 },
  { maxKW: 60, liquid: 19.1, gas: 38.1 },
];

export function size(input: VrfPipingInput): VrfPipingResult {
  const warnings: string[] = [];
  if (input.capacityKW <= 0) warnings.push('Capacity must be positive.');

  const fittings = input.fittingsEquivLengthM ?? input.actualLengthM * 0.3;
  const equivLength = input.actualLengthM + fittings;

  const band = LINE_SIZES.find(b => input.capacityKW <= b.maxKW) ?? LINE_SIZES[LINE_SIZES.length - 1]!;

  // Capacity correction: ~0.1% per metre beyond a 7.5 m reference + height penalty.
  const refLength = 7.5;
  const lossPerM = 0.001;        // 0.1%/m
  const heightLossPerM = 0.002;  // 0.2%/m of height diff
  const lengthLoss = Math.max(0, equivLength - refLength) * lossPerM;
  const heightLoss = Math.abs(input.indoorAboveOutdoorM) * heightLossPerM;
  const correction = Math.max(0.5, 1 - lengthLoss - heightLoss);

  const maxEquiv = input.maxEquivLengthM ?? 150;
  const maxHeight = input.maxHeightM ?? 50;
  const withinLimits = equivLength <= maxEquiv && Math.abs(input.indoorAboveOutdoorM) <= maxHeight;
  if (equivLength > maxEquiv) warnings.push(`Equivalent length ${equivLength.toFixed(0)} m exceeds limit ${maxEquiv} m.`);
  if (Math.abs(input.indoorAboveOutdoorM) > maxHeight) warnings.push(`Height difference exceeds ${maxHeight} m limit.`);

  return {
    equivalentLengthM: equivLength,
    liquidLineMm: band.liquid,
    gasLineMm: band.gas,
    capacityCorrection: correction,
    correctedCapacityKW: input.capacityKW * correction,
    withinLimits,
    warnings,
  };
}

/** Combination ratio = Σ indoor capacity / outdoor capacity (typical 50–130%). */
export function combinationRatio(indoorTotalKW: number, outdoorKW: number): number {
  return outdoorKW > 0 ? indoorTotalKW / outdoorKW : Infinity;
}

export function summarize(r: VrfPipingResult): { liquidLineMm: number; gasLineMm: number; correctedCapacityKW: number; withinLimits: boolean } {
  return { liquidLineMm: r.liquidLineMm, gasLineMm: r.gasLineMm, correctedCapacityKW: r.correctedCapacityKW, withinLimits: r.withinLimits };
}
