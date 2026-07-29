/**
 * 변단면 거더(헌치보) 어휘 — 260729.
 *
 * 근거: buildingSMART IFC 4.3 공식 커버리지 샘플 `beam-varying-profiles`.
 * ⚠ 코퍼스 **빈도로 고른 것이 아니다** — 상위 3개 기증자가 57.4%라 빈도는 한 기증자에
 * 과적합된다. IFC 공식 샘플 46건만이 편향 없는 부분집합이다.
 *
 * 이 어휘 전까지 「변단면」은 블레이드 생성(domain-assemblies·gen-macros)의 테이퍼뿐이었고
 * **구조 부재로는 존재하지 않았다** — 교량 헌치보·라멘 우각부를 낼 방법이 없었다.
 */
import { describe, it, expect } from 'vitest';
import { gate, partAabb, scadBody } from './reconstruct.mjs';
import { partVolume, partCG } from './structural.mjs';
import { buildProxyInventory } from './proxy-inventory.mjs';

const G = { length: 10000, topW: 300, topT: 20, webT: 12, webH1: 600, webH2: 1200, botW: 400, botT: 25 };
const g = (p: Record<string, unknown>) =>
  (gate as unknown as (i: unknown) => string[])({ type: 'tapered_girder', ...p });
const vol = (p: Record<string, unknown>) =>
  (partVolume as unknown as (t: string, p: unknown) => number)('tapered_girder', p);

describe('부피 — 단면적이 1차식이라 평균단면×길이가 정확하다', () => {
  it('선언 치수의 폐형', () => {
    expect(vol(G)).toBe(10000 * (400 * 25 + 300 * 20 + 12 * (600 + 1200) / 2));
    expect(vol(G)).toBe(268_000_000);
  });

  it('수치적분(웨브 1e5 분할)과 일치 — 사다리꼴이 근사가 아님을 확인', () => {
    let web = 0;
    const N = 100_000;
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) / N;
      web += (G.webH1 + (G.webH2 - G.webH1) * t) * G.webT * (G.length / N);
    }
    const num = web + G.length * (G.botW * G.botT + G.topW * G.topT);
    expect(Math.abs(num - vol(G)) / vol(G)).toBeLessThan(1e-9);
  });

  it('webH1 === webH2 면 i_girder 와 같은 값', () => {
    const uniform = vol({ ...G, webH1: 800, webH2: 800 });
    const straight = (partVolume as unknown as (t: string, p: unknown) => number)(
      'i_girder', { length: 10000, topW: 300, topT: 20, webT: 12, webH: 800, botW: 400, botT: 25 });
    expect(uniform).toBe(straight);
  });

  it('AABB 는 깊은 쪽 춤을 쓴다 — 축 순서는 x=스팬·y=춤·z=폭', () => {
    const a = (partAabb as unknown as (p: unknown) => { max: number[] })({ type: 'tapered_girder', ...G });
    expect(a.max).toEqual([10000, 25 + 1200 + 20, 400]);
  });
});

describe('무게중심 — 스팬·춤 둘 다 비대칭이라 AABB 중심이 아니다', () => {
  const cg = (partCG as unknown as (p: unknown) => number[])({ type: 'tapered_girder', params: G });

  it('깊은 쪽(x=L)으로 치우친다', () => {
    expect(cg[0]).toBeGreaterThan(G.length / 2);
  });

  it('폐형 CG 가 수치적분 CG 와 일치(1e-6 이내)', () => {
    // 웨브만 스팬 방향으로 비대칭 — 플랜지 2개는 x 대칭이라 해석해가 맞는지 여기서 갈린다.
    const N = 200_000;
    let Vw = 0, Mx = 0, My = 0;
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) / N, x = t * G.length;
      const h = G.webH1 + (G.webH2 - G.webH1) * t;
      const dV = h * G.webT * (G.length / N);
      Vw += dV; Mx += x * dV; My += (G.botT + h / 2) * dV;
    }
    const Vb = G.length * G.botT * G.botW, Vt = G.length * G.topT * G.topW;
    const tyNum = G.botT + (G.webH1 + G.webH2) / 2 + G.topT / 2;
    const V = Vb + Vw + Vt;
    const cxNum = (Vb * G.length / 2 + Mx + Vt * G.length / 2) / V;
    const cyNum = (Vb * G.botT / 2 + My + Vt * tyNum) / V;
    expect(Math.abs(cg[0] - cxNum) / cxNum).toBeLessThan(1e-6);
    expect(Math.abs(cg[1] - cyNum) / cyNum).toBeLessThan(1e-6);
  });
});

describe('게이트', () => {
  it('정상은 통과', () => expect(g(G)).toEqual([]));

  it.each([
    ['webH2 누락', { ...G, webH2: undefined }, 'webH2 invalid'],
    ['웨브가 플랜지보다 넓음', { ...G, webT: 500 }, 'webT > 플랜지 폭'],
    ['얕은 쪽 춤 부족', { ...G, webH1: 100, webH2: 120 }, '최소 거더 춤'],
  ])('%s → 걸린다', (_l, p, want) => expect(g(p as Record<string, unknown>).join(' ')).toContain(want));

  it('급물매를 거부한다 — 플랜지 두께가 연직 측정이라 직교 두께가 얇아진다', () => {
    // 스팬 2m 에 춤이 1.4m 변하면 물매 1:1.43 — 직교 두께가 22% 얇다.
    const steep = { ...G, length: 2000, webH1: 400, webH2: 1800 };
    const errs = g(steep).join(' ');
    expect(errs).toContain('웨브 물매');
    expect(errs).toContain('연직 측정');
  });

  it('1:3 물매는 통과(경계 — 과탐 금지)', () => {
    // Δh/L = 3000/10000 = 0.3 < 1/3.
    expect(g({ ...G, webH1: 600, webH2: 3600 })).toEqual([]);
  });
});

describe('SCAD 는 폐형과 같은 solid 를 낸다', () => {
  it('경사면 프리즘은 폭(Z) 방향 압출 — union 3성분', () => {
    const s = (scadBody as unknown as (i: unknown) => string)({ type: 'tapered_girder', ...G });
    expect(s).toContain('linear_extrude');
    expect((s.match(/linear_extrude/g) ?? []).length).toBe(2); // 웨브 + 상부 플랜지
    expect(s).toContain('cube(['); // 하부 플랜지만 직육면체
  });
});

describe('3열 부피 일치 — analytic·SCAD·STEP', () => {
  it('EXACT', async () => {
    const inv = await (buildProxyInventory as unknown as (o: unknown) => Promise<{ rows: { verdict: string }[] }>)(
      { types: ['tapered_girder'] });
    expect(inv.rows[0].verdict).toBe('EXACT');
  }, 600_000);
});
