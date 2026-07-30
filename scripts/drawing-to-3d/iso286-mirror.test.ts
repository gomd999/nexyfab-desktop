/**
 * ISO 286 산식 — **두 구현이 같은 값을 내는가** (260801f).
 *
 * `.mjs`(형상 검사)는 `.ts`(UI)를 import 할 수 없어 산식이 **두 벌**이다.
 * 두 벌이면 언젠가 갈리므로 여기서 묶는다 — 한쪽만 고치면 이 회귀가 먼저 깨진다.
 * (이 리포의 `SNAP_MIRROR` 선례와 같은 방식이다.)
 */
import { describe, it, expect } from 'vitest';
import * as mjs from './iso286.mjs';
import * as ts from '@/app/[lang]/shape-generator/assembly/iso286';

const SIZES = [1, 2.9, 3, 5, 6, 9, 10, 17, 18, 25, 30, 45, 50, 79, 80, 119, 120, 179, 180, 249, 250, 314, 315, 399, 400, 499, 500];
const GRADES = [5, 6, 7, 8, 9, 10, 11];
const SYMS = ['e', 'f', 'g', 'h', 'k', 'n'] as const;

describe('★ .mjs 와 .ts 산식이 일치한다', () => {
  it('표준공차단위 i — 전 구간', () => {
    for (const d of SIZES) {
      expect((mjs as { toleranceUnit: (n: number) => number | null }).toleranceUnit(d), `⌀${d}`)
        .toBe(ts.toleranceUnit(d));
    }
  });

  it('IT 등급 — 전 구간 × 전 등급', () => {
    for (const d of SIZES) {
      for (const g of GRADES) {
        expect((mjs as { itTolerance: (n: number, g: number) => number | null }).itTolerance(d, g), `⌀${d} IT${g}`)
          .toBe(ts.itTolerance(d, g));
      }
    }
  });

  it('축 기본편차 — 전 구간 × 전 기호', () => {
    for (const d of SIZES) {
      for (const sym of SYMS) {
        expect(
          (mjs as { shaftFundamentalDeviation: (n: number, s: string) => unknown }).shaftFundamentalDeviation(d, sym),
          `⌀${d} ${sym}`,
        ).toEqual(ts.shaftFundamentalDeviation(d, sym));
      }
    }
  });

  it('적용 상한도 같다', () => {
    expect((mjs as { ISO286_MAX_MM: number }).ISO286_MAX_MM).toBe(ts.ISO286_MAX_MM);
  });

  it('구간 밖은 양쪽 다 null — 0 을 돌려주지 않는다(0=공차 없음으로 읽힌다)', () => {
    for (const d of [0, -1, 501, 1000]) {
      expect((mjs as { itTolerance: (n: number, g: number) => number | null }).itTolerance(d, 7)).toBeNull();
      expect(ts.itTolerance(d, 7)).toBeNull();
    }
  });
});
