/**
 * section-properties.test.ts — **임의 폴리곤 단면 특성**(PBAS 0.7.3 이식, 260803).
 *
 * ## 왜 이식했나
 * 우리에게는 `structural.SECTIONS` **규격 단면표**만 있었다. 표에 없는 단면
 * (사용자 프로파일 · `extrude_profile` · 비대칭 형강)은 계산할 방법이 없었다.
 *
 * ## 이 파일이 지키는 것
 * ① **폐형과 대조한다.** 사각 bh³/12 · 원형 πr⁴/4 · 각관 (b⁴−b'⁴)/12 는 손으로 풀린다.
 * ② **규격표와 어긋나지 않는다.** 우리 `SECTIONS` 표의 H형강과 폴리곤 계산이 맞아야
 *    「표를 쓸 때와 계산할 때 답이 다른」 상태가 안 된다.
 * ③ **없는 것을 0 으로 내지 않는다.** ㄷ·ㄱ형강 전단중심은 `null` 이다 — 0 으로 주면
 *    비대칭 단면을 대칭인 것처럼 계산해 편심 비틀림을 통째로 놓친다.
 */

import { describe, expect, it } from 'vitest';
import {
  angleSection, annulusSection, channelSection, circleSection, iSection,
  polygonSection, rectTubeSection, rectangleSection, sectionCapability, sectionOfPart,
} from './section-properties.mjs';

type Sec = {
  area: number; ix: number; iy: number; ixy: number; centroid: number[];
  polar: number; perimeter: number; torsionJ?: number; torsionMethod?: string; method?: string;
  shearCenter: number[] | null; warpingCw: number | null; advancedStatus: string | null;
  principal: { iMax: number; iMin: number; angleRad: number };
};
const poly = polygonSection as unknown as (l: number[][] | number[][][]) => Sec;
const rect = rectangleSection as unknown as (w: number, h: number) => Sec;
const circ = circleSection as unknown as (r: number) => Sec;
const ann = annulusSection as unknown as (o: number, i: number) => Sec;
const rtube = rectTubeSection as unknown as (w: number, h: number, t: number) => Sec;
const isec = iSection as unknown as (o: Record<string, number>) => Sec;
const chan = channelSection as unknown as (o: Record<string, number>) => Sec;
const ang = angleSection as unknown as (o: Record<string, number>) => Sec;
const ofPart = sectionOfPart as unknown as (t: string, p: Record<string, unknown>) => Sec | null;

describe('★① 폐형과 대조 — 손으로 풀리는 것부터', () => {
  it('사각 100×200: A=bh · Ix=bh³/12 · Iy=hb³/12', () => {
    const r = rect(100, 200);
    expect(r.area).toBeCloseTo(20000, 6);
    expect(r.ix).toBeCloseTo(100 * 200 ** 3 / 12, 3);
    expect(r.iy).toBeCloseTo(200 * 100 ** 3 / 12, 3);
    expect(r.ixy).toBeCloseTo(0, 6); // 대칭이면 관성곱 0
  });

  it('원형 r=50: A=πr² · I=πr⁴/4 · J=2I', () => {
    const c = circ(50);
    expect(c.area).toBeCloseTo(Math.PI * 2500, 6);
    expect(c.ix).toBeCloseTo(Math.PI * 50 ** 4 / 4, 3);
    expect(c.torsionJ).toBeCloseTo(2 * c.ix, 3);
  });

  it('원환 ⌀100/⌀84: I=π(ro⁴−ri⁴)/4', () => {
    const a = ann(50, 42);
    expect(a.ix).toBeCloseTo(Math.PI * (50 ** 4 - 42 ** 4) / 4, 3);
  });

  it('각관 100×100×4: 구멍 루프가 실제로 빠진다', () => {
    const t = rtube(100, 100, 4);
    expect(t.area).toBeCloseTo(100 * 100 - 92 * 92, 6);
    expect(t.ix).toBeCloseTo((100 ** 4 - 92 ** 4) / 12, 1);
  });

  /**
   * ⚠ 루프 방향은 **호출자의 계약**이다(외곽 CCW·구멍 CW). 이 함수는 부호로 더할 뿐이라
   *   방향을 틀리면 「구멍이 덧붙임이 된다」. 우리가 잡아 주는 것은 **순면적이 0 이하**로
   *   떨어지는 경우뿐이다 — 그 경계를 테스트로 못박아 둔다(있는 척도, 없는 척도 안 한다).
   */
  it('순면적이 0 이하로 떨어지면 거부한다 — 방향이 완전히 뒤집힌 경우', () => {
    const outer = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(() => poly([[...outer].reverse()])).toThrow(/외곽은 CCW, 구멍은 CW/);
  });

  it('★같은 방향 루프 둘은 「구멍」이 아니라 덧붙임이다 — 방향은 호출자 계약이다', () => {
    const outer = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const alsoCCW = [[40, 40], [60, 40], [60, 60], [40, 60]];
    // 구멍으로 의도했더라도 CCW 면 400 이 **더해진다**. 이 규약을 모르면 면적이 조용히 커진다.
    expect(poly([outer, alsoCCW]).area).toBeCloseTo(10000 + 400, 6);
    expect(poly([outer, [...alsoCCW].reverse()]).area, 'CW 로 주면 빠진다').toBeCloseTo(10000 - 400, 6);
  });

  it('★평행축 정리가 걸린다 — 원점에서 떨어진 폴리곤도 도심 기준으로 낸다', () => {
    const atOrigin = poly([[0, 0], [100, 0], [100, 50], [0, 50]]);
    const moved = poly([[1000, 500], [1100, 500], [1100, 550], [1000, 550]]);
    expect(moved.ix).toBeCloseTo(atOrigin.ix, 6);
    expect(moved.centroid[0]).toBeCloseTo(1050, 6);
  });
});

describe('★② 규격표와 어긋나지 않는다', () => {
  it('H300×300×10×15 의 면적이 규격 계산과 맞는다', () => {
    const h = isec({ depth: 300, flangeWidth: 300, flangeThk: 15, webThk: 10 });
    // 2×(300×15) + (300−30)×10 = 9000 + 2700 = 11700
    expect(h.area).toBeCloseTo(11700, 6);
    expect(h.ixy).toBeCloseTo(0, 6); // 이중대칭
    expect(h.shearCenter, '이중대칭이면 전단중심을 안다').toEqual([0, 0]);
  });

  it('주축이 나온다 — 비대칭 단면에서 이게 없으면 휨 계산이 틀린다', () => {
    const a = ang({ legX: 65, legY: 65, thk: 6 });
    expect(a.principal.iMax).toBeGreaterThan(a.principal.iMin);
    expect(Math.abs(a.ixy), '동일 다리 ㄱ형강은 관성곱이 0 이 아니다').toBeGreaterThan(0);
  });
});

describe('★③ 없는 것을 0 으로 내지 않는다', () => {
  it('ㄷ·ㄱ형강 전단중심은 null 이고 사유가 붙는다', () => {
    for (const s of [chan({ depth: 150, flangeWidth: 75, flangeThk: 10, webThk: 6.5 }), ang({ legX: 65, legY: 65, thk: 6 })]) {
      expect(s.shearCenter, '0 을 주면 비대칭을 대칭처럼 계산한다').toBeNull();
      expect(s.warpingCw).toBeNull();
      expect(s.advancedStatus).toMatch(/Saint-Venant|sectorial/);
    }
  });

  it('★비틀림상수는 방법을 함께 낸다 — 근사를 폐형처럼 쓰면 안 된다', () => {
    expect(circ(50).torsionMethod).toMatch(/폐형/);
    expect(rect(100, 200).torsionMethod).toMatch(/근사/);
    expect(rtube(100, 100, 4).torsionMethod).toMatch(/Bredt-Batho/);
    expect(isec({ depth: 300, flangeWidth: 300, flangeThk: 15, webThk: 10 }).torsionMethod).toMatch(/개단면/);
  });

  it('capability 가 무엇이 안 나왔는지 말한다', () => {
    const cap = sectionCapability(chan({ depth: 150, flangeWidth: 75, flangeThk: 10, webThk: 6.5 })) as Record<string, boolean>;
    expect(cap.inertia).toBe(true);
    expect(cap.shearCenter).toBe(false);
    expect(cap.openSectionTorsionReady).toBe(false);
  });

  it('말이 안 되는 치수는 조용히 넘기지 않고 거부한다', () => {
    expect(() => rtube(100, 100, 60)).toThrow(/내부 공간/);
    expect(() => isec({ depth: 100, flangeWidth: 50, flangeThk: 60, webThk: 5 })).toThrow(/성립하지 않는다/);
    expect(() => ann(50, 60)).toThrow(/작아야/);
  });
});

describe('★④ 우리 어휘와 이어져 있다 — 이식만 하고 안 쓰면 무효다', () => {
  it('표에 없는 임의 프로파일이 계산된다 — 이식의 요점이다', () => {
    const s = ofPart('extrude_profile', { profile: [[0, 0], [120, 0], [120, 40], [60, 90], [0, 40]] });
    expect(s?.area).toBeGreaterThan(0);
    expect(s?.method).toMatch(/Green/);
  });

  it('주요 어휘가 단면을 낸다', () => {
    expect(ofPart('cylinder', { diameter: 100 })?.area).toBeCloseTo(Math.PI * 2500, 3);
    expect(ofPart('rect_tube', { width: 50, height: 50, wallThk: 3 })?.area).toBeCloseTo(50 * 50 - 44 * 44, 6);
    expect(ofPart('h_section', { H: 300, B: 300, tw: 10, tf: 15 })?.area).toBeCloseTo(11700, 6);
  });

  it('★단면 개념이 없는 어휘는 null — 억지로 만들지 않는다', () => {
    expect(ofPart('sphere', { diameter: 100 })).toBeNull();
    expect(ofPart('mesh', {})).toBeNull();
    expect(ofPart('extrude_profile', { profile: [[0, 0]] }), '점 3개 미만이면 단면이 아니다').toBeNull();
  });
});
