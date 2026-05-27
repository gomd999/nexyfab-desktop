/**
 * pidNetwork.ts — Piping & Instrumentation Diagram (P&ID) + valve
 * sizing for process plant design.
 *
 * SolidWorks Plant 3D / AutoCAD Plant 3D is a separate product
 * dedicated to oil&gas, chemical, pharma plant layout. The core
 * deliverables:
 *
 *   - **P&ID** — schematic showing every pipe, valve, instrument,
 *     equipment item with tag numbers + line numbers.
 *   - **Line list** — every pipe segment + spec (ASME class, material,
 *     insulation, service).
 *   - **Valve sizing** — pick the right Cv (flow coefficient) for the
 *     fluid + flow rate + pressure drop.
 *   - **Pump sizing** — duty point (flow + head) → motor kW.
 *   - **Pressure relief** — sizing the safety valve per API 520.
 *
 * This module covers the P&ID graph + valve/pump sizing math. Layout
 * + rendering is a separate UI concern.
 */

export type EquipmentKind =
  | 'tank' | 'pump' | 'compressor' | 'heat-exchanger'
  | 'column' | 'reactor' | 'filter' | 'separator'
  | 'valve' | 'instrument' | 'pipe-fitting';

export type ValveKind =
  | 'gate' | 'globe' | 'ball' | 'butterfly' | 'check'
  | 'plug' | 'needle' | 'diaphragm' | 'relief' | 'control';

export type InstrumentKind =
  | 'pressure' | 'temperature' | 'flow' | 'level'
  | 'analytical' | 'control' | 'switch' | 'alarm';

export interface PidEquipment {
  id: string;
  /** Tag number (e.g. P-101). */
  tag: string;
  kind: EquipmentKind;
  /** ISA standard symbol code. */
  symbolCode?: string;
  /** Service description. */
  service?: string;
}

export interface PidLine {
  id: string;
  /** Line number (e.g. "6-CW-101-A1B"). */
  lineNumber: string;
  /** Nominal pipe size (DN). */
  nominalSize: string;
  /** Service code (CW = cooling water, PA = process air...). */
  serviceCode: string;
  /** Pipe spec class (ASME B31.3 etc). */
  specClass: string;
  fromEquipmentId: string;
  toEquipmentId: string;
  /** Optional insulation. */
  insulationMm?: number;
  /** Heat tracing? */
  heatTraced?: boolean;
}

export interface PidValve {
  id: string;
  tag: string;
  kind: ValveKind;
  /** Cv at full open. */
  cvFullOpen?: number;
  /** Failure mode (FO = fail open, FC = fail close, FL = fail last). */
  failureMode?: 'FO' | 'FC' | 'FL';
  /** Line this valve sits on. */
  lineId: string;
}

export interface PidInstrument {
  id: string;
  tag: string;
  kind: InstrumentKind;
  /** What it measures / controls. */
  measuredVariable?: string;
  /** Location (line or equipment id). */
  locationId: string;
}

// ── P&ID document ─────────────────────────────────────────────────

export interface PidDocument {
  equipment: PidEquipment[];
  lines: PidLine[];
  valves: PidValve[];
  instruments: PidInstrument[];
}

export interface PidValidationReport {
  duplicateTags: string[];
  orphanLines: string[];      // refer to missing equipment
  orphanValves: string[];     // refer to missing line
  orphanInstruments: string[]; // refer to missing host
  warnings: string[];
}

export function validatePid(doc: PidDocument): PidValidationReport {
  const equipmentIds = new Set(doc.equipment.map(e => e.id));
  const lineIds = new Set(doc.lines.map(l => l.id));
  // Tag uniqueness.
  const tags = new Map<string, number>();
  for (const e of doc.equipment) tags.set(e.tag, (tags.get(e.tag) ?? 0) + 1);
  for (const v of doc.valves) tags.set(v.tag, (tags.get(v.tag) ?? 0) + 1);
  for (const i of doc.instruments) tags.set(i.tag, (tags.get(i.tag) ?? 0) + 1);
  const duplicates: string[] = [];
  for (const [t, n] of tags) if (n > 1) duplicates.push(t);

  const orphanLines: string[] = [];
  for (const l of doc.lines) {
    if (!equipmentIds.has(l.fromEquipmentId) || !equipmentIds.has(l.toEquipmentId)) {
      orphanLines.push(l.id);
    }
  }
  const orphanValves: string[] = [];
  for (const v of doc.valves) {
    if (!lineIds.has(v.lineId)) orphanValves.push(v.id);
  }
  const hostIds = new Set([...equipmentIds, ...lineIds]);
  const orphanInstruments: string[] = [];
  for (const i of doc.instruments) {
    if (!hostIds.has(i.locationId)) orphanInstruments.push(i.id);
  }

  const warnings: string[] = [];
  for (const v of doc.valves) {
    if (v.kind === 'control' && !v.failureMode) {
      warnings.push(`Control valve ${v.tag} missing failure mode`);
    }
  }

  return { duplicateTags: duplicates, orphanLines, orphanValves, orphanInstruments, warnings };
}

// ── Valve sizing ─────────────────────────────────────────────────

export interface LiquidValveSizing {
  /** Volumetric flow rate (m³/h). */
  flowM3H: number;
  /** Pressure drop across valve (bar). */
  pressureDropBar: number;
  /** Liquid specific gravity (water = 1). */
  specificGravity: number;
  /** Fluid temperature (°C). */
  temperatureC?: number;
}

export interface ValveSizingResult {
  /** Required Cv (US customary, gpm at 1 psi). */
  cv: number;
  /** Required Kv (metric, m³/h at 1 bar). */
  kv: number;
  /** Recommended valve nominal diameter (mm) — closest standard size. */
  recommendedDn: number;
  /** Warnings (cavitation risk, choked flow). */
  warnings: string[];
}

/** Liquid valve sizing per ISA-75.01 / IEC 60534. */
export function sizeLiquidValve(input: LiquidValveSizing): ValveSizingResult {
  // Kv = Q · sqrt(SG / ΔP), units: m³/h, bar.
  const kv = input.flowM3H * Math.sqrt(input.specificGravity / Math.max(0.001, input.pressureDropBar));
  // Cv conversion: Cv = 1.156 · Kv (close enough for liquids).
  const cv = kv * 1.156;
  // Pick nominal DN from a list, choosing the smallest that has Kv ≥ required.
  const dnTable = [
    { dn: 15, maxKv: 4 }, { dn: 20, maxKv: 8 }, { dn: 25, maxKv: 12 },
    { dn: 32, maxKv: 19 }, { dn: 40, maxKv: 30 }, { dn: 50, maxKv: 47 },
    { dn: 65, maxKv: 75 }, { dn: 80, maxKv: 120 }, { dn: 100, maxKv: 180 },
    { dn: 150, maxKv: 400 }, { dn: 200, maxKv: 750 }, { dn: 250, maxKv: 1200 },
  ];
  const dn = dnTable.find(d => d.maxKv >= kv)?.dn ?? 300;

  const warnings: string[] = [];
  if (input.pressureDropBar < 0.1) warnings.push('Very low ΔP — valve may be oversized');
  if (input.pressureDropBar > 20) warnings.push('Very high ΔP — cavitation risk; consider multi-stage valve');

  return { cv, kv, recommendedDn: dn, warnings };
}

// ── Pump sizing ──────────────────────────────────────────────────

export interface PumpDuty {
  /** Volumetric flow rate (m³/h). */
  flowM3H: number;
  /** Total dynamic head (m). */
  headM: number;
  /** Fluid specific gravity. */
  specificGravity: number;
  /** Pump efficiency (0..1). */
  efficiency?: number;
  /** Motor efficiency (0..1). */
  motorEfficiency?: number;
}

export interface PumpSizingResult {
  /** Hydraulic power (kW). */
  hydraulicPowerKw: number;
  /** Shaft power (kW). */
  shaftPowerKw: number;
  /** Recommended motor rating (kW, next standard size). */
  motorRatingKw: number;
  /** NPSH required estimate (m). */
  npshRequiredM: number;
}

/** Pump sizing per centrifugal pump formulas. */
export function sizePump(input: PumpDuty): PumpSizingResult {
  const g = 9.81;
  const rho = 1000 * input.specificGravity;
  const flowM3S = input.flowM3H / 3600;
  // P_hyd = ρ·g·Q·H
  const hydPower = rho * g * flowM3S * input.headM / 1000;
  const pumpEff = input.efficiency ?? 0.7;
  const motorEff = input.motorEfficiency ?? 0.92;
  const shaftPower = hydPower / pumpEff;
  const motorPower = shaftPower / motorEff;
  // Standard motor sizes (kW).
  const standardSizes = [0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110];
  const motorRating = standardSizes.find(s => s >= motorPower) ?? 132;
  // NPSH rough estimate: 0.1 × head + 2 m baseline.
  const npshR = 0.1 * input.headM + 2;
  return {
    hydraulicPowerKw: hydPower,
    shaftPowerKw: shaftPower,
    motorRatingKw: motorRating,
    npshRequiredM: npshR,
  };
}

// ── Pressure relief valve (API 520) ──────────────────────────────

export interface ReliefValveInput {
  /** Set pressure (barg). */
  setPressureBar: number;
  /** Required relief mass flow (kg/h). */
  reliefFlowKgH: number;
  /** Gas molecular weight (g/mol). For liquids: caller switches to liquid path. */
  molecularWeight?: number;
  /** Fluid temperature (K). */
  temperatureK: number;
  /** Discharge coefficient (typ 0.975). */
  dischargeCoefficient?: number;
  /** Backpressure correction factor (0..1, default 1). */
  backpressureFactor?: number;
}

export interface ReliefValveResult {
  /** Required effective orifice area (mm²). */
  effectiveOrificeAreaMm2: number;
  /** Recommended orifice letter (D/E/F/G/H/J/K/L/M/N/P/Q/R/T per API). */
  orificeLetter: string;
}

const API_ORIFICE_AREAS_MM2: Array<{ letter: string; areaMm2: number }> = [
  { letter: 'D', areaMm2: 71.0 },
  { letter: 'E', areaMm2: 126.5 },
  { letter: 'F', areaMm2: 198.1 },
  { letter: 'G', areaMm2: 324.5 },
  { letter: 'H', areaMm2: 506.5 },
  { letter: 'J', areaMm2: 830.3 },
  { letter: 'K', areaMm2: 1186 },
  { letter: 'L', areaMm2: 1841 },
  { letter: 'M', areaMm2: 2323 },
  { letter: 'N', areaMm2: 2800 },
  { letter: 'P', areaMm2: 4116 },
  { letter: 'Q', areaMm2: 7129 },
  { letter: 'R', areaMm2: 10323 },
  { letter: 'T', areaMm2: 16774 },
];

export function sizeReliefValve(input: ReliefValveInput): ReliefValveResult {
  // API 520 gas formula:
  //   A = W / (C·Kd·Kb·P1·√(M/(T·Z)))
  // Simplified for ideal gas, Z=1:
  const Kd = input.dischargeCoefficient ?? 0.975;
  const Kb = input.backpressureFactor ?? 1;
  const M = input.molecularWeight ?? 29; // air default
  const T = input.temperatureK;
  const P1 = (input.setPressureBar * 1.1 + 1) * 100000; // 10% accumulation, convert bar→Pa
  const W = input.reliefFlowKgH / 3600; // kg/s
  // Rough analytical sizing (simplified API equation, gas).
  const C = 0.03948; // SI metric constant for gas critical flow.
  const area = W / (C * Kd * Kb * P1 * Math.sqrt(M / T)); // m²
  const areaMm2 = area * 1e6;
  const letter = API_ORIFICE_AREAS_MM2.find(o => o.areaMm2 >= areaMm2)?.letter ?? 'T';
  return { effectiveOrificeAreaMm2: areaMm2, orificeLetter: letter };
}
