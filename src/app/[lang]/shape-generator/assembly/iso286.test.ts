/**
 * ISO 286 산식 구현 (260801e).
 *
 * ## 왜 산식인가
 * 표를 **기억으로 옮겨 적는 것이 가장 위험하다** — 그건 지어내기다.
 * ISO 286 이 산식으로 정의한 부분만 구현하고, **기존 ⌀18~30 표로 대조**해 검증했다.
 * 대조 결과 6개 끼워맞춤 전부 **오차 0** 으로 일치한다(아래 회귀).
 *
 * ## ⚠ 일치하지 않은 것은 확장하지 않았다
 * `c` 는 산식 −97.6 vs 표 −110 으로 어긋났고, `p·s·u` 는 확인된 산식이 없다.
 * 한 점에 맞춰 역추정하면 검증이 아니라 **과적합**이다 — 그 넷은 표 구간에 묶어 둔다.
 */
import { describe, it, expect } from 'vitest';
import { evaluateFit, FIT_TABLE, isFormulaFit, FIT_TABLE_RANGE_MM, type FitName } from './fitClassLookup';
import { toleranceUnit, itTolerance, shaftFundamentalDeviation, ISO286_MAX_MM } from './iso286';

const FORMULA = (Object.keys(FIT_TABLE) as FitName[]).filter(isFormulaFit);
const TABLE_ONLY = (Object.keys(FIT_TABLE) as FitName[]).filter((f) => !isFormulaFit(f));

describe('★ 산식이 기존 표를 재현한다 — 이것이 검증의 근거다', () => {
  it('⌀18~30 구간의 표준공차단위 i 와 IT 등급', () => {
    const i = toleranceUnit(25)!;
    expect(i).toBeCloseTo(1.3074, 3);          // 0.45·∛23.238 + 0.001·23.238
    expect(itTolerance(25, 6)).toBe(13);       // 표 h6 폭
    expect(itTolerance(25, 7)).toBe(21);       // 표 H7 = +21
    expect(itTolerance(25, 8)).toBe(33);       // 표 H8 = +33
    expect(itTolerance(25, 11)).toBe(131);     // 표 c11 폭 130 (반올림 1µm 차)
  });

  it.each(FORMULA)('%s — ⌀25 산식 결과가 표와 ±1µm 안', (fit) => {
    const r = evaluateFit(25, fit);
    const t = FIT_TABLE[fit];
    const hHi = Math.round((r.holeDiameter.max - 25) * 1000);
    const sHi = Math.round((r.shaftDiameter.max - 25) * 1000);
    const sLo = Math.round((r.shaftDiameter.min - 25) * 1000);
    expect(Math.abs(hHi - t.hole.upper), `${fit} hole`).toBeLessThanOrEqual(1);
    expect(Math.abs(sHi - t.shaft.upper), `${fit} shaft es`).toBeLessThanOrEqual(1);
    expect(Math.abs(sLo - t.shaft.lower), `${fit} shaft ei`).toBeLessThanOrEqual(1);
  });

  it('축 기본편차 산식이 표값과 맞는다', () => {
    expect(shaftFundamentalDeviation(25, 'g')).toEqual({ kind: 'es', value: -7 });
    expect(shaftFundamentalDeviation(25, 'f')).toEqual({ kind: 'es', value: -20 });
    expect(shaftFundamentalDeviation(25, 'e')).toEqual({ kind: 'es', value: -40 });
    expect(shaftFundamentalDeviation(25, 'h')).toEqual({ kind: 'es', value: 0 });
    expect(shaftFundamentalDeviation(25, 'k')).toEqual({ kind: 'ei', value: 2 });
    expect(shaftFundamentalDeviation(25, 'n')).toEqual({ kind: 'ei', value: 15 });
  });
});

describe('전 구간(⌀0~500)이 열렸다 — 종전엔 ⌀18~30 뿐이었다', () => {
  it.each([1, 3, 10, 25, 50, 120, 250, 400, 500])('⌀%dmm H7/g6 가 계산된다', (d) => {
    const r = evaluateFit(d, 'H7/g6');
    expect(r.minClearance).toBeGreaterThan(0);          // 헐거운 끼워맞춤
    expect(r.maxClearance).toBeGreaterThan(r.minClearance);
  });

  it('★지름이 커지면 공차도 커진다 — 종전엔 **어떤 지름이든 같은 값**이었다', () => {
    const small = evaluateFit(6, 'H7/g6');
    const large = evaluateFit(400, 'H7/g6');
    const w = (r: { minClearance: number; maxClearance: number }) => r.maxClearance - r.minClearance;
    expect(w(large)).toBeGreaterThan(w(small) * 2);     // 실측: 14µm → 92µm
  });

  it('⌀500 초과는 거부한다 — 그 위는 IT 산식이 달라진다', () => {
    expect(() => evaluateFit(ISO286_MAX_MM + 1, 'H7/g6')).toThrow(/exceeds/);
  });
});

describe('★ 산식이 없는 끼워맞춤은 **확장하지 않는다**', () => {
  it('표 구간 안에서는 답한다', () => {
    for (const fit of TABLE_ONLY) expect(() => evaluateFit(25, fit)).not.toThrow();
  });

  it.each(TABLE_ONLY)('%s — 표 구간 밖은 거부하고 **이유를 말한다**', (fit) => {
    let msg = '';
    try { evaluateFit(100, fit); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('table-only');
    expect(msg).toContain('no verified formula');
  });

  it('c·p·s·u 가 산식 목록에 없다 — 있으면 검증 없이 확장된 것이다', () => {
    expect(TABLE_ONLY.sort()).toEqual(['H7/p6', 'H7/s6', 'H7/u6', 'H8/c11']);
    expect(FIT_TABLE_RANGE_MM).toEqual({ min: 18, max: 30 });
  });
});
