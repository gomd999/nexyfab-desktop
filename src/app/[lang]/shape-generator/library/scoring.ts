/**
 * scoring.ts — IntakeSpec 와 Parts/Methods/Materials 매칭 엔진
 *
 * 역할:
 *   Intake 결과를 받아 (부품, 제조법, 재료) 조합에 점수를 매기고
 *   LLM(Composer) 에게 "최유력 후보" 를 입력으로 제공.
 */

import type {
  IntakeSpec,
  SizeClass,
  QuantityTier,
  BudgetPriority,
  SpecialReq,
  Environment,
  LoadType,
} from '../intake/intakeSpec';
import { sizeClassToDims, quantityTierToCount } from '../intake/intakeSpec';
import { PARTS_CATALOG, type PartTemplate } from './parts';
import { METHODS, type ManufacturingMethod } from './methods';
import { MATERIALS, type Material } from './materials';

// parts.ts 의 레거시 method ID → methods.ts 의 실제 ID 로 매핑
// (parts.ts 는 'cnc-milling', '3dprint-fdm' 등 간략 ID 사용,
//  methods.ts 는 'cnc-mill-3ax', 'fdm' 등 세분화 ID 사용)
const METHOD_ALIAS: Record<string, string[]> = {
  'cnc-milling': ['cnc-mill-3ax', 'cnc-mill-5ax'],
  'cnc-turning': ['cnc-turning'],
  '3dprint-fdm': ['fdm'],
  '3dprint-sla': ['sla'],
  '3dprint-sls': ['sls'],
  'sheet-metal': ['sheet-metal'],
  'laser-cut': ['laser-cut'],
  'waterjet': ['waterjet'],
  'casting-sand': ['die-casting'],
  'forging': ['die-casting'],
  'grinding': ['cnc-turning', 'cnc-mill-3ax'],
  'injection': ['injection-mold'],
  'wire-edm': ['cnc-mill-5ax'],
  'hobbing': ['cnc-mill-5ax'],
};

function resolvePartMethodIds(partMethodIds: string[]): Set<string> {
  const resolved = new Set<string>();
  for (const id of partMethodIds) {
    const aliases = METHOD_ALIAS[id] ?? [id];
    for (const a of aliases) resolved.add(a);
  }
  return resolved;
}

export interface ScoredOption<T> {
  item: T;
  score: number;        // 0~100
  reasons: string[];    // 점수 근거
  warnings: string[];   // 경고
}

// ═════════════════════════════════════════════
// 부품 스코어링
// ═════════════════════════════════════════════
const MECHANICAL_CATS = new Set(['bracket', 'flange', 'shaft', 'coupling', 'spacer', 'gear', 'plate', 'mount']);

export function scoreParts(spec: IntakeSpec): ScoredOption<PartTemplate>[] {
  const dims = spec.approxDimensions || sizeClassToDims(spec.sizeClass);
  const maxDim = Math.max(dims.w, dims.h, dims.d);

  const results: ScoredOption<PartTemplate>[] = PARTS_CATALOG.map((p) => {
    let score = 40;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1) subCategory 정확 일치 → 최고 가중
    if (spec.subCategory && p.id === spec.subCategory) {
      score += 50;
      reasons.push('사용자 선택 부품과 정확히 일치');
    }

    // 2) function 적합
    if (p.useCases.includes(spec.function)) {
      score += 20;
      reasons.push(`${spec.function} 기능에 적합`);
    }

    // 3) 카테고리 범위
    if (spec.category === 'mechanical_part' && MECHANICAL_CATS.has(p.category)) {
      score += 10;
    }
    if (spec.category === 'structural') {
      if (p.category === 'structural') {
        score += 18;
        reasons.push('구조재 카테고리 정확 일치');
      } else if (['bracket', 'plate', 'mount'].includes(p.category)) {
        score += 8;
      }
    }
    if (spec.category === 'housing' && ['housing', 'cover'].includes(p.category)) {
      score += 15;
      reasons.push('하우징 카테고리');
    }
    if (spec.category === 'jig_fixture' && ['plate', 'mount', 'bracket'].includes(p.category)) {
      score += 8;
    }

    // 4) 대형 부품(>500mm) 시 구조재/판재 가중
    if (maxDim > 500 && ['structural', 'plate'].includes(p.category)) {
      score += 5;
    }

    // 5) 환경 매칭 (식품/방수)
    if (spec.environment.includes('food_grade') && p.category === 'housing') {
      score += 5;
    }
    if (spec.specialReqs.includes('waterproof') && p.category === 'housing') {
      score += 5;
    }

    return { item: p, score: Math.min(100, score), reasons, warnings };
  });

  return results.sort((a, b) => b.score - a.score);
}

// ═════════════════════════════════════════════
// 제조법 스코어링
// ═════════════════════════════════════════════
export function scoreMethods(spec: IntakeSpec): ScoredOption<ManufacturingMethod>[] {
  const dims = spec.approxDimensions || sizeClassToDims(spec.sizeClass);
  const maxDim = Math.max(dims.w, dims.h, dims.d);
  const qtyCount = quantityTierToCount(spec.quantity);

  const results: ScoredOption<ManufacturingMethod>[] = METHODS.map((m) => {
    let score = 50;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1) 크기 제약 — 필수 필터
    if (maxDim > m.maxSize) {
      score -= 40;
      warnings.push(`최대 크기 ${m.maxSize}mm 초과 (요구 ${maxDim}mm)`);
    }

    // 2) 수량 적합성
    const qtyScore = m.qtyFit[spec.quantity];
    score += (qtyScore - 50) * 0.5;
    if (qtyScore >= 80) reasons.push(`${spec.quantity} 수량에 최적`);
    else if (qtyScore < 30) warnings.push(`${spec.quantity} 수량에 부적합`);

    // 3) 예산 우선순위
    if (spec.budget === 'cost') {
      score += (6 - m.unitCostTier - m.setupCostTier) * 3;
      if (m.setupCostTier >= 4) warnings.push('금형비 높음 (시제품 부적합)');
    }
    if (spec.budget === 'quality') {
      score += (m.precisionScore - 50) * 0.4;
      if (m.precisionScore >= 85) reasons.push('고정밀 가공 가능');
    }
    if (spec.budget === 'speed') {
      const avgLead = (m.leadTimeDays[0] + m.leadTimeDays[1]) / 2;
      score += Math.max(0, 20 - avgLead);
      if (avgLead <= 5) reasons.push(`빠른 납기 (${avgLead}일)`);
    }

    // 4) 하중 조건
    if (spec.loadType === 'impact' || spec.loadType === 'cyclic') {
      score += (m.strengthScore - 50) * 0.3;
      if (m.strengthScore < 60) warnings.push('충격/피로 하중에 강도 부족 우려');
    }
    if (spec.loadType === 'dynamic' && m.precisionScore < 70) {
      warnings.push('동적 부품에 정밀도 부족');
    }

    // 5) 특수 요구사항 대응
    if (spec.specialReqs.includes('high_precision')) {
      if (m.toleranceMm <= 0.05) {
        score += 10;
        reasons.push('고정밀 공차 충족');
      } else {
        score -= 15;
        warnings.push('IT6+ 공차 미달');
      }
    }

    // 6) 시제품 워크플로
    if (spec.quantity === 'proto' && m.setupCostTier >= 4) {
      score -= 30;
      warnings.push('시제품에 금형 불필요');
    }

    return { item: m, score: Math.max(0, Math.min(100, score)), reasons, warnings };
  });

  return results.sort((a, b) => b.score - a.score);
}

// ═════════════════════════════════════════════
// 재료 스코어링
// ═════════════════════════════════════════════
export function scoreMaterials(spec: IntakeSpec): ScoredOption<Material>[] {
  const results: ScoredOption<Material>[] = MATERIALS.map((m) => {
    let score = 50;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1) 사용자 지정 재료
    if (spec.materialPreference === m.id) {
      score += 40;
      reasons.push('사용자 지정 재료');
    }

    // 2) 환경 적합성
    for (const env of spec.environment) {
      const adj = environmentAdjustment(env, m);
      score += adj.score;
      if (adj.reason) reasons.push(adj.reason);
      if (adj.warning) warnings.push(adj.warning);
    }

    // 3) 하중 조건
    if (spec.loadType === 'impact' && m.elongationPct < 5) {
      score -= 20;
      warnings.push('취성 재료 — 충격에 균열 우려');
    }
    if (spec.loadType === 'cyclic' && m.tensileStrengthMPa < 200) {
      score -= 15;
      warnings.push('피로 강도 부족');
    }
    if (spec.loadType === 'dynamic' || spec.loadType === 'static') {
      score += Math.min(15, (m.yieldStrengthMPa / 100) * 1.5);
    }

    // 4) 특수 요구 태그 매칭
    for (const req of spec.specialReqs) {
      if (m.tags.includes(req)) {
        score += 12;
        reasons.push(`${req} 요구 충족`);
      } else {
        // 일부 요구는 치명적
        if (['food_safe', 'biocompatible', 'transparent'].includes(req)) {
          score -= 20;
          warnings.push(`${req} 미지원`);
        }
      }
    }

    // 5) 경량 요구 (크기 대비)
    if (spec.specialReqs.includes('lightweight') && m.densityKgM3 > 3000) {
      score -= 10;
      warnings.push('무거움 (경량 요구 미흡)');
    }

    // 6) 예산 우선순위
    if (spec.budget === 'cost') {
      score += (6 - m.costTier) * 3;
    }
    if (spec.budget === 'quality' && m.costTier >= 4) {
      score += 5;
    }

    // 7) 수량 스케일링 — 대량 생산시 재료비 중요
    if (spec.quantity === 'mass') {
      score += (6 - m.costTier) * 4;
    }

    return { item: m, score: Math.max(0, Math.min(100, score)), reasons, warnings };
  });

  return results.sort((a, b) => b.score - a.score);
}

function environmentAdjustment(
  env: Environment,
  m: Material
): { score: number; reason?: string; warning?: string } {
  switch (env) {
    case 'outdoor':
      if (m.uvResistance < 50) return { score: -15, warning: 'UV 저항 낮음 (실외 부적합)' };
      return { score: 3 };
    case 'humid':
    case 'corrosive':
      if (m.corrosionResistance >= 90) return { score: 10, reason: '부식 내성 우수' };
      if (m.corrosionResistance < 50) return { score: -20, warning: '부식 취약' };
      return { score: 0 };
    case 'high_temp':
      if (m.maxTempC >= 200) return { score: 10, reason: `내열 ${m.maxTempC}°C` };
      if (m.maxTempC < 80) return { score: -25, warning: `열 취약 (최대 ${m.maxTempC}°C)` };
      return { score: 0 };
    case 'low_temp':
      if (m.minTempC <= -40) return { score: 5 };
      return { score: -5 };
    case 'vibration':
      if (m.elongationPct < 3) return { score: -10, warning: '취성 — 진동 피로 우려' };
      return { score: 2 };
    case 'cleanroom':
      if (m.tags.includes('food_safe') || m.tags.includes('biocompatible'))
        return { score: 5, reason: '클린룸 호환' };
      return { score: 0 };
    case 'food_grade':
      if (m.tags.includes('food_safe')) return { score: 15, reason: '식품 안전' };
      return { score: -30, warning: '식품 접촉 불가' };
    default:
      return { score: 0 };
  }
}

// ═════════════════════════════════════════════
// 조합 호환성 체크
// ═════════════════════════════════════════════
export function isCompatible(method: ManufacturingMethod, material: Material): boolean {
  return method.compatibleMaterials.includes(material.category) &&
    material.compatibleMethods.includes(method.id);
}

export function isPartMethodCompatible(part: PartTemplate, method: ManufacturingMethod): boolean {
  const resolved = resolvePartMethodIds(part.compatibleMethods);
  return resolved.has(method.id);
}

// ═════════════════════════════════════════════
// 최종 후보 묶음
// ═════════════════════════════════════════════
export interface CandidateBundle {
  part: ScoredOption<PartTemplate>;
  method: ScoredOption<ManufacturingMethod>;
  material: ScoredOption<Material>;
  totalScore: number;        // 가중 평균
  compatible: boolean;
  summary: string;
}

export function buildCandidates(spec: IntakeSpec, limit: number = 5): CandidateBundle[] {
  const parts = scoreParts(spec).slice(0, 5);
  const methods = scoreMethods(spec).slice(0, 5);
  const materials = scoreMaterials(spec).slice(0, 8);

  const bundles: CandidateBundle[] = [];
  for (const p of parts) {
    for (const m of methods) {
      if (!isPartMethodCompatible(p.item, m.item)) continue;
      for (const mat of materials) {
        if (!isCompatible(m.item, mat.item)) continue;
        const total = Math.round(p.score * 0.4 + m.score * 0.35 + mat.score * 0.25);
        bundles.push({
          part: p,
          method: m,
          material: mat,
          totalScore: total,
          compatible: true,
          summary: `${p.item.nameKo} / ${m.item.nameKo} / ${mat.item.nameKo} (점수 ${total})`,
        });
      }
    }
  }

  return bundles.sort((a, b) => b.totalScore - a.totalScore).slice(0, limit);
}
