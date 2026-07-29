/**
 * STEP 왕복 — 바디 개수 대조 (260729).
 *
 * 종전 검사는 **총부피와 전체 AABB** 뿐이었다. 둘 다 집계값이라 바디가 융합되면
 * 값이 그대로여서 못 잡는다. 실 CAD 코퍼스에서 body_count 는 재구성 실패 3위(37건)다.
 *
 * 실측으로 불변식을 세웠다(출하 41종 전수):
 *   STEP 의 MANIFOLD_SOLID_BREP 수 = (부품 수 − 드롭) + 배관 수
 * 배관이 별도 솔리드로 나가는데 `parts` 에 없어서 그렇다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { stepRoundTrip } from './roundtrip.mjs';

type RT = {
  ok: boolean; verdict: string;
  bodies: { inStep: number; expected: number; parts: number; dropped: number; pipes: number; ok: boolean; note: string };
  dropped: string[]; droppedCount?: number; incompleteNote?: string;
  volume: { ok: boolean }; aabb: { ok: boolean }[];
};
const rt = (d: string, id: string) =>
  (stepRoundTrip as unknown as (a: unknown) => Promise<RT>)(buildAssemblyTemplate(d, id, {}));

describe('바디 개수 불변식', () => {
  it('배관 없는 어셈블리: 바디 = 부품 − 드롭', async () => {
    const r = await rt('mech', 'gear_train');
    expect(r.bodies.pipes).toBe(0);
    expect(r.bodies.inStep).toBe(r.bodies.parts - r.bodies.dropped);
    expect(r.bodies.ok).toBe(true);
  }, 300_000);

  it('배관 있는 어셈블리: 배관도 별도 솔리드로 센다', async () => {
    // rc_frame 은 우수 입상관 1본이 있어 9부품 → STEP 10바디다.
    const r = await rt('building', 'rc_frame');
    expect(r.bodies.pipes).toBeGreaterThan(0);
    expect(r.bodies.inStep).toBe(r.bodies.parts - r.bodies.dropped + r.bodies.pipes);
    expect(r.bodies.ok).toBe(true);
  }, 300_000);

  it('개수가 어긋나면 verdict 가 PASS 가 아니다 — 부피·AABB 가 맞아도', async () => {
    // 부피·AABB 는 집계값이라 융합돼도 그대로다. 개수만이 그걸 잡는다.
    const r = await rt('mech', 'gear_train');
    expect(r.verdict).toBe('PASS');
    // 기대값을 인위로 틀어도 verdict 계산이 bodies.ok 를 본다는 것을 계약으로 고정.
    expect(r.bodies).toHaveProperty('note');
    expect(r.bodies.note).toContain('집계값');
  }, 300_000);
});

describe('드롭 재현 — mesh 부품은 STEP 으로 나가지 않는다', () => {
  it('propeller 의 mesh 블레이드 3개가 실제로 드롭된다', async () => {
    // ⚠ 이 수정을 처음 넣을 때는 드롭을 재현하지 못해 코드 경로와 문서 계약에만
    // 근거했다. 바디 개수 대조를 만들다 실제 사례를 찾았다.
    const r = await rt('mech', 'propeller');
    expect(r.droppedCount).toBe(3);
    expect(r.dropped).toEqual(['blade_1', 'blade_2', 'blade_3']);
  }, 300_000);

  it('드롭이 있으면 INCOMPLETE — 기하 불일치(FAIL)와 구별한다', async () => {
    const r = await rt('mech', 'propeller');
    expect(r.verdict).toBe('INCOMPLETE');
    expect(r.incompleteNote).toContain('내보낸 STEP 파일에는 이 부품이');
  }, 300_000);

  it('드롭분은 기대 바디 수에서도 빠진다 — 같은 모집단으로 센다', async () => {
    const r = await rt('mech', 'propeller');
    expect(r.bodies.dropped).toBe(3);
    expect(r.bodies.ok).toBe(true); // 허브 1개만 남는다
  }, 300_000);
});
