/**
 * wallFunction.ts — Turbulence wall functions for CFD.
 *
 * In high-Reynolds-number turbulent flow, the gradient near a solid
 * wall is extreme — velocity goes from 0 (no-slip) to free-stream
 * across a layer that may be < 1 mm thick. Resolving this region
 * with a normal grid takes y⁺ ≈ 1 cells, which means millions of
 * cells just for boundary layers. Wall functions bridge the gap by
 * applying an analytical near-wall profile, letting the grid stay
 * coarse (y⁺ ≈ 30-300).
 *
 * Profiles:
 *
 *   - **Viscous sublayer** (y⁺ < 5): u⁺ = y⁺ (linear).
 *   - **Buffer layer** (5 < y⁺ < 30): blended; usually avoided.
 *   - **Log-law region** (30 < y⁺ < 300): u⁺ = (1/κ) ln(y⁺) + B,
 *     where κ ≈ 0.41 (von Kármán constant), B ≈ 5.0.
 *
 * Wall shear stress τ_w follows from u⁺ and the free-stream velocity.
 *
 * For low-Re flow or near-wall regions of interest (heat transfer,
 * separation), use a low-Reynolds model that resolves to y⁺ = 1
 * instead of a wall function.
 */

export const KAPPA = 0.41;
export const B_CONSTANT = 5.0;

export interface WallProfilePoint {
  /** Dimensionless wall distance y⁺ = y · u_τ / ν. */
  yPlus: number;
  /** Dimensionless velocity u⁺ = u / u_τ. */
  uPlus: number;
  /** Regime classification. */
  regime: 'viscous' | 'buffer' | 'log-law' | 'outer';
}

// ── Wall profile ────────────────────────────────────────────────

export function uPlusFromYPlus(yPlus: number): WallProfilePoint {
  if (yPlus <= 5) {
    return { yPlus, uPlus: yPlus, regime: 'viscous' };
  }
  if (yPlus <= 30) {
    // Reichardt's law as a smooth blend (used by OpenFOAM nutkWallFunction).
    const uPlus = (1 / KAPPA) * Math.log(1 + KAPPA * yPlus) + 7.8 * (1 - Math.exp(-yPlus / 11) - (yPlus / 11) * Math.exp(-yPlus / 3));
    return { yPlus, uPlus, regime: 'buffer' };
  }
  if (yPlus <= 300) {
    return {
      yPlus,
      uPlus: (1 / KAPPA) * Math.log(yPlus) + B_CONSTANT,
      regime: 'log-law',
    };
  }
  return {
    yPlus,
    uPlus: (1 / KAPPA) * Math.log(yPlus) + B_CONSTANT,
    regime: 'outer',
  };
}

// ── Friction velocity from free-stream ─────────────────────────

export interface FrictionVelocityResult {
  /** Friction velocity u_τ (m/s). */
  uTau: number;
  /** y⁺ value at the first off-wall cell. */
  yPlus: number;
  /** Wall shear stress (Pa). */
  wallShearStress: number;
}

/** Iterate to find u_τ such that the log-law matches the free-stream
 *  velocity at the centroid of the first off-wall cell. */
export function frictionVelocity(
  freeStreamVelocity: number,
  firstCellWallDistance: number,
  kinematicViscosity: number,
  density: number,
  maxIterations: number = 50,
): FrictionVelocityResult {
  // Newton iteration on the log-law: u/u_τ = (1/κ) ln(y u_τ / ν) + B.
  // Initial guess from Reynolds number.
  let uTau = freeStreamVelocity * 0.04;
  for (let i = 0; i < maxIterations; i++) {
    const yPlus = uTau * firstCellWallDistance / kinematicViscosity;
    if (yPlus <= 0) {
      uTau = Math.max(uTau, 1e-6);
      continue;
    }
    const uPlus = (1 / KAPPA) * Math.log(yPlus) + B_CONSTANT;
    const predicted = uTau * uPlus;
    const err = predicted - freeStreamVelocity;
    if (Math.abs(err) < 1e-9) break;
    // Update: uTau ← uTau - err * (∂F/∂uTau)⁻¹.
    const dydU = firstCellWallDistance / kinematicViscosity;
    const dErr = uPlus + (1 / KAPPA) * (dydU / yPlus) * uTau;
    if (Math.abs(dErr) < 1e-12) break;
    uTau -= err / dErr;
    if (uTau < 1e-9) uTau = 1e-9;
  }
  const yPlus = uTau * firstCellWallDistance / kinematicViscosity;
  return {
    uTau,
    yPlus,
    wallShearStress: density * uTau * uTau,
  };
}

// ── Skin friction coefficient ───────────────────────────────────

/** Cf = τ_w / (½ ρ U²). */
export function skinFrictionCoefficient(wallShearStress: number, density: number, freeStreamVelocity: number): number {
  if (freeStreamVelocity <= 0) return 0;
  return wallShearStress / (0.5 * density * freeStreamVelocity * freeStreamVelocity);
}

// ── y⁺ classification ───────────────────────────────────────────

export type YPlusRegime = 'too-small' | 'viscous' | 'buffer-warning' | 'log-law-good' | 'too-large';

export function classifyYPlus(yPlus: number): { regime: YPlusRegime; message: string } {
  if (yPlus < 1) return { regime: 'too-small', message: 'y⁺ < 1: overkill for wall function, consider low-Re model' };
  if (yPlus < 5) return { regime: 'viscous', message: `y⁺ = ${yPlus.toFixed(1)} in viscous sublayer — direct resolution` };
  if (yPlus < 30) return { regime: 'buffer-warning', message: `y⁺ = ${yPlus.toFixed(1)} in buffer layer — wall function less reliable` };
  if (yPlus <= 300) return { regime: 'log-law-good', message: `y⁺ = ${yPlus.toFixed(1)} in log-law region — wall function OK` };
  return { regime: 'too-large', message: `y⁺ = ${yPlus.toFixed(1)} too coarse — refine first cell` };
}

// ── First-cell sizing helper ────────────────────────────────────

/** Recommended first-cell distance for target y⁺ at given Reynolds. */
export function firstCellDistanceForTargetYPlus(
  targetYPlus: number,
  characteristicLength: number,
  reynoldsNumber: number,
  kinematicViscosity: number,
): number {
  if (reynoldsNumber <= 0) return characteristicLength;
  // Use flat-plate skin friction estimate Cf ≈ 0.058 Re^(-0.2) (turbulent).
  const cf = 0.058 / Math.pow(reynoldsNumber, 0.2);
  const uFreeStream = (reynoldsNumber * kinematicViscosity) / characteristicLength;
  const uTau = uFreeStream * Math.sqrt(cf / 2);
  if (uTau <= 0) return characteristicLength;
  return (targetYPlus * kinematicViscosity) / uTau;
}

// ── Turbulent kinetic energy from wall function ─────────────────

export interface TurbulenceWallValues {
  /** k (m²/s²). */
  turbulentKineticEnergy: number;
  /** ε (m²/s³). */
  turbulentDissipation: number;
  /** ω (1/s) for k-ω models. */
  specificDissipation: number;
}

/** Standard k-ε wall function boundary values:
 *    k = u_τ² / √Cμ (Cμ ≈ 0.09)
 *    ε = u_τ³ / (κ y)
 *    ω = u_τ / (√Cμ κ y) */
export function turbulenceWallValues(uTau: number, wallDistance: number, cMu: number = 0.09): TurbulenceWallValues {
  const k = (uTau * uTau) / Math.sqrt(cMu);
  const eps = (uTau * uTau * uTau) / (KAPPA * Math.max(wallDistance, 1e-9));
  const omega = uTau / (Math.sqrt(cMu) * KAPPA * Math.max(wallDistance, 1e-9));
  return {
    turbulentKineticEnergy: k,
    turbulentDissipation: eps,
    specificDissipation: omega,
  };
}
