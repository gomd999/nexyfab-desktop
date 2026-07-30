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

import { itTolerance, shaftFundamentalDeviation, ISO286_MAX_MM, type ShaftDevSymbol } from './iso286';

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

/**
 * **산식으로 전 구간(⌀0~500mm) 계산되는 끼워맞춤** (260801e).
 *
 * ISO 286 이 산식으로 정의한 IT 등급과 축 기본편차만 쓴다. 기존 ⌀18~30 표와 대조해
 * 전부 반올림 오차 안에서 일치하는 것을 확인했다(회귀로 박았다).
 *
 * ⚠ `H7/p6·H7/s6·H7/u6·H8/c11` 은 **여기 없다** — 기본편차 산식이 표를 재현하지 못했다
 *   (c: 산식 −97.6 vs 표 −110). 한 점에 맞춰 역추정하면 검증이 아니라 과적합이다.
 *   그 넷은 종전대로 **표 구간(⌀18~30)** 안에서만 답한다.
 */
const FORMULA_FITS: Readonly<Record<string, { holeGrade: number; shaft: ShaftDevSymbol; shaftGrade: number }>> = {
  'H7/g6': { holeGrade: 7, shaft: 'g', shaftGrade: 6 },
  'H7/f7': { holeGrade: 7, shaft: 'f', shaftGrade: 7 },
  'H7/e8': { holeGrade: 7, shaft: 'e', shaftGrade: 8 },
  'H7/h6': { holeGrade: 7, shaft: 'h', shaftGrade: 6 },
  'H7/k6': { holeGrade: 7, shaft: 'k', shaftGrade: 6 },
  'H7/n6': { holeGrade: 7, shaft: 'n', shaftGrade: 6 },
};

/** 이 끼워맞춤이 산식으로 전 구간 계산되는가 — 호출측이 범위를 물어볼 수 있게 export. */
export function isFormulaFit(fit: FitName): boolean { return fit in FORMULA_FITS; }

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
  const spec = FORMULA_FITS[fit];
  if (spec) {
    /**
     * 산식 경로 — ⌀0~500mm 전 구간. IT 등급과 축 기본편차를 ISO 286 산식으로 낸다.
     * ⚠ 산식이 못 내면(구간 밖) **추정하지 않고 거부**한다.
     */
    if (nominalMm > ISO286_MAX_MM) {
      throw new Error(
        `fit: nominal ⌀${nominalMm}mm exceeds ⌀${ISO286_MAX_MM}mm — the IT formula changes above `
        + 'that size, so extrapolating would report wrong tolerances under a standard name.',
      );
    }
    const holeIT = itTolerance(nominalMm, spec.holeGrade);
    const shaftIT = itTolerance(nominalMm, spec.shaftGrade);
    const dev = shaftFundamentalDeviation(nominalMm, spec.shaft);
    if (holeIT === null || shaftIT === null || dev === null) {
      throw new Error(`fit: ISO 286 formula did not produce values for ⌀${nominalMm}mm ${fit}`);
    }
    // 구멍은 기준구멍 H → EI=0, ES=+IT. 축은 기본편차 쪽에서 IT 만큼 벌린다.
    const holeLo = 0, holeHi = holeIT;
    const shaftHi = dev.kind === 'es' ? dev.value : dev.value + shaftIT;
    const shaftLo = dev.kind === 'es' ? dev.value - shaftIT : dev.value;
    const hMin = nominalMm + holeLo / 1000, hMax = nominalMm + holeHi / 1000;
    const sMin = nominalMm + shaftLo / 1000, sMax = nominalMm + shaftHi / 1000;
    return {
      fitName: fit, category: FIT_TABLE[fit].category,
      holeDiameter: { min: hMin, max: hMax },
      shaftDiameter: { min: sMin, max: sMax },
      minClearance: hMin - sMax, maxClearance: hMax - sMin,
      application: FIT_TABLE[fit].application,
    };
  }
  if (nominalMm < FIT_TABLE_RANGE_MM.min || nominalMm > FIT_TABLE_RANGE_MM.max) {
    throw new Error(
      `fit: ${fit} is table-only (⌀${FIT_TABLE_RANGE_MM.min}~${FIT_TABLE_RANGE_MM.max}mm) and `
      + `⌀${nominalMm}mm is outside it. Its fundamental deviation has no verified formula `
      + '(c: formula −97.6 vs table −110), so extrapolating would report wrong clearances under '
      + 'a standard name. Extend FIT_TABLE with the missing size ranges — do not widen the range alone.',
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
