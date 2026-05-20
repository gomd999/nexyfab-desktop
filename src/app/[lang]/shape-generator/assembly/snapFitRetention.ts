/**
 * snapFitRetention.ts — Analyse cantilever snap-fit beam retention
 * force and stress.
 *
 * For a cantilever snap-fit (plastic snap), four geometric quantities
 * matter:
 *   - Beam length L (mm)
 *   - Beam thickness t (mm)
 *   - Beam width b (mm)
 *   - Undercut Y (deflection during engagement, mm)
 *
 * Material: Young modulus E (MPa), allowable strain ε_max.
 *
 * Bending stress and force during engagement (Bayer/DuPont):
 *
 *   σ_max = 1.5 · E · t · Y / L²       (maximum bending stress)
 *   ε_max = σ_max / E
 *   F_engage = (b · t² / (6 · L)) · σ_max · tan(α + μ)
 *
 * where α is the engagement ramp angle and μ the static friction.
 *
 * Module returns engagement / retention forces, peak stress, and
 * pass/fail classification against allowable strain.
 */

export interface SnapFitGeometry {
  /** Beam length (mm). */
  lengthMm: number;
  /** Beam thickness at fixed end (mm). */
  thicknessMm: number;
  /** Beam width (mm). */
  widthMm: number;
  /** Maximum deflection during engagement (mm). */
  undercutMm: number;
  /** Engagement ramp angle, deg. */
  engagementRampDeg: number;
  /** Retention ramp angle, deg. */
  retentionRampDeg: number;
  /** Tapered beam: if true thickness halves at free end. */
  tapered: boolean;
}

export interface MaterialSpec {
  /** Young modulus (MPa). */
  youngMpa: number;
  /** Allowable strain (dimensionless, e.g. 0.04 for ABS). */
  allowableStrain: number;
  /** Static friction coefficient. */
  friction: number;
  name?: string;
}

export interface SnapFitAnalysis {
  peakStressMpa: number;
  peakStrain: number;
  engagementForceN: number;
  retentionForceN: number;
  /** Whether strain is within allowable. */
  strainOk: boolean;
  /** Safety factor (allowable strain / actual). */
  strainSafetyFactor: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function analyzeSnapFit(geo: SnapFitGeometry, material: MaterialSpec): SnapFitAnalysis {
  const warnings: string[] = [];
  if (geo.lengthMm <= 0 || geo.thicknessMm <= 0 || geo.widthMm <= 0) {
    warnings.push('Invalid geometry: dimensions must be positive.');
    return {
      peakStressMpa: 0, peakStrain: 0, engagementForceN: 0, retentionForceN: 0,
      strainOk: false, strainSafetyFactor: 0, warnings,
    };
  }
  const taperFactor = geo.tapered ? 1.09 : 1.0;
  const peakStress = (1.5 * material.youngMpa * geo.thicknessMm * geo.undercutMm) / (geo.lengthMm * geo.lengthMm) * taperFactor;
  const peakStrain = peakStress / material.youngMpa;
  // Force formula F = (b·t²/(6L)) · σ · tan(α+μ_eff)
  const baseCoef = (geo.widthMm * geo.thicknessMm * geo.thicknessMm) / (6 * geo.lengthMm);
  const engageEffectiveAngle = (geo.engagementRampDeg * Math.PI) / 180 + Math.atan(material.friction);
  const retentionEffectiveAngle = (geo.retentionRampDeg * Math.PI) / 180 + Math.atan(material.friction);
  const engagementForce = baseCoef * peakStress * safeTanForForce(engageEffectiveAngle);
  const retentionForce = baseCoef * peakStress * safeTanForForce(retentionEffectiveAngle);
  const strainOk = peakStrain <= material.allowableStrain;
  const sf = material.allowableStrain / Math.max(0.0001, peakStrain);

  if (!strainOk) warnings.push(`Peak strain ${(peakStrain * 100).toFixed(2)}% > allowable ${(material.allowableStrain * 100).toFixed(2)}%; beam will break.`);
  if (geo.retentionRampDeg > 89) warnings.push('Retention ramp ≥ 90° → permanent locking; cannot disengage.');
  if (geo.lengthMm / geo.thicknessMm < 5) warnings.push('Beam too short (L/t < 5); stress estimate may be inaccurate.');

  return {
    peakStressMpa: peakStress,
    peakStrain,
    engagementForceN: engagementForce,
    retentionForceN: retentionForce,
    strainOk,
    strainSafetyFactor: sf,
    warnings,
  };
}

/** Clamp effective angle just below 90° so the tan() stays positive and finite. */
function safeTanForForce(angleRad: number): number {
  const cap = (89.5 * Math.PI) / 180;
  return Math.tan(Math.min(angleRad, cap));
}

// ── Suggest geometry tweak ────────────────────────────────────

export interface GeometrySuggestion {
  newLengthMm?: number;
  newThicknessMm?: number;
  rationale: string;
}

export function suggestGeometry(analysis: SnapFitAnalysis, current: SnapFitGeometry, material: MaterialSpec): GeometrySuggestion | null {
  if (analysis.strainOk) return null;
  // Required reduction factor.
  const ratio = analysis.peakStrain / material.allowableStrain;
  // To reduce strain, increase L (linear in σ_max ∝ 1/L²) or reduce thickness.
  // Easiest: scale L by sqrt(ratio).
  const newL = current.lengthMm * Math.sqrt(ratio);
  return {
    newLengthMm: newL,
    rationale: `Increase beam length from ${current.lengthMm.toFixed(2)} → ${newL.toFixed(2)} mm to bring strain within allowable.`,
  };
}

// ── Material presets ──────────────────────────────────────────

export const MATERIAL_PRESETS: Record<string, MaterialSpec> = {
  'abs':       { youngMpa: 2200, allowableStrain: 0.04, friction: 0.5, name: 'ABS' },
  'pp':        { youngMpa: 1500, allowableStrain: 0.06, friction: 0.45, name: 'Polypropylene' },
  'pa66':      { youngMpa: 3000, allowableStrain: 0.05, friction: 0.4, name: 'PA66 Nylon' },
  'pc':        { youngMpa: 2300, allowableStrain: 0.04, friction: 0.55, name: 'Polycarbonate' },
  'acetal':    { youngMpa: 2800, allowableStrain: 0.05, friction: 0.35, name: 'Acetal (POM)' },
  'pet':       { youngMpa: 3100, allowableStrain: 0.04, friction: 0.4, name: 'PET' },
};

// ── Reaction force comparison ────────────────────────────────

export interface RetentionRatio {
  engagementForceN: number;
  retentionForceN: number;
  ratio: number;
  permanent: boolean;
}

export function retentionRatio(analysis: SnapFitAnalysis): RetentionRatio {
  const ratio = analysis.retentionForceN / Math.max(0.001, analysis.engagementForceN);
  return {
    engagementForceN: analysis.engagementForceN,
    retentionForceN: analysis.retentionForceN,
    ratio,
    permanent: !isFinite(ratio) || ratio > 10,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface SnapFitSummary {
  peakStressMpa: number;
  peakStrainPct: number;
  strainOk: boolean;
  engagementForceN: number;
  retentionForceN: number;
  warningCount: number;
}

export function summarize(analysis: SnapFitAnalysis): SnapFitSummary {
  return {
    peakStressMpa: analysis.peakStressMpa,
    peakStrainPct: analysis.peakStrain * 100,
    strainOk: analysis.strainOk,
    engagementForceN: analysis.engagementForceN,
    retentionForceN: analysis.retentionForceN,
    warningCount: analysis.warnings.length,
  };
}
