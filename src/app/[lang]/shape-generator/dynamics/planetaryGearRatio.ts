/**
 * planetaryGearRatio.ts — Compute the ratios of a single-stage planetary
 * (epicyclic) gear set from sun (S), ring (R), and planet (P) tooth
 * counts, for the common operating configurations.
 *
 * Tooth constraint:  R = S + 2·P.
 *
 * Using the basic ratio k = −R/S (sign convention), the ratios for fixed
 * members (carrier C):
 *   - ring fixed, sun in, carrier out:   i = 1 + R/S
 *   - sun fixed, ring in, carrier out:   i = 1 + S/R
 *   - carrier fixed (star), sun↔ring:    i = −R/S
 *
 * We also check the assembly condition (S+R) divisible by number of
 * planets, and report planet count feasibility.
 */

export type PlanetaryConfig = 'ring-fixed' | 'sun-fixed' | 'carrier-fixed';

export interface PlanetaryInput {
  sunTeeth: number;
  ringTeeth: number;
  planetTeeth?: number;        // if omitted, derived from R=S+2P
  planetCount?: number;        // for assembly check, default 3
  config: PlanetaryConfig;
  inputSpeedRpm?: number;
  inputTorqueNm?: number;
}

export interface PlanetaryResult {
  ratio: number;               // input/output speed ratio
  outputSpeedRpm: number | null;
  outputTorqueNm: number | null;
  derivedPlanetTeeth: number;
  toothConstraintOk: boolean;  // R = S + 2P
  assemblyOk: boolean;         // (S+R) % planetCount === 0
  warnings: string[];
}

export function compute(input: PlanetaryInput): PlanetaryResult {
  const warnings: string[] = [];
  const S = input.sunTeeth, R = input.ringTeeth;
  if (S <= 0 || R <= 0) warnings.push('Tooth counts must be positive.');
  if (R <= S) warnings.push('Ring must have more teeth than sun.');

  const derivedP = (R - S) / 2;
  const P = input.planetTeeth ?? derivedP;
  const toothConstraintOk = Math.abs(R - (S + 2 * P)) < 1e-6;
  if (!toothConstraintOk) warnings.push(`Tooth constraint R=S+2P violated (R=${R}, S+2P=${S + 2 * P}).`);

  const planetCount = input.planetCount ?? 3;
  const assemblyOk = ((S + R) % planetCount) === 0;
  if (!assemblyOk) warnings.push(`Assembly condition: (S+R)=${S + R} not divisible by ${planetCount} planets.`);

  let ratio: number;
  switch (input.config) {
    case 'ring-fixed': ratio = 1 + R / S; break;        // sun in → carrier out (reduction)
    case 'sun-fixed': ratio = 1 + S / R; break;         // ring in → carrier out
    case 'carrier-fixed': ratio = -R / S; break;        // star: sun in → ring out (reversing)
  }

  const outputSpeed = input.inputSpeedRpm != null && ratio !== 0 ? input.inputSpeedRpm / ratio : null;
  const outputTorque = input.inputTorqueNm != null ? input.inputTorqueNm * Math.abs(ratio) : null;

  return {
    ratio,
    outputSpeedRpm: outputSpeed,
    outputTorqueNm: outputTorque,
    derivedPlanetTeeth: derivedP,
    toothConstraintOk,
    assemblyOk,
    warnings,
  };
}

/** Largest reduction (ring-fixed) achievable for a sun/ring pair. */
export function maxReduction(sunTeeth: number, ringTeeth: number): number {
  return sunTeeth > 0 ? 1 + ringTeeth / sunTeeth : Infinity;
}

export function summarize(r: PlanetaryResult): { ratio: number; outputSpeedRpm: number | null; assemblyOk: boolean } {
  return { ratio: r.ratio, outputSpeedRpm: r.outputSpeedRpm, assemblyOk: r.assemblyOk };
}
