/**
 * hemStandards.ts — Sheet metal hem geometry per common shop standards.
 *
 * A hem is a folded-back edge that reinforces stiffness, removes
 * sharp edges, and provides a smoother appearance. Four common
 * styles (per Bralla, "Design for Manufacturing"):
 *
 *   - **Closed hem** — material folded 180°, both surfaces touching.
 *     Length ≈ 2× thickness. Strongest hem; hard to undo.
 *   - **Open hem** — material folded ~180° but with a gap (≥ 1×
 *     thickness). Easier to bend; more compliant.
 *   - **Teardrop hem** — radius ≈ 0.5-2× thickness, partial fold.
 *     Common when the metal is hardened or thick.
 *   - **Rolled hem** — full 360° rolled wire-like edge. Highest
 *     stiffness; needs a multi-pass rolling die.
 *
 * Module produces, for each style, the unfold dimensions (flat-blank
 * extension), bend allowance, force estimate, and minimum permissible
 * material thickness given a tool radius.
 */

export type HemStyle = 'closed' | 'open' | 'teardrop' | 'rolled';

export interface HemInput {
  /** Sheet thickness, mm. */
  thicknessMm: number;
  /** Hem style. */
  style: HemStyle;
  /** Material yield strength, MPa (for force estimate). */
  yieldStrengthMpa: number;
  /** Hem length along the edge, mm. */
  lengthMm: number;
  /** Optional inside-bend radius override (mm). */
  bendRadiusMm?: number;
  /** Optional gap for open hem (mm). Default = thickness. */
  gapMm?: number;
}

export interface HemResult {
  style: HemStyle;
  /** Flat blank extension along the hem direction (mm). */
  flatBlankExtensionMm: number;
  /** Bend allowance (additional flat length to account for the bend). */
  bendAllowanceMm: number;
  /** Estimated bending force, kN. */
  bendingForceKn: number;
  /** Hem thickness profile (sheet stacks). */
  finalThicknessMm: number;
  /** Inside radius used. */
  insideRadiusMm: number;
  /** Warnings (empty if all OK). */
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function computeHem(input: HemInput): HemResult {
  const t = input.thicknessMm;
  const warnings: string[] = [];

  // Default inside radius per style.
  const insideR = input.bendRadiusMm ?? defaultInsideRadius(input.style, t);
  const gap = input.gapMm ?? t;

  // K-factor for bend allowance (0.33 for tight bend, 0.42 for loose).
  const k = insideR < t ? 0.33 : 0.42;

  let flatExtension: number;
  let finalThickness: number;
  switch (input.style) {
    case 'closed':
      flatExtension = 2 * t + insideR;
      finalThickness = 2 * t;
      break;
    case 'open':
      flatExtension = 2 * t + insideR + gap;
      finalThickness = 2 * t + gap;
      break;
    case 'teardrop':
      flatExtension = (Math.PI * (insideR + t / 2)) * 0.75;
      finalThickness = 2 * t + insideR;
      break;
    case 'rolled':
      flatExtension = 2 * Math.PI * (insideR + t / 2);
      finalThickness = 2 * (insideR + t);
      break;
  }

  const bendAllowance = bendAllowanceMm(insideR, t, k);

  // Force estimate: F = (U · σ_y · L · t²) / W, U = 1.33 for V-die.
  // For a hem use a tight die opening W = 4t.
  const force = (1.33 * input.yieldStrengthMpa * input.lengthMm * t * t) / (4 * t);
  const forceKn = force / 1000;

  // Warnings.
  if (input.style === 'closed' && insideR > t * 0.5) {
    warnings.push('Closed hem with insideR > 0.5t may not fully close.');
  }
  if (input.style === 'rolled' && t > 1.5) {
    warnings.push('Rolled hem on sheet > 1.5 mm may need multi-pass tooling.');
  }
  if (insideR < t * 0.25) {
    warnings.push('Inside radius below 0.25× thickness — cracking risk.');
  }

  return {
    style: input.style,
    flatBlankExtensionMm: flatExtension + bendAllowance,
    bendAllowanceMm: bendAllowance,
    bendingForceKn: forceKn,
    finalThicknessMm: finalThickness,
    insideRadiusMm: insideR,
    warnings,
  };
}

// ── Helpers ────────────────────────────────────────────────────

export function defaultInsideRadius(style: HemStyle, thicknessMm: number): number {
  switch (style) {
    case 'closed': return 0;
    case 'open': return thicknessMm * 0.5;
    case 'teardrop': return thicknessMm * 1.0;
    case 'rolled': return thicknessMm * 2.0;
  }
}

export function bendAllowanceMm(insideRadiusMm: number, thicknessMm: number, kFactor: number): number {
  // Wallace formula at 180°: BA = π · (r + k·t).
  return Math.PI * (insideRadiusMm + kFactor * thicknessMm);
}

// ── Style comparison ───────────────────────────────────────────

export interface HemComparison {
  style: HemStyle;
  flatBlankExtensionMm: number;
  finalThicknessMm: number;
  bendingForceKn: number;
}

/** Compute all four hem styles for the same material spec. */
export function compareAllStyles(
  thicknessMm: number,
  yieldMpa: number,
  lengthMm: number,
): HemComparison[] {
  const styles: HemStyle[] = ['closed', 'open', 'teardrop', 'rolled'];
  return styles.map(style => {
    const r = computeHem({ thicknessMm, style, yieldStrengthMpa: yieldMpa, lengthMm });
    return {
      style,
      flatBlankExtensionMm: r.flatBlankExtensionMm,
      finalThicknessMm: r.finalThicknessMm,
      bendingForceKn: r.bendingForceKn,
    };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface HemSummary {
  style: HemStyle;
  flatBlankExtensionMm: number;
  thicknessIncreaseFactor: number;
  bendingForceKn: number;
  warningCount: number;
  isFeasible: boolean;
}

export function summarize(result: HemResult, originalThickness: number): HemSummary {
  return {
    style: result.style,
    flatBlankExtensionMm: result.flatBlankExtensionMm,
    thicknessIncreaseFactor: result.finalThicknessMm / originalThickness,
    bendingForceKn: result.bendingForceKn,
    warningCount: result.warnings.length,
    isFeasible: result.warnings.length === 0,
  };
}
