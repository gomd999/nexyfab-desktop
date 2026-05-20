/**
 * wireHarness.ts — Electrical wire harness routing.
 *
 * SolidWorks Electrical / Routing Professional handles wire harness
 * design separate from mechanical pipe routing. The deliverables:
 *
 *   - **Wire schedule** — every connection (from-pin to-pin), wire
 *     gauge, color, length.
 *   - **Bundle assembly** — wires grouped into bundles with
 *     calculated outside diameter + bend radius.
 *   - **Connector library** — Molex / JST / Hirose / Amphenol with
 *     pin counts, locking style, contact rating.
 *   - **Voltage drop** — per-wire voltage drop across the run; flag
 *     undersized gauges.
 *   - **Continuity test pattern** — list of pairs that must show 0Ω
 *     continuity at end-of-line testing.
 *
 * AWG sizing follows NEC + IPC/WHMA-A-620 conventions.
 */

export type WireGauge = '4AWG' | '6AWG' | '8AWG' | '10AWG' | '12AWG' | '14AWG' | '16AWG' | '18AWG' | '20AWG' | '22AWG' | '24AWG' | '26AWG' | '28AWG' | '30AWG';
export type InsulationStandard = 'UL1007' | 'UL1015' | 'UL1061' | 'PVC' | 'XLPE' | 'silicone' | 'teflon';

export interface WireSpec {
  gauge: WireGauge;
  insulation: InsulationStandard;
  insulatedDiameterMm: number;
  conductorDiameterMm: number;
  /** Continuous current rating (A). */
  currentRatingA: number;
  /** Resistance per length (Ω/m). */
  resistanceOhmPerM: number;
  /** Color insulation standard (IEC 60757). */
  color?: string;
}

export const AWG_TABLE: Record<WireGauge, Omit<WireSpec, 'insulation' | 'color'>> = {
  '4AWG':  { gauge: '4AWG',  insulatedDiameterMm: 7.5,  conductorDiameterMm: 5.19, currentRatingA: 70,  resistanceOhmPerM: 0.000815 },
  '6AWG':  { gauge: '6AWG',  insulatedDiameterMm: 6.1,  conductorDiameterMm: 4.11, currentRatingA: 55,  resistanceOhmPerM: 0.00130 },
  '8AWG':  { gauge: '8AWG',  insulatedDiameterMm: 4.8,  conductorDiameterMm: 3.26, currentRatingA: 40,  resistanceOhmPerM: 0.00207 },
  '10AWG': { gauge: '10AWG', insulatedDiameterMm: 4.0,  conductorDiameterMm: 2.59, currentRatingA: 30,  resistanceOhmPerM: 0.00329 },
  '12AWG': { gauge: '12AWG', insulatedDiameterMm: 3.4,  conductorDiameterMm: 2.05, currentRatingA: 20,  resistanceOhmPerM: 0.00521 },
  '14AWG': { gauge: '14AWG', insulatedDiameterMm: 2.7,  conductorDiameterMm: 1.63, currentRatingA: 15,  resistanceOhmPerM: 0.00829 },
  '16AWG': { gauge: '16AWG', insulatedDiameterMm: 2.3,  conductorDiameterMm: 1.29, currentRatingA: 13,  resistanceOhmPerM: 0.0132 },
  '18AWG': { gauge: '18AWG', insulatedDiameterMm: 1.9,  conductorDiameterMm: 1.02, currentRatingA: 10,  resistanceOhmPerM: 0.0210 },
  '20AWG': { gauge: '20AWG', insulatedDiameterMm: 1.6,  conductorDiameterMm: 0.81, currentRatingA: 7,   resistanceOhmPerM: 0.0333 },
  '22AWG': { gauge: '22AWG', insulatedDiameterMm: 1.4,  conductorDiameterMm: 0.64, currentRatingA: 5,   resistanceOhmPerM: 0.0530 },
  '24AWG': { gauge: '24AWG', insulatedDiameterMm: 1.2,  conductorDiameterMm: 0.51, currentRatingA: 3.5, resistanceOhmPerM: 0.0842 },
  '26AWG': { gauge: '26AWG', insulatedDiameterMm: 1.0,  conductorDiameterMm: 0.40, currentRatingA: 2.2, resistanceOhmPerM: 0.134 },
  '28AWG': { gauge: '28AWG', insulatedDiameterMm: 0.9,  conductorDiameterMm: 0.32, currentRatingA: 1.4, resistanceOhmPerM: 0.213 },
  '30AWG': { gauge: '30AWG', insulatedDiameterMm: 0.8,  conductorDiameterMm: 0.25, currentRatingA: 0.9, resistanceOhmPerM: 0.339 },
};

/** Pick the smallest AWG that handles the requested current with
 *  20% safety margin. */
export function pickGaugeForCurrent(currentA: number): WireGauge | null {
  const sortedByA = (Object.keys(AWG_TABLE) as WireGauge[])
    .sort((a, b) => AWG_TABLE[a].currentRatingA - AWG_TABLE[b].currentRatingA);
  for (const g of sortedByA) {
    if (AWG_TABLE[g].currentRatingA >= currentA * 1.2) return g;
  }
  return null;
}

// ── Connector library ────────────────────────────────────────────

export interface ConnectorSpec {
  id: string;
  manufacturer: string;
  /** Part number. */
  partNumber: string;
  pinCount: number;
  /** Pitch between pins (mm). */
  pitchMm: number;
  /** Max contact current (A). */
  contactCurrentA: number;
  /** Lock style. */
  locking: 'friction' | 'latch' | 'screw' | 'bayonet';
  /** Sealed / IP rated? */
  sealing?: 'IP67' | 'IP68' | 'unsealed';
}

export const CONNECTOR_LIBRARY: ConnectorSpec[] = [
  { id: 'molex-3001', manufacturer: 'Molex', partNumber: 'KK 254', pinCount: 4, pitchMm: 2.54, contactCurrentA: 3, locking: 'friction' },
  { id: 'molex-microfit', manufacturer: 'Molex', partNumber: 'Micro-Fit 3.0', pinCount: 6, pitchMm: 3.0, contactCurrentA: 8.5, locking: 'latch' },
  { id: 'molex-minifit', manufacturer: 'Molex', partNumber: 'Mini-Fit Jr', pinCount: 8, pitchMm: 4.2, contactCurrentA: 13, locking: 'latch' },
  { id: 'jst-ph', manufacturer: 'JST', partNumber: 'PH', pinCount: 6, pitchMm: 2.0, contactCurrentA: 2, locking: 'friction' },
  { id: 'jst-xh', manufacturer: 'JST', partNumber: 'XH', pinCount: 4, pitchMm: 2.5, contactCurrentA: 3, locking: 'friction' },
  { id: 'jst-vh', manufacturer: 'JST', partNumber: 'VH', pinCount: 4, pitchMm: 3.96, contactCurrentA: 10, locking: 'friction' },
  { id: 'amphenol-circular-c016', manufacturer: 'Amphenol', partNumber: 'C016', pinCount: 7, pitchMm: 0, contactCurrentA: 16, locking: 'screw', sealing: 'IP67' },
  { id: 'hirose-df11', manufacturer: 'Hirose', partNumber: 'DF11', pinCount: 12, pitchMm: 2.0, contactCurrentA: 2, locking: 'latch' },
];

export function findConnector(id: string): ConnectorSpec | null {
  return CONNECTOR_LIBRARY.find(c => c.id === id) ?? null;
}

// ── Bundle calculations ──────────────────────────────────────────

export interface Wire {
  id: string;
  fromConnector: string;
  fromPin: number;
  toConnector: string;
  toPin: number;
  gauge: WireGauge;
  /** Current carried (A). */
  currentA: number;
  /** Color (IEC). */
  color?: string;
  /** Total length (mm). */
  lengthMm: number;
}

export interface Bundle {
  id: string;
  wireIds: string[];
}

export interface BundleSize {
  /** Outside diameter accounting for typical bundle packing (mm). */
  outerDiameterMm: number;
  /** Minimum bend radius (mm) — typ 10× OD. */
  minBendRadiusMm: number;
  /** Sum of wire current ratings (A). */
  totalCurrentRatingA: number;
  /** Wire count. */
  wireCount: number;
}

/** Compute bundle outer diameter from individual wire diameters. */
export function bundleSize(bundle: Bundle, wires: Wire[]): BundleSize {
  const bundleWires = bundle.wireIds
    .map(id => wires.find(w => w.id === id))
    .filter((w): w is Wire => w !== undefined);
  // Total cross-section area, including 1.25 packing factor.
  let area = 0;
  let totalCurrentRating = 0;
  for (const w of bundleWires) {
    const r = AWG_TABLE[w.gauge].insulatedDiameterMm / 2;
    area += Math.PI * r * r * 1.25;
    totalCurrentRating += AWG_TABLE[w.gauge].currentRatingA;
  }
  const od = 2 * Math.sqrt(area / Math.PI);
  return {
    outerDiameterMm: od,
    minBendRadiusMm: od * 10,
    totalCurrentRatingA: totalCurrentRating,
    wireCount: bundleWires.length,
  };
}

// ── Voltage drop ─────────────────────────────────────────────────

export interface VoltageDropResult {
  wireId: string;
  resistanceOhm: number;
  voltageDropV: number;
  /** Drop as % of nominal source voltage. */
  dropPercent: number;
  /** True when drop exceeds 3% (US NEC recommendation). */
  exceedsRecommendation: boolean;
}

export function computeVoltageDrop(
  wire: Wire,
  sourceVoltageV: number,
): VoltageDropResult {
  const resistance = AWG_TABLE[wire.gauge].resistanceOhmPerM * (wire.lengthMm / 1000) * 2; // round trip
  const drop = resistance * wire.currentA;
  const pct = sourceVoltageV > 0 ? (drop / sourceVoltageV) * 100 : 0;
  return {
    wireId: wire.id,
    resistanceOhm: resistance,
    voltageDropV: drop,
    dropPercent: pct,
    exceedsRecommendation: pct > 3,
  };
}

// ── Continuity test pattern ──────────────────────────────────────

export interface ContinuityCheck {
  fromConnector: string;
  fromPin: number;
  toConnector: string;
  toPin: number;
  expectedResistanceOhm: number;
}

export function generateContinuityChecks(wires: Wire[]): ContinuityCheck[] {
  return wires.map(w => ({
    fromConnector: w.fromConnector,
    fromPin: w.fromPin,
    toConnector: w.toConnector,
    toPin: w.toPin,
    expectedResistanceOhm: AWG_TABLE[w.gauge].resistanceOhmPerM * (w.lengthMm / 1000),
  }));
}

// ── Wire schedule summary ────────────────────────────────────────

export interface WireScheduleSummary {
  wireCount: number;
  /** Total wire length (m). */
  totalLengthM: number;
  /** Per-gauge inventory (m of wire needed). */
  perGaugeLengthM: Record<WireGauge, number>;
  /** Distinct connectors needed (id → count). */
  connectorCounts: Record<string, number>;
}

export function summarizeWireSchedule(wires: Wire[]): WireScheduleSummary {
  const perGauge: Partial<Record<WireGauge, number>> = {};
  const connectorCounts: Record<string, number> = {};
  let total = 0;
  for (const w of wires) {
    perGauge[w.gauge] = (perGauge[w.gauge] ?? 0) + w.lengthMm / 1000;
    connectorCounts[w.fromConnector] = (connectorCounts[w.fromConnector] ?? 0) + 1;
    connectorCounts[w.toConnector] = (connectorCounts[w.toConnector] ?? 0) + 1;
    total += w.lengthMm / 1000;
  }
  return {
    wireCount: wires.length,
    totalLengthM: total,
    perGaugeLengthM: perGauge as Record<WireGauge, number>,
    connectorCounts,
  };
}
