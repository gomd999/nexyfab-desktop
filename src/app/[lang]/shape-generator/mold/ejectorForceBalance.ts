/**
 * ejectorForceBalance.ts — Verify ejector force balance across pins
 * in an injection mold.
 *
 * Ejector pin layout must:
 *   - Apply uniform force (no tipping during ejection).
 *   - Stay below per-pin buckling limit.
 *   - Sum of ejection forces ≥ release force needed.
 *
 * Module:
 *   - Computes per-pin load given a target ejection force.
 *   - Detects imbalance (max - min > tolerance).
 *   - Checks against pin buckling capacity using Euler formula.
 *   - Suggests adding pins or relocating to balance.
 */

export interface Vec2 { x: number; y: number }

export interface EjectorPin {
  id: string;
  position: Vec2;
  /** Pin diameter (mm). */
  diameterMm: number;
  /** Free length between fixed ends (mm). */
  freeLengthMm: number;
  /** Pin material young modulus (MPa). */
  youngMpa: number;
}

export interface EjectionRequirement {
  /** Total release force needed (N). */
  releaseForceN: number;
  /** Part centroid (where the force resists). */
  partCentroid: Vec2;
}

export interface BalanceOptions {
  /** Imbalance tolerance: max-min as fraction of mean. */
  imbalanceTolerance: number;
  /** Safety factor on Euler buckling. */
  bucklingSafetyFactor: number;
}

export const DEFAULT_OPTIONS: BalanceOptions = {
  imbalanceTolerance: 0.2,
  bucklingSafetyFactor: 4,
};

export interface PinLoad {
  pinId: string;
  loadN: number;
  bucklingCapacityN: number;
  utilisation: number;
  /** Whether this pin buckles. */
  buckles: boolean;
}

export interface BalanceResult {
  loads: PinLoad[];
  meanLoadN: number;
  imbalanceFraction: number;
  bucklingPins: string[];
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function balanceForces(pins: EjectorPin[], req: EjectionRequirement, options: Partial<BalanceOptions> = {}): BalanceResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  if (pins.length === 0) {
    warnings.push('No pins defined.');
    return { loads: [], meanLoadN: 0, imbalanceFraction: 0, bucklingPins: [], warnings };
  }

  // Distribute force inversely by distance from centroid (closer pins carry more).
  const distances = pins.map(p => Math.hypot(p.position.x - req.partCentroid.x, p.position.y - req.partCentroid.y));
  const weights = distances.map(d => 1 / (d + 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const loads: PinLoad[] = pins.map((p, i) => {
    const loadN = (weights[i]! / totalWeight) * req.releaseForceN;
    const capacity = eulerBucklingCapacity(p);
    const util = loadN / Math.max(0.01, capacity / opts.bucklingSafetyFactor);
    return {
      pinId: p.id,
      loadN,
      bucklingCapacityN: capacity,
      utilisation: util,
      buckles: loadN > capacity / opts.bucklingSafetyFactor,
    };
  });

  const sumLoad = loads.reduce((s, l) => s + l.loadN, 0);
  const mean = sumLoad / loads.length;
  let max = 0, min = Infinity;
  for (const l of loads) {
    if (l.loadN > max) max = l.loadN;
    if (l.loadN < min) min = l.loadN;
  }
  const imbalance = mean === 0 ? 0 : (max - min) / mean;
  if (imbalance > opts.imbalanceTolerance) {
    warnings.push(`Pin load imbalance ${(imbalance * 100).toFixed(1)}% > ${(opts.imbalanceTolerance * 100).toFixed(0)}%.`);
  }
  const buckling = loads.filter(l => l.buckles).map(l => l.pinId);
  if (buckling.length > 0) warnings.push(`${buckling.length} pin(s) buckle under load.`);

  return { loads, meanLoadN: mean, imbalanceFraction: imbalance, bucklingPins: buckling, warnings };
}

// ── Euler buckling capacity ──────────────────────────────────

function eulerBucklingCapacity(pin: EjectorPin): number {
  const radius = pin.diameterMm / 2;
  const I = (Math.PI * Math.pow(radius, 4)) / 4;
  // Fixed-fixed K = 0.5. P_cr = π² · E · I / (K · L)²
  const L_mm = pin.freeLengthMm;
  const K = 0.5;
  return (Math.PI * Math.PI * pin.youngMpa * I) / Math.pow(K * L_mm, 2);
}

// ── Suggest pin layout fix ───────────────────────────────────

export interface PinSuggestion {
  action: 'add-pin' | 'reposition' | 'increase-diameter';
  rationale: string;
}

export function suggestFix(result: BalanceResult, pins: EjectorPin[]): PinSuggestion[] {
  const suggestions: PinSuggestion[] = [];
  if (result.bucklingPins.length > 0) {
    suggestions.push({
      action: 'increase-diameter',
      rationale: `${result.bucklingPins.length} pin(s) buckle; increase diameter or add more pins.`,
    });
  }
  if (result.imbalanceFraction > 0.2) {
    suggestions.push({
      action: 'add-pin',
      rationale: `Imbalance ${(result.imbalanceFraction * 100).toFixed(0)}%; add a pin near least-loaded region.`,
    });
  }
  if (pins.length < 4) {
    suggestions.push({ action: 'add-pin', rationale: 'Less than 4 pins; consider redundancy.' });
  }
  return suggestions;
}

// ── Total ejection capacity ──────────────────────────────────

export interface CapacityCheck {
  totalAvailableN: number;
  required: number;
  ok: boolean;
}

export function checkCapacity(pins: EjectorPin[], req: EjectionRequirement, sf: number = 4): CapacityCheck {
  let total = 0;
  for (const p of pins) total += eulerBucklingCapacity(p) / sf;
  return { totalAvailableN: total, required: req.releaseForceN, ok: total >= req.releaseForceN };
}

// ── Summary ────────────────────────────────────────────────────

export interface BalanceSummary {
  pinCount: number;
  meanLoadN: number;
  imbalanceFractionPct: number;
  bucklingCount: number;
  warningCount: number;
}

export function summarize(result: BalanceResult): BalanceSummary {
  return {
    pinCount: result.loads.length,
    meanLoadN: result.meanLoadN,
    imbalanceFractionPct: result.imbalanceFraction * 100,
    bucklingCount: result.bucklingPins.length,
    warningCount: result.warnings.length,
  };
}
