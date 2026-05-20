/**
 * reliefValveSizing.ts — Size a pressure-relief valve orifice per API 520
 * for gas/vapour or liquid service, and pick the next standard API 526
 * orifice letter.
 *
 * Vapour (critical/sonic flow), USC-to-SI adapted:
 *   A = W·sqrt(T·Z) / (C·Kd·P1·Kb·Kc·sqrt(M))   [mm²]
 * with C the gas coefficient from k (specific-heat ratio).
 *
 * Liquid:
 *   A = Q·sqrt(G) / (Kd·Kw·Kc·Kv) / (constant·sqrt(ΔP))
 *
 * We implement the vapour critical-flow case (most common) with SI-ish
 * constants, plus the API 526 lettered-orifice lookup so the engineer
 * orders a real valve ≥ the required area.
 */

export interface ReliefVaporInput {
  massFlowKgH: number;       // W, required relief rate
  relievingTempK: number;    // T
  molarMassGmol: number;     // M
  specificHeatRatio: number; // k
  relievingPressureBarA: number; // P1 (absolute)
  compressibility?: number;  // Z, default 1
  dischargeCoefficient?: number; // Kd, default 0.975
  backpressureFactor?: number;   // Kb, default 1
  combinationFactor?: number;    // Kc, default 1 (no rupture disk)
}

export interface ReliefValveResult {
  gasCoefficientC: number;
  requiredAreaMm2: number;
  selectedOrifice: string;   // API 526 letter
  selectedAreaMm2: number;
  warnings: string[];
}

// API 526 standard orifice areas (mm²).
const API526: { letter: string; areaMm2: number }[] = [
  { letter: 'D', areaMm2: 71 },
  { letter: 'E', areaMm2: 126 },
  { letter: 'F', areaMm2: 198 },
  { letter: 'G', areaMm2: 325 },
  { letter: 'H', areaMm2: 506 },
  { letter: 'J', areaMm2: 830 },
  { letter: 'K', areaMm2: 1186 },
  { letter: 'L', areaMm2: 1841 },
  { letter: 'M', areaMm2: 2323 },
  { letter: 'N', areaMm2: 2800 },
  { letter: 'P', areaMm2: 4116 },
  { letter: 'Q', areaMm2: 7129 },
  { letter: 'R', areaMm2: 10323 },
  { letter: 'T', areaMm2: 16774 },
];

/** Gas coefficient C from specific-heat ratio k (API 520). */
export function gasCoefficientC(k: number): number {
  // C = 0.03948·sqrt(k·(2/(k+1))^((k+1)/(k-1)))  (SI form, mm² basis ~ 0.04…)
  if (k <= 1) return 0.0239;
  const term = k * Math.pow(2 / (k + 1), (k + 1) / (k - 1));
  return 0.03948 * Math.sqrt(term);
}

export function sizeVapor(input: ReliefVaporInput): ReliefValveResult {
  const warnings: string[] = [];
  if (input.massFlowKgH <= 0) warnings.push('Relief mass flow must be positive.');
  if (input.relievingPressureBarA <= 0) warnings.push('Relieving pressure must be positive.');

  const C = gasCoefficientC(input.specificHeatRatio);
  const Z = input.compressibility ?? 1;
  const Kd = input.dischargeCoefficient ?? 0.975;
  const Kb = input.backpressureFactor ?? 1;
  const Kc = input.combinationFactor ?? 1;
  const T = input.relievingTempK;
  const M = input.molarMassGmol;
  const P1kPa = input.relievingPressureBarA * 100; // bar → kPa

  // API 520 SI: A[mm²] = (W/(C·Kd·P1·Kb·Kc))·sqrt(T·Z/M), W in kg/h, P1 in kPa.
  const denom = C * Kd * P1kPa * Kb * Kc;
  const A = denom > 0 ? (input.massFlowKgH / denom) * Math.sqrt((T * Z) / M) : 0;

  const sel = API526.find(o => o.areaMm2 >= A) ?? API526[API526.length - 1]!;
  if (A > API526[API526.length - 1]!.areaMm2) warnings.push('Required area exceeds largest API 526 orifice (T); use multiple valves.');

  return {
    gasCoefficientC: C,
    requiredAreaMm2: A,
    selectedOrifice: sel.letter,
    selectedAreaMm2: sel.areaMm2,
    warnings,
  };
}

/** Relieving capacity (kg/h) of a chosen orifice at given conditions (inverse). */
export function capacityOfOrifice(letter: string, input: Omit<ReliefVaporInput, 'massFlowKgH'>): number {
  const orifice = API526.find(o => o.letter === letter);
  if (!orifice) return 0;
  const C = gasCoefficientC(input.specificHeatRatio);
  const Z = input.compressibility ?? 1;
  const Kd = input.dischargeCoefficient ?? 0.975;
  const Kb = input.backpressureFactor ?? 1;
  const Kc = input.combinationFactor ?? 1;
  const P1kPa = input.relievingPressureBarA * 100;
  const factor = Math.sqrt((input.relievingTempK * Z) / input.molarMassGmol);
  // W = A·C·Kd·P1·Kb·Kc / sqrt(TZ/M)
  return factor > 0 ? (orifice.areaMm2 * C * Kd * P1kPa * Kb * Kc) / factor : 0;
}

export function summarize(r: ReliefValveResult): { requiredAreaMm2: number; selectedOrifice: string; selectedAreaMm2: number } {
  return { requiredAreaMm2: r.requiredAreaMm2, selectedOrifice: r.selectedOrifice, selectedAreaMm2: r.selectedAreaMm2 };
}
