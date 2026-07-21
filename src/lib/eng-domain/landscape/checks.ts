/**
 * eng-domain/landscape — PURE landscape-design GATE MATERIAL (Batch 3, P-조경).
 *
 * Deterministic, side-effect-free check functions a later landscape DomainModule
 * wires into a "plan → measured gate → verified package" driver. Landscape has a
 * lighter legal ceiling than structural work — these are design-verifiable checks
 * (관수 커버리지·배수 구배·식재 간격·조경면적 비율·객토 깊이), not life-safety limits.
 *
 * HONESTY CONTRACT (성역):
 *  - Every metric is REAL-computed from the inputs — no fabricated numbers.
 *  - `basis` states the standard / formula, with approximations (근사/대표값) named.
 *  - A check REFUSES (pass:false + reason) when the limit is violated — that is a
 *    gate verdict, distinct from a caller-bug bad param (which throws).
 *  - Pure functions only: no I/O, no design-driver imports. Node/browser-agnostic.
 *
 * GROUNDING (in-repo authoritative source, not fabricated):
 *  - 객토 깊이 표 3.1-1 and 생육토심 표 1.6-1 are transcribed from the repo's KDS
 *    calculator `scripts/engineering-core/calculators/planting-base.mjs`
 *    (KDS 34 30 10:2024 원문 전사). Mirrored here as SOIL_REPLACE_DEPTH_M / SOIL_GROWTH_DEPTH_CM.
 *  - Irrigation coverage / planting spacing are GEOMETRIC (closed-form area math);
 *    thresholds are caller-supplied, not invented code minimums.
 *  - Drainage-slope bands and green-area zone minimums are 대표값 근사 of the
 *    published 조경설계기준 / 건축법 시행령 §27 규정 and MUST be verified against the
 *    authority having jurisdiction (지자체 조례가 우선). Sources are named per-table.
 *
 * Unit convention: areas in m²; lengths/radii/spacing in m; depths in m (객토) unless
 * a field name says otherwise; grades in percent (%).
 */

export interface LandscapeCheckResult {
  /** stable check id, e.g. 'irrigation-coverage' */
  id: string;
  /** true iff the measured metrics satisfy the limit */
  pass: boolean;
  /** measured values backing the verdict (real-computed, never fabricated) */
  metrics: Record<string, number>;
  /** present iff !pass — human-readable reason the limit was violated */
  reason?: string;
  /** the standard / formula basis (근사·대표값 명시) — REQUIRED */
  basis: string;
}

// ── small guards (throw on invalid params — caller bug, distinct from the gate
//    verdict pass:false which means the design failed the limit) ──────────────
function requirePositive(name: string, v: number): number {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`landscape check: '${name}' must be a positive finite number, got ${v}`);
  }
  return v;
}
function requireNonNegative(name: string, v: number): number {
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`landscape check: '${name}' must be a non-negative finite number, got ${v}`);
  }
  return v;
}
function requireFraction(name: string, v: number): number {
  if (!Number.isFinite(v) || v <= 0 || v > 1) {
    throw new Error(`landscape check: '${name}' must be in (0, 1], got ${v}`);
  }
  return v;
}
function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP TABLES (exported — 대표값/원문 전사, sources named)
// ─────────────────────────────────────────────────────────────────────────────

/** Plant category for 객토(soil-replacement) depth. Matches 표 3.1-1 keys. */
export type SoilCategory = '교목' | '아교목' | '관목' | '지피초화류';

/**
 * 객토량 산정 깊이 (m) — KDS 34 30 10:2024 표 3.1-1.
 * Mirrored from the repo's `planting-base.mjs` SOIL_REPLACE (원문 전사).
 * 지피초화류 0.2~0.3 m 중 중앙값 0.25 적용 (계산기와 동일 명시).
 */
export const SOIL_REPLACE_DEPTH_M: Record<SoilCategory, number> = {
  교목: 1.0,
  아교목: 0.7,
  관목: 0.5,
  지피초화류: 0.25,
};

/** Plant type for 생육토심(growth soil-depth) 표 1.6-1. */
export type GrowthPlantType = '잔디초화류' | '소관목' | '대관목' | '천근성교목' | '심근성교목';

/**
 * 생육토심 표 1.6-1 (cm) — KDS 34 30 10:2024, mirrored from `planting-base.mjs` SOIL_DEPTH.
 * survive: 생존 최소토심 (인공토/자연토/혼합토); grow: 생육 최소토심 (토양 중급/상급);
 * drain: 배수층 별도 두께. Exported as a lookup for reference/downstream use.
 */
export const SOIL_GROWTH_DEPTH_CM: Record<
  GrowthPlantType,
  { artificial: number; natural: number; mixed: number; growMid: number; growHigh: number; drain: number }
> = {
  잔디초화류: { artificial: 10, natural: 15, mixed: 13, growMid: 30, growHigh: 25, drain: 10 },
  소관목: { artificial: 20, natural: 30, mixed: 25, growMid: 45, growHigh: 40, drain: 15 },
  대관목: { artificial: 30, natural: 45, mixed: 38, growMid: 60, growHigh: 50, drain: 20 },
  천근성교목: { artificial: 40, natural: 60, mixed: 50, growMid: 90, growHigh: 70, drain: 30 },
  심근성교목: { artificial: 60, natural: 90, mixed: 75, growMid: 150, growHigh: 100, drain: 30 },
};

/** Surface type for drainage-slope bands. */
export type DrainageSurface = 'paving' | 'permeablePaving' | 'lawn' | 'plantingBed' | 'plaza' | 'sportsField';

/**
 * 표면 배수 구배 허용대역 (%) — 대표값 근사 of 조경설계기준 / KDS 34 배수시설 관례.
 * ⚠ 대표값: 지자체 조례·발주 기준·재료 특성에 따라 상이 → 반드시 확인. minGrade는
 * 물고임 방지 하한, maxGrade는 세굴·미끄럼 방지 상한.
 */
export const DRAINAGE_SLOPE_BAND_PCT: Record<DrainageSurface, { min: number; max: number }> = {
  paving: { min: 0.5, max: 2 }, // 포장면(보도·차도) — 물고임 방지 0.5%, 배수 원활 상한 2%
  permeablePaving: { min: 0.5, max: 2 }, // 투수포장 — 동일 대역(대표)
  lawn: { min: 2, max: 5 }, // 잔디식재지 — 표면배수 2~5% 관례
  plantingBed: { min: 2, max: 5 }, // 관목/초화 식재지 — 2~5% 관례
  plaza: { min: 0.5, max: 2 }, // 광장·운동장 평탄면 — 0.5~2%
  sportsField: { min: 0.5, max: 1 }, // 경기장 잔디 — 0.5~1%(경기성 요구)
};

/** Planting category for center-to-center minimum spacing. */
export type SpacingCategory = '교목' | '아교목' | '관목' | '생울타리' | '지피초화류';

/**
 * 식재 최소 식재간격 (중심간 거리, m) — 대표값 근사 of 조경공사 표준시방서 /
 * 조경설계기준 식재간격 관례. ⚠ 대표값: 수종·규격·설계 목표에 따라 상이 → 확인.
 */
export const PLANT_MIN_SPACING_M: Record<SpacingCategory, number> = {
  교목: 4.5, // 성목 수관폭 고려 통상 4.5~6 m
  아교목: 3.0, // 아교목 통상 3 m
  관목: 1.0, // 관목 통상 1 m
  생울타리: 0.3, // 생울타리 밀식 0.3 m
  지피초화류: 0.3, // 지피/초화 0.2~0.4 m
};

/** 용도지역 zone key for green-area (조경면적) minimum ratio. */
export type LandUseZone = 'residential' | 'commercial' | 'industrial' | 'green' | 'general';

/**
 * 대지 안의 조경면적 최소 비율 (대지면적 대비, 분수) — 대표값 근사 of 건축법 시행령 §27
 * + 조경기준(국토교통부 고시). ⚠ 실제 비율은 지자체 건축조례가 정하므로(§27①), 아래는
 * 통용 대표값일 뿐 반드시 해당 조례 확인. 건축법상 대지면적 200 m² 미만은 조경 의무 없음.
 */
export const GREEN_AREA_MIN_RATIO: Record<LandUseZone, number> = {
  residential: 0.1, // 주거지역 — 대표 10%
  commercial: 0.05, // 상업지역 — 대표 5%
  industrial: 0.1, // 공업지역 — 대표 10%
  green: 0.15, // 녹지지역 — 대표 15%
  general: 0.1, // 미지정 일반 — 대표 10%
};

/** 건축법 시행령 §27 조경 의무 하한 대지면적 (m²). */
export const GREEN_AREA_EXEMPT_SITE_M2 = 200;

// ─────────────────────────────────────────────────────────────────────────────
// 1. IRRIGATION COVERAGE — coveredArea = heads·π·r²·overlapFactor ≥ target·uniformity
// ─────────────────────────────────────────────────────────────────────────────
export interface IrrigationCoverageInput {
  /** number of sprinkler heads */
  headCount: number;
  /** per-head throw radius r (m) */
  coverageRadiusM: number;
  /** target area to be irrigated (m²) */
  targetAreaM2: number;
  /**
   * effective coverage efficiency f ∈ (0,1]: net unique coverage = gross πr² × f,
   * derating for head-to-head overlap redistribution. Default 1.0 (idealized full
   * disc — real triangular head-to-head layouts derate ~0.55, square ~0.79; caller supplies).
   */
  overlapFactor?: number;
  /** required coverage uniformity ratio (covered/target). Default 0.9. */
  requiredUniformity?: number;
}

export function checkIrrigationCoverage(input: IrrigationCoverageInput): LandscapeCheckResult {
  const heads = requirePositive('headCount', input.headCount);
  const r = requirePositive('coverageRadiusM', input.coverageRadiusM);
  const target = requirePositive('targetAreaM2', input.targetAreaM2);
  const f = requireFraction('overlapFactor', input.overlapFactor ?? 1.0);
  const required = requireFraction('requiredUniformity', input.requiredUniformity ?? 0.9);

  const perHeadAreaM2 = Math.PI * r * r; // πr²
  const grossCoverageM2 = heads * perHeadAreaM2;
  const effectiveCoverageM2 = grossCoverageM2 * f;
  const coverageRatio = effectiveCoverageM2 / target;
  const pass = coverageRatio >= required;
  return {
    id: 'irrigation-coverage',
    pass,
    metrics: {
      headCount: heads,
      coverageRadiusM: round(r),
      perHeadAreaM2: round(perHeadAreaM2),
      grossCoverageM2: round(grossCoverageM2),
      effectiveCoverageM2: round(effectiveCoverageM2),
      targetAreaM2: round(target),
      coverageRatio: round(coverageRatio),
      requiredUniformity: round(required),
    },
    reason: pass
      ? undefined
      : `관수 커버리지 비율 ${round(coverageRatio, 3)} < 요구 ${round(required, 3)} ` +
        `(유효면적 ${round(effectiveCoverageM2, 2)} m² / 목표 ${round(target, 2)} m²).`,
    basis:
      'Geometric: per-head coverage = πr², 유효면적 = headCount·πr²·overlapFactor, ' +
      '커버리지 비율 = 유효면적/목표면적 ≥ requiredUniformity. ' +
      'overlapFactor(효율)·requiredUniformity는 caller 입력(head-to-head 겹침 관례 ~0.55 triangular, 근사).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DRAINAGE SLOPE — min ≤ measured surface grade (%) ≤ max
// ─────────────────────────────────────────────────────────────────────────────
export interface DrainageSlopeInput {
  /** measured surface grade (%) */
  measuredGradePct: number;
  /** surface type selecting the allowable band (default 'paving' 0.5–2%) */
  surfaceType?: DrainageSurface;
  /** explicit min grade override (%) */
  minGradePctOverride?: number;
  /** explicit max grade override (%) */
  maxGradePctOverride?: number;
}

export function checkDrainageSlope(input: DrainageSlopeInput): LandscapeCheckResult {
  const grade = requireNonNegative('measuredGradePct', input.measuredGradePct);
  const surface = input.surfaceType ?? 'paving';
  const band = DRAINAGE_SLOPE_BAND_PCT[surface];
  if (!band) {
    throw new Error(
      `landscape check: unknown surfaceType '${surface}' (표 키: ${Object.keys(DRAINAGE_SLOPE_BAND_PCT).join('|')})`,
    );
  }
  const minGrade = input.minGradePctOverride ?? band.min;
  const maxGrade = input.maxGradePctOverride ?? band.max;
  if (minGrade > maxGrade) {
    throw new Error(`landscape check: minGrade ${minGrade} > maxGrade ${maxGrade}`);
  }
  const tooFlat = grade < minGrade;
  const tooSteep = grade > maxGrade;
  const pass = !tooFlat && !tooSteep;
  return {
    id: 'drainage-slope',
    pass,
    metrics: {
      measuredGradePct: round(grade),
      minGradePct: round(minGrade),
      maxGradePct: round(maxGrade),
    },
    reason: pass
      ? undefined
      : tooFlat
        ? `배수 구배 ${round(grade, 3)}% < 최소 ${round(minGrade, 3)}% — 물고임 우려 (${surface}).`
        : `배수 구배 ${round(grade, 3)}% > 최대 ${round(maxGrade, 3)}% — 세굴·미끄럼 우려 (${surface}).`,
    basis:
      '표면 배수 구배 허용대역 min ≤ grade ≤ max. 대표값 근사(조경설계기준 / KDS 34 배수시설 관례) — ' +
      '지자체 조례·재료·발주기준 우선. min=물고임 방지 하한, max=세굴·미끄럼 방지 상한.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PLANTING SPACING — actual center-to-center spacing ≥ min (over-crowding gate)
//    actualSpacing = √(area/count); maxPlantsFit = floor(area / min²)
// ─────────────────────────────────────────────────────────────────────────────
export interface PlantingSpacingInput {
  /** planned plant count on the area */
  plantCount: number;
  /** planting area (m²) */
  areaM2: number;
  /** planting category selecting min center-to-center spacing (default '관목') */
  category?: SpacingCategory;
  /** explicit min center-to-center spacing override (m) */
  minSpacingMOverride?: number;
}

export function checkPlantingSpacing(input: PlantingSpacingInput): LandscapeCheckResult {
  const count = requirePositive('plantCount', input.plantCount);
  const area = requirePositive('areaM2', input.areaM2);
  const category = input.category ?? '관목';
  const tableMin = PLANT_MIN_SPACING_M[category];
  if (input.minSpacingMOverride === undefined && tableMin === undefined) {
    throw new Error(
      `landscape check: unknown category '${category}' (표 키: ${Object.keys(PLANT_MIN_SPACING_M).join('|')})`,
    );
  }
  const minSpacing = requirePositive('minSpacing', input.minSpacingMOverride ?? tableMin);

  // Even-square-grid approximation: each plant occupies s² of ground.
  const actualSpacingM = Math.sqrt(area / count);
  const maxPlantsFit = Math.floor(area / (minSpacing * minSpacing));
  const pass = actualSpacingM >= minSpacing;
  return {
    id: 'planting-spacing',
    pass,
    metrics: {
      plantCount: count,
      areaM2: round(area),
      minSpacingM: round(minSpacing),
      actualSpacingM: round(actualSpacingM),
      maxPlantsFit,
    },
    reason: pass
      ? undefined
      : `식재간격 ${round(actualSpacingM, 3)} m < 최소 ${round(minSpacing, 3)} m — 과밀 ` +
        `(${category}, 면적 ${round(area, 2)} m²에 최대 ${maxPlantsFit}주, 계획 ${count}주).`,
    basis:
      '정사각 격자 근사: actualSpacing = √(area/count), maxPlantsFit = ⌊area/min²⌋. ' +
      '최소 식재간격(중심간)은 대표값 근사(조경공사 표준시방서 / 조경설계기준 식재간격) — 수종·규격 확인.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. GREEN-AREA RATIO (조경면적 비율) — landscaped/site ≥ zone minimum
// ─────────────────────────────────────────────────────────────────────────────
export interface GreenAreaRatioInput {
  /** provided pervious / landscaped area (m²) */
  landscapedAreaM2: number;
  /** total site area (m²) */
  siteAreaM2: number;
  /** 용도지역 zone selecting min ratio (default 'general' 10%) */
  zone?: LandUseZone;
  /** explicit min ratio override (fraction, e.g. 0.15) */
  minRatioOverride?: number;
}

export function checkGreenAreaRatio(input: GreenAreaRatioInput): LandscapeCheckResult {
  const landscaped = requireNonNegative('landscapedAreaM2', input.landscapedAreaM2);
  const site = requirePositive('siteAreaM2', input.siteAreaM2);
  const zone = input.zone ?? 'general';
  const tableMin = GREEN_AREA_MIN_RATIO[zone];
  if (input.minRatioOverride === undefined && tableMin === undefined) {
    throw new Error(
      `landscape check: unknown zone '${zone}' (표 키: ${Object.keys(GREEN_AREA_MIN_RATIO).join('|')})`,
    );
  }
  const minRatio = input.minRatioOverride ?? tableMin;
  if (landscaped > site) {
    throw new Error(`landscape check: landscapedAreaM2 ${landscaped} exceeds siteAreaM2 ${site}`);
  }
  const ratio = landscaped / site;

  // 건축법 시행령 §27: 대지면적 200 m² 미만은 조경 의무 없음 → 게이트 통과(정보).
  const exempt = site < GREEN_AREA_EXEMPT_SITE_M2;
  const pass = exempt || ratio >= minRatio;
  return {
    id: 'green-area-ratio',
    pass,
    metrics: {
      landscapedAreaM2: round(landscaped),
      siteAreaM2: round(site),
      ratio: round(ratio),
      minRatio: round(minRatio),
      exemptSiteM2: GREEN_AREA_EXEMPT_SITE_M2,
    },
    reason: pass
      ? undefined
      : `조경면적 비율 ${round(ratio * 100, 2)}% < 최소 ${round(minRatio * 100, 2)}% ` +
        `(${zone}, 조경 ${round(landscaped, 2)} / 대지 ${round(site, 2)} m²).`,
    basis:
      '조경면적 비율 = 조경면적 / 대지면적 ≥ zone 최소비율. 건축법 시행령 §27(대지 200 m² 미만 면제) + ' +
      '조경기준(국토교통부 고시). ⚠ 실제 최소비율은 지자체 건축조례가 정함(§27①) — 대표값, 조례 확인 필수.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. SOIL DEPTH (객토 깊이) — provided depth ≥ minimum by plant category (표 3.1-1)
// ─────────────────────────────────────────────────────────────────────────────
export interface SoilDepthInput {
  /** plant category (교목|아교목|관목|지피초화류) */
  category: SoilCategory;
  /** provided planting-soil (객토) depth (m) */
  providedDepthM: number;
}

export function checkSoilDepth(input: SoilDepthInput): LandscapeCheckResult {
  const provided = requirePositive('providedDepthM', input.providedDepthM);
  const minDepth = SOIL_REPLACE_DEPTH_M[input.category];
  if (minDepth === undefined) {
    throw new Error(
      `landscape check: unknown category '${input.category}' (표 3.1-1 키: ${Object.keys(SOIL_REPLACE_DEPTH_M).join('|')})`,
    );
  }
  const pass = provided >= minDepth;
  return {
    id: 'soil-depth',
    pass,
    metrics: {
      providedDepthM: round(provided),
      minDepthM: round(minDepth),
      marginM: round(provided - minDepth),
    },
    reason: pass
      ? undefined
      : `객토 깊이 ${round(provided, 3)} m < 최소 ${round(minDepth, 3)} m (${input.category}, 표 3.1-1).`,
    basis:
      'KDS 34 30 10:2024 표 3.1-1 객토량 산정 깊이 (교목 1.0·아교목 0.7·관목 0.5·지피초화류 0.25 m). ' +
      '원문 전사(repo planting-base 계산기와 동일). 지피초화류 0.2~0.3 m 중 중앙 0.25 적용 명시.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LANDSCAPE_CHECKS — registry of pure gate-material check functions, keyed by id.
// A later landscape DomainModule (Batch 3) wires these into the design driver.
// ─────────────────────────────────────────────────────────────────────────────
export const LANDSCAPE_CHECKS = {
  'irrigation-coverage': checkIrrigationCoverage,
  'drainage-slope': checkDrainageSlope,
  'planting-spacing': checkPlantingSpacing,
  'green-area-ratio': checkGreenAreaRatio,
  'soil-depth': checkSoilDepth,
} as const;

export type LandscapeCheckId = keyof typeof LANDSCAPE_CHECKS;
