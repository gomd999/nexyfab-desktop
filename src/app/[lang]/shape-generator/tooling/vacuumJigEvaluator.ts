/**
 * vacuumJigEvaluator.ts — Evaluate the holding force of a vacuum
 * fixture (vacuum jig / vacuum table) for a part.
 *
 * Vacuum jigs are widely used in CNC routers and laser cutters for
 * sheet workholding. Holding force depends on:
 *
 *   - Effective contact area between part and jig.
 *   - Vacuum level (= delta pressure between atmosphere and pump).
 *   - Leakage through gaps, sealed-vs-open zones.
 *
 *      F_hold = A_contact · (P_atm - P_vac) · efficiency
 *
 * The fixture is divided into *zones*: each zone has its own
 * contact area + vacuum level (some shops only run vacuum where
 * needed to save pump power).
 *
 * Module also checks for:
 *
 *   - Force margin vs cutting forces during machining.
 *   - Slip risk (when lateral cutting force > μ · F_hold).
 *   - Part deflection due to vacuum pull (thin parts can bow).
 */

export interface VacuumZone {
  id: string;
  /** Contact area, mm². */
  areaMm2: number;
  /** Vacuum level, kPa (positive number = partial vacuum). 70 kPa typical. */
  vacuumKpa: number;
  /** Sealing efficiency (0..1). 1 = perfect seal. */
  efficiency: number;
}

export interface PartLoad {
  /** Approximate cutting force during machining, N. */
  cuttingForceN: number;
  /** Coefficient of friction part-to-jig. */
  friction: number;
  /** Part mass, kg. */
  massKg: number;
}

export interface EvaluationResult {
  /** Sum of holding force across zones, N. */
  holdingForceN: number;
  /** Per-zone holding force breakdown. */
  perZoneForceN: Array<{ zoneId: string; forceN: number }>;
  /** Minimum slip threshold (lateral force at which part slips). */
  slipThresholdN: number;
  /** Safety factor = holdingForce / cuttingForce. */
  safetyFactor: number;
  /** Will the part slip during the planned cut? */
  willSlip: boolean;
  /** Warnings. */
  warnings: string[];
}

export interface EvaluationOptions {
  /** Atmospheric pressure (kPa). Default sea level = 101.325. */
  atmosphericKpa: number;
}

export const DEFAULT_OPTIONS: EvaluationOptions = {
  atmosphericKpa: 101.325,
};

// ── Top-level entry ────────────────────────────────────────────

export function evaluateVacuumJig(
  zones: VacuumZone[],
  load: PartLoad,
  options: Partial<EvaluationOptions> = {},
): EvaluationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  const perZone: Array<{ zoneId: string; forceN: number }> = [];
  let totalForce = 0;
  for (const z of zones) {
    if (z.vacuumKpa > opts.atmosphericKpa) {
      warnings.push(`zone ${z.id}: vacuum > atmospheric pressure (impossible).`);
    }
    // F = ΔP × A × efficiency; convert kPa·mm² → N (1 kPa·mm² = 0.001 N).
    const f = z.vacuumKpa * z.areaMm2 * z.efficiency * 0.001;
    perZone.push({ zoneId: z.id, forceN: f });
    totalForce += f;
  }
  // Slip threshold = friction × holding force (gravity helps if part is on top).
  const gravityN = load.massKg * 9.81;
  const slipThreshold = load.friction * (totalForce + gravityN);
  const safetyFactor = load.cuttingForceN > 0 ? totalForce / load.cuttingForceN : Infinity;
  const willSlip = load.cuttingForceN > slipThreshold;
  if (willSlip) warnings.push(`Lateral cutting force ${load.cuttingForceN.toFixed(1)} N exceeds slip threshold ${slipThreshold.toFixed(1)} N.`);
  if (safetyFactor < 2 && safetyFactor !== Infinity) warnings.push(`Safety factor ${safetyFactor.toFixed(2)} below recommended 2.0.`);

  return {
    holdingForceN: totalForce,
    perZoneForceN: perZone,
    slipThresholdN: slipThreshold,
    safetyFactor,
    willSlip,
    warnings,
  };
}

// ── Zone builders ──────────────────────────────────────────────

export function buildFullSurfaceZone(id: string, areaMm2: number, vacuumKpa: number = 70, efficiency: number = 0.95): VacuumZone {
  return { id, areaMm2, vacuumKpa, efficiency };
}

export function buildGridZones(rows: number, cols: number, cellAreaMm2: number, vacuumKpa: number = 70): VacuumZone[] {
  const out: VacuumZone[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ id: `cell-${r}-${c}`, areaMm2: cellAreaMm2, vacuumKpa, efficiency: 0.92 });
    }
  }
  return out;
}

// ── Part deflection check ─────────────────────────────────────

export interface DeflectionInput {
  /** Part thickness, mm. */
  thicknessMm: number;
  /** Vacuum delta pressure, kPa. */
  deltaKpa: number;
  /** Unsupported span (longest direction), mm. */
  spanMm: number;
  /** Young's modulus, GPa. */
  youngGpa: number;
}

/** Plate bending under uniform pressure (simply supported, isotropic). */
export function approximatePlateDeflection(input: DeflectionInput): number {
  // δ ≈ α · q · L⁴ / (E · t³). α ≈ 0.0026 for simply supported square plate.
  const alpha = 0.0026;
  const q = input.deltaKpa * 1e-3; // kPa → N/mm²
  const E = input.youngGpa * 1000; // GPa → N/mm²
  const L = input.spanMm;
  return (alpha * q * Math.pow(L, 4)) / (E * Math.pow(input.thicknessMm, 3));
}

// ── Summary ────────────────────────────────────────────────────

export interface JigSummary {
  totalHoldingForceN: number;
  zonesUsed: number;
  averageZoneForceN: number;
  safetyFactor: number;
  warningCount: number;
  isAdequate: boolean;
}

export function summarize(result: EvaluationResult, zoneCount: number): JigSummary {
  const avg = zoneCount > 0 ? result.holdingForceN / zoneCount : 0;
  return {
    totalHoldingForceN: result.holdingForceN,
    zonesUsed: zoneCount,
    averageZoneForceN: avg,
    safetyFactor: result.safetyFactor,
    warningCount: result.warnings.length,
    isAdequate: !result.willSlip && result.safetyFactor >= 2,
  };
}
