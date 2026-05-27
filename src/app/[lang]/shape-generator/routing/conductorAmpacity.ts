/**
 * conductorAmpacity.ts — Compute the derated current-carrying capacity
 * (ampacity) of an insulated conductor and pick the smallest standard
 * cross-section that carries the load.
 *
 *   I_derated = I_base · k_temp · k_grouping
 *
 *   k_temp     = sqrt((T_rating − T_ambient)/(T_rating − 30))   (IEC-style)
 *   k_grouping = grouping factor from the number of loaded circuits
 *
 * Base ampacities are tabulated per cross-section for a reference
 * insulation temperature (e.g. 70 °C PVC or 90 °C XLPE) in free air. We
 * derate, compare to the design current, and report the chosen size and
 * the voltage drop over the run.
 */

export interface AmpacityRow {
  areaMm2: number;
  baseAmpacity: number; // at reference conditions
}

// IEC 60364-style PVC copper, single-core in free air (illustrative).
const COPPER_PVC: AmpacityRow[] = [
  { areaMm2: 1.5, baseAmpacity: 19.5 },
  { areaMm2: 2.5, baseAmpacity: 27 },
  { areaMm2: 4, baseAmpacity: 36 },
  { areaMm2: 6, baseAmpacity: 46 },
  { areaMm2: 10, baseAmpacity: 63 },
  { areaMm2: 16, baseAmpacity: 85 },
  { areaMm2: 25, baseAmpacity: 112 },
  { areaMm2: 35, baseAmpacity: 138 },
  { areaMm2: 50, baseAmpacity: 168 },
  { areaMm2: 70, baseAmpacity: 213 },
  { areaMm2: 95, baseAmpacity: 258 },
  { areaMm2: 120, baseAmpacity: 299 },
];

// Grouping factor by number of circuits (IEC 60364-5-52 illustrative).
const GROUPING: Record<number, number> = { 1: 1.0, 2: 0.8, 3: 0.7, 4: 0.65, 5: 0.6, 6: 0.57 };

export interface AmpacityInput {
  designCurrentA: number;
  insulationRatingC?: number; // default 70 (PVC)
  ambientTempC?: number;      // default 30
  groupedCircuits?: number;   // default 1
  conductivityMSm?: number;   // for voltage drop, default 58 (copper)
  runLengthM?: number;
  voltageV?: number;          // for VD%
}

export interface AmpacityResult {
  tempDerating: number;
  groupingDerating: number;
  selectedAreaMm2: number | null;
  deratedAmpacityA: number;
  voltageDropPercent: number | null;
  warnings: string[];
}

export function compute(input: AmpacityInput): AmpacityResult {
  const warnings: string[] = [];
  if (input.designCurrentA <= 0) warnings.push('Design current must be positive.');

  const rating = input.insulationRatingC ?? 70;
  const ambient = input.ambientTempC ?? 30;
  const kTemp = rating > 30 ? Math.sqrt(Math.max(0, (rating - ambient) / (rating - 30))) : 1;

  const n = Math.max(1, input.groupedCircuits ?? 1);
  const kGroup = GROUPING[n] ?? Math.max(0.5, GROUPING[6]! - (n - 6) * 0.02);

  // Find the smallest size whose derated ampacity ≥ design current.
  let selected: AmpacityRow | null = null;
  let deratedAt = 0;
  for (const row of COPPER_PVC) {
    const derated = row.baseAmpacity * kTemp * kGroup;
    if (derated >= input.designCurrentA) { selected = row; deratedAt = derated; break; }
  }
  if (!selected) {
    warnings.push('Load exceeds largest tabulated conductor; parallel conductors or busbar needed.');
    const last = COPPER_PVC[COPPER_PVC.length - 1]!;
    deratedAt = last.baseAmpacity * kTemp * kGroup;
  }

  let vdPercent: number | null = null;
  if (selected && input.runLengthM != null && input.voltageV != null && input.voltageV > 0) {
    const sigma = input.conductivityMSm ?? 58; // MS/m
    const R = input.runLengthM / (sigma * selected.areaMm2); // Ω (single conductor)
    // single-phase round trip: 2·R; drop = I·2R.
    const drop = input.designCurrentA * 2 * R;
    vdPercent = (drop / input.voltageV) * 100;
    if (vdPercent > 5) warnings.push(`Voltage drop ${vdPercent.toFixed(1)}% > 5%; increase cross-section.`);
  }

  return {
    tempDerating: kTemp,
    groupingDerating: kGroup,
    selectedAreaMm2: selected?.areaMm2 ?? null,
    deratedAmpacityA: deratedAt,
    voltageDropPercent: vdPercent,
    warnings,
  };
}

/** Base ampacity for a given cross-section (lookup). */
export function baseAmpacity(areaMm2: number): number | null {
  return COPPER_PVC.find(r => r.areaMm2 === areaMm2)?.baseAmpacity ?? null;
}

export function summarize(r: AmpacityResult): { selectedAreaMm2: number | null; deratedAmpacityA: number; voltageDropPercent: number | null } {
  return { selectedAreaMm2: r.selectedAreaMm2, deratedAmpacityA: r.deratedAmpacityA, voltageDropPercent: r.voltageDropPercent };
}
