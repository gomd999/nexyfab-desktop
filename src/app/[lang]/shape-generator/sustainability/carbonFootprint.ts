/**
 * carbonFootprint.ts — Cradle-to-gate kgCO₂e calculator.
 *
 * Increasingly required by procurement teams (EU CSRD, ISO 14067).
 * Cradle-to-gate counts emissions from raw material extraction
 * through factory-gate shipment.
 *
 * Methodology:
 *   - Mass of each material × material-specific GWP factor
 *   - Plus energy cost of the chosen manufacturing process
 *   - Plus transport emissions estimate (km × tonne-km factor)
 *
 * Data sources: Granta CES EduPack / Ecoinvent v3.x averages.
 * Numbers are mean values — real ISO 14067 analyses need
 * primary supplier data.
 */

export type MaterialCategory =
  | 'steel-mild' | 'steel-stainless' | 'aluminum-recycled' | 'aluminum-virgin'
  | 'copper' | 'brass' | 'titanium'
  | 'plastic-abs' | 'plastic-pp' | 'plastic-pet' | 'plastic-pla'
  | 'wood-pine' | 'rubber' | 'glass';

/** Cradle-to-gate kgCO₂e per kg of material. Ecoinvent v3.x mean. */
const MATERIAL_GWP: Record<MaterialCategory, number> = {
  'steel-mild':         1.85,
  'steel-stainless':    6.10,
  'aluminum-recycled':  0.50,
  'aluminum-virgin':   12.50,
  'copper':             3.40,
  'brass':              3.90,
  'titanium':          47.00,
  'plastic-abs':        3.30,
  'plastic-pp':         1.95,
  'plastic-pet':        3.45,
  'plastic-pla':        2.10,
  'wood-pine':          0.40,
  'rubber':             3.00,
  'glass':              0.95,
};

export type ManufacturingProcess =
  | 'cnc-milling' | '3d-print-fdm' | '3d-print-sla'
  | 'injection-molding' | 'sheet-metal' | 'die-casting'
  | 'lathe' | 'forging';

/** Energy intensity of manufacturing process — kWh per kg removed/processed. */
const PROCESS_ENERGY: Record<ManufacturingProcess, number> = {
  'cnc-milling':       4.5,
  '3d-print-fdm':      9.0,
  '3d-print-sla':     12.0,
  'injection-molding': 1.8,
  'sheet-metal':       0.6,
  'die-casting':       2.4,
  'lathe':             3.2,
  'forging':           5.5,
};

/** Grid electricity GWP (kgCO₂e / kWh). Korean grid 2023 average. */
export const GRID_GWP_KR = 0.420;
/** Global average (IEA 2023). */
export const GRID_GWP_GLOBAL = 0.440;

/** Transport mode GWP (kgCO₂e per tonne-km). */
export const TRANSPORT_GWP: Record<string, number> = {
  truck:    0.062,
  rail:     0.022,
  sea:      0.014,
  air:      0.602,
};

export interface CarbonBreakdown {
  material: { mass: number; gwp: number; kgCO2e: number };
  manufacturing: { kwh: number; gwp: number; kgCO2e: number };
  transport: { tonneKm: number; gwp: number; kgCO2e: number };
  total: number;
}

export interface CarbonInput {
  /** Material mass (kg). */
  massKg: number;
  material: MaterialCategory;
  process: ManufacturingProcess;
  /** Grid mix used by the factory (kgCO₂e/kWh). */
  gridGwpFactor?: number;
  /** Transport: distance and mode. */
  transportKm?: number;
  transportMode?: keyof typeof TRANSPORT_GWP;
}

export function computeCarbonFootprint(input: CarbonInput): CarbonBreakdown {
  const matGwp = MATERIAL_GWP[input.material];
  const procEnergy = PROCESS_ENERGY[input.process];
  const grid = input.gridGwpFactor ?? GRID_GWP_KR;

  const materialKgCO2e = matGwp * input.massKg;
  const manufacturingKwh = procEnergy * input.massKg;
  const manufacturingKgCO2e = manufacturingKwh * grid;
  const tonneKm = input.transportKm && input.transportMode
    ? (input.massKg / 1000) * input.transportKm
    : 0;
  const transportGwp = input.transportMode ? TRANSPORT_GWP[input.transportMode] : 0;
  const transportKgCO2e = tonneKm * (transportGwp ?? 0);

  return {
    material: { mass: input.massKg, gwp: matGwp, kgCO2e: materialKgCO2e },
    manufacturing: { kwh: manufacturingKwh, gwp: grid, kgCO2e: manufacturingKgCO2e },
    transport: { tonneKm, gwp: transportGwp ?? 0, kgCO2e: transportKgCO2e },
    total: materialKgCO2e + manufacturingKgCO2e + transportKgCO2e,
  };
}

/** Compare two materials for the same part — useful for showing the
 *  carbon delta of switching virgin → recycled aluminum. */
export function compareMaterials(
  a: CarbonInput,
  b: CarbonInput,
): { aTotal: number; bTotal: number; deltaKgCO2e: number; pctReduction: number } {
  const ra = computeCarbonFootprint(a);
  const rb = computeCarbonFootprint(b);
  return {
    aTotal: ra.total,
    bTotal: rb.total,
    deltaKgCO2e: ra.total - rb.total,
    pctReduction: ra.total === 0 ? 0 : (ra.total - rb.total) / ra.total * 100,
  };
}

/** Equivalent comparison helpers — gives users intuitive scale.
 *  1 kgCO₂e = ~4.4 km in average passenger car. */
export function carEquivalentKm(kgCO2e: number): number {
  return kgCO2e * 4.4;
}

/** 1 kgCO₂e = ~0.05 trees absorbing 1 year. */
export function treesYearEquivalent(kgCO2e: number): number {
  return kgCO2e * 0.05;
}
