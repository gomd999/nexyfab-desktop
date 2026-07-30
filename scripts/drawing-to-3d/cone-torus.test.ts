/**
 * cone-torus.test.ts — 솔리드 원뿔대·원환 어휘 (260801h).
 *
 * ## 왜 추가했는가
 * `pipe_reducer`(원뿔 **셸**)·`pipe_elbow`(원환 셸)·`revolve`(다각형 회전체)는 있었지만
 * **속이 찬 원뿔·원환을 선언할 방법이 없었다.** `revolve` 로 흉내 내면 다각형 근사라
 * 부피가 실제와 다르다 — 질량·BOQ 가 그만큼 틀린다.
 *
 * ## ⚠ 임포트가 풀린다는 뜻은 아니다 (실측)
 * 코퍼스에서 `CONICAL_SURFACE`·`TOROIDAL_SURFACE` 를 가진 셸 **383개 중 373개가 혼재**
 * (모따기·라운드 면)였다. 단독 원뿔 8 · 원환 2 뿐이다. 즉 이 어휘는 **어휘로서** 필요한
 * 것이고, 임포트 차단의 해결책이 아니다 — 그건 일반 BREP 경로(OCCT)의 몫이다.
 * 「원뿔·원환을 지원한다 → 임포트가 된다」로 적으면 과고지다.
 *
 * ## 무엇을 고정하는가
 * 부피·표면적을 **공식대로 적었는지**가 아니라 **맞는지**를 수치적분으로 대조한다.
 */

import { describe, expect, it } from 'vitest';
import { gate, partAabb } from './reconstruct.mjs';
import { partVolume } from './structural.mjs';
import { computeBOQ } from './boq.mjs';

const V = partVolume as unknown as (t: string, p: Record<string, number>) => number;
/**
 * 겉넓이는 **실제 소비 경로**(BOQ)로 잰다 — 내부 함수를 직접 부르면 「산출은 되는데
 * 물량서에는 안 실린다」는 형태 ①(있는 것이 안 닿음)을 놓친다. m² → mm² 로 되돌린다.
 */
const S = (t: string, p: Record<string, number>): number => {
  const b = (computeBOQ as unknown as (a: unknown) => { items: Array<{ surfaceM2: number | null }> })(
    { parts: [{ id: t, type: t, params: p }] });
  const m2 = b.items[0]!.surfaceM2;
  if (m2 == null) throw new Error(`${t}: BOQ 가 겉넓이를 산출하지 않았다(미산출 어휘로 빠졌다)`);
  return m2 * 1e6;
};
const G = gate as unknown as (i: Record<string, unknown>) => string[];
const BB = partAabb as unknown as (i: Record<string, unknown>) => { min: number[]; max: number[] };

describe('원뿔대 — 부피·겉넓이가 실제와 맞는가', () => {
  const p = { dia1: 80, dia2: 40, height: 120 };

  it('★부피가 원판 적분과 일치한다 — 공식을 적은 것이 아니라 맞는지 본다', () => {
    // 높이 z 에서 반경 r(z) = r1 + (r2−r1)·z/h → V = ∫πr(z)²dz
    const r1 = p.dia1 / 2, r2 = p.dia2 / 2, N = 200_000;
    let sum = 0;
    for (let k = 0; k < N; k++) {
      const z = ((k + 0.5) / N) * p.height;
      const r = r1 + ((r2 - r1) * z) / p.height;
      sum += Math.PI * r * r * (p.height / N);
    }
    expect(V('cone', p)).toBeCloseTo(sum, 3);
  });

  it('★겉넓이는 **모선**으로 잰다 — 높이를 쓰면 도장 물량이 과소가 된다', () => {
    const r1 = p.dia1 / 2, r2 = p.dia2 / 2;
    const slant = Math.hypot(p.height, r1 - r2);
    const truth = Math.PI * (r1 + r2) * slant + Math.PI * (r1 ** 2 + r2 ** 2);
    // ⚠ BOQ 는 m² 소수 3자리로 반올림한다 — 그 자릿수까지만 비교한다(과도한 정밀 주장 금지).
    expect(S('cone', p) / 1e6).toBeCloseTo(truth / 1e6, 3);
    // 높이를 모선으로 잘못 쓰면 **작게** 나온다 — 그 오류가 다시 들어오면 잡힌다.
    const wrong = Math.PI * (r1 + r2) * p.height + Math.PI * (r1 ** 2 + r2 ** 2);
    expect(S('cone', p)).toBeGreaterThan(wrong);
  });

  it('dia2 = 0 은 뾰족한 원뿔이다 — 허용하고 V = πr²h/3 이 된다', () => {
    const sharp = { dia1: 80, dia2: 0, height: 120 };
    expect(G({ type: 'cone', ...sharp })).toEqual([]);
    expect(V('cone', sharp)).toBeCloseTo((Math.PI * 40 ** 2 * 120) / 3, 6);
  });

  it('★dia1 = dia2 는 거부한다 — 원기둥을 두 어휘로 쓰면 BOQ·도면이 갈린다', () => {
    const errs = G({ type: 'cone', dia1: 60, dia2: 60, height: 100 });
    expect(errs.join(' ')).toMatch(/cylinder/);
  });

  it('AABB 는 **큰 쪽 지름**이 정한다 — 위가 넓은 형상도 있다', () => {
    const wide = BB({ type: 'cone', dia1: 40, dia2: 80, height: 120 });
    expect(wide.max[0]! - wide.min[0]!).toBeCloseTo(80, 6);
  });
});

describe('원환 — 부피·겉넓이가 실제와 맞는가', () => {
  const p = { majorDia: 200, minorDia: 40 };

  it('★부피가 파푸스 정리(단면적 × 중심 이동거리)와 일치한다', () => {
    const R = p.majorDia / 2, r = p.minorDia / 2;
    expect(V('torus', p)).toBeCloseTo(Math.PI * r * r * (2 * Math.PI * R), 6);
  });

  it('★겉넓이가 파푸스 정리(둘레 × 중심 이동거리)와 일치한다', () => {
    const R = p.majorDia / 2, r = p.minorDia / 2;
    expect(S('torus', p) / 1e6).toBeCloseTo((2 * Math.PI * r * (2 * Math.PI * R)) / 1e6, 3);
  });

  it('★minorDia ≥ majorDia 는 거부한다 — 자기교차라 2π²Rr² 이 과대해진다', () => {
    /**
     * ⚠ 통과시키면 안쪽 구멍이 없는데도 있는 것처럼 계산해 **부피가 실제보다 크게** 나온다.
     *   형상이 성립하지 않는 것을 통과시키고 수치를 내는 것이 이 세션에서 반복해 잡은 형태다.
     */
    expect(G({ type: 'torus', majorDia: 100, minorDia: 100 }).join(' ')).toMatch(/자기교차/);
    expect(G({ type: 'torus', majorDia: 100, minorDia: 40 })).toEqual([]);
  });

  it('AABB 는 바깥 반경 R+r · 두께 2r', () => {
    const bb = BB({ type: 'torus', ...p });
    expect(bb.max[0]! - bb.min[0]!).toBeCloseTo(240, 6);
    expect(bb.max[2]! - bb.min[2]!).toBeCloseTo(40, 6);
  });
});

/**
 * ★프리미티브 `kind` 가 **세 곳 모두**에 있는가 (260801h).
 *
 * ⚠ 이번에 실제로 밟은 함정이다: `to-step.mjs`(B-rep)와 `assembly.mjs`(배선)에 `torus` 를
 *   넣었는데 `compose.mjs` 의 **kind 게이트**에 없어서 `unknown kind 'torus'` 로 잘렸다.
 *   증상은 「부피·BOQ 는 나오는데 STEP 이 빈다」 — 형태 ①(있는 것이 안 닿음)이다.
 *
 * 세 파일이 **같은 kind 목록을 각자** 들고 있는 구조라 하나만 빠지면 조용히 사라진다.
 * 목록을 합칠 수는 없었다(compose 는 게이트+SCAD, to-step 은 커널) — 대신 **어긋남을
 * 검사**한다. 다음에 프리미티브를 추가할 때 세 곳을 다 밟게 만드는 것이 이 검사의 일이다.
 */
describe('프리미티브 kind — 세 소비자가 어긋나지 않는다', () => {
  const kinds = (src: string, re: RegExp): Set<string> =>
    new Set([...src.matchAll(re)].map((m) => m[1]!));

  it("compose 게이트 · compose SCAD · to-step 커널의 kind 집합이 일치한다", async () => {
    const { readFileSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const compose = readFileSync(`${dir}/compose.mjs`, 'utf8');
    const toStep = readFileSync(`${dir}/to-step.mjs`, 'utf8');
    // 게이트는 `validate` 안의 switch, 방출은 `featBody` 안의 switch — 파일을 잘라 각각 센다.
    const gateSrc = compose.slice(0, compose.indexOf('function featBody'));
    const emitSrc = compose.slice(compose.indexOf('function featBody'));
    const gate = kinds(gateSrc, /case '(\w+)':/g);
    const emit = kinds(emitSrc, /case '(\w+)':/g);
    const kernel = kinds(toStep.slice(toStep.indexOf('switch (f.kind)')), /case '(\w+)':/g);
    /**
     * ⚠ 「커널이 게이트의 전 kind 를 가져야 한다」고 단정했다가 **실측에서 정정했다.**
     *   `polyhedron` 은 커널에 없지만 조용히 사라지지 않는다 — `buildSolidRobust` 가
     *   **떨어뜨리고 `dropped` 로 보고**하고(실측 확인), 호출측이 고지하는 규약이 있다.
     *   그래서 「커널에 없어도 되는 것」은 **이유와 함께 명시된 것만** 허용한다.
     */
    const KERNEL_EXEMPT: Record<string, string> = {
      polyhedron: 'SCAD 전용(자유곡면 정점/면 직접) — STEP 은 buildSolidRobust 가 dropped 로 고지',
    };
    const gateOnly = [...gate].filter((k) => !kernel.has(k) && !(k in KERNEL_EXEMPT));
    expect(gateOnly, `게이트에 있고 커널에 없다(고지 규약도 없다): ${gateOnly.join(', ')}`).toEqual([]);
    /**
     * ⚠ 여기서도 한 번 더 틀렸다. `loft`·`sweep` 은 커널에만 있는데, 그건 **compose 가
     *   아닌 다른 생산자**(`loft.mjs`)가 만드는 스펙이라 compose 게이트를 지나지 않는다.
     *   「게이트에 없으면 영영 안 닿는다」는 내 가정이 구조와 달랐다.
     *   생산자가 둘이라는 사실을 적어 두고, **그 밖의 어긋남**만 잡는다.
     */
    const GATE_EXEMPT: Record<string, string> = {
      loft: 'loft.mjs 가 만드는 스펙 — compose 게이트를 지나지 않는다',
      sweep: 'loft.mjs 가 만드는 스펙 — compose 게이트를 지나지 않는다',
    };
    const kernelOnly = [...kernel].filter((k) => !gate.has(k) && !(k in GATE_EXEMPT));
    expect(kernelOnly, `커널에만 있고 어느 생산자도 명시되지 않았다: ${kernelOnly.join(', ')}`).toEqual([]);
    // 게이트와 SCAD 방출은 **같은 파일의 두 스위치**라 어긋날 이유가 없다.
    const gateNoEmit = [...gate].filter((k) => !emit.has(k));
    const emitNoGate = [...emit].filter((k) => !gate.has(k));
    expect(gateNoEmit, `게이트에 있고 SCAD 방출에 없다: ${gateNoEmit.join(', ')}`).toEqual([]);
    expect(emitNoGate, `SCAD 방출에 있고 게이트에 없다: ${emitNoGate.join(', ')}`).toEqual([]);
    // 이번에 추가한 것이 실제로 세 곳에 다 있는지 — 집합이 다 비어도 통과하는 것을 막는다.
    for (const s of [gate, emit, kernel]) expect(s.has('torus')).toBe(true);
    for (const s of [gate, emit, kernel]) expect(s.has('cone')).toBe(true);
  });
});
