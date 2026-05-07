/**
 * partner-pricebook.ts — Types + utilities for partner price books and
 * process-capability matrices, plus a deterministic auto-quote helper.
 *
 * Stored on nf_factories as two JSON columns (`price_book`, `process_capability`)
 * so partners self-serve quoting without admin involvement.
 */

/* ─── Process / material catalogs ──────────────────────────────────────────── */

export type ProcessCode =
  | 'cnc_milling' | 'cnc_turning'
  | 'fdm' | 'sla' | 'sls'
  | 'sheetmetal_laser' | 'sheetmetal_press'
  | 'injection' | 'casting' | 'welding';

export const PROCESS_LABELS: Record<ProcessCode, string> = {
  cnc_milling:       'CNC 밀링',
  cnc_turning:       'CNC 선반',
  fdm:               '3D 프린팅 (FDM)',
  sla:               '3D 프린팅 (SLA)',
  sls:               '3D 프린팅 (SLS)',
  sheetmetal_laser:  '판금 (레이저)',
  sheetmetal_press:  '판금 (프레스)',
  injection:         '사출 성형',
  casting:           '주조',
  welding:           '용접',
};

export const PROCESS_CODES = Object.keys(PROCESS_LABELS) as ProcessCode[];

/* ─── Data models ──────────────────────────────────────────────────────────── */

export interface VolumeTier {
  minQty: number;       // applies when qty >= minQty
  discountPct: number;  // 0 ~ 50
}

export interface PriceBookProcessRate {
  hourlyRateKrw: number;   // machine + operator combined
  setupHours?: number;     // one-time setup, multiplied into total
}

export interface PriceBookMaterial {
  pricePerKgKrw: number;
  markupPct?: number;      // 0 ~ 100, partner's markup over raw cost
}

export interface PriceBook {
  setupFeeKrw: number;            // flat per-order
  minOrderKrw: number;            // floor on totalCost
  expressMultiplier: number;      // applied when leadTime is "rush"
  currency: 'KRW';                // future-proofing — only KRW supported now
  volumeTiers: VolumeTier[];      // sorted ascending by minQty
  processes: Partial<Record<ProcessCode, PriceBookProcessRate>>;
  materials: Record<string, PriceBookMaterial>; // keyed by material preset id
}

export interface ProcessCapabilitySpec {
  enabled: boolean;
  maxBboxMm: { x: number; y: number; z: number };
  minWallMm?: number;
  minHoleMm?: number;
  minToleranceMm?: number;     // e.g. 0.05 for ±0.05mm
  surfaceFinishRa?: number[];  // available Ra options
  leadTimeDaysMin: number;
  leadTimeDaysMax: number;
  notes?: string;
}

export type ProcessCapability = Partial<Record<ProcessCode, ProcessCapabilitySpec>>;

/* ─── Defaults — sensible starting values for new partners ─────────────────── */

export const DEFAULT_PRICEBOOK: PriceBook = {
  setupFeeKrw: 50_000,
  minOrderKrw: 100_000,
  expressMultiplier: 1.5,
  currency: 'KRW',
  volumeTiers: [
    { minQty: 10,  discountPct: 5  },
    { minQty: 100, discountPct: 15 },
    { minQty: 500, discountPct: 25 },
  ],
  processes: {
    cnc_milling: { hourlyRateKrw: 80_000, setupHours: 0.5 },
    fdm:         { hourlyRateKrw: 20_000, setupHours: 0.1 },
  },
  materials: {
    aluminum: { pricePerKgKrw: 11_000, markupPct: 30 },
    steel:    { pricePerKgKrw: 4_000,  markupPct: 30 },
  },
};

export const DEFAULT_CAPABILITY: ProcessCapability = {
  cnc_milling: {
    enabled: true,
    maxBboxMm: { x: 600, y: 400, z: 300 },
    minWallMm: 0.8,
    minHoleMm: 1.0,
    minToleranceMm: 0.05,
    surfaceFinishRa: [0.8, 1.6, 3.2, 6.3],
    leadTimeDaysMin: 5,
    leadTimeDaysMax: 14,
  },
};

/* ─── Validation ───────────────────────────────────────────────────────────── */

import { z } from 'zod';

const processCodeSchema = z.enum([
  'cnc_milling', 'cnc_turning',
  'fdm', 'sla', 'sls',
  'sheetmetal_laser', 'sheetmetal_press',
  'injection', 'casting', 'welding',
]);

const volumeTierSchema = z.object({
  minQty:      z.number().int().min(1, 'minQty 는 1 이상이어야 합니다'),
  discountPct: z.number().min(0, 'discountPct 는 0 이상').max(50, 'discountPct 는 50 이하'),
});

const priceBookProcessRateSchema = z.object({
  hourlyRateKrw: z.number().min(0, '시간당 단가는 0 이상'),
  setupHours:    z.number().min(0).optional(),
});

const priceBookMaterialSchema = z.object({
  pricePerKgKrw: z.number().min(0, 'kg 당 가격은 0 이상'),
  markupPct:     z.number().min(0).max(100).optional(),
});

export const priceBookSchema = z.object({
  setupFeeKrw:        z.number().min(0, '셋업 비용은 0 이상'),
  minOrderKrw:        z.number().min(0, '최소 주문 금액은 0 이상'),
  expressMultiplier:  z.number().min(1, '익스프레스 배수는 1 이상').max(5, '익스프레스 배수는 5 이하'),
  currency:           z.literal('KRW'),
  volumeTiers:        z.array(volumeTierSchema),
  processes:          z.record(processCodeSchema, priceBookProcessRateSchema),
  materials:          z.record(z.string().min(1), priceBookMaterialSchema),
});

const processCapabilitySpecSchema = z.object({
  enabled:         z.boolean(),
  maxBboxMm:       z.object({
    x: z.number().positive('maxBboxMm.x > 0'),
    y: z.number().positive('maxBboxMm.y > 0'),
    z: z.number().positive('maxBboxMm.z > 0'),
  }),
  minWallMm:       z.number().positive().optional(),
  minHoleMm:       z.number().positive().optional(),
  minToleranceMm:  z.number().positive().optional(),
  surfaceFinishRa: z.array(z.number().positive()).optional(),
  leadTimeDaysMin: z.number().int().min(0),
  leadTimeDaysMax: z.number().int().min(0),
  notes:           z.string().optional(),
}).refine(
  (s) => s.leadTimeDaysMax >= s.leadTimeDaysMin,
  { message: 'leadTimeDaysMax 는 leadTimeDaysMin 이상이어야 합니다', path: ['leadTimeDaysMax'] },
);

export const processCapabilitySchema = z.record(processCodeSchema, processCapabilitySpecSchema);

export interface ValidationIssue {
  path: string;     // dotted path (e.g. "processes.cnc_milling.hourlyRateKrw")
  message: string;  // localized error message
}

/**
 * zod.issues 를 사용자 친화적 path/message 쌍으로 변환.
 * API 응답 `{ error: '...', issues: [...] }` 형태로 그대로 전달해 클라이언트가
 * 어느 필드가 문제인지 하이라이트할 수 있게 한다.
 */
function toIssues(zodErr: z.ZodError): ValidationIssue[] {
  return zodErr.issues.map((iss) => ({
    path:    iss.path.join('.') || '(root)',
    message: iss.message,
  }));
}

export function validatePriceBook(x: unknown):
  | { ok: true;  data: PriceBook }
  | { ok: false; issues: ValidationIssue[] } {
  const parsed = priceBookSchema.safeParse(x);
  if (parsed.success) return { ok: true, data: parsed.data as PriceBook };
  return { ok: false, issues: toIssues(parsed.error) };
}

export function validateProcessCapability(x: unknown):
  | { ok: true;  data: ProcessCapability }
  | { ok: false; issues: ValidationIssue[] } {
  const parsed = processCapabilitySchema.safeParse(x);
  if (parsed.success) return { ok: true, data: parsed.data as ProcessCapability };
  return { ok: false, issues: toIssues(parsed.error) };
}

/** @deprecated use validatePriceBook() — returns detailed issues */
export function isPriceBook(x: unknown): x is PriceBook {
  return priceBookSchema.safeParse(x).success;
}

/** @deprecated use validateProcessCapability() — returns detailed issues */
export function isProcessCapability(x: unknown): x is ProcessCapability {
  return processCapabilitySchema.safeParse(x).success;
}

/* ─── Auto-quote ───────────────────────────────────────────────────────────── */

export interface QuoteInput {
  process: ProcessCode;
  materialId: string;
  quantity: number;
  volume_cm3: number;
  bbox?: { w: number; h: number; d: number };
  /** Optional difficulty multiplier from DFM analysis (1.0 = nominal). */
  difficulty?: number;
  isRush?: boolean;
}

export interface AutoQuoteResult {
  totalKrw: number;
  unitKrw: number;
  breakdown: {
    materialKrw:  number;
    machineKrw:   number;
    setupKrw:     number;
    volumeDiscountPct: number;
    expressApplied: boolean;
  };
  leadTimeDays: { min: number; max: number };
  warnings: string[];   // e.g. "맥스 박스 초과", "재질 단가 미설정"
}

const DENSITY_G_PER_CM3: Record<string, number> = {
  aluminum: 2.7, steel: 7.85, titanium: 4.43, copper: 8.96,
  abs_white: 1.05, abs_black: 1.05, nylon: 1.14, glass: 2.5,
  rubber: 1.2, wood: 0.6, ceramic: 3.9, gold: 19.3,
};

/** Heuristic machine-time estimator — keeps the helper deterministic when the
 *  caller doesn't have a process planner. Tuned so a 100cm³ cnc_milling part
 *  comes out around 25 minutes which matches typical 3-axis throughput. */
function estimateMachineHours(input: QuoteInput): number {
  const baseMinutesPerCm3: Record<ProcessCode, number> = {
    cnc_milling: 0.25, cnc_turning: 0.18,
    fdm: 1.2, sla: 0.8, sls: 1.0,
    sheetmetal_laser: 0.05, sheetmetal_press: 0.04,
    injection: 0.005,  // amortized over many shots
    casting: 0.01,
    welding: 0.3,
  };
  const minutes = (baseMinutesPerCm3[input.process] ?? 0.3) * Math.max(1, input.volume_cm3);
  const difficulty = input.difficulty ?? 1.0;
  return (minutes * difficulty) / 60;
}

function pickVolumeDiscount(tiers: VolumeTier[], qty: number): number {
  let best = 0;
  for (const t of tiers) {
    if (qty >= t.minQty && t.discountPct > best) best = t.discountPct;
  }
  return best;
}

export function autoQuote(input: QuoteInput, book: PriceBook, cap?: ProcessCapability): AutoQuoteResult {
  const warnings: string[] = [];
  const qty = Math.max(1, Math.floor(input.quantity));

  // ── Capability check — non-fatal, just warns ───────────────────────────────
  const spec = cap?.[input.process];
  if (spec?.enabled && input.bbox) {
    if (input.bbox.w > spec.maxBboxMm.x
     || input.bbox.h > spec.maxBboxMm.y
     || input.bbox.d > spec.maxBboxMm.z) {
      warnings.push(`최대 가공 크기(${spec.maxBboxMm.x}×${spec.maxBboxMm.y}×${spec.maxBboxMm.z}mm)를 초과합니다.`);
    }
  }

  // ── Material cost ─────────────────────────────────────────────────────────
  const matEntry = book.materials[input.materialId];
  if (!matEntry) warnings.push(`재질 단가가 등록되지 않았습니다: ${input.materialId}`);
  const density = DENSITY_G_PER_CM3[input.materialId] ?? 5.0;
  const massKg = (input.volume_cm3 * density) / 1000;
  const materialBase = matEntry ? matEntry.pricePerKgKrw * massKg : 0;
  const materialKrw  = materialBase * (1 + ((matEntry?.markupPct ?? 0) / 100));

  // ── Machine cost ──────────────────────────────────────────────────────────
  const procRate = book.processes[input.process];
  if (!procRate) warnings.push(`공정 단가가 등록되지 않았습니다: ${PROCESS_LABELS[input.process]}`);
  const machineHours = estimateMachineHours(input) * qty;
  const machineKrw   = procRate ? procRate.hourlyRateKrw * machineHours : 0;
  const setupKrw     = (procRate?.setupHours ?? 0) * (procRate?.hourlyRateKrw ?? 0) + book.setupFeeKrw;

  // ── Volume discount + express surcharge ───────────────────────────────────
  const volumeDiscountPct = pickVolumeDiscount(book.volumeTiers, qty);
  const expressApplied = !!input.isRush;

  let totalKrw = (materialKrw + machineKrw + setupKrw) * (1 - volumeDiscountPct / 100);
  if (expressApplied) totalKrw *= book.expressMultiplier;
  if (totalKrw < book.minOrderKrw) totalKrw = book.minOrderKrw;

  // ── Lead time ─────────────────────────────────────────────────────────────
  const leadTimeDays = spec
    ? { min: spec.leadTimeDaysMin, max: spec.leadTimeDaysMax }
    : { min: 7, max: 14 };

  return {
    totalKrw: Math.round(totalKrw),
    unitKrw:  Math.round(totalKrw / qty),
    breakdown: {
      materialKrw: Math.round(materialKrw),
      machineKrw:  Math.round(machineKrw),
      setupKrw:    Math.round(setupKrw),
      volumeDiscountPct,
      expressApplied,
    },
    leadTimeDays,
    warnings,
  };
}
