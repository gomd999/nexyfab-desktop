/**
 * BOQ 표면적 — 「미등록 = 0」을 「미등록 = 미산출」로 (260729).
 *
 * 실측으로 찾은 결함: 32개 어휘 중 11개가 `surfaceMm2` 에 없었고 `default: return 0` 이라
 * 도장 물량이 **조용히 0** 으로 나갔다. 하필 강구조 단면(h_section·c_channel·i_girder)이
 * 전부 거기 있었다 — 강교 도장은 물량의 핵심인데 산출서에 "0.000 ㎡"가 찍혔다.
 * §6-G ④(부재가 정상으로 읽힘): 「없음」이 「필요 없음」으로 읽히는 형태다.
 */
import { describe, it, expect } from 'vitest';
import { computeBOQ, boqReport } from './boq.mjs';

type Boq = {
  items: { id: string; type: string; surfaceM2: number | null }[];
  surfaceM2: number; surfaceMissing?: string[];
};
const boq = (parts: unknown[]) =>
  (computeBOQ as unknown as (a: unknown, o?: unknown) => Boq)({ parts }, {}) as Boq;
const P = (id: string, type: string, params: Record<string, unknown>) =>
  ({ id, type, params, material: 'SS400', at: { tx: 0, ty: 0, tz: 0 } });

describe('강구조 단면 — 이제 0 이 아니다', () => {
  it('h_section 전개둘레가 KS 형강표와 맞는다 (H-200×100×5.5×8 = 0.79 ㎡/m)', () => {
    const b = boq([P('g1', 'h_section', { H: 200, B: 100, tw: 5.5, tf: 8, length: 1000 })]);
    // 둘레 4B+2H−2tw = 789mm → 1m 당 0.789㎡ (+ 단부 2면)
    expect(b.items[0].surfaceM2).toBeCloseTo(0.794, 3);
  });

  it('i_girder 도장 면적 > 0 — 종전엔 0 이었다', () => {
    const b = boq([P('g1', 'i_girder', { length: 10000, topW: 300, topT: 20, webT: 12, webH: 800, botW: 400, botT: 25 })]);
    const perim = 2 * (400 + 300 - 12 + 25 + 20 + 800); // 웨브 공제 1회(플랜지 노출 가단 합)
    expect(b.items[0].surfaceM2).toBeCloseTo((perim * 10000 + 2 * (400 * 25 + 12 * 800 + 300 * 20)) / 1e6, 3);
    expect(b.items[0].surfaceM2!).toBeGreaterThan(30); // 10m 거더 ≈ 30㎡ 이상
  });

  it('tapered_girder 는 등단면(webH1=webH2)에서 i_girder 와 정확히 같다', () => {
    const common = { length: 10000, topW: 300, topT: 20, webT: 12, botW: 400, botT: 25 };
    const a = boq([P('a', 'tapered_girder', { ...common, webH1: 800, webH2: 800 })]);
    const c = boq([P('c', 'i_girder', { ...common, webH: 800 })]);
    expect(a.items[0].surfaceM2).toBeCloseTo(c.items[0].surfaceM2!, 3); // surfaceM2 는 소수 3자리 반올림
  });

  it('변단면은 경사면이라 등단면(평균 춤)보다 넓다', () => {
    const common = { length: 10000, topW: 300, topT: 20, webT: 12, botW: 400, botT: 25 };
    const taper = boq([P('a', 'tapered_girder', { ...common, webH1: 600, webH2: 1200 })]);
    const flat = boq([P('c', 'tapered_girder', { ...common, webH1: 900, webH2: 900 })]);
    expect(taper.items[0].surfaceM2!).toBeGreaterThan(flat.items[0].surfaceM2!);
  });

  it('rebar·coil_spring·pipe_elbow 도 폐형이 선다', () => {
    const b = boq([
      P('r', 'rebar', { dia: 16, points: [[0, 0, 0], [0, 0, 1000]] }),
      P('s', 'coil_spring', { wireDia: 4, coilDia: 40, pitch: 10, turns: 8 }),
      P('e', 'pipe_elbow', { od: 60.5, bendR: 90, angleDeg: 90 }),
    ]);
    for (const it of b.items) expect(it.surfaceM2).toBeGreaterThan(0);
    // 철근 D16 1m = π·16·1000 = 50,265mm² + 단부 2 → 0.0505㎡
    expect(b.items[0].surfaceM2).toBeCloseTo((Math.PI * 16 * 1000 + 2 * (Math.PI / 4) * 256) / 1e6, 3);
  });
});

describe('폐형이 안 서는 어휘는 null — 0 이 아니다', () => {
  const b = boq([
    P('t', 'pipe_tee', { runOD: 60.5, runLen: 200, branchOD: 34, branchLen: 100 }),
    P('g', 'i_girder', { length: 10000, topW: 300, topT: 20, webT: 12, webH: 800, botW: 400, botT: 25 }),
  ]);

  it('surfaceM2 가 null(=미산출)이지 0(=면적 없음)이 아니다', () => {
    expect(b.items[0].surfaceM2).toBeNull();
  });

  it('미산출 어휘를 이름으로 고지한다 — 합계에서 빠졌다는 사실이 드러나야 한다', () => {
    expect(b.surfaceMissing).toContain('pipe_tee');
    expect(b.surfaceMissing).not.toContain('i_girder');
  });

  it('전부 산출되면 고지 키 자체가 없다 — 과고지 금지', () => {
    const clean = boq([P('g', 'i_girder', { length: 10000, topW: 300, topT: 20, webT: 12, webH: 800, botW: 400, botT: 25 })]);
    expect(clean.surfaceMissing).toBeUndefined();
  });

  it('합계는 산출된 것만 더한다 — null 이 NaN 으로 번지지 않는다', () => {
    expect(Number.isFinite(b.surfaceM2)).toBe(true);
    expect(b.surfaceM2).toBeCloseTo(b.items[1].surfaceM2!, 2);
  });
});

describe('리포트 — 미산출이 숫자처럼 보이지 않는다', () => {
  const html = (boqReport as unknown as (a: unknown, o?: unknown) => string)({
    parts: [P('t', 'pipe_tee', { runOD: 60.5, runLen: 200, branchOD: 34, branchLen: 100 })],
  }, {});

  it('표에 0.000 이 아니라 — 이 찍힌다', () => {
    expect(html).not.toContain('NaN');
    expect(html).toMatch(/<td>—<\/td>/);
  });

  it('주석에 미산출 어휘를 이름으로 밝힌다', () => {
    expect(html).toContain('표면적 미산출');
    expect(html).toContain('pipe_tee');
  });
});
