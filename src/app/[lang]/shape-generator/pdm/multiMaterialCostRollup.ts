/**
 * multiMaterialCostRollup.ts — Cost rollup for parts/assemblies that
 * combine multiple materials.
 *
 * A typical multi-material part: aluminum body, steel inserts,
 * plastic gasket. Each material has its own:
 *
 *   - Unit cost (USD/kg).
 *   - Required volume (cm³).
 *   - Density (g/cm³).
 *   - Process cost (machining/molding/coating).
 *   - Waste factor (overspray / chip / scrap).
 *
 * Total cost = Σ (material cost + process cost + per-unit overhead).
 * Useful for the cost panel + RFQ quote breakdown.
 *
 * Module also computes:
 *
 *   - Material breakdown by mass + cost.
 *   - Largest cost driver.
 *   - Sensitivity (what happens if any one material price moves 10%).
 *   - Comparison across two material specs.
 */

export interface MaterialSpec {
  /** Material id (e.g. "Al6061", "AISI1018", "ABS"). */
  id: string;
  /** Display name. */
  name: string;
  /** Unit cost USD/kg. */
  unitCostUsdPerKg: number;
  /** Density g/cm³. */
  densityGcm3: number;
}

export interface PartMaterialUse {
  materialId: string;
  /** Volume used in cm³ (gross — includes waste). */
  volumeCm3: number;
  /** Optional waste factor (default 0). 0.1 = 10% extra material. */
  wasteFraction?: number;
  /** Process cost added on top of raw material, USD. */
  processCostUsd?: number;
}

export interface CostLine {
  materialId: string;
  materialName: string;
  massKg: number;
  rawMaterialCostUsd: number;
  wasteCostUsd: number;
  processCostUsd: number;
  totalUsd: number;
  /** Fraction of total cost (0..1). */
  shareOfTotal: number;
}

export interface RollupResult {
  lines: CostLine[];
  /** Grand total. */
  totalUsd: number;
  /** Largest line. */
  primaryDriver: string;
  /** Sensitivity: USD impact per 10% increase per material. */
  sensitivities: Array<{ materialId: string; deltaPer10PctUsd: number }>;
}

export interface RollupOptions {
  /** Per-unit overhead applied once (USD). */
  perUnitOverheadUsd: number;
}

export const DEFAULT_OPTIONS: RollupOptions = {
  perUnitOverheadUsd: 0,
};

// ── Top-level entry ────────────────────────────────────────────

export function rollup(
  uses: PartMaterialUse[],
  materials: MaterialSpec[],
  options: Partial<RollupOptions> = {},
): RollupResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const matMap = new Map<string, MaterialSpec>();
  for (const m of materials) matMap.set(m.id, m);

  // First pass: compute totals.
  const lines: CostLine[] = [];
  let grandTotal = opts.perUnitOverheadUsd;
  for (const u of uses) {
    const mat = matMap.get(u.materialId);
    if (!mat) continue;
    const waste = u.wasteFraction ?? 0;
    const grossVol = u.volumeCm3 * (1 + waste);
    const grossMass = (grossVol * mat.densityGcm3) / 1000;
    const rawMass = (u.volumeCm3 * mat.densityGcm3) / 1000;
    const rawCost = rawMass * mat.unitCostUsdPerKg;
    const wasteCost = (grossMass - rawMass) * mat.unitCostUsdPerKg;
    const processCost = u.processCostUsd ?? 0;
    const total = rawCost + wasteCost + processCost;
    grandTotal += total;
    lines.push({
      materialId: u.materialId,
      materialName: mat.name,
      massKg: grossMass,
      rawMaterialCostUsd: rawCost,
      wasteCostUsd: wasteCost,
      processCostUsd: processCost,
      totalUsd: total,
      shareOfTotal: 0,
    });
  }

  // Add a synthetic overhead line so shareOfTotal sums to 1.
  if (opts.perUnitOverheadUsd > 0) {
    lines.push({
      materialId: '_overhead',
      materialName: 'Overhead',
      massKg: 0,
      rawMaterialCostUsd: 0,
      wasteCostUsd: 0,
      processCostUsd: opts.perUnitOverheadUsd,
      totalUsd: opts.perUnitOverheadUsd,
      shareOfTotal: 0,
    });
  }

  // Second pass: shareOfTotal.
  for (const l of lines) {
    l.shareOfTotal = grandTotal > 0 ? l.totalUsd / grandTotal : 0;
  }

  const primaryDriver = lines.length > 0
    ? lines.reduce((m, l) => (l.totalUsd > m.totalUsd ? l : m), lines[0]!).materialId
    : '';

  // Sensitivities: re-run with each material's unit cost bumped by 10%.
  const sensitivities: Array<{ materialId: string; deltaPer10PctUsd: number }> = [];
  for (const m of materials) {
    const bumped = materials.map(x => (x.id === m.id ? { ...x, unitCostUsdPerKg: x.unitCostUsdPerKg * 1.1 } : x));
    const bumpedTotal = rollupInternal(uses, bumped, opts.perUnitOverheadUsd);
    sensitivities.push({ materialId: m.id, deltaPer10PctUsd: bumpedTotal - grandTotal });
  }

  return { lines, totalUsd: grandTotal, primaryDriver, sensitivities };
}

function rollupInternal(uses: PartMaterialUse[], materials: MaterialSpec[], overhead: number): number {
  const matMap = new Map<string, MaterialSpec>();
  for (const m of materials) matMap.set(m.id, m);
  let total = overhead;
  for (const u of uses) {
    const mat = matMap.get(u.materialId);
    if (!mat) continue;
    const waste = u.wasteFraction ?? 0;
    const grossMass = (u.volumeCm3 * (1 + waste) * mat.densityGcm3) / 1000;
    total += grossMass * mat.unitCostUsdPerKg + (u.processCostUsd ?? 0);
  }
  return total;
}

// ── Scenario comparison ───────────────────────────────────────

export interface ScenarioComparison {
  scenarioATotalUsd: number;
  scenarioBTotalUsd: number;
  diffUsd: number;
  /** Cheaper scenario id (A or B). */
  cheaper: 'A' | 'B' | 'tied';
}

export function compareScenarios(
  scenarioA: { uses: PartMaterialUse[]; materials: MaterialSpec[] },
  scenarioB: { uses: PartMaterialUse[]; materials: MaterialSpec[] },
  options: Partial<RollupOptions> = {},
): ScenarioComparison {
  const a = rollup(scenarioA.uses, scenarioA.materials, options).totalUsd;
  const b = rollup(scenarioB.uses, scenarioB.materials, options).totalUsd;
  const diff = b - a;
  let cheaper: 'A' | 'B' | 'tied';
  if (Math.abs(diff) < 0.001) cheaper = 'tied';
  else cheaper = diff < 0 ? 'B' : 'A';
  return { scenarioATotalUsd: a, scenarioBTotalUsd: b, diffUsd: diff, cheaper };
}

// ── Summary ────────────────────────────────────────────────────

export interface RollupSummary {
  totalUsd: number;
  primaryDriver: string;
  primaryDriverShare: number;
  materialCount: number;
  hasWaste: boolean;
}

export function summarize(result: RollupResult): RollupSummary {
  const primary = result.lines.find(l => l.materialId === result.primaryDriver);
  return {
    totalUsd: result.totalUsd,
    primaryDriver: result.primaryDriver,
    primaryDriverShare: primary?.shareOfTotal ?? 0,
    materialCount: result.lines.filter(l => l.materialId !== '_overhead').length,
    hasWaste: result.lines.some(l => l.wasteCostUsd > 0),
  };
}
