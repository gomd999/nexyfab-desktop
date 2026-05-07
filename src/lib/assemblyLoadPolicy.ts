/**
 * 대형 어셈블리(M7) — 뷰포트·간섭·LOD 힌트를 한곳에서 세분화.
 * 임계값은 제품에서 조정 가능하도록 상수 객체로만 노출한다.
 */

// ─── 임계값 (파트 개수 n = 간섭/뷰에 들어가는 바디 수) ─────────────────────

export const ASSEMBLY_VIEW_THRESHOLDS = {
  /** n ≥ 이 값: 가벼운 부하 힌트(연한 배지) */
  light: 12,
  /** n ≥ 이 값: 뷰포트 경고(보라) */
  warn: 24,
  /** n ≥ 이 값: 뷰포트 강한 경고(주황) */
  heavy: 48,
  /** n ≥ 이 값: 극단 — LOD 강제·간섭 사전 안내 */
  extreme: 96,
} as const;

/** @deprecated `ASSEMBLY_VIEW_THRESHOLDS.warn` 사용 */
export const ASSEMBLY_VIEW_WARN_MIN_PARTS = ASSEMBLY_VIEW_THRESHOLDS.warn;
/** @deprecated `ASSEMBLY_VIEW_THRESHOLDS.heavy` 사용 */
export const ASSEMBLY_VIEW_HEAVY_MIN_PARTS = ASSEMBLY_VIEW_THRESHOLDS.heavy;

// ─── 간섭 broad-phase ───────────────────────────────────────────────────────

/**
 * `detectInterference`가 **전 쌍 O(n²) 열거** 대신 **최적화 broad-phase**(X축 sweep-and-prune 후보)를 쓰기 시작하는 최소 파트 수.
 * (구현: `InterferenceDetection.ts` — 웹·워커 동일.)
 */
export const INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT = 18;

// ─── 간섭: O(n²) 쌍 수 n(n−1)/2 기준 (UI·토스트는 최악 상한으로 보수적 유지) ─

export const ASSEMBLY_INTERFERENCE_THRESHOLDS = {
  /** 쌍 ≤ 이 값: 가벼움 */
  lightMaxPairs: 15, // n≤6
  /** 쌍 ≤ 이 값: 보통 */
  moderateMaxPairs: 45, // n≤10
  /** 쌍 ≤ 이 값: 무거움 — 사전 안내 토스트 */
  heavyMaxPairs: 300, // n≤25
  /** 그 초과: 극단 — 강한 안내 */
} as const;

/**
 * M7 성능 예산(참고) — 로컬·스테이징 벤치 목표(ms). 구현이 하드 캡으로 강제하지는 않는다.
 * `npm run m7`·Perf 패널과 함께 수치를 맞춰 간다.
 */
export const M7_REFERENCE_BUDGETS_MS = {
  /** 대략 n=12 파트, broad-phase + 1차 narrow 간섭 패스 */
  interferencePass12Parts: 2_500,
  /** 어셈블리 스냅샷 역직렬화 + 씬 반영 1회 */
  snapshotHydrateOnce: 400,
} as const;

/** 뷰포트 크롬(배지)용 5단계 */
export type AssemblyViewportLoadBand = 'normal' | 'light' | 'warn' | 'heavy' | 'extreme';

/** 간섭 워커 부하 5단계 */
export type InterferenceWorkloadBand = 'trivial' | 'light' | 'moderate' | 'heavy' | 'extreme';

/** 이론상 최대 파트 쌍 수. 실제 간섭은 n≥`INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT`에서 sweep 후보가 분리 장면에서 줄어드는 경우가 많다(최악은 동일). */
export function assemblyPairwiseComparisonCount(partCount: number): number {
  if (!Number.isFinite(partCount) || partCount < 2) return 0;
  const n = Math.floor(partCount);
  return (n * (n - 1)) / 2;
}

export function assemblyViewportLoadBand(partCount: number): AssemblyViewportLoadBand {
  if (!Number.isFinite(partCount) || partCount < 0) return 'normal';
  const n = partCount;
  const { light, warn, heavy, extreme } = ASSEMBLY_VIEW_THRESHOLDS;
  if (n >= extreme) return 'extreme';
  if (n >= heavy) return 'heavy';
  if (n >= warn) return 'warn';
  if (n >= light) return 'light';
  return 'normal';
}

/** 호환용 3값 — 기존 `npm run m7`·일부 호출부와 동일 의미(24/48 경계). */
export type AssemblyViewportLoadTier = 'normal' | 'warn' | 'heavy';

export function assemblyViewportLoadTier(partCount: number): AssemblyViewportLoadTier {
  if (!Number.isFinite(partCount) || partCount < 0) return 'normal';
  if (partCount >= ASSEMBLY_VIEW_THRESHOLDS.heavy) return 'heavy';
  if (partCount >= ASSEMBLY_VIEW_THRESHOLDS.warn) return 'warn';
  return 'normal';
}

export function interferenceWorkloadBand(partCount: number): InterferenceWorkloadBand {
  const pairs = assemblyPairwiseComparisonCount(partCount);
  if (pairs <= 0) return 'trivial';
  const { lightMaxPairs, moderateMaxPairs, heavyMaxPairs } = ASSEMBLY_INTERFERENCE_THRESHOLDS;
  if (pairs <= lightMaxPairs) return 'light';
  if (pairs <= moderateMaxPairs) return 'moderate';
  if (pairs <= heavyMaxPairs) return 'heavy';
  return 'extreme';
}

export interface AssemblyLoadGuidance {
  partCount: number;
  pairwiseComparisons: number;
  viewportBand: AssemblyViewportLoadBand;
  interferenceBand: InterferenceWorkloadBand;
  /** 궤도 여부와 무관하게 저해상 메시 우선(극단·초과 중형) */
  suggestAggressiveViewportLOD: boolean;
  /** 간섭 실행 전 정보 토스트 권장 */
  suggestInterferencePreambleToast: boolean;
  /** 성능 패널(Perf) 열어보라는 권장 — 극단 부하 시 */
  suggestOpenPerfPanel: boolean;
}

/**
 * 간섭 narrow-phase(삼각형 쌍) 상한 — 파트가 적을수록 더 촘촘히 샘플링(품질),
 * 많을수록 기본값으로 두어 워스트 케이스 시간을 제한.
 * `detectInterference`가 예산을 넘기면 **보수적으로 간섭으로 간주**하는 구현과 맞물린다.
 */
export function recommendedMaxTriPairsForPartCount(partCount: number): number {
  if (!Number.isFinite(partCount) || partCount < 2) return 50_000;
  if (partCount <= 2) return 120_000;
  if (partCount <= 4) return 90_000;
  if (partCount <= 6) return 72_000;
  if (partCount <= 10) return 58_000;
  return 50_000;
}

/**
 * UI에서 간섭 검사·뷰포트 배너 등에 쓰일 때는 부모가 계산한 파트 수와 동일한 값을 넘기면
 * `interferenceWorkloadBand`와 `assemblyViewportLoadBand`가 한 번에 정렬된다.
 */
export function getAssemblyLoadGuidance(partCount: number): AssemblyLoadGuidance {
  const n = Number.isFinite(partCount) && partCount >= 0 ? partCount : 0;
  const pairwiseComparisons = assemblyPairwiseComparisonCount(n);
  const viewportBand = assemblyViewportLoadBand(n);
  const interferenceBand = interferenceWorkloadBand(n);

  const suggestAggressiveViewportLOD =
    viewportBand === 'extreme' || viewportBand === 'heavy' || viewportBand === 'warn';

  const suggestInterferencePreambleToast =
    interferenceBand === 'heavy' || interferenceBand === 'extreme';

  const suggestOpenPerfPanel =
    viewportBand === 'extreme' || interferenceBand === 'extreme';

  return {
    partCount: n,
    pairwiseComparisons,
    viewportBand,
    interferenceBand,
    suggestAggressiveViewportLOD,
    suggestInterferencePreambleToast,
    suggestOpenPerfPanel,
  };
}
