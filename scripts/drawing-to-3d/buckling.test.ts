/**
 * buckling.test.ts — **압축 좌굴 사전 선별**(PBAS 0.7.3 이식 ④, 260803).
 *
 * ## 이미 있는 것과 무엇이 다른가
 * `engineering-core/calculators/column-buckling.mjs`(AISC 360 §E3)가 **법정 코드 검토**다 —
 * 입력 6개를 사람이 적어야 한다. 이 모듈은 어셈블리를 **형상에서 유도해 전수로 훑는다.**
 * 부재 40개짜리 어셈블리에서 「어디를 봐야 하나」를 고르는 것이 일이다.
 *
 * ## 이 파일이 지키는 것
 * ① **손으로 풀리는 값과 맞는다.** λ=KL/r · Euler π²E/λ² · Johnson · 국부 kπ²E/12(1−ν²)(t/b)².
 * ② **선별을 판정으로 팔지 않는다.** 결과에 항상 `precheck` 와 코드 계산기 안내가 붙는다.
 * ③ **항복점 없는 재료에 숫자를 지어내지 않는다.** 콘크리트·유리·FRP 는 `pending` + 사유.
 * ④ **약축으로 잰다.** 강축으로 재면 좌굴을 통째로 놓친다.
 */

import { describe, expect, it } from 'vitest';
import { bucklingPrecheck, effectiveLengthFactor, endConditionsOf, evaluateBuckling } from './buckling.mjs';
import { circleSection, iSection, rectTubeSection } from './section-properties.mjs';
import { ELASTIC } from './structural.mjs';

type Buck = {
  precheck: boolean; status: string; pass: boolean | null;
  radiusGyrationMm: number; slenderness: number; transitionSlenderness: number; regime: string;
  criticalStressMPa: number; criticalLoadN: number; safetyFactor: number; columnSafetyFactor: number;
  effectiveLengthFactor: number; effectiveLengthFactorSource: string; governedBy: string;
  localPlateBuckling: { applicable: boolean; criticalMPa: number; safetyFactor: number };
  materialAssumed: string[]; note: string; requiredInputs?: string[]; noYield?: string; effectiveLengthUncertain?: boolean;
};
const evalB = evaluateBuckling as unknown as (o: unknown) => Buck;
const sweep = bucklingPrecheck as unknown as (a: unknown, o?: unknown) => null | {
  results: Array<Buck & { id: string }>; counts: Record<string, number>; flaggedIds: string[]; note: string;
};
const kOf = effectiveLengthFactor as unknown as (a?: string, b?: string) => { K: number; ko: string };
const endsOf = endConditionsOf as unknown as (id: string, a: unknown) => { first: string; second: string; declaredCount: number };
const circ = circleSection as unknown as (r: number) => unknown;
const rtube = rectTubeSection as unknown as (w: number, h: number, t: number) => unknown;
const isec = iSection as unknown as (o: Record<string, number>) => { ix: number; iy: number };

const STEEL_PIN = { material: 'steel', endConditions: { first: 'pin', second: 'pin' } };

describe('★① 손으로 풀리는 값과 맞는다', () => {
  /** ⌀50 강봉 L=2000 양단핀: A=1963.5 · I=306796 · r=12.5 · λ=160 · λt=131.2 → Euler */
  it('Euler 영역: σcr=π²E/λ² — ⌀50·L2000·핀핀 = 79.03 MPa', () => {
    const r = evalB({ lengthMm: 2000, section: circ(25), compressionN: 50000, ...STEEL_PIN });
    expect(r.radiusGyrationMm).toBeCloseTo(12.5, 6);
    expect(r.slenderness).toBeCloseTo(160, 6);
    expect(r.transitionSlenderness).toBeCloseTo(Math.sqrt(2 * Math.PI ** 2 * 205000 / 235), 4);
    expect(r.regime).toMatch(/Euler/);
    expect(r.criticalStressMPa).toBeCloseTo(Math.PI ** 2 * 205000 / 160 ** 2, 6);
    expect(r.criticalLoadN).toBeCloseTo(Math.PI ** 2 * 205000 / 160 ** 2 * Math.PI * 625, 3);
  });

  it('Johnson 영역: σcr=Fy(1−Fy·λ²/4π²E) — 같은 봉 L500 · λ=40 = 224.08 MPa', () => {
    const r = evalB({ lengthMm: 500, section: circ(25), compressionN: 50000, ...STEEL_PIN });
    expect(r.slenderness).toBeCloseTo(40, 6);
    expect(r.regime).toMatch(/Johnson/);
    expect(r.criticalStressMPa).toBeCloseTo(235 * (1 - 235 * 1600 / (4 * Math.PI ** 2 * 205000)), 4);
  });

  /**
   * ⚠ 전이점에서 두 식은 **정확히 Fy/2 로 만난다** — Euler π²E/λt²=Fy/2,
   *   Johnson Fy(1−½)=Fy/2. 여기가 벌어지면 λ 한 끗 차이로 답이 튄다.
   *   양옆 표본의 차는 **기울기×간격**일 뿐이므로 간격을 줄이면 같이 줄어야 한다.
   */
  it('★전이점에서 두 식이 이어진다 — 불연속이면 λ 한 끗 차이로 답이 튄다', () => {
    const lt = Math.sqrt(2 * Math.PI ** 2 * 205000 / 235);
    const at = (lam: number) => evalB({ lengthMm: lam * 12.5, section: circ(25), compressionN: 1, ...STEEL_PIN }).criticalStressMPa;
    expect(at(lt), '전이점에서 정확히 Fy/2').toBeCloseTo(235 / 2, 6);
    const gap = (h: number) => Math.abs(at(lt - h) - at(lt + h));
    expect(gap(0.01)).toBeLessThan(0.05);
    expect(gap(0.001), '간격을 10배 줄이면 차도 10배 준다 = 점프가 없다').toBeLessThan(gap(0.01) / 5);
  });

  it.each([
    ['fixed', 'fixed', 0.5], ['fixed', 'pin', 0.7], ['pin', 'fixed', 0.7],
    ['pin', 'pin', 1.0], ['fixed', 'free', 2.0], ['free', 'fixed', 2.0],
    ['welded', 'bolted', 0.5], ['revolute', 'spherical', 1.0],
  ])('유효좌굴계수 %s/%s → K=%f', (a, b, k) => expect(kOf(a, b).K).toBe(k));

  it('K 는 이론값이라 출처를 밝힌다 — 선언값이 규칙유도를 이긴다', () => {
    const derived = evalB({ lengthMm: 2000, section: circ(25), compressionN: 1000, ...STEEL_PIN });
    expect(derived.effectiveLengthFactorSource).toBe('rule_derived');
    expect(derived.materialAssumed.join()).toMatch(/K=1/);
    const declared = evalB({ lengthMm: 2000, section: circ(25), compressionN: 1000, material: 'steel', K: 0.65 });
    expect(declared.effectiveLengthFactor).toBe(0.65);
    expect(declared.effectiveLengthFactorSource).toBe('declared');
  });

  /** 각관 100×100×2: t/b=0.02 · k=4 · ν=0.3 → σcr = 4π²E/(12(1−0.09))·0.0004 = 296.4 MPa */
  it('국부 판좌굴 σcr=kπ²E/(12(1−ν²))·(t/b)² — 각관 100×100×2 = 296.4 MPa', () => {
    const r = evalB({ lengthMm: 2000, section: rtube(100, 100, 2), compressionN: 100000,
      plate: { thicknessMm: 2, widthMm: 100 }, ...STEEL_PIN });
    expect(r.localPlateBuckling.applicable).toBe(true);
    expect(r.localPlateBuckling.criticalMPa).toBeCloseTo(4 * Math.PI ** 2 * 205000 / (12 * (1 - 0.09)) * 0.02 ** 2, 1);
  });

  it('★박판이면 국부가 기둥보다 먼저 진다 — 지배 모드가 바뀐다', () => {
    const thin = evalB({ lengthMm: 800, section: rtube(200, 200, 1.2), compressionN: 60000,
      plate: { thicknessMm: 1.2, widthMm: 200 }, ...STEEL_PIN });
    expect(thin.localPlateBuckling.safetyFactor).toBeLessThan(thin.columnSafetyFactor);
    expect(thin.governedBy).toMatch(/국부/);
    expect(thin.safetyFactor).toBe(thin.localPlateBuckling.safetyFactor);
  });
});

describe('★② 선별을 판정으로 팔지 않는다', () => {
  it('결과에 precheck 와 코드 계산기 안내가 항상 붙는다', () => {
    const r = evalB({ lengthMm: 2000, section: circ(25), compressionN: 50000, ...STEEL_PIN });
    expect(r.precheck).toBe(true);
    expect(r.status).toBe('screened');
    expect(r.note).toMatch(/사전 선별/);
    expect(r.note, '어디로 가야 하는지까지 적는다').toMatch(/column_buckling/);
  });

  it('무엇을 가정했는지 남긴다 — 표 대표값·유도 K·국부 미검토', () => {
    const r = evalB({ lengthMm: 2000, section: circ(25), compressionN: 50000, ...STEEL_PIN });
    expect(r.materialAssumed.join('|')).toMatch(/표 대표값/);
    expect(r.materialAssumed.join('|')).toMatch(/국부 판좌굴 미검토/);
  });

  it('압축을 안 받으면 not-in-compression — pass 는 true 가 아니라 null 이다', () => {
    const r = evalB({ lengthMm: 2000, section: circ(25), compressionN: 0, ...STEEL_PIN });
    expect(r.status).toBe('not-in-compression');
    expect(r.pass, 'true 로 두면 「좌굴 안전」으로 읽힌다').toBeNull();
  });

  it('길이·단면을 못 얻으면 pending 이고 무엇이 없는지 적는다', () => {
    expect(evalB({ section: circ(25), compressionN: 1000, material: 'steel' }).requiredInputs).toContain('lengthMm');
    expect(evalB({ lengthMm: 2000, compressionN: 1000, material: 'steel' }).requiredInputs).toContain('section(단면적)');
    expect(evalB({ compressionN: 1000, material: 'steel' }).note).toMatch(/안전하다」가 아니다/);
  });
});

describe('★③ 항복점 없는 재료에 숫자를 지어내지 않는다', () => {
  it.each(['concrete', 'castiron', 'glass', 'FRP'])('%s 는 fy 가 null 이고 사유가 붙는다', (m) => {
    const e = (ELASTIC as Record<string, { fy: number | null; noYield?: string }>)[m];
    expect(e.fy, '숫자를 채우면 가장 위험한 재료가 가장 안전해 보인다').toBeNull();
    expect(e.noYield).toBeTruthy();
  });

  it.each(['concrete', 'glass', 'FRP'])('%s 로 선별하면 pending 이고 사유를 그대로 전달한다', (m) => {
    const r = evalB({ lengthMm: 2000, section: circ(25), compressionN: 5000, material: m });
    expect(r.status).toBe('pending');
    expect(r.pass).toBeNull();
    expect(r.noYield).toBeTruthy();
  });

  it('연성 금속은 표에서 바로 풀린다', () => {
    for (const m of ['steel', 'STS304', 'STS316', 'aluminum', 'PVC', 'timber']) {
      expect(evalB({ lengthMm: 1000, section: circ(25), compressionN: 5000, material: m }).status).toBe('screened');
    }
  });
});

describe('★④ 약축으로 잰다 — 강축으로 재면 좌굴을 놓친다', () => {
  it('H형강은 약축(Iy)이 지배한다', () => {
    const h = isec({ depth: 300, flangeWidth: 150, flangeThk: 12, webThk: 8 });
    expect(h.iy, '비대칭 H는 약축이 훨씬 작다').toBeLessThan(h.ix);
    const r = evalB({ lengthMm: 4000, section: h, compressionN: 200000, ...STEEL_PIN });
    // r = √(Iy/A) 여야 한다 — Ix 로 재면 λ 가 작아져 「안전」으로 나온다
    const A = 2 * 150 * 12 + 276 * 8;
    expect(r.radiusGyrationMm).toBeCloseTo(Math.sqrt(h.iy / A), 3);
    expect(r.radiusGyrationMm).toBeLessThan(Math.sqrt(h.ix / A));
  });
});

describe('★⑤ 어셈블리 전수 선별 — 이식만 하고 안 쓰면 무효다', () => {
  const ASM = {
    parts: [
      { id: 'post1', type: 'cylinder', material: 'steel', params: { diameter: 50, length: 3000 }, axialN: -50000 },
      { id: 'post2', type: 'cylinder', material: 'steel', params: { diameter: 20, length: 3000 }, axialN: -50000 },
      { id: 'tie', type: 'cylinder', material: 'steel', params: { diameter: 30, length: 2000 }, axialN: 20000 },
      { id: 'beam', type: 'box', material: 'steel', params: { width: 2000, depth: 100, height: 200 } },
    ],
    joints: [
      // post1 은 양단을 모두 선언했다(K=0.5) · post2 는 한쪽만이라 캔틸레버(K=2.0)
      { type: 'fixed', between: ['post1', 'footing'] },
      { type: 'fixed', between: ['post1', 'beam'] },
      { type: 'revolute', axis: 'z', between: ['post2', 'beam'] },
    ],
  };

  it('압축을 선언한 부재만 훑고, 위험한 것을 지목한다', () => {
    const s = sweep(ASM)!;
    expect(s.counts.declared, '인장(tie)과 무하중(beam)은 대상이 아니다').toBe(2);
    expect(s.counts.screened).toBe(2);
    expect(s.flaggedIds, '⌀20 로 3m 를 버틸 수 없다').toContain('post2');
    expect(s.flaggedIds, '⌀50 양단고정은 버틴다').not.toContain('post1');
  });

  it('단부 조건을 joints 선언에서 읽는다 — 사람이 K 를 안 적어도 된다', () => {
    expect(endsOf('post1', ASM)).toMatchObject({ first: 'fixed', second: 'fixed', declaredCount: 2 });
    expect(endsOf('post2', ASM), '한쪽만 선언 → 반대쪽은 자유').toMatchObject({ first: 'revolute', second: 'free' });
    expect(endsOf('없는부재', ASM), '선언이 없으면 free').toMatchObject({ first: 'free', declaredCount: 0 });
    const s = sweep(ASM)!;
    expect(s.results.find((r) => r.id === 'post1')!.effectiveLengthFactor, '양단 고정 = 0.5').toBe(0.5);
    const p2 = s.results.find((r) => r.id === 'post2')!;
    expect(p2.effectiveLengthFactor, '핀-자유는 규칙표에 없다').toBe(1.0);
    /** ⚠ 핀-자유는 이론상 불안정(K→∞)이라 어떤 유한 K 도 맞지 않는다. 조용히 1.0 을 쓰면 안 된다. */
    expect(p2.effectiveLengthUncertain, '「양단 핀으로 검토됨」으로 읽히면 안 된다').toBe(true);
    expect(p2.materialAssumed.join('|')).toMatch(/불안정/);
  });

  /**
   * ⚠ **구속 하나짜리 부재의 반대쪽 끝을 고정으로 세면 안 된다.** `hits[0]`·`hits[at-1]` 로
   *   쓰면 길이 1 일 때 같은 구속을 두 번 세어 캔틸레버가 「양단 고정」이 된다 —
   *   K 가 2.0 대신 0.5 라서 좌굴 하중이 **16배**(K²) 커진다. 원본 PBAS 도 같은 형태였다.
   */
  it('★구속이 하나면 반대쪽 끝은 자유다 — 캔틸레버를 양단고정으로 세지 않는다', () => {
    // ⌀40·L4000 — 두 경우 모두 Euler 영역에 있어야 배율이 정확히 K² 로 떨어진다
    const one = { parts: [{ id: 'p', type: 'cylinder', material: 'steel', params: { diameter: 40, length: 4000 }, axialN: -30000 }],
      joints: [{ type: 'fixed', between: ['p', 'ground'] }] };
    expect(endsOf('p', one)).toMatchObject({ first: 'fixed', second: 'free', declaredCount: 1 });
    expect(sweep(one)!.results[0].effectiveLengthFactor).toBe(2.0);

    const two = { ...one, joints: [...one.joints, { type: 'fixed', between: ['p', 'cap'] }] };
    expect(sweep(two)!.results[0].effectiveLengthFactor, '양쪽을 실제로 선언하면 0.5').toBe(0.5);
    for (const s of [one, two]) expect(sweep(s)!.results[0].regime).toMatch(/Euler/);
    expect(sweep(two)!.results[0].criticalLoadN / sweep(one)!.results[0].criticalLoadN)
      .toBeCloseTo(16, 6); // (2.0/0.5)² — 이 배율이 통째로 틀렸던 것이다
  });

  it('압축 선언이 없으면 null — 「좌굴 없음」이 아니다', () => {
    expect(sweep({ parts: [{ id: 'a', type: 'box', params: { width: 10, depth: 10, height: 10 } }] })).toBeNull();
  });

  it('buildAssembly 에 붙는다 — 선언이 없으면 키 자체가 없다', async () => {
    const { buildAssembly } = await import('./assembly.mjs') as unknown as {
      buildAssembly: (a: unknown) => { buckling?: { counts: Record<string, number>; flaggedIds: string[] } };
    };
    const parts = [
      { id: 'post', type: 'cylinder', material: 'steel', params: { diameter: 20, length: 3000 }, at: { tx: 0, ty: 0, tz: 0 } },
    ];
    expect(buildAssembly({ parts }).buckling, '하중 선언이 없으면 안 붙는다').toBeUndefined();
    const r = buildAssembly({ parts: [{ ...parts[0], axialN: -50000 }] });
    expect(r.buckling!.flaggedIds).toContain('post');
  });

  it('선별 못 한 것을 통과로 세지 않는다', () => {
    const s = sweep({ parts: [{ id: 'x', type: 'mesh', material: 'steel', axialN: -1000 }] })!;
    expect(s.counts.notScreened).toBe(1);
    expect(s.counts.flagged).toBe(0);
    expect(s.note).toMatch(/안전하다는 뜻이 아니다/);
  });
});
