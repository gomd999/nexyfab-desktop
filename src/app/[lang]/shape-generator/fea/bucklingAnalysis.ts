/**
 * bucklingAnalysis.ts — Column / plate buckling stability check.
 *
 * Stage-1 FEA covers static stress (Cauchy → von Mises) and modal
 * analysis (natural frequencies). Stage 2 adds *stability* checks:
 * does the structure buckle under compressive load before it yields?
 *
 * Two regimes:
 *
 *   1. **Euler buckling** (long, slender columns) —
 *      P_cr = (π² · E · I) / (L_eff)²
 *
 *      where L_eff depends on end conditions:
 *        - both ends pinned:  L_eff = L
 *        - both ends fixed:   L_eff = 0.5 · L
 *        - one fixed, one free: L_eff = 2 · L
 *        - one fixed, one pinned: L_eff = 0.7 · L
 *
 *   2. **Johnson buckling** (intermediate columns) — applies when
 *      slenderness ratio < critical slenderness. Smooth transition
 *      from elastic Euler curve to yield strength.
 *
 * Choice between Euler/Johnson is made by comparing slenderness ratio
 * (L_eff / k, where k = √(I / A)) against the critical slenderness
 * Cc = √(2 · π² · E / σy).
 */

export type EndCondition = 'pinned-pinned' | 'fixed-fixed' | 'fixed-free' | 'fixed-pinned';

const EFFECTIVE_LENGTH_FACTOR: Record<EndCondition, number> = {
  'pinned-pinned': 1.0,
  'fixed-fixed': 0.5,
  'fixed-free': 2.0,
  'fixed-pinned': 0.7,
};

export interface ColumnGeometry {
  /** Cross-section area (mm²). */
  areaMm2: number;
  /** Smaller principal moment of inertia (mm⁴). */
  minMomentOfInertiaMm4: number;
  /** Column length (mm). */
  lengthMm: number;
  endCondition: EndCondition;
}

export interface MaterialForBuckling {
  /** Young's modulus (MPa = N/mm²). */
  elasticModulusMpa: number;
  /** Yield strength (MPa). */
  yieldStrengthMpa: number;
}

export interface BucklingResult {
  /** Effective length L_eff (mm). */
  effectiveLengthMm: number;
  /** Radius of gyration k = √(I / A) (mm). */
  radiusOfGyrationMm: number;
  /** Slenderness ratio λ = L_eff / k. */
  slendernessRatio: number;
  /** Transition slenderness Cc (Euler/Johnson boundary). */
  transitionSlenderness: number;
  /** Critical buckling load (N). */
  criticalLoadN: number;
  /** Regime used. */
  regime: 'euler' | 'johnson';
  /** Critical compressive stress at failure (MPa). */
  criticalStressMpa: number;
}

export function analyzeBuckling(
  geometry: ColumnGeometry,
  material: MaterialForBuckling,
): BucklingResult {
  const K = EFFECTIVE_LENGTH_FACTOR[geometry.endCondition];
  const lEff = K * geometry.lengthMm;
  const k = Math.sqrt(geometry.minMomentOfInertiaMm4 / geometry.areaMm2);
  const lambda = lEff / k;
  const Cc = Math.sqrt((2 * Math.PI * Math.PI * material.elasticModulusMpa) / material.yieldStrengthMpa);

  if (lambda > Cc) {
    // Long column — Euler regime.
    const sigmaCr = (Math.PI * Math.PI * material.elasticModulusMpa) / (lambda * lambda);
    return {
      effectiveLengthMm: lEff,
      radiusOfGyrationMm: k,
      slendernessRatio: lambda,
      transitionSlenderness: Cc,
      criticalLoadN: sigmaCr * geometry.areaMm2,
      regime: 'euler',
      criticalStressMpa: sigmaCr,
    };
  }
  // Intermediate column — Johnson formula.
  const sigmaCr = material.yieldStrengthMpa
    * (1 - (lambda * lambda) / (2 * Cc * Cc));
  return {
    effectiveLengthMm: lEff,
    radiusOfGyrationMm: k,
    slendernessRatio: lambda,
    transitionSlenderness: Cc,
    criticalLoadN: sigmaCr * geometry.areaMm2,
    regime: 'johnson',
    criticalStressMpa: sigmaCr,
  };
}

/** Compute safety factor against buckling, given an applied load. */
export function bucklingSafetyFactor(
  result: BucklingResult,
  appliedLoadN: number,
): number {
  if (appliedLoadN <= 0) return Infinity;
  return result.criticalLoadN / appliedLoadN;
}

/** Helper — minimum I for a rectangular cross-section b × h. */
export function rectangleMinI(b: number, h: number): number {
  const small = Math.min(b, h);
  const large = Math.max(b, h);
  // I = (b·h³)/12 about the centroidal axis; minimum is the axis where
  // h is the smaller dimension.
  return (large * small * small * small) / 12;
}

/** Helper — I for a circular cross-section of diameter d. */
export function circleI(diameter: number): number {
  return (Math.PI * Math.pow(diameter, 4)) / 64;
}

/** Helper — I for an annular (hollow) cross-section. */
export function annulusI(outerDiameter: number, innerDiameter: number): number {
  return (Math.PI * (Math.pow(outerDiameter, 4) - Math.pow(innerDiameter, 4))) / 64;
}

// ── Plate buckling ─────────────────────────────────────────────────

/** Simply supported rectangular plate under uniaxial compression —
 *  critical stress σ_cr = k · π² · E / (12 (1 - ν²)) · (t/b)²
 *
 *  k depends on aspect ratio a/b; default k = 4 (long plate). */
export function plateBucklingStress(
  thicknessMm: number,
  widthMm: number,
  elasticModulusMpa: number,
  poissonsRatio: number,
  k: number = 4,
): number {
  const t = thicknessMm;
  const b = widthMm;
  return k * Math.PI * Math.PI * elasticModulusMpa
    / (12 * (1 - poissonsRatio * poissonsRatio))
    * (t / b) * (t / b);
}
