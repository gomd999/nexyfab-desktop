/**
 * ESG Carbon Footprint Calculator
 * Based on industry-average emission factors (IPCC / ecoinvent / JEITA)
 * OUTPUT: estimated kg CO₂e — not certified, for reference only
 */

export type ManufacturingProcess =
  | 'cnc_milling' | 'cnc_turning' | 'sheet_metal' | 'injection_molding'
  | 'die_casting' | 'sand_casting' | 'welding' | 'laser_cutting'
  | 'wire_edm' | 'fdm_3dprint' | 'sla_3dprint' | 'surface_treatment' | 'assembly';

export type MaterialType =
  | 'aluminum_6061' | 'aluminum_7075' | 'stainless_steel_304' | 'stainless_steel_316'
  | 'carbon_steel' | 'titanium' | 'copper' | 'brass'
  | 'abs_plastic' | 'pc_plastic' | 'nylon' | 'peek' | 'pom';

export interface ESGInput {
  process: ManufacturingProcess;
  material: MaterialType;
  weightKg: number;           // finished part weight
  materialUtilizationPct?: number; // 0–100, default 70 (material removed by machining)
  quantity?: number;          // default 1
  transportKm?: number;       // shipping distance km (optional)
  transportMode?: 'truck' | 'air' | 'sea'; // default 'truck'
  electricityKwhPerKg?: number; // override if known
}

export interface ESGResult {
  totalCO2e: number;          // kg CO₂e, total for all units
  perUnitCO2e: number;        // kg CO₂e per part
  breakdown: {
    materialCO2e: number;     // raw material production
    processCO2e: number;      // machining/manufacturing energy
    transportCO2e: number;    // logistics
    wasteCO2e: number;        // material removed/scrapped
  };
  inputs: ESGInput;
  disclaimer: string;
}

// ─── Emission factors ─────────────────────────────────────────────────────────

// Material production CO₂e (kg CO₂e / kg material) — cradle-to-gate
const MATERIAL_FACTORS: Record<MaterialType, number> = {
  aluminum_6061:        8.24,   // primary Al production is energy-intensive
  aluminum_7075:        8.80,
  stainless_steel_304:  6.15,
  stainless_steel_316:  6.50,
  carbon_steel:         1.85,
  titanium:            35.00,   // very high — Kroll process
  copper:               3.50,
  brass:                3.80,
  abs_plastic:          3.20,
  pc_plastic:           5.40,
  nylon:                7.80,
  peek:                12.50,
  pom:                  3.60,
};

// Process energy intensity (kWh / kg finished part)
const PROCESS_KWH_PER_KG: Record<ManufacturingProcess, number> = {
  cnc_milling:         15.0,
  cnc_turning:         10.0,
  sheet_metal:          3.5,
  injection_molding:    2.8,
  die_casting:          4.5,
  sand_casting:         8.0,
  welding:              6.0,
  laser_cutting:        5.0,
  wire_edm:            20.0,
  fdm_3dprint:         10.0,
  sla_3dprint:          8.0,
  surface_treatment:    3.0,
  assembly:             1.5,
};

// Transport emission factors (kg CO₂e / tonne-km)
const TRANSPORT_FACTORS: Record<'truck' | 'air' | 'sea', number> = {
  truck: 0.096,
  air:   0.602,
  sea:   0.016,
};

// Korean grid electricity emission factor (kg CO₂e / kWh) — 2023 KEPCO average
const ELECTRICITY_CO2_PER_KWH = 0.4781;

// ─── Main calculation ─────────────────────────────────────────────────────────

export function calculateCO2(input: ESGInput): ESGResult {
  const {
    process,
    material,
    weightKg,
    materialUtilizationPct = 70,
    quantity = 1,
    transportKm = 0,
    transportMode = 'truck',
    electricityKwhPerKg,
  } = input;

  // 1. Raw material: account for material removed in machining
  const utilizationRatio = Math.max(0.01, Math.min(1, materialUtilizationPct / 100));
  const rawMaterialKg = weightKg / utilizationRatio; // total material consumed per part
  const materialCO2e = rawMaterialKg * (MATERIAL_FACTORS[material] ?? 5.0);

  // 2. Process energy
  const kwhPerKg = electricityKwhPerKg ?? PROCESS_KWH_PER_KG[process] ?? 5.0;
  const processCO2e = weightKg * kwhPerKg * ELECTRICITY_CO2_PER_KWH;

  // 3. Transport
  const weightTonnes = (weightKg * quantity) / 1000;
  const transportCO2e = transportKm > 0
    ? weightTonnes * transportKm * (TRANSPORT_FACTORS[transportMode] ?? 0.096)
    : 0;

  // 4. Waste/scrap material CO₂e
  const wasteKg = rawMaterialKg - weightKg;
  const wasteCO2e = wasteKg * (MATERIAL_FACTORS[material] ?? 5.0) * 0.3; // 30% factor for end-of-life

  const perUnitCO2e = materialCO2e + processCO2e + wasteCO2e + (transportCO2e / quantity);
  const totalCO2e = perUnitCO2e * quantity;

  return {
    totalCO2e: Math.round(totalCO2e * 100) / 100,
    perUnitCO2e: Math.round(perUnitCO2e * 100) / 100,
    breakdown: {
      materialCO2e: Math.round(materialCO2e * 100) / 100,
      processCO2e:  Math.round(processCO2e  * 100) / 100,
      transportCO2e: Math.round(transportCO2e * 100) / 100,
      wasteCO2e:    Math.round(wasteCO2e    * 100) / 100,
    },
    inputs: input,
    disclaimer: 'This is an estimation based on industry-average emission factors. Values are indicative only and should not be used for regulatory reporting without verification by a certified GHG auditor.',
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const SUPPORTED_PROCESSES = Object.keys(PROCESS_KWH_PER_KG) as ManufacturingProcess[];
export const SUPPORTED_MATERIALS = Object.keys(MATERIAL_FACTORS) as MaterialType[];

export function getProcessLabel(p: ManufacturingProcess): string {
  const labels: Record<ManufacturingProcess, string> = {
    cnc_milling: 'CNC 밀링', cnc_turning: 'CNC 선반', sheet_metal: '판금',
    injection_molding: '사출 성형', die_casting: '다이캐스팅', sand_casting: '사형 주조',
    welding: '용접', laser_cutting: '레이저 커팅', wire_edm: '와이어 EDM',
    fdm_3dprint: 'FDM 3D프린팅', sla_3dprint: 'SLA 3D프린팅',
    surface_treatment: '표면처리', assembly: '조립',
  };
  return labels[p] ?? p;
}

export function getMaterialLabel(m: MaterialType): string {
  const labels: Record<MaterialType, string> = {
    aluminum_6061: '알루미늄 6061', aluminum_7075: '알루미늄 7075',
    stainless_steel_304: '스테인리스 304', stainless_steel_316: '스테인리스 316',
    carbon_steel: '탄소강', titanium: '티타늄', copper: '구리', brass: '황동',
    abs_plastic: 'ABS 플라스틱', pc_plastic: 'PC 플라스틱', nylon: '나일론',
    peek: 'PEEK', pom: 'POM',
  };
  return labels[m] ?? m;
}
