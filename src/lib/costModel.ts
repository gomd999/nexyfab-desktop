// Parametric manufacturing cost estimator — deterministic (no LLM), so the AI
// never invents prices. Geometry + DFM signals → per-process engineering cost
// with seed KR/CN rate tables. Real quotes calibrate it later (calibrationFactor).
//
// v2: DFM-driven complexity, CNC rough/finish/drill/setup/5-axis, injection
// cavity-optimization + tonnage + cooling∝wall², quantity learning curve,
// tolerance/finish surcharges, and compareCost() across processes × regions
// (the "AI 비교견적" core).
//
// ⚠️ Rates are SEED values (public benchmarks) — tune with real quotes. Output
// is a budgeting RANGE, not a binding quote.

export type CostRegion = 'kr' | 'cn';
export type CostProcess = 'cnc' | 'injection' | 'sheet_metal' | '3d_print' | 'casting';
export type Tolerance = 'standard' | 'tight';
export type Finish = 'none' | 'anodize' | 'polish' | 'plate' | 'paint';

export interface DfmSignals {
  undercutCount?: number;
  sharpCornerCount?: number;
  featureCount?: number;   // holes / pockets
  deepPocket?: boolean;
  thinWall?: boolean;
  minWallMm?: number;      // measured min wall (for injection cooling)
  errorCount?: number;
  warningCount?: number;
}

export interface CostInput {
  volume_mm3: number;
  surface_area_mm2: number;
  bbox_mm: { w: number; h: number; d: number };
  material: string;
  process: CostProcess;
  quantity: number;
  region?: CostRegion;
  calibrationFactor?: number;
  dfm?: DfmSignals;
  tolerance?: Tolerance;
  finish?: Finish;
}

export interface CostEstimate {
  currency: 'KRW';
  process: CostProcess;
  region: CostRegion;
  perPart: { min: number; max: number };
  total: { min: number; max: number };
  leadDays: { min: number; max: number };
  confidence: 'low' | 'medium' | 'high';
  calibrated: boolean;
  complexity: number;
  drivers: string[];
  breakdown: Record<string, number>;
  note: string;
}

interface MatClass {
  density: number;      // g/cm³
  pricePerKg: number;   // KRW/kg
  mrrRough: number;     // cm³/min (CNC roughing)
  machinability: number;// 1 = aluminum baseline (>1 easier)
  plastic: boolean;
}
const MAT: Record<string, MatClass> = {
  aluminum:  { density: 2.7,  pricePerKg: 8000,  mrrRough: 25, machinability: 1.0, plastic: false },
  steel:     { density: 7.85, pricePerKg: 3000,  mrrRough: 10, machinability: 0.6, plastic: false },
  titanium:  { density: 4.5,  pricePerKg: 60000, mrrRough: 3,  machinability: 0.25, plastic: false },
  copper:    { density: 8.9,  pricePerKg: 15000, mrrRough: 15, machinability: 0.85, plastic: false },
  gold:      { density: 19.3, pricePerKg: 95000000, mrrRough: 15, machinability: 0.9, plastic: false },
  abs_white: { density: 1.05, pricePerKg: 4000,  mrrRough: 50, machinability: 1.4, plastic: true },
  abs_black: { density: 1.05, pricePerKg: 4000,  mrrRough: 50, machinability: 1.4, plastic: true },
  nylon:     { density: 1.14, pricePerKg: 8000,  mrrRough: 45, machinability: 1.3, plastic: true },
  rubber:    { density: 1.2,  pricePerKg: 5000,  mrrRough: 30, machinability: 1.2, plastic: true },
  ceramic:   { density: 3.9,  pricePerKg: 20000, mrrRough: 1,  machinability: 0.15, plastic: false },
  glass:     { density: 2.5,  pricePerKg: 6000,  mrrRough: 1,  machinability: 0.15, plastic: false },
  wood:      { density: 0.7,  pricePerKg: 3000,  mrrRough: 60, machinability: 1.6, plastic: false },
  // Explicit alloys often chosen in quoting.
  stainless: { density: 8.0,  pricePerKg: 12000, mrrRough: 5,  machinability: 0.4, plastic: false },
  brass:     { density: 8.5,  pricePerKg: 14000, mrrRough: 18, machinability: 0.95, plastic: false },
  // MATERIAL_PRESETS use-case ids → nearest cost class (so they don't hit the generic fallback).
  structural:            { density: 7.85, pricePerKg: 3500,  mrrRough: 9,  machinability: 0.55, plastic: false }, // steel-like
  lightweight:           { density: 2.7,  pricePerKg: 8500,  mrrRough: 24, machinability: 1.0, plastic: false },  // aluminum-like
  outdoor:               { density: 2.7,  pricePerKg: 9000,  mrrRough: 22, machinability: 0.95, plastic: false }, // anodized alu-ish
  food_contact:          { density: 8.0,  pricePerKg: 13000, mrrRough: 5,  machinability: 0.4, plastic: false },  // stainless-ish
  electrical_insulation: { density: 1.4,  pricePerKg: 9000,  mrrRough: 40, machinability: 1.2, plastic: true },   // engineering plastic
};
const MAT_FALLBACK: MatClass = { density: 2.7, pricePerKg: 8000, mrrRough: 20, machinability: 0.9, plastic: false };
const mat = (id: string): MatClass => MAT[id] ?? MAT_FALLBACK;

interface RegionRates {
  cnc3Hr: number; cnc5Hr: number; injHrPerTon: number; sheetHr: number; printHr: number;
  cncSetup: number; cncProgram: number; sheetSetup: number; moldBase: number; minCharge: number;
  leadMul: number;
}
const RATES: Record<CostRegion, RegionRates> = {
  kr: { cnc3Hr: 55000, cnc5Hr: 90000, injHrPerTon: 350, sheetHr: 45000, printHr: 22000, cncSetup: 45000, cncProgram: 60000, sheetSetup: 40000, moldBase: 6_000_000, minCharge: 30000, leadMul: 1 },
  cn: { cnc3Hr: 28000, cnc5Hr: 50000, injHrPerTon: 180, sheetHr: 24000, printHr: 12000, cncSetup: 25000, cncProgram: 35000, sheetSetup: 22000, moldBase: 3_000_000, minCharge: 15000, leadMul: 1.4 },
};

const FINISH_ADD: Record<Finish, number> = { none: 0, anodize: 1500, polish: 3000, plate: 2500, paint: 1200 };

const round = (n: number) => (n >= 100000 ? Math.round(n / 1000) * 1000 : n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** DFM-driven complexity multiplier (≈0.85–2.4). Uses signals we already compute. */
function complexityOf(d: DfmSignals | undefined, saToVol: number, aspect: number): number {
  let c = 1.0;
  if (!d) d = {};
  if ((d.undercutCount ?? 0) > 0) c += clamp((d.undercutCount ?? 0) / 500, 0.1, 0.5);
  if (d.deepPocket) c += 0.2;
  if (d.thinWall) c += 0.15;
  c += clamp((d.featureCount ?? 0) * 0.02, 0, 0.3);
  c += clamp((d.sharpCornerCount ?? 0) / 200, 0, 0.15);
  if (saToVol > 3) c += 0.15;            // thin/intricate shell
  if (aspect > 4) c += 0.1;              // long/deep features
  return clamp(c, 0.85, 2.4);
}

export function estimateCost(input: CostInput): CostEstimate {
  const region: CostRegion = input.region ?? 'kr';
  const R = RATES[region];
  const m = mat(input.material);
  const qty = Math.max(1, Math.floor(input.quantity || 1));
  const cal = input.calibrationFactor && input.calibrationFactor > 0 ? input.calibrationFactor : 1;
  const tol = input.tolerance ?? 'standard';
  const finish = input.finish ?? 'none';

  const volCm3 = Math.max(0.001, input.volume_mm3 / 1000);
  const saCm2 = Math.max(0.01, input.surface_area_mm2 / 100);
  const { w, h, d } = input.bbox_mm;
  const bboxCm3 = Math.max(volCm3, (w * h * d) / 1000);
  const dims = [w, h, d].filter(x => x > 0);
  const maxMm = dims.length ? Math.max(...dims) : 10;
  const minMm = dims.length ? Math.min(...dims) : 2;
  const midMm = dims.length ? (dims.sort((a, b) => a - b)[Math.floor(dims.length / 2)] ?? maxMm) : maxMm;
  const aspect = minMm > 0 ? maxMm / minMm : 1;
  const saToVol = saCm2 / volCm3;
  const holes = input.dfm?.featureCount ?? Math.min(24, Math.round(saCm2 / 15));
  const cplx = complexityOf(input.dfm, saToVol, aspect);
  const tolMul = tol === 'tight' ? 1.3 : 1;
  // Learning curve: per-part machining/labor eases with volume (Wright ~b=0.1).
  const qtyEase = clamp(Math.pow(qty, -0.08), 0.72, 1);

  const bd: Record<string, number> = {};
  const drivers: string[] = [];
  let perPart = 0;
  let leadMin = 5, leadMax = 10;

  if (input.process === 'cnc') {
    const use5axis = (input.dfm?.undercutCount ?? 0) > 0;
    const machRate = use5axis ? R.cnc5Hr : R.cnc3Hr;
    const stockKg = (bboxCm3 * m.density) / 1000;
    const matCost = stockKg * m.pricePerKg * 1.3;
    const removedCm3 = Math.max(0, bboxCm3 - volCm3);
    const roughMin = removedCm3 / (m.mrrRough * (use5axis ? 0.7 : 1));
    const finishMin = (saCm2 * 0.12) / m.machinability;
    const drillMin = holes * (1.2 + midMm / 30);
    const setups = clamp(1 + Math.round((input.dfm?.featureCount ?? 0) / 8) + (aspect > 3 ? 1 : 0) + (use5axis ? 1 : 0), 1, 5);
    const machMin = (roughMin + finishMin + drillMin) * cplx * tolMul * qtyEase;
    const machCost = (machMin / 60) * machRate;
    const setupCost = (setups * R.cncSetup + R.cncProgram) / qty;
    const finCost = FINISH_ADD[finish];
    perPart = matCost + machCost + setupCost + finCost;
    bd.material = round(matCost); bd.machining = round(machCost); bd.setup = round(setupCost); if (finCost) bd.finish = finCost;
    drivers.push(`소재 ${round(matCost).toLocaleString()}원`, `가공 ${Math.round(machMin)}분(${use5axis ? '5축' : '3축'}) ${round(machCost).toLocaleString()}원`, `셋업${setups}회+프로그래밍÷${qty} ${round(setupCost).toLocaleString()}원`);
    if (use5axis) drivers.push('언더컷→5축 가공');
    if (m.machinability <= 0.3) drivers.push('난삭재');
    leadMin = Math.round((5 + setups) * R.leadMul); leadMax = Math.round((10 + setups * 2) * R.leadMul);
  } else if (input.process === 'injection' || input.process === 'casting') {
    const casting = input.process === 'casting';
    const partKg = (volCm3 * m.density) / 1000;
    // Clamp tonnage from projected area (largest footprint).
    const projCm2 = Math.max((w * h), (h * d), (w * d)) / 100;
    const tonnage = clamp(projCm2 * 0.35, 20, 1800);
    const injHr = tonnage * R.injHrPerTon;
    const wallMm = clamp(input.dfm?.minWallMm && input.dfm.minWallMm > 0 ? input.dfm.minWallMm : Math.max(1, minMm / 2), 0.8, 8);
    const coolingSec = 2 + 2.5 * wallMm * wallMm;   // cooling ∝ wall²
    const cycleSec = 2 + coolingSec + 3;
    // Optimize cavity count for this quantity.
    const moldOne = (casting ? R.moldBase * 0.4 : R.moldBase) * clamp(projCm2 / 60, 0.5, 5) * cplx;
    let best = { cav: 1, per: Infinity, mold: moldOne };
    for (let cav = 1; cav <= 16; cav++) {
      const mold = moldOne * (1 + 0.55 * (cav - 1));
      const shotMass = partKg * cav * 1.15; // + runner
      const machPerShot = (cycleSec / 3600) * injHr;
      const perShot = machPerShot + shotMass * m.pricePerKg;
      const per = perShot / cav + mold / qty;
      if (per < best.per) best = { cav, per, mold };
    }
    const matMachPP = (best.per - best.mold / qty);
    const moldPP = best.mold / qty;
    perPart = best.per;
    bd.tooling = round(best.mold); bd.toolingPerPart = round(moldPP); bd.partCycle = round(matMachPP);
    drivers.push(`금형 ${round(best.mold).toLocaleString()}원(${best.cav}캐비티) ÷ ${qty} = ${round(moldPP).toLocaleString()}원/개`, `개당 소재+성형 ${round(matMachPP).toLocaleString()}원`, `형체력 ~${Math.round(tonnage)}톤, 냉각 ${coolingSec.toFixed(1)}s(살두께 ${wallMm.toFixed(1)}mm)`);
    if (moldPP > matMachPP) { const be = Math.round(best.mold / Math.max(1, matMachPP)); drivers.push(`금형비 지배 — 손익분기 ~${be.toLocaleString()}개+`); }
    leadMin = Math.round((casting ? 20 : 30) * R.leadMul); leadMax = Math.round((casting ? 35 : 55) * R.leadMul);
  } else if (input.process === 'sheet_metal') {
    const tCm = clamp(minMm / 10, 0.05, 2);
    const flatCm2 = saCm2 / 2;
    const matCost = flatCm2 * tCm * m.density / 1000 * m.pricePerKg * 1.25; // + nesting scrap
    const cutLenM = Math.max(2 * (w + h) / 1000, Math.sqrt(flatCm2) * 4 / 100) + holes * 0.05;
    const cutCost = cutLenM * (R.sheetHr / 60) * 1.5;
    const bends = clamp(Math.round(maxMm / 25) + (aspect > 3 ? 1 : 0), 0, 12);
    const bendCost = bends * 1500;
    const pierceCost = holes * 300;
    const setupCost = R.sheetSetup / qty;
    perPart = (matCost + cutCost + bendCost + pierceCost) * qtyEase + setupCost;
    bd.material = round(matCost); bd.cut = round(cutCost); bd.bend = round(bendCost); bd.pierce = round(pierceCost); bd.setup = round(setupCost);
    drivers.push(`판재 ${round(matCost).toLocaleString()}원`, `절단 ${cutLenM.toFixed(1)}m ${round(cutCost).toLocaleString()}원`, `벤딩 ${bends}회 ${round(bendCost).toLocaleString()}원`, `셋업÷${qty} ${round(setupCost).toLocaleString()}원`);
    leadMin = Math.round(5 * R.leadMul); leadMax = Math.round(12 * R.leadMul);
  } else { // 3d_print
    const partKg = (volCm3 * m.density) / 1000;
    const matCost = partKg * m.pricePerKg * 2.2;
    const printHr = volCm3 * 0.05 + maxMm / 10 * 0.25;
    const printCost = printHr * R.printHr;
    perPart = (matCost + printCost * cplx);
    bd.material = round(matCost); bd.print = round(printCost);
    drivers.push(`소재 ${round(matCost).toLocaleString()}원`, `출력 ${printHr.toFixed(1)}h ${round(printCost).toLocaleString()}원`);
    leadMin = Math.round(3 * R.leadMul); leadMax = Math.round(7 * R.leadMul);
  }

  perPart = Math.max(perPart, R.minCharge / Math.min(qty, 5)) * cal;
  const spread = cplx > 1.6 || (input.dfm?.errorCount ?? 0) > 0 ? [0.6, 1.6] : [0.72, 1.38];
  const perMin = round(perPart * spread[0]!);
  const perMax = round(perPart * spread[1]!);
  return {
    currency: 'KRW', process: input.process, region,
    perPart: { min: perMin, max: perMax },
    total: { min: round(perMin * qty), max: round(perMax * qty) },
    leadDays: { min: leadMin, max: leadMax },
    confidence: cal !== 1 ? 'medium' : 'low',
    calibrated: cal !== 1,
    complexity: Math.round(cplx * 100) / 100,
    drivers, breakdown: bd,
    note: cal !== 1
      ? '실견적으로 보정된 추정치. 확정 가격은 실견적을 받으세요.'
      : '실견적 미반영 개략치(예산·판단용). 확정 가격은 실견적을 받으세요.',
  };
}

export interface CostCurvePoint { quantity: number; perPartMid: number; total: number }

/** Per-part cost across quantity tiers — shows volume breakpoints (esp. the
 *  injection mold amortization curve). Same process/region as `input`. */
export function costCurve(input: Omit<CostInput, 'quantity'>, tiers: number[] = [1, 10, 100, 1000, 10000]): CostCurvePoint[] {
  return tiers.map(q => {
    const e = estimateCost({ ...input, quantity: q });
    const mid = Math.round((e.perPart.min + e.perPart.max) / 2);
    return { quantity: q, perPartMid: mid, total: mid * q };
  });
}

/** Which processes are worth comparing for a material. */
function candidateProcesses(materialId: string): CostProcess[] {
  const m = mat(materialId);
  if (m.plastic) return ['injection', '3d_print', 'cnc'];
  return ['cnc', 'sheet_metal', 'casting', '3d_print'];
}

export interface CostComparison {
  quantity: number;
  options: CostEstimate[];               // sorted, cheapest per-part first
  cheapest: { process: CostProcess; region: CostRegion; perPartMid: number };
  notes: string[];
}

/** The "AI 비교견적": estimate across viable processes × KR/CN and rank them. */
export function compareCost(input: Omit<CostInput, 'process' | 'region'>, calibration?: (p: CostProcess, r: CostRegion) => number): CostComparison {
  const procs = candidateProcesses(input.material);
  const regions: CostRegion[] = ['kr', 'cn'];
  const options: CostEstimate[] = [];
  for (const process of procs) {
    for (const region of regions) {
      options.push(estimateCost({ ...input, process, region, calibrationFactor: calibration?.(process, region) ?? 1 }));
    }
  }
  const mid = (e: CostEstimate) => (e.perPart.min + e.perPart.max) / 2;
  options.sort((a, b) => mid(a) - mid(b));
  const c = options[0]!;
  const notes: string[] = [];
  // Injection break-even hint if present but not cheapest.
  const inj = options.find(o => o.process === 'injection');
  if (inj && c.process !== 'injection') notes.push('현재 수량에선 사출 금형비가 비효율 — 수량이 크면 사출이 역전될 수 있습니다.');
  const krVsCn = options.filter(o => o.process === c.process);
  if (krVsCn.length === 2) {
    const kr = krVsCn.find(o => o.region === 'kr')!, cn = krVsCn.find(o => o.region === 'cn')!;
    const save = Math.round((1 - mid(cn) / mid(kr)) * 100);
    if (save > 5) notes.push(`같은 공정 기준 중국이 약 ${save}% 저렴(납기·물류·MOQ 고려 필요).`);
  }
  return {
    quantity: Math.max(1, Math.floor(input.quantity || 1)),
    options,
    cheapest: { process: c.process, region: c.region, perPartMid: round(mid(c)) },
    notes,
  };
}
