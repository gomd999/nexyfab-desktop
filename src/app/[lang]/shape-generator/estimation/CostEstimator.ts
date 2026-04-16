// ─── Manufacturing Cost Estimation Engine ────────────────────────────────────
import { getMaterialPreset, type MaterialPreset } from '../materials';
import type { FlatPatternResult } from '../features/sheetMetal';

/* ─── Types ─────────────────────────────────────────────────────────────────── */

export type ProcessType = 'cnc' | 'fdm' | 'sla' | 'sls' | 'injection' | 'sheetmetal_laser';

export type CostCurrency = 'USD' | 'KRW';

/** CNC machine class — 3-axis mill is the shop-floor default; 5-axis costs
 * more per hour but reaches features that 3-axis can't. */
export type CncMachineClass = '3axis' | '4axis' | '5axis';

export interface CostEstimate {
  process: ProcessType;
  processName: string;
  currency: CostCurrency;
  materialCost: number;
  machineCost: number;
  setupCost: number;
  totalCost: number;
  leadTime: string;          // "3-5 days"
  quantity: number;
  unitCost: number;
  confidence: 'high' | 'medium' | 'low';
  /** 1–10 difficulty score — higher means harder/more expensive */
  difficulty: number;
  notes: string[];
}

export interface GeometryMetrics {
  volume_cm3: number;
  surfaceArea_cm2: number;
  boundingBox: { w: number; h: number; d: number };
  complexity: number;  // 0-1 based on triangle count / bounding volume ratio
}

/** Optional extra inputs that let the estimator use ground-truth process data
 * instead of falling back to approximations. */
export interface CostEstimationContext {
  currency?: CostCurrency;
  cncMachineClass?: CncMachineClass;
  /** Real flat pattern from the sheet-metal feature — perimeter, bends, material */
  flatPattern?: FlatPatternResult;
}

/* ─── Currency ──────────────────────────────────────────────────────────────── */

// Rough FX for display; the underlying math runs in USD and multiplies here
// at the end. Real systems would pull this from an FX feed, but a static rate
// is fine for automated quotes where the customer gets a formal requote later.
const USD_TO_KRW = 1380;

function toCurrency(usd: number, c: CostCurrency): number {
  return c === 'KRW' ? Math.round(usd * USD_TO_KRW) : +usd.toFixed(2);
}

export function formatCost(value: number, currency: CostCurrency): string {
  if (currency === 'KRW') return `₩${Math.round(value).toLocaleString('ko-KR')}`;
  return `$${value.toFixed(2)}`;
}

/* ─── Material $/kg lookup ──────────────────────────────────────────────────── */

const MATERIAL_PRICE_PER_KG: Record<string, number> = {
  aluminum: 8,
  steel: 3,
  titanium: 60,
  copper: 12,
  gold: 65000,
  abs_white: 25,
  abs_black: 25,
  nylon: 35,
  glass: 15,
  rubber: 10,
  wood: 5,
  ceramic: 20,
};

/* ─── Process display names ─────────────────────────────────────────────────── */

const PROCESS_NAMES: Record<ProcessType, { ko: string; en: string }> = {
  cnc:              { ko: 'CNC 가공',        en: 'CNC Machining' },
  fdm:              { ko: 'FDM 3D프린팅',    en: 'FDM 3D Printing' },
  sla:              { ko: 'SLA 3D프린팅',     en: 'SLA 3D Printing' },
  sls:              { ko: 'SLS 3D프린팅',     en: 'SLS 3D Printing' },
  injection:        { ko: '사출 성형',        en: 'Injection Molding' },
  sheetmetal_laser: { ko: '판금 레이저',      en: 'Sheet Metal Laser' },
};

export function getProcessName(p: ProcessType, lang: string): string {
  const names = PROCESS_NAMES[p];
  return lang === 'ko' ? names.ko : names.en;
}

/* ─── Process icons ─────────────────────────────────────────────────────────── */

export const PROCESS_ICONS: Record<ProcessType, string> = {
  cnc: '⚙️',
  fdm: '🖨️',
  sla: '💎',
  sls: '🔥',
  injection: '🏭',
  sheetmetal_laser: '✂️',
};

/* ─── Material → applicable processes ───────────────────────────────────────── */

const METAL_IDS = new Set(['aluminum', 'steel', 'titanium', 'copper', 'gold']);
const PLASTIC_IDS = new Set(['abs_white', 'abs_black', 'nylon']);
const NO_FDM = new Set(['glass', 'ceramic', 'gold', 'copper', 'steel', 'titanium']);
const NO_SLA = new Set(['glass', 'ceramic', 'gold', 'copper', 'steel', 'titanium', 'wood', 'rubber']);
const SHEET_OK = new Set(['aluminum', 'steel', 'titanium', 'copper']);

function getApplicableProcesses(materialId: string): ProcessType[] {
  const procs: ProcessType[] = [];
  // CNC: metals + hard plastics
  if (METAL_IDS.has(materialId) || PLASTIC_IDS.has(materialId) || materialId === 'wood') {
    procs.push('cnc');
  }
  // FDM: plastics only
  if (!NO_FDM.has(materialId)) procs.push('fdm');
  // SLA: resins/plastics
  if (!NO_SLA.has(materialId)) procs.push('sla');
  // SLS: nylon, some plastics, metals with DMLS
  if (PLASTIC_IDS.has(materialId) || METAL_IDS.has(materialId)) procs.push('sls');
  // Injection: plastics
  if (PLASTIC_IDS.has(materialId) || materialId === 'rubber') procs.push('injection');
  // Sheet metal laser: sheet-capable metals
  if (SHEET_OK.has(materialId)) procs.push('sheetmetal_laser');
  return procs;
}

/* ─── Quantity discount ─────────────────────────────────────────────────────── */

function quantityDiscount(qty: number): number {
  if (qty >= 1000) return 0.45;
  if (qty >= 100) return 0.30;
  if (qty >= 10) return 0.15;
  return 0;
}

/* ─── Difficulty scoring ────────────────────────────────────────────────────── */

/**
 * Score the part on a 1–10 scale based on geometric heuristics. Shops use a
 * similar mental model when they triage a quote request: how much material do
 * we remove, is the aspect ratio unfriendly, does the feature density suggest
 * small tools / multiple setups?
 *
 *  - Volumetric removal fraction: (stock - part) / stock. High = lots of
 *    roughing = long cycle time.
 *  - Aspect ratio: thin+tall or thin+wide parts need fixturing tricks.
 *  - Feature complexity (passed in via metrics.complexity 0–1).
 */
export function computeDifficulty(m: GeometryMetrics): number {
  const bbVol_cm3 = (m.boundingBox.w * m.boundingBox.h * m.boundingBox.d) / 1000;
  const removal = bbVol_cm3 > 0
    ? Math.max(0, Math.min(1, 1 - m.volume_cm3 / bbVol_cm3))
    : 0;

  const sizes = [m.boundingBox.w, m.boundingBox.h, m.boundingBox.d].filter(v => v > 0);
  const maxDim = sizes.length ? Math.max(...sizes) : 1;
  const minDim = sizes.length ? Math.min(...sizes) : 1;
  const aspect = minDim > 0 ? maxDim / minDim : 10;
  const aspectPenalty = Math.min(1, Math.max(0, (aspect - 3) / 12));

  // Blend: complexity 40%, removal fraction 35%, aspect penalty 25%.
  const raw = m.complexity * 0.4 + removal * 0.35 + aspectPenalty * 0.25;
  return Math.round(1 + raw * 9);
}

/** Hourly rate for CNC machine by class. USD/hour. */
function cncHourlyRate(cls: CncMachineClass): number {
  switch (cls) {
    case '5axis': return 140;
    case '4axis': return 105;
    case '3axis':
    default:      return 80;
  }
}

/* ─── Individual process estimators ─────────────────────────────────────────── */

function estimateCNC(
  m: GeometryMetrics,
  mat: MaterialPreset,
  priceKg: number,
  qty: number,
  ctx: CostEstimationContext,
): Omit<CostEstimate, 'process' | 'processName' | 'currency'> {
  // Raw stock = bounding box volume rounded up for saw kerf. Density in g/cm³,
  // so mass in kg is volume_cm3 * density / 1000.
  const density = mat.density ?? 2.7;
  const bbVol_cm3 = (m.boundingBox.w * m.boundingBox.h * m.boundingBox.d) / 1000;
  const stockVol_cm3 = bbVol_cm3 * 1.08; // 8% saw kerf / stock rounding
  const stockMassKg = (stockVol_cm3 * density) / 1000;
  const materialCost = stockMassKg * priceKg;

  // Roughing pass: material removal rate (MRR) scales with machine power.
  // Values in cm³/min for 3-axis mild-steel baseline; scale by material
  // machinability multiplier and machine class.
  const machinability: Record<string, number> = {
    aluminum: 3.0,
    steel: 1.0,
    titanium: 0.35,
    copper: 2.0,
    brass: 2.5,
    wood: 5.0,
    abs_white: 4.0, abs_black: 4.0,
    nylon: 3.5,
  };
  const machId = mat.id ?? 'steel';
  const matFactor = machinability[machId] ?? 1.0;
  const cls = ctx.cncMachineClass ?? '3axis';
  const classMrrFactor = cls === '5axis' ? 1.4 : cls === '4axis' ? 1.15 : 1.0;
  const baseMrr = 15; // cm³/min for mild steel on a 3-axis VMC (rough)
  const mrr = baseMrr * matFactor * classMrrFactor;

  const removedVol_cm3 = Math.max(0, stockVol_cm3 - m.volume_cm3);
  const roughMin = removedVol_cm3 / mrr;

  // Finishing pass: proportional to surface area. Rough number: 12 cm²/min
  // at 3-axis, scaled by material and machine class.
  const finishRate = 12 * Math.sqrt(matFactor) * classMrrFactor; // cm²/min
  const finishMin = m.surfaceArea_cm2 / finishRate;

  // Difficulty multiplier — hard parts get more roughing rework, more tool
  // changes, more probing. Multiplier range ~1.0 … 2.0.
  const difficulty = computeDifficulty(m);
  const diffMult = 1 + (difficulty - 1) * 0.11;

  const totalCycleMin = (roughMin + finishMin) * diffMult;
  const machineHrs = totalCycleMin / 60;
  const machineCost = machineHrs * cncHourlyRate(cls);

  // Setup cost: programming + fixturing + first-article inspection. More for
  // harder parts and more-axis machines, amortized across the lot.
  const setupCostPerJob = 50 + difficulty * 10 + (cls === '5axis' ? 80 : cls === '4axis' ? 30 : 0);
  const disc = quantityDiscount(qty);
  const perUnit = (materialCost + machineCost) * (1 - disc) + setupCostPerJob / qty;
  const total = perUnit * qty;

  const notes: string[] = [];
  if (difficulty >= 8) notes.push(`Difficulty ${difficulty}/10 — consider 5-axis`);
  if (removedVol_cm3 / stockVol_cm3 > 0.85) notes.push('Heavy removal — long roughing cycle');
  if (mat.id === 'titanium') notes.push('Titanium — slow feeds, short tool life');

  return {
    materialCost: +(materialCost * qty).toFixed(2),
    machineCost: +(machineCost * qty * (1 - disc)).toFixed(2),
    setupCost: +setupCostPerJob.toFixed(2),
    totalCost: +total.toFixed(2),
    unitCost: +perUnit.toFixed(2),
    leadTime: qty <= 10 ? '3-5 days' : qty <= 100 ? '5-10 days' : '10-20 days',
    quantity: qty,
    confidence: difficulty <= 4 ? 'high' : difficulty <= 7 ? 'medium' : 'low',
    difficulty,
    notes,
  };
}

function estimateFDM(
  m: GeometryMetrics, _mat: MaterialPreset, qty: number,
): Omit<CostEstimate, 'process' | 'processName' | 'currency'> {
  const materialCost = m.volume_cm3 * 0.05;
  const printHrs = m.volume_cm3 / 10;
  const machineCost = printHrs * 15;
  const setupCost = 10;
  const disc = quantityDiscount(qty);
  const perUnit = (materialCost + machineCost) * (1 - disc) + setupCost / qty;
  const total = perUnit * qty;
  return {
    materialCost: +(materialCost * qty).toFixed(2),
    machineCost: +(machineCost * qty * (1 - disc)).toFixed(2),
    setupCost: +setupCost.toFixed(2),
    totalCost: +total.toFixed(2),
    unitCost: +perUnit.toFixed(2),
    leadTime: qty <= 5 ? '1-3 days' : qty <= 50 ? '3-7 days' : '7-14 days',
    quantity: qty,
    confidence: 'high',
    difficulty: computeDifficulty(m),
    notes: m.boundingBox.h > 300 ? ['Part height exceeds typical build volume'] : [],
  };
}

function estimateSLA(
  m: GeometryMetrics, _mat: MaterialPreset, qty: number,
): Omit<CostEstimate, 'process' | 'processName' | 'currency'> {
  const materialCost = m.volume_cm3 * 0.15;
  const printHrs = m.volume_cm3 / 5;
  const machineCost = printHrs * 25;
  const setupCost = 15;
  const disc = quantityDiscount(qty);
  const perUnit = (materialCost + machineCost) * (1 - disc) + setupCost / qty;
  const total = perUnit * qty;
  return {
    materialCost: +(materialCost * qty).toFixed(2),
    machineCost: +(machineCost * qty * (1 - disc)).toFixed(2),
    setupCost: +setupCost.toFixed(2),
    totalCost: +total.toFixed(2),
    unitCost: +perUnit.toFixed(2),
    leadTime: qty <= 5 ? '2-4 days' : qty <= 50 ? '5-10 days' : '10-18 days',
    quantity: qty,
    confidence: 'high',
    difficulty: computeDifficulty(m),
    notes: [],
  };
}

function estimateSLS(
  m: GeometryMetrics, mat: MaterialPreset, qty: number,
): Omit<CostEstimate, 'process' | 'processName' | 'currency'> {
  const materialCost = m.volume_cm3 * 0.12;
  // Machine time based on bounding-box height (layer-based process)
  const layerHeight = 0.1; // mm
  const layers = m.boundingBox.h / layerHeight;
  const printHrs = (layers * 0.005) + (m.volume_cm3 * 0.002);
  const machineCost = printHrs * 20;
  const setupCost = 20;
  const disc = quantityDiscount(qty);
  const perUnit = (materialCost + machineCost) * (1 - disc) + setupCost / qty;
  const total = perUnit * qty;
  const isMetal = METAL_IDS.has(mat.id);
  return {
    materialCost: +(materialCost * (isMetal ? 3 : 1) * qty).toFixed(2),
    machineCost: +(machineCost * qty * (1 - disc)).toFixed(2),
    setupCost: +setupCost.toFixed(2),
    totalCost: +(total * (isMetal ? 2.5 : 1)).toFixed(2),
    unitCost: +((total * (isMetal ? 2.5 : 1)) / qty).toFixed(2),
    leadTime: qty <= 10 ? '3-5 days' : qty <= 100 ? '5-12 days' : '12-25 days',
    quantity: qty,
    confidence: isMetal ? 'medium' : 'high',
    difficulty: computeDifficulty(m),
    notes: isMetal ? ['DMLS/SLM metal printing — higher cost'] : [],
  };
}

function estimateInjection(
  m: GeometryMetrics, _mat: MaterialPreset, qty: number,
): Omit<CostEstimate, 'process' | 'processName' | 'currency'> {
  // Tooling cost based on complexity & size
  const boxVol = m.boundingBox.w * m.boundingBox.h * m.boundingBox.d;
  const sizeFactor = Math.min(boxVol / 500000, 1);
  const toolingCost = 2000 + 6000 * (m.complexity * 0.6 + sizeFactor * 0.4);
  const materialCost = m.volume_cm3 * 0.008; // bulk plastic is cheap
  const cycleSec = 15 + m.volume_cm3 * 0.3;
  const machineCostPerUnit = (cycleSec / 3600) * 40;
  const perUnit = materialCost + machineCostPerUnit + toolingCost / qty;
  const total = perUnit * qty;
  return {
    materialCost: +(materialCost * qty).toFixed(2),
    machineCost: +(machineCostPerUnit * qty).toFixed(2),
    setupCost: +toolingCost.toFixed(2),
    totalCost: +total.toFixed(2),
    unitCost: +perUnit.toFixed(2),
    leadTime: '15-30 days',
    quantity: qty,
    confidence: qty >= 100 ? 'high' : 'medium',
    difficulty: computeDifficulty(m),
    notes: [
      `Tooling: $${toolingCost.toFixed(0)}`,
      ...(qty < 100 ? ['Low quantity — tooling cost dominates'] : []),
    ],
  };
}

function estimateSheetMetalLaser(
  m: GeometryMetrics,
  mat: MaterialPreset,
  priceKg: number,
  qty: number,
  ctx: CostEstimationContext,
): Omit<CostEstimate, 'process' | 'processName' | 'currency'> {
  const fp = ctx.flatPattern;
  // ── Geometry: prefer real flat pattern if the user ran the feature ──
  let perimeter_mm: number;
  let area_mm2: number;
  let bendCount: number;
  let thickness_mm: number;
  let confidence: 'high' | 'medium' | 'low';
  const notes: string[] = [];

  if (fp) {
    perimeter_mm = 2 * (fp.width + fp.length);
    area_mm2 = fp.width * fp.length;
    bendCount = fp.bendTable.length;
    thickness_mm = fp.thickness;
    confidence = 'high';
    if (fp.warnings.some(w => w.severity === 'error')) {
      confidence = 'medium';
      notes.push('Flat pattern has bend warnings — verify before release');
    }
  } else {
    // Approximate: project SA/2 as flat area and perimeter as 4·√area.
    perimeter_mm = Math.sqrt(m.surfaceArea_cm2 * 100) * 4;
    area_mm2 = m.surfaceArea_cm2 * 100 * 0.5;
    bendCount = Math.round(m.complexity * 6);
    thickness_mm = 2;
    confidence = 'medium';
    notes.push('Estimate (no flat pattern yet) — run Flat Pattern feature for exact pricing');
  }

  // ── Cut time from laser speed (material- and thickness-dependent) ──
  // Rough values: 2mm mild steel ~ 8 m/min, 6mm ~ 2 m/min, stainless ~60% of that.
  const baseSpeed_mpm = Math.max(0.5, 10 / Math.max(1, thickness_mm) - 0.3);
  const matSpeedFactor: Record<string, number> = {
    steel: 1.0,
    aluminum: 0.9,
    copper: 0.6,
    titanium: 0.5,
    brass: 0.7,
  };
  const cutSpeed = baseSpeed_mpm * (matSpeedFactor[mat.id ?? 'steel'] ?? 0.8);
  const cuttingTime_min = perimeter_mm / (cutSpeed * 1000);

  // Pierce time: each closed loop needs ~0.5s pierce. We don't know loop count
  // without a real flat pattern, so assume 1 outer + a couple of interior cuts.
  const pierceCount = fp ? 1 + Math.round(bendCount / 4) : 3;
  const pierceTime_min = pierceCount * 0.01;

  // ── Press-brake bend time ──
  // Each bend: ~20s handling + 5s per bend. Hourly rate $65.
  const bendTime_min = bendCount * (20 + 5) / 60;
  const bendCost = bendTime_min * (65 / 60);

  // ── Material cost ──
  // Blank mass = area × thickness × density. 15% waste for nest offcut.
  const blankVol_cm3 = (area_mm2 / 100) * (thickness_mm / 10);
  const blankMassKg = (blankVol_cm3 * (mat.density ?? 7.85)) / 1000;
  const materialCost = blankMassKg * priceKg * 1.15;

  // ── Machine cost ──
  // Fiber laser rate $90/hr, press brake $65/hr.
  const laserCost = (cuttingTime_min + pierceTime_min) * (90 / 60);
  const machineCost = laserCost + bendCost;

  // ── Setup & totals ──
  const setupCost = 25 + bendCount * 2; // programming + tooling setup per job
  const disc = quantityDiscount(qty);
  const perUnit = (materialCost + machineCost) * (1 - disc) + setupCost / qty;
  const total = perUnit * qty;

  const difficulty = Math.min(10, Math.max(1, Math.round(1 + bendCount * 0.8 + (thickness_mm > 6 ? 3 : 0))));
  if (bendCount > 0) notes.push(`${bendCount} bends × ~${(bendTime_min * 60 / bendCount).toFixed(0)}s each`);
  if (thickness_mm > 6) notes.push(`Thick plate (${thickness_mm}mm) — slower cut`);

  return {
    materialCost: +(materialCost * qty).toFixed(2),
    machineCost: +(machineCost * qty * (1 - disc)).toFixed(2),
    setupCost: +setupCost.toFixed(2),
    totalCost: +total.toFixed(2),
    unitCost: +perUnit.toFixed(2),
    leadTime: qty <= 50 ? '3-7 days' : '7-14 days',
    quantity: qty,
    confidence,
    difficulty,
    notes,
  };
}

/* ─── Main estimation function ──────────────────────────────────────────────── */

export function estimateCosts(
  metrics: GeometryMetrics,
  materialId: string,
  quantities: number[],
  ctx: CostEstimationContext = {},
): CostEstimate[] {
  const mat = getMaterialPreset(materialId);
  if (!mat) return [];
  const priceKg = MATERIAL_PRICE_PER_KG[materialId] ?? 10;
  const processes = getApplicableProcesses(materialId);
  const currency: CostCurrency = ctx.currency ?? 'USD';
  const results: CostEstimate[] = [];

  for (const qty of quantities) {
    for (const proc of processes) {
      let est: Omit<CostEstimate, 'process' | 'processName' | 'currency'>;
      switch (proc) {
        case 'cnc':
          est = estimateCNC(metrics, mat, priceKg, qty, ctx);
          break;
        case 'fdm':
          est = estimateFDM(metrics, mat, qty);
          break;
        case 'sla':
          est = estimateSLA(metrics, mat, qty);
          break;
        case 'sls':
          est = estimateSLS(metrics, mat, qty);
          break;
        case 'injection':
          est = estimateInjection(metrics, mat, qty);
          break;
        case 'sheetmetal_laser':
          est = estimateSheetMetalLaser(metrics, mat, priceKg, qty, ctx);
          break;
        default:
          continue;
      }
      // Convert USD-denominated intermediate numbers to the requested display
      // currency. The underlying formulas stay in USD so shop calibration is
      // unambiguous — currency is purely a presentation concern.
      results.push({
        process: proc,
        processName: getProcessName(proc, 'en'),
        currency,
        ...est,
        materialCost: toCurrency(est.materialCost, currency),
        machineCost: toCurrency(est.machineCost, currency),
        setupCost: toCurrency(est.setupCost, currency),
        totalCost: toCurrency(est.totalCost, currency),
        unitCost: toCurrency(est.unitCost, currency),
      });
    }
  }
  return results;
}
