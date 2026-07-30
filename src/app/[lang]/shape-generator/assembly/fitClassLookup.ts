/**
 * fitClassLookup.ts — Look up ISO 286 hole/shaft fit class details.
 *
 * Standard fits are denoted as Hole/Shaft combinations:
 *
 *   - Clearance fits (looser shaft):
 *     H7/g6  precision sliding
 *     H7/f7  running
 *     H7/e8  loose running
 *     H8/c11 large clearance
 *
 *   - Transition fits (tight tolerance, may interfere):
 *     H7/k6  press fit (locating)
 *     H7/n6  driving fit
 *
 *   - Interference fits (always tight):
 *     H7/p6  light press
 *     H7/s6  shrink
 *     H7/u6  forced
 *
 * ⚠⚠ **크기 구간 제약 (260801d 실측)** — `FIT_TABLE` 은 **⌀18~30mm 구간의 편차만** 담고
 * 있다(원래 주석에 「illustrative … for size range 18-30 mm」로 적혀 있었다). 그런데
 * `evaluateFit` 이 **어떤 지름에도 그 표를 그대로 적용**해서 ⌀6 이든 ⌀400 이든 같은
 * 틈새(7~41µm)를 냈다. ISO 286 의 편차는 **치수 구간마다 다르므로** 구간 밖 결과는 틀린다.
 *
 * 이 기능은 `assembly.fit-class` 로 **사용자에게 노출**돼 있고 설명이 「Computes min/max
 * clearance」였다 — 구간 밖에서도 값을 내면서 그 사실을 말하지 않았다.
 *
 * → **구간 밖은 거부한다.** 표 값을 기억으로 채워 넣지 않는다(그게 지어내기다).
 *   전 구간 표(IT 등급 × 기본편차)를 넣는 것은 별 작업이며, 넣기 전까지는 범위를 지킨다.
 *
 * Module:
 *   - Returns the named fit's hole+shaft deviations for a nominal
 *     diameter range.
 *   - Computes resulting clearance/interference min/max.
 *   - Recommends fit based on application (sliding/locating/press).
 */

export type FitName = 'H7/g6' | 'H7/f7' | 'H7/e8' | 'H7/h6' | 'H7/k6' | 'H7/n6' | 'H7/p6' | 'H7/s6' | 'H7/u6' | 'H8/c11';
export type FitCategory = 'clearance' | 'transition' | 'interference';

/**
 * 이 표가 유효한 **호칭치수 구간**(mm). 밖에서는 `evaluateFit` 이 거부한다.
 * ⚠ 값을 늘리려면 **표를 함께 늘려야** 한다 — 범위만 넓히면 틀린 값이 나간다.
 */
export const FIT_TABLE_RANGE_MM = { min: 18, max: 30 } as const;

/** Deviation values (μm) — ISO 286, **호칭치수 18~30mm 구간 한정**(위 경고 참조). */
export interface DeviationTable {
  /** Upper deviation, μm. */
  upper: number;
  /** Lower deviation, μm. */
  lower: number;
}

export const FIT_TABLE: Record<FitName, { hole: DeviationTable; shaft: DeviationTable; category: FitCategory; application: string }> = {
  'H7/g6': { hole: { upper: 21, lower: 0 }, shaft: { upper: -7, lower: -20 }, category: 'clearance', application: 'Precision sliding (spindle bearings).' },
  'H7/f7': { hole: { upper: 21, lower: 0 }, shaft: { upper: -20, lower: -41 }, category: 'clearance', application: 'Running fit, oil-lubricated.' },
  'H7/e8': { hole: { upper: 21, lower: 0 }, shaft: { upper: -40, lower: -73 }, category: 'clearance', application: 'Loose running, high temp.' },
  'H7/h6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 0, lower: -13 }, category: 'clearance', application: 'Slide / locational fit.' },
  'H7/k6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 15, lower: 2 }, category: 'transition', application: 'Press / locating fit (assemble with mallet).' },
  'H7/n6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 28, lower: 15 }, category: 'transition', application: 'Driving / press fit.' },
  'H7/p6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 35, lower: 22 }, category: 'interference', application: 'Light press fit.' },
  'H7/s6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 48, lower: 35 }, category: 'interference', application: 'Shrink fit.' },
  'H7/u6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 60, lower: 47 }, category: 'interference', application: 'Forced fit (heavy press, perm.).' },
  'H8/c11': { hole: { upper: 33, lower: 0 }, shaft: { upper: -110, lower: -240 }, category: 'clearance', application: 'Large clearance (gas/coarse).' },
};

export interface FitResult {
  fitName: FitName;
  category: FitCategory;
  /** Hole min/max diameter (mm). */
  holeDiameter: { min: number; max: number };
  /** Shaft min/max diameter (mm). */
  shaftDiameter: { min: number; max: number };
  /** Min clearance (negative = interference). */
  minClearance: number;
  /** Max clearance. */
  maxClearance: number;
  application: string;
}

// ── Top-level entry ────────────────────────────────────────────

/**
 * 명명 끼워맞춤의 홀·축 치수와 틈새/조임을 낸다.
 *
 * @throws 호칭치수가 `FIT_TABLE_RANGE_MM` 밖이면 **거부한다** — 표가 그 구간의 편차만
 *   담고 있어서, 밖에서 계산하면 ISO 286 이라는 이름으로 **틀린 값**이 나간다.
 *   (실측: ⌀6 과 ⌀400 이 같은 틈새 7~41µm 를 냈다.)
 */
export function evaluateFit(nominalMm: number, fit: FitName): FitResult {
  if (!Number.isFinite(nominalMm) || nominalMm <= 0) {
    throw new Error(`fit: nominal diameter must be > 0, got ${nominalMm}`);
  }
  if (nominalMm < FIT_TABLE_RANGE_MM.min || nominalMm > FIT_TABLE_RANGE_MM.max) {
    throw new Error(
      `fit: nominal ⌀${nominalMm}mm is outside the tabulated range `
      + `⌀${FIT_TABLE_RANGE_MM.min}~${FIT_TABLE_RANGE_MM.max}mm. ISO 286 deviations vary by `
      + 'size range, so evaluating outside it would report wrong clearances as if they were '
      + 'standard. Extend FIT_TABLE with the missing size ranges first — do not widen the range alone.',
    );
  }
  const entry = FIT_TABLE[fit];
  const holeMin = nominalMm + entry.hole.lower / 1000;
  const holeMax = nominalMm + entry.hole.upper / 1000;
  const shaftMin = nominalMm + entry.shaft.lower / 1000;
  const shaftMax = nominalMm + entry.shaft.upper / 1000;
  return {
    fitName: fit,
    category: entry.category,
    holeDiameter: { min: holeMin, max: holeMax },
    shaftDiameter: { min: shaftMin, max: shaftMax },
    minClearance: holeMin - shaftMax,
    maxClearance: holeMax - shaftMin,
    application: entry.application,
  };
}

// ── Recommend fit ─────────────────────────────────────────────

export type Application = 'spindle' | 'bushing' | 'press-fit' | 'locating' | 'shrink' | 'sliding';

export function recommendFit(app: Application): FitName {
  switch (app) {
    case 'spindle': return 'H7/g6';
    case 'bushing': return 'H7/f7';
    case 'sliding': return 'H7/h6';
    case 'locating': return 'H7/k6';
    case 'press-fit': return 'H7/p6';
    case 'shrink': return 'H7/s6';
  }
}

// ── Tolerance budget (sum of upper-lower) ─────────────────────

export interface ToleranceBudget {
  hole: number;
  shaft: number;
  total: number;
}

/**
 * 공차 폭의 합(µm). ⚠ 이 값도 **⌀18~30mm 구간 한정**이다 — 지름을 받지 않는 함수라
 *   호출측이 구간을 지켜야 한다(`FIT_TABLE_RANGE_MM`).
 */
export function toleranceBudget(fit: FitName): ToleranceBudget {
  const entry = FIT_TABLE[fit];
  const hole = entry.hole.upper - entry.hole.lower;
  const shaft = entry.shaft.upper - entry.shaft.lower;
  return { hole, shaft, total: hole + shaft };
}

// ── Summary ────────────────────────────────────────────────────

export interface FitSummary {
  fitName: FitName;
  category: FitCategory;
  minClearance: number;
  maxClearance: number;
}

export function summarize(result: FitResult): FitSummary {
  return {
    fitName: result.fitName,
    category: result.category,
    minClearance: result.minClearance,
    maxClearance: result.maxClearance,
  };
}
