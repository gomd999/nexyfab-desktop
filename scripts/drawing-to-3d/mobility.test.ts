/**
 * mobility.test.ts — **기구 자유도** (260803, 갭 매트릭스 빈칸 ②).
 *
 * 「조립이 되나」(간섭·부유)와 「움직이나」는 다른 질문이다. 4절 링크는 부품이 안 겹치고
 * 다 받쳐져 있어도 자유도가 0 이면 **안 움직이는 구조물**이다.
 *
 * ## 이 파일이 지키는 것
 * ① **교과서 값과 대조한다.** 4절=1 · 슬라이더크랭크=1 · 삼각링크=0 · 6축 로봇팔=6.
 *    「값이 나온다」는 검사가 아니다.
 * ② **안 잰 것과 0 을 구별한다.** `joints` 선언이 없으면 `null` — `mobility:0` 으로 내면
 *    「안 움직인다」로 읽히는데 실제로는 재지 않은 것이다.
 * ③ **못 보는 것을 말하는지** 확인한다. Kutzbach 는 치수를 안 봐서 평행사변형 링크 같은
 *    특수 치수의 여분 자유도를 못 잡는다 — 그 사실이 결과에 붙어 나가야 한다.
 */

import { describe, expect, it } from 'vitest';
import { JOINT_DOF, grashof, mobilityCheck } from './mobility.mjs';
import { buildAssembly } from './assembly.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';

type Mob = {
  mobility: number | null; formula: string | null; links: number; joints: number;
  verdict: string; note: string; errors: string[];
};
const check = mobilityCheck as unknown as (a: unknown, o?: unknown) => Mob | null;
const rev = (a: string, b: string, axis = 'z') => ({ type: 'revolute', axis, between: [a, b] });

describe('★① 교과서 값과 대조', () => {
  it('4절 링크 = 1 (평면 M=3(4−1)−2·4)', () => {
    const r = check({
      parts: [{ id: 'g', role: 'frame' }, { id: 'crank' }, { id: 'coupler' }, { id: 'rocker' }],
      joints: [rev('g', 'crank'), rev('crank', 'coupler'), rev('coupler', 'rocker'), rev('rocker', 'g')],
    })!;
    expect(r.mobility).toBe(1);
    expect(r.formula).toBe('planar');
    expect(r.verdict).toBe('mechanism');
  });

  it('슬라이더-크랭크 = 1 (회전 3 + 병진 1)', () => {
    const r = check({
      parts: [{ id: 'g', role: 'frame' }, { id: 'crank' }, { id: 'rod' }, { id: 'slider' }],
      joints: [rev('g', 'crank'), rev('crank', 'rod'), rev('rod', 'slider'), { type: 'prismatic', between: ['slider', 'g'] }],
    })!;
    expect(r.mobility).toBe(1);
  });

  it('★삼각 링크 = 0 — 「조립은 되는데 안 움직인다」를 잡는다', () => {
    const r = check({
      parts: [{ id: 'g', role: 'frame' }, { id: 'a' }, { id: 'b' }],
      joints: [rev('g', 'a'), rev('a', 'b'), rev('b', 'g')],
    })!;
    expect(r.mobility).toBe(0);
    expect(r.verdict).toBe('structure');
  });

  it('6축 로봇팔 = 6 (공간 식으로 넘어간다)', () => {
    const ax = ['z', 'y', 'y', 'x', 'y', 'x'];
    const ids = ['base', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
    const r = check({
      parts: ids.map((id, i) => ({ id, ...(i === 0 ? { role: 'frame' } : {}) })),
      joints: ax.map((a, i) => rev(ids[i], ids[i + 1], a)),
    })!;
    expect(r.mobility).toBe(6);
    expect(r.formula).toBe('spatial');
  });

  it('★과구속을 과구속이라고 말한다 — 링크를 하나 더 물리면 음수가 된다', () => {
    const r = check({
      parts: [{ id: 'g', role: 'frame' }, { id: 'a' }, { id: 'b' }, { id: 'c' }],
      joints: [rev('g', 'a'), rev('a', 'b'), rev('b', 'c'), rev('c', 'g'), rev('a', 'c')],
    })!;
    expect(r.mobility).toBeLessThan(0);
    expect(r.verdict).toBe('overconstrained');
  });
});

describe('★② 안 잰 것과 0 은 다르다', () => {
  it('joints 선언이 없으면 null 이다 — 0 이 아니다', () => {
    expect(check({ parts: [{ id: 'x' }, { id: 'y' }] })).toBeNull();
    expect(check({ parts: [{ id: 'x' }], joints: [] })).toBeNull();
  });

  it('알 수 없는 운동쌍은 조용히 넘기지 않고 errors 로 남긴다', () => {
    const r = check({ parts: [{ id: 'a' }, { id: 'b' }], joints: [{ type: '용접비슷한것', between: ['a', 'b'] }] })!;
    expect(r.errors.join(' ')).toMatch(/알 수 없는 운동쌍/);
    expect(r.mobility).toBeNull();
  });

  it('알 수 없는 부품 id 도 남긴다', () => {
    const r = check({ parts: [{ id: 'a' }, { id: 'b' }], joints: [rev('a', '없는놈')] })!;
    expect(r.errors.join(' ')).toMatch(/알 수 없는 부품/);
  });
});

describe('★③ 못 보는 것을 말한다', () => {
  it('Kutzbach 가 치수를 안 본다는 사실이 결과에 붙는다', () => {
    const r = check({
      parts: [{ id: 'g', role: 'frame' }, { id: 'a' }, { id: 'b' }, { id: 'c' }],
      joints: [rev('g', 'a'), rev('a', 'b'), rev('b', 'c'), rev('c', 'g')],
    })!;
    expect(r.note).toMatch(/치수를 보지 않는다/);
    expect(r.note, '어떤 식으로 셌는지도 적어야 재현된다').toMatch(/M=3\(n−1\)/);
  });

  it('운동쌍 자유도 표가 표준과 같다', () => {
    expect(JOINT_DOF.revolute.f).toBe(1);
    expect(JOINT_DOF.cylindrical.f).toBe(2);
    expect(JOINT_DOF.spherical.f).toBe(3);
    expect(JOINT_DOF.fixed.f).toBe(0);
  });
});

describe('★④ 배선 — 템플릿이 실제로 선언한다(있는데 안 닿으면 무효다)', () => {
  it('four_bar 템플릿이 joints 를 선언하고 buildAssembly 가 자유도를 낸다', () => {
    const b = buildAssembly(buildAssemblyTemplate('mech', 'four_bar', {}) as never) as unknown as { mobility?: Mob };
    expect(b.mobility, 'four_bar 가 joints 를 선언하지 않으면 여기서 undefined 다').toBeTruthy();
    expect(b.mobility!.mobility).toBe(1);
    expect(b.mobility!.verdict).toBe('mechanism');
  });

  it('joints 없는 템플릿에는 키가 안 붙는다 — 0 을 지어내지 않는다', () => {
    const b = buildAssembly(buildAssemblyTemplate('mech', 'desk_stand', {}) as never) as unknown as { mobility?: Mob };
    expect(b.mobility).toBeUndefined();
  });
});

describe('★⑤ Grashof — 「움직이나」와 「한 바퀴 도나」는 다른 질문이다', () => {
  it('s+l ≤ p+q 면 충족', () => {
    expect(grashof([400, 120, 350, 250])!.grashof).toBe(true);
  });
  it('미충족이면 전부 요동 링크라고 말한다', () => {
    const r = grashof([100, 100, 100, 400])!;
    expect(r.grashof).toBe(false);
    expect(r.note).toMatch(/요동/);
  });
  it('링크 4개가 아니면 null — 억지로 답하지 않는다', () => {
    expect(grashof([100, 200, 300])).toBeNull();
  });
});
