/**
 * toolDeflection.ts — End-mill deflection as a cantilever beam.
 *
 *   δ = F · L³ / (3 · E · I),   I = π · d_eff⁴ / 64,   d_eff = k_f · d
 *
 * The fluted section is weaker than the shank, so an effective-diameter
 * factor k_f (≈ 0.8 for a 4-flute) reduces the stiffness. Slenderness L/D
 * drives chatter risk; deflection drives part accuracy.
 */

export type ToolMaterial = 'carbide' | 'HSS' | 'cobalt';

const MODULUS_MPA: Record<ToolMaterial, number> = {
  carbide: 600_000, cobalt: 240_000, HSS: 210_000,
};

// Effective-diameter factor by flute count (more flutes → less core).
function fluteFactor(flutes: number): number {
  if (flutes <= 2) return 0.85;
  if (flutes === 3) return 0.82;
  if (flutes === 4) return 0.80;
  return 0.78;
}

export interface ToolDeflectionInput {
  toolDiameterMm: number;
  stickoutMm: number;            // L (overhang from holder)
  cuttingForceN: number;         // radial force at the tip
  fluteCount?: number;           // default 4
  material?: ToolMaterial;       // default carbide
}

export interface ToolDeflectionResult {
  effectiveDiameterMm: number;
  secondMomentMm4: number;
  stiffnessNPerMm: number;
  deflectionMm: number;
  slendernessLD: number;
  chatterRisk: 'low' | 'moderate' | 'high';
  warnings: string[];
}

export function compute(input: ToolDeflectionInput): ToolDeflectionResult {
  const warnings: string[] = [];
  const flutes = input.fluteCount ?? 4;
  const E = MODULUS_MPA[input.material ?? 'carbide'];
  const kf = fluteFactor(flutes);
  const dEff = kf * input.toolDiameterMm;

  if (input.toolDiameterMm <= 0) warnings.push('Tool diameter must be positive.');
  if (input.stickoutMm <= 0) warnings.push('Stickout must be positive.');

  const I = (Math.PI / 64) * Math.pow(dEff, 4);
  const L = input.stickoutMm;
  const stiffness = L > 0 ? (3 * E * I) / Math.pow(L, 3) : Infinity;
  const deflection = stiffness > 0 ? input.cuttingForceN / stiffness : Infinity;

  const ld = input.toolDiameterMm > 0 ? L / input.toolDiameterMm : Infinity;
  const chatterRisk: 'low' | 'moderate' | 'high' = ld <= 3 ? 'low' : ld <= 5 ? 'moderate' : 'high';
  if (ld > 5) warnings.push(`L/D ${ld.toFixed(1)} > 5: high chatter risk, consider a stub/necked tool.`);

  return {
    effectiveDiameterMm: dEff,
    secondMomentMm4: I,
    stiffnessNPerMm: stiffness,
    deflectionMm: deflection,
    slendernessLD: ld,
    chatterRisk,
    warnings,
  };
}

/** Max stickout (mm) that keeps deflection within a tolerance, same force. */
export function maxStickoutForTolerance(input: Omit<ToolDeflectionInput, 'stickoutMm'>, toleranceMm: number): number {
  const flutes = input.fluteCount ?? 4;
  const E = MODULUS_MPA[input.material ?? 'carbide'];
  const dEff = fluteFactor(flutes) * input.toolDiameterMm;
  const I = (Math.PI / 64) * Math.pow(dEff, 4);
  if (toleranceMm <= 0 || input.cuttingForceN <= 0) return 0;
  // δ = F L³/(3EI) ≤ tol → L = (3·E·I·tol / F)^(1/3)
  return Math.pow((3 * E * I * toleranceMm) / input.cuttingForceN, 1 / 3);
}

export function summarize(r: ToolDeflectionResult): {
  deflectionMm: number; slendernessLD: number; chatterRisk: string;
} {
  return { deflectionMm: r.deflectionMm, slendernessLD: r.slendernessLD, chatterRisk: r.chatterRisk };
}
