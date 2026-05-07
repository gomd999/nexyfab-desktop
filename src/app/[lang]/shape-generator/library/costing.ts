/**
 * costing.ts — 부품 부피·질량·단가 추정
 *
 * 정확한 CAD 부피는 JSCAD 컴파일 후에야 알 수 있지만,
 * 사용자가 swap 결정할 때 실시간으로 비교하려면 빠른 추정이 필요.
 * 부품 카테고리별 휴리스틱 + 재료 밀도/단가 + 제조법 setup 비용으로 1차 견적.
 */

import { PARTS_BY_ID } from './parts';
import { METHODS_BY_ID } from './methods';
import { MATERIALS_BY_ID } from './materials';

export interface CostEstimate {
  volume_cm3: number;          // 부피 cm³
  mass_g: number;              // 질량 g
  materialCostUsd: number;     // 재료비
  machiningCostUsd: number;    // 가공비 (setup tier 기반)
  totalUnitUsd: number;        // 1개당 총 단가
  setupOnceUsd: number;        // 비반복성 (금형/세팅) 비용
  notes: string[];
}

// ── Setup / Unit machining $ — tier 별 산업 평균 (대략) ──
// methods.ts 의 setupCostTier(1~5), unitCostTier(1~5) 를 USD 로 매핑
const SETUP_TIER_USD: Record<number, number> = {
  1: 0,        // 툴링 없음 (3D 프린팅)
  2: 50,       // 간단한 지그
  3: 300,      // CNC 세팅 / 시트메탈
  4: 3000,     // 단순 금형
  5: 25000,    // 복잡한 사출/다이 캐스팅 금형
};

const UNIT_TIER_USD_PER_KG: Record<number, number> = {
  1: 0.5,    // 사출/스탬핑 — 금형비 회수 후 매우 저렴
  2: 5,      // FDM, 시트메탈
  3: 25,     // CNC 일반, SLA, SLS
  4: 80,     // 5축 CNC, CFRP 가공
  5: 250,    // DMLS, PEEK 가공
};

// ── 부품 카테고리별 부피 채움 비율 (bbox 대비 실제 솔리드 비율) ──
const FILL_FACTOR_BY_CATEGORY: Record<string, number> = {
  bracket: 0.18,       // L/평 브라켓 - 박판
  flange: 0.55,        // 원형 플랜지 - 디스크
  shaft: 0.78,         // 솔리드 원통
  coupling: 0.7,
  spacer: 0.55,        // 스탠드오프 / 스페이서
  gear: 0.6,           // 평 기어
  plate: 0.25,         // 타공 플레이트
  cover: 0.18,
  mount: 0.5,          // 베어링 시트
  housing: 0.15,       // 박스 하우징 - 얇은 벽
};

/** 부품 파라미터에서 bbox(mm) 추정. 없으면 sizeClass dims 사용. */
function bboxFromParams(
  partId: string,
  params: Record<string, number>,
  fallback?: { w: number; h: number; d: number }
): { w: number; h: number; d: number } {
  // 우선순위: width/height/depth → length/diameter → fallback
  const w =
    params.width ??
    params.outerDia ??
    params.diameter ??
    params.length ??
    fallback?.w ??
    50;
  const h =
    params.height ??
    params.length ??
    params.outerDia ??
    fallback?.h ??
    50;
  const d =
    params.depth ??
    params.thickness ??
    params.height ??
    fallback?.d ??
    30;
  return { w, h, d };
}

export function estimateUnitCost(
  partId: string,
  params: Record<string, number>,
  methodId: string,
  materialId: string,
  fallbackDims?: { w: number; h: number; d: number },
  unitsPerOrder: number = 1
): CostEstimate | null {
  const part = PARTS_BY_ID[partId];
  const method = METHODS_BY_ID[methodId];
  const material = MATERIALS_BY_ID[materialId];
  if (!method || !material) return null;

  const notes: string[] = [];
  const bbox = bboxFromParams(partId, params, fallbackDims);
  // freeform-custom (카탈로그 외 부품) → 중간 채움 비율로 가정
  const fill = part ? FILL_FACTOR_BY_CATEGORY[part.category] ?? 0.4 : 0.35;
  if (!part) notes.push('맞춤 설계 — 부피 ±40% 오차');

  // 부피 mm³ → cm³
  const bboxVolume_cm3 = (bbox.w * bbox.h * bbox.d) / 1000;
  const volume_cm3 = bboxVolume_cm3 * fill;

  // 질량 g (density kg/m³ × volume cm³ × 1e-3 = g)
  const mass_g = (material.densityKgM3 * volume_cm3) / 1000;
  const mass_kg = mass_g / 1000;

  // 재료비 (loss factor 1.3 — 가공 손실 / 적층 서포트 / 런너)
  const lossFactor = method.category === 'subtractive' ? 1.5 : method.category === 'additive' ? 1.15 : 1.3;
  const materialCostUsd = mass_kg * material.pricePerKgUsd * lossFactor;
  if (lossFactor > 1.4) notes.push(`가공 손실 ${Math.round((lossFactor - 1) * 100)}% 반영`);

  // 가공비 — 단가 tier × 질량 (소요 시간 ≈ 부피 비례 근사)
  const machiningRate = UNIT_TIER_USD_PER_KG[method.unitCostTier];
  const machiningCostUsd = Math.max(machiningRate * mass_kg, machiningRate * 0.05); // 최소 처리비

  // setup (1회성) — 수량으로 분배
  const setupOnceUsd = SETUP_TIER_USD[method.setupCostTier];
  const setupPerUnit = setupOnceUsd / Math.max(1, unitsPerOrder);

  const totalUnitUsd = materialCostUsd + machiningCostUsd + setupPerUnit;

  if (method.setupCostTier >= 4 && unitsPerOrder < 100) {
    notes.push(`금형 회수 미흡 (수량 ${unitsPerOrder}개 < 권장 100+)`);
  }

  return {
    volume_cm3: round(volume_cm3, 2),
    mass_g: round(mass_g, 2),
    materialCostUsd: round(materialCostUsd, 2),
    machiningCostUsd: round(machiningCostUsd, 2),
    totalUnitUsd: round(totalUnitUsd, 2),
    setupOnceUsd,
    notes,
  };
}

function round(n: number, d: number): number {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}
