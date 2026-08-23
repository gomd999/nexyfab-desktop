/**
 * B4 — STEP/STL upload → AI auto-quote (zero-input fast path).
 *
 * Existing flow: upload file → extract geometry → user picks material +
 * process + quantity → estimate. That's 4 form steps before a price.
 *
 * This endpoint collapses it: take geometry, apply heuristic material +
 * process selection from shape characteristics, return an immediate
 * price range + suggested alternatives. The user can then refine if
 * the auto-pick isn't quite right.
 *
 * Heuristics (deliberate — no LLM call so it's fast + free):
 *   - thin walls (volume / surface area < 1.5mm) → sheet metal candidate
 *   - small (≤ 50mm bbox) + complex → 3D printing
 *   - mid-large + simple → CNC
 *   - very large (≥ 200mm) + high quantity → injection molding hint
 *
 * The price range comes from running the existing estimate endpoint
 * for the top 2-3 candidates and returning them as comparable options.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_JSON_BODY_BYTES = 64 * 1024;

interface AutoQuoteInput {
  geometry: {
    volume_cm3: number;
    surface_area_cm2: number;
    bbox: { w: number; h: number; d: number };
  };
  /** Optional hint to bias the picker. */
  useCase?: 'prototype' | 'production' | 'custom' | 'one-off';
  quantity?: number;
}

interface ProcessCandidate {
  process: string;
  processName: string;
  material: string;
  materialName: string;
  rationale: string;
  estimatedUnitKrw: number;
  estimatedTotalKrw: number;
  leadTimeDays: number;
  confidence: 'high' | 'medium' | 'low';
}

interface AutoQuoteOutput {
  ok: boolean;
  primary: ProcessCandidate;
  alternatives: ProcessCandidate[];
  /** Geometry classification used for picking. */
  classification: {
    sizeBand: 'small' | 'medium' | 'large' | 'xlarge';
    wallProxy: 'thin' | 'medium' | 'thick';
    complexity: number;
  };
}

const MATERIAL_DEFAULTS = {
  'cnc':                { material: 'aluminum_6061', name: 'Al 6061', densityG: 2.70, basePerCm3: 12 },
  '3d_printing_fdm':    { material: 'pla',           name: 'PLA',     densityG: 1.24, basePerCm3: 5 },
  '3d_printing_sla':    { material: 'pla',           name: 'SLA Resin', densityG: 1.18, basePerCm3: 18 },
  'sheet_metal':        { material: 'steel_s45c',    name: 'Steel 1.5mm', densityG: 7.85, basePerCm3: 8 },
  'injection_molding':  { material: 'abs_plastic',   name: 'ABS',     densityG: 1.05, basePerCm3: 2 },
} as const;

const PROCESS_NAME_KO: Record<string, string> = {
  cnc: 'CNC 가공',
  '3d_printing_fdm': '3D 프린팅 (FDM)',
  '3d_printing_sla': '3D 프린팅 (SLA)',
  sheet_metal: '판금 가공',
  injection_molding: '사출 성형',
};

/** Quick proxy for wall thickness: volume / surface area (mm).
 *  thin → flat sheet-like; thick → solid block. */
function wallProxyMm(g: AutoQuoteInput['geometry']): number {
  const vMm3 = g.volume_cm3 * 1000;
  const aMm2 = g.surface_area_cm2 * 100;
  return aMm2 > 0 ? vMm3 / aMm2 * 2 : 0;  // *2: V/A is half-thickness for thin plates
}

function classify(g: AutoQuoteInput['geometry']): AutoQuoteOutput['classification'] {
  const maxDim = Math.max(g.bbox.w, g.bbox.h, g.bbox.d);
  const sizeBand = maxDim <= 50 ? 'small' : maxDim <= 200 ? 'medium' : maxDim <= 500 ? 'large' : 'xlarge';
  const w = wallProxyMm(g);
  const wallProxy = w < 2 ? 'thin' : w < 6 ? 'medium' : 'thick';
  // Complexity: surface area to bbox surface ratio (high = lots of features).
  const bboxArea = 2 * (g.bbox.w * g.bbox.h + g.bbox.h * g.bbox.d + g.bbox.w * g.bbox.d) / 100; // cm²
  const complexity = bboxArea > 0 ? Math.min(5, g.surface_area_cm2 / bboxArea) : 1;
  return { sizeBand, wallProxy, complexity };
}

/** Estimate cost for a given process — simple model so we don't depend on
 *  the full /estimate route. Real price comes from refinement step. */
function estimate(process: keyof typeof MATERIAL_DEFAULTS, g: AutoQuoteInput['geometry'], qty: number): { unit: number; total: number; days: number } {
  const m = MATERIAL_DEFAULTS[process];

  switch (process) {
    case 'cnc': {
      const setup = 150_000;
      const machining = g.volume_cm3 * m.basePerCm3 * 1500;
      const unit = machining + setup / qty;
      return { unit, total: unit * qty, days: 7 };
    }
    case '3d_printing_fdm': {
      const setup = 30_000;
      const print = g.volume_cm3 * m.basePerCm3 * 800;
      const unit = print + setup / qty;
      return { unit, total: unit * qty, days: 3 };
    }
    case '3d_printing_sla': {
      const setup = 50_000;
      const print = g.volume_cm3 * m.basePerCm3 * 1200;
      const unit = print + setup / qty;
      return { unit, total: unit * qty, days: 4 };
    }
    case 'sheet_metal': {
      const setup = 200_000;
      const flat = g.surface_area_cm2 * 200;
      const unit = flat + setup / qty;
      return { unit, total: unit * qty, days: 5 };
    }
    case 'injection_molding': {
      const tooling = 5_000_000;
      const part = g.volume_cm3 * m.basePerCm3 * 100;
      const unit = part + tooling / qty;
      return { unit, total: unit * qty, days: 35 };
    }
  }
}

/** Pick the top 1 + 2 alternatives based on classification. */
function pickProcesses(c: AutoQuoteOutput['classification'], useCase: AutoQuoteInput['useCase'], qty: number): Array<keyof typeof MATERIAL_DEFAULTS> {
  // Sheet metal short-circuit for thin walls.
  if (c.wallProxy === 'thin' && c.sizeBand !== 'xlarge') {
    return ['sheet_metal', 'cnc', '3d_printing_fdm'];
  }
  // High volume + production → injection mold front.
  if (qty >= 100 && useCase === 'production' && c.sizeBand !== 'xlarge') {
    return ['injection_molding', 'cnc', '3d_printing_fdm'];
  }
  // Small + complex → SLA prototyping.
  if (c.sizeBand === 'small' && c.complexity >= 2) {
    return ['3d_printing_sla', '3d_printing_fdm', 'cnc'];
  }
  // Small/medium prototype → FDM.
  if ((useCase === 'prototype' || useCase === 'one-off') && c.sizeBand !== 'xlarge') {
    return ['3d_printing_fdm', 'cnc', '3d_printing_sla'];
  }
  // Default: CNC primary.
  return ['cnc', '3d_printing_fdm', 'sheet_metal'];
}

function rationale(process: keyof typeof MATERIAL_DEFAULTS, c: AutoQuoteOutput['classification'], qty: number): string {
  const reasons: string[] = [];
  if (process === 'sheet_metal' && c.wallProxy === 'thin') reasons.push('얇은 벽 두께(평균 ≤ 2mm)에 적합');
  if (process === '3d_printing_sla' && c.sizeBand === 'small' && c.complexity >= 2) reasons.push('소형·복잡 형상에 정밀 출력');
  if (process === '3d_printing_fdm') reasons.push('빠른 시제품 / 저비용');
  if (process === 'cnc') reasons.push('정밀도·표면조도 + 다양한 재료');
  if (process === 'injection_molding' && qty >= 100) reasons.push(`수량 ${qty}개로 금형 분할 효율적`);
  return reasons.join('; ') || '형상·수량 조건에 부합';
}

export async function POST(req: NextRequest) {
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  let body: AutoQuoteInput;
  try {
    body = await readBoundedJson(req, MAX_JSON_BODY_BYTES);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.geometry || typeof body.geometry.volume_cm3 !== 'number' || typeof body.geometry.surface_area_cm2 !== 'number' || !body.geometry.bbox) {
    return NextResponse.json({ ok: false, error: 'geometry.volume_cm3 + surface_area_cm2 + bbox required' }, { status: 400 });
  }
  const qty = typeof body.quantity === 'number' && body.quantity > 0 ? Math.min(10_000, body.quantity) : 1;

  const c = classify(body.geometry);
  const processes = pickProcesses(c, body.useCase, qty);

  const buildCandidate = (p: keyof typeof MATERIAL_DEFAULTS, conf: 'high' | 'medium' | 'low'): ProcessCandidate => {
    const m = MATERIAL_DEFAULTS[p];
    const e = estimate(p, body.geometry, qty);
    return {
      process: p,
      processName: PROCESS_NAME_KO[p] ?? p,
      material: m.material,
      materialName: m.name,
      rationale: rationale(p, c, qty),
      estimatedUnitKrw: Math.round(e.unit),
      estimatedTotalKrw: Math.round(e.total),
      leadTimeDays: e.days,
      confidence: conf,
    };
  };

  const primary = buildCandidate(processes[0], 'high');
  const alternatives = processes.slice(1).map(p => buildCandidate(p, 'medium'));

  return NextResponse.json({
    ok: true,
    primary,
    alternatives,
    classification: c,
  });
}
