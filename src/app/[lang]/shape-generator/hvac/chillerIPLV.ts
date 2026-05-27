/**
 * chillerIPLV.ts — Compute a chiller's Integrated Part-Load Value (IPLV)
 * from its full- and part-load efficiencies, per AHRI 550/590 weighting.
 *
 *   IPLV = 1 / (0.01/A + 0.42/B + 0.45/C + 0.12/D)
 *
 * where A, B, C, D are the COP (or 1/kW-per-ton) at 100/75/50/25 % load.
 * The weights reflect the fraction of operating hours at each load.
 *
 * We accept efficiencies as COP or kW/ton (convert), return IPLV in the
 * same unit, plus the load-weighted annual energy fraction vs full-load.
 */

export type EfficiencyUnit = 'COP' | 'kW-per-ton';

export interface ChillerIPLVInput {
  unit: EfficiencyUnit;
  full100: number;   // efficiency at 100% load
  part75: number;
  part50: number;
  part25: number;
}

export interface ChillerIPLVResult {
  unit: EfficiencyUnit;
  iplv: number;            // in the same unit as inputs
  copPoints: [number, number, number, number]; // A,B,C,D as COP
  betterThanFullLoad: boolean; // IPLV more efficient than 100% point
  warnings: string[];
}

const KWTON_TO_COP = 3.51685; // 1 ton = 3.51685 kW thermal; COP = 3.51685 / (kW/ton)

export function compute(input: ChillerIPLVInput): ChillerIPLVResult {
  const warnings: string[] = [];
  const toCop = (v: number) => input.unit === 'COP' ? v : (v > 0 ? KWTON_TO_COP / v : 0);

  const A = toCop(input.full100);
  const B = toCop(input.part75);
  const C = toCop(input.part50);
  const D = toCop(input.part25);
  if (A <= 0 || B <= 0 || C <= 0 || D <= 0) warnings.push('All load-point efficiencies must be positive.');

  // IPLV as COP (weighted harmonic mean of COP via the kW weighting).
  const denom = 0.01 / A + 0.42 / B + 0.45 / C + 0.12 / D;
  const iplvCop = denom > 0 ? 1 / denom : 0;

  const iplv = input.unit === 'COP' ? iplvCop : (iplvCop > 0 ? KWTON_TO_COP / iplvCop : 0);
  const betterThanFull = iplvCop > A;

  return {
    unit: input.unit,
    iplv,
    copPoints: [A, B, C, D],
    betterThanFullLoad: betterThanFull,
    warnings,
  };
}

/** Convert COP ↔ kW/ton. */
export function copToKwPerTon(cop: number): number {
  return cop > 0 ? KWTON_TO_COP / cop : Infinity;
}
export function kwPerTonToCop(kwTon: number): number {
  return kwTon > 0 ? KWTON_TO_COP / kwTon : 0;
}

/** Annual energy vs an always-full-load baseline (fraction < 1 means savings). */
export function annualEnergyRatio(result: ChillerIPLVResult): number {
  const [A] = result.copPoints;
  const iplvCop = result.unit === 'COP' ? result.iplv : KWTON_TO_COP / result.iplv;
  return A > 0 ? A / iplvCop : 1; // energy ∝ 1/COP; ratio of full-load COP to IPLV COP
}

export function summarize(r: ChillerIPLVResult): { iplv: number; unit: EfficiencyUnit; betterThanFullLoad: boolean } {
  return { iplv: r.iplv, unit: r.unit, betterThanFullLoad: r.betterThanFullLoad };
}
