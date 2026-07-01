// Parametric manufacturing cost estimator — deterministic (no LLM), so the AI
// never invents prices. Produces a RANGE + drivers from geometry metrics using
// per-process engineering formulas and seed rate tables. Real quotes calibrate
// it later (calibrationFactor); until then confidence is 'low'.
//
// ⚠️ Rate tables are SEED values (public benchmarks) — tune with real quotes.
// Output is a budgeting / go-no-go range, NOT a binding quote.

export type CostRegion = 'kr' | 'cn';
export type CostProcess = 'cnc' | 'injection' | 'sheet_metal' | '3d_print' | 'casting';

export interface CostInput {
  volume_mm3: number;
  surface_area_mm2: number;
  bbox_mm: { w: number; h: number; d: number };
  material: string;       // MATERIAL_PRESETS id
  process: CostProcess;
  quantity: number;
  region?: CostRegion;    // default 'kr'
  featureCount?: number;  // holes/pockets/etc from DFM (optional)
  calibrationFactor?: number; // from real-quote calibration; default 1
}

export interface CostEstimate {
  currency: 'KRW';
  region: CostRegion;
  perPart: { min: number; max: number };
  total: { min: number; max: number };
  confidence: 'low' | 'medium' | 'high';
  calibrated: boolean;
  drivers: string[];
  note: string;
}

interface MatClass { density: number; pricePerKg: number; mrr: number } // mrr: cm³/min (CNC removal)
const MAT: Record<string, MatClass> = {
  aluminum:  { density: 2.7,  pricePerKg: 8000,  mrr: 20 },
  steel:     { density: 7.85, pricePerKg: 3000,  mrr: 8 },
  titanium:  { density: 4.5,  pricePerKg: 60000, mrr: 2 },
  copper:    { density: 8.9,  pricePerKg: 15000, mrr: 10 },
  gold:      { density: 19.3, pricePerKg: 95000000, mrr: 10 },
  abs_white: { density: 1.05, pricePerKg: 4000,  mrr: 45 },
  abs_black: { density: 1.05, pricePerKg: 4000,  mrr: 45 },
  nylon:     { density: 1.14, pricePerKg: 8000,  mrr: 40 },
  ceramic:   { density: 3.9,  pricePerKg: 20000, mrr: 1 },
  glass:     { density: 2.5,  pricePerKg: 6000,  mrr: 1 },
  rubber:    { density: 1.2,  pricePerKg: 5000,  mrr: 30 },
  wood:      { density: 0.7,  pricePerKg: 3000,  mrr: 60 },
};
const MAT_FALLBACK: MatClass = { density: 2.7, pricePerKg: 8000, mrr: 15 };
const mat = (id: string): MatClass => MAT[id] ?? MAT_FALLBACK;

interface RegionRates {
  cncHr: number; injHr: number; sheetHr: number; printHr: number;
  cncSetup: number; sheetSetup: number; moldBase: number;
}
const RATES: Record<CostRegion, RegionRates> = {
  kr: { cncHr: 55000, injHr: 60000, sheetHr: 45000, printHr: 22000, cncSetup: 60000, sheetSetup: 40000, moldBase: 6_000_000 },
  cn: { cncHr: 28000, injHr: 32000, sheetHr: 24000, printHr: 12000, cncSetup: 35000, sheetSetup: 22000, moldBase: 3_000_000 },
};

const round = (n: number) => (n >= 100000 ? Math.round(n / 1000) * 1000 : Math.round(n / 10) * 10);

export function estimateCost(input: CostInput): CostEstimate {
  const region: CostRegion = input.region ?? 'kr';
  const R = RATES[region];
  const m = mat(input.material);
  const qty = Math.max(1, Math.floor(input.quantity || 1));
  const cal = input.calibrationFactor && input.calibrationFactor > 0 ? input.calibrationFactor : 1;

  const volCm3 = Math.max(0.001, input.volume_mm3 / 1000);
  const saCm2 = Math.max(0, input.surface_area_mm2 / 100);
  const { w, h, d } = input.bbox_mm;
  const bboxCm3 = Math.max(volCm3, (w * h * d) / 1000);
  const dimsMm = [w, h, d].filter(x => x > 0);
  const maxCm = (dimsMm.length ? Math.max(...dimsMm) : 10) / 10;
  const minMm = dimsMm.length ? Math.min(...dimsMm) : 2;
  const feat = input.featureCount ?? Math.min(20, Math.round(saCm2 / 15));

  let perPart = 0;
  const drivers: string[] = [];

  if (input.process === 'cnc') {
    const stockKg = (bboxCm3 * m.density) / 1000;
    const matCost = stockKg * m.pricePerKg * 1.25; // stock + waste
    const removedCm3 = Math.max(0, bboxCm3 - volCm3);
    const machMin = removedCm3 / m.mrr + saCm2 * 0.03 + feat * 1.5;
    const machCost = (machMin / 60) * R.cncHr;
    const setupPer = R.cncSetup / qty;
    perPart = matCost + machCost + setupPer;
    drivers.push(`소재 ${round(matCost)}원`, `가공(${Math.round(machMin)}분) ${round(machCost)}원`, `셋업/수량 ${round(setupPer)}원`);
    if (m.mrr <= 4) drivers.push('난삭재(가공시간↑)');
  } else if (input.process === 'injection' || input.process === 'casting') {
    const partKg = (volCm3 * m.density) / 1000;
    const matCostPP = partKg * m.pricePerKg;
    const cycleSec = 12 + volCm3 * 0.6;
    const machCostPP = (cycleSec / 3600) * R.injHr;
    const sizeF = Math.min(5, Math.max(0.5, maxCm / 8));
    const moldBase = input.process === 'casting' ? R.moldBase * 0.4 : R.moldBase;
    const moldCost = moldBase * sizeF;
    const moldPP = moldCost / qty;
    perPart = matCostPP + machCostPP + moldPP;
    drivers.push(`금형 ${round(moldCost)}원 ÷ ${qty}개 = ${round(moldPP)}원/개`, `개당 소재+성형 ${round(matCostPP + machCostPP)}원`);
    const breakeven = Math.round(moldCost / Math.max(1, matCostPP + machCostPP));
    if (moldPP > (matCostPP + machCostPP)) drivers.push(`금형비 지배적 — 손익분기 대략 ${breakeven.toLocaleString()}개+`);
  } else if (input.process === 'sheet_metal') {
    const tCm = Math.max(0.05, minMm / 10);
    const flatCm2 = saCm2 / 2;
    const matCost = flatCm2 * tCm * m.density / 1000 * m.pricePerKg * 1.2;
    const cutLenM = (2 * (w + h) / 1000) || (Math.sqrt(flatCm2) * 4 / 100);
    const cutCost = cutLenM * (R.sheetHr / 60) * 1.5;
    const bends = Math.min(12, Math.max(0, Math.round(maxCm / 3)));
    const bendCost = bends * 1500;
    const setupPer = R.sheetSetup / qty;
    perPart = matCost + cutCost + bendCost + setupPer;
    drivers.push(`판재 ${round(matCost)}원`, `절단 ${round(cutCost)}원`, `벤딩 ${bends}회 ${round(bendCost)}원`, `셋업/수량 ${round(setupPer)}원`);
  } else { // 3d_print
    const partKg = (volCm3 * m.density) / 1000;
    const matCost = partKg * m.pricePerKg * 2.2; // filament/resin markup
    const printHr = (volCm3 * 0.06 + maxCm * 0.25) / 1;
    const printCost = printHr * R.printHr;
    perPart = matCost + printCost;
    drivers.push(`소재 ${round(matCost)}원`, `출력(${printHr.toFixed(1)}h) ${round(printCost)}원`);
  }

  perPart = perPart * cal;
  const perMin = round(perPart * 0.7);
  const perMax = round(perPart * 1.4);
  return {
    currency: 'KRW',
    region,
    perPart: { min: perMin, max: perMax },
    total: { min: round(perMin * qty), max: round(perMax * qty) },
    confidence: cal !== 1 ? 'medium' : 'low',
    calibrated: cal !== 1,
    drivers,
    note: cal !== 1
      ? '실견적으로 보정된 추정치입니다. 확정 가격은 실견적을 받으세요.'
      : '실견적 데이터 미반영 개략치(예산·판단용). 확정 가격은 실견적을 받으세요.',
  };
}
