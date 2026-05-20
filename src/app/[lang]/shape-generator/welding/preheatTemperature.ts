/**
 * preheatTemperature.ts — Estimate the welding preheat temperature needed
 * to avoid hydrogen-induced (cold) cracking, from the steel's carbon
 * equivalent, thickness (combined thickness), and hydrogen level.
 *
 * Carbon equivalent (IIW):
 *   CE = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15
 *
 * Preheat rises with CE, joint thickness (heat-sink), and diffusible
 * hydrogen. A common engineering estimate (AWS D1.1 Annex / Yurioka-like
 * banding):
 *
 *   CE ≤ 0.45        → no preheat (thin) … up to ~100 °C (thick)
 *   0.45 < CE ≤ 0.60 → 100–150 °C
 *   CE > 0.60        → 150–250 °C
 *
 * We compute CE, pick a base preheat from CE band + thickness factor +
 * hydrogen factor, and return the recommended preheat (rounded to 25 °C).
 */

export interface SteelComposition {
  C: number; Mn: number;
  Cr?: number; Mo?: number; V?: number; Ni?: number; Cu?: number;
}

export type HydrogenLevel = 'low' | 'medium' | 'high'; // <5, 5-10, >10 mL/100g

export interface PreheatInput {
  composition: SteelComposition;
  combinedThicknessMm: number; // sum of plate thicknesses at the joint
  hydrogen: HydrogenLevel;
}

export interface PreheatResult {
  carbonEquivalent: number;
  recommendedPreheatC: number;
  band: 'none' | 'low' | 'medium' | 'high';
  thicknessFactorC: number;
  hydrogenFactorC: number;
  warnings: string[];
}

export function compute(input: PreheatInput): PreheatResult {
  const warnings: string[] = [];
  const c = input.composition;
  if (c.C < 0 || c.Mn < 0) warnings.push('Composition values must be non-negative.');

  const CE = carbonEquivalent(c);

  // Base preheat from CE band.
  let base: number;
  let band: 'none' | 'low' | 'medium' | 'high';
  if (CE <= 0.45) { base = 20; band = 'none'; }
  else if (CE <= 0.60) { base = 100; band = 'low'; }
  else if (CE <= 0.75) { base = 150; band = 'medium'; }
  else { base = 200; band = 'high'; }

  // Thickness factor: thick joints sink heat → more preheat.
  let thicknessFactor = 0;
  const t = input.combinedThicknessMm;
  if (t > 50) thicknessFactor = 50;
  else if (t > 30) thicknessFactor = 30;
  else if (t > 15) thicknessFactor = 15;

  // Hydrogen factor.
  const hydrogenFactor = input.hydrogen === 'high' ? 50 : input.hydrogen === 'medium' ? 25 : 0;

  let preheat = base + thicknessFactor + hydrogenFactor;
  if (band === 'none' && thicknessFactor === 0 && hydrogenFactor === 0) preheat = 20; // ambient OK
  // round up to nearest 25 °C.
  const recommended = Math.ceil(preheat / 25) * 25;

  if (CE > 0.75) warnings.push('High CE (>0.75): also use low-hydrogen consumables + consider PWHT.');

  return {
    carbonEquivalent: CE,
    recommendedPreheatC: Math.max(20, recommended),
    band,
    thicknessFactorC: thicknessFactor,
    hydrogenFactorC: hydrogenFactor,
    warnings,
  };
}

/** IIW carbon equivalent. */
export function carbonEquivalent(c: SteelComposition): number {
  return c.C
    + c.Mn / 6
    + ((c.Cr ?? 0) + (c.Mo ?? 0) + (c.V ?? 0)) / 5
    + ((c.Ni ?? 0) + (c.Cu ?? 0)) / 15;
}

/** Weldability verdict from CE. */
export function weldability(CE: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (CE <= 0.40) return 'excellent';
  if (CE <= 0.50) return 'good';
  if (CE <= 0.60) return 'fair';
  return 'poor';
}

export function summarize(r: PreheatResult): { carbonEquivalent: number; recommendedPreheatC: number; band: string } {
  return { carbonEquivalent: r.carbonEquivalent, recommendedPreheatC: r.recommendedPreheatC, band: r.band };
}
