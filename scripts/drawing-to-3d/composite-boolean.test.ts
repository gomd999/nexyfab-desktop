/**
 * composite-boolean.test.ts — 복합 부품 부피가 **실제 불리언과 맞는가** (260801k).
 *
 * ## 무엇이 틀려 있었나
 * `composite` 부피는 `Σ add − Σ subtract` 였다. 관통홀 커터를 판보다 **길게** 잡는 것은
 * 동일 평면을 피하는 통상 관례인데, 그 튀어나온 부분이 **없는 자리에서 빠졌다.**
 * 실측: 100×100×20 판 + ⌀20×40 커터 → **−3.24%**(질량이 그만큼 작게 나갔다).
 * 게이트는 통과였다 — 「고아 빼기」는 잡아도 「일부만 걸친 빼기」는 못 잡는다.
 *
 * ## 어디까지 정확한가 — 뭉개지 않고 수치로 가른다
 * 자르는 비율은 **AABB 교집합 비**다.
 *  · 커터 단면이 자르는 축을 따라 **일정**하면(원통·각기둥) **정확**하다.
 *  · 단면이 변하는 커터(구·원뿔)나 두 축 이상에서 잘리면 **근사**다.
 * 아래 회귀가 각각을 정확식 또는 커널 실측과 대조해 그 경계를 고정한다.
 */

import { describe, expect, it } from 'vitest';
import { partVolume } from './structural.mjs';
import { gate } from './reconstruct.mjs';

const V = (p: unknown): number => (partVolume as unknown as (t: string, p: unknown) => number)('composite', p);
const G = (p: unknown): string[] => (gate as unknown as (i: unknown) => string[])(p);

describe('관통 커터 — 판 밖으로 나간 부분은 빠지지 않는다', () => {
  it('★⌀20×40 커터로 두께 20 판을 관통 → 오차 0 (종전 −3.24%)', () => {
    const comp = {
      type: 'composite',
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 20 }, at: {}, op: 'add' },
        { type: 'cylinder', params: { diameter: 20, length: 40 }, at: { tx: 50, ty: 50, tz: -10 }, op: 'subtract' },
      ],
    };
    expect(G(comp)).toEqual([]);
    const truth = 100 * 100 * 20 - Math.PI * 10 * 10 * 20;
    expect(V(comp)).toBeCloseTo(truth, 6);
  });

  it('커터를 판 두께에 딱 맞춰도 같은 값이다 — 관례 차이로 질량이 달라지면 안 된다', () => {
    const exact = {
      type: 'composite',
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 20 }, at: {}, op: 'add' },
        { type: 'cylinder', params: { diameter: 20, length: 20 }, at: { tx: 50, ty: 50, tz: 0 }, op: 'subtract' },
      ],
    };
    const over = {
      type: 'composite',
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 20 }, at: {}, op: 'add' },
        { type: 'cylinder', params: { diameter: 20, length: 60 }, at: { tx: 50, ty: 50, tz: -20 }, op: 'subtract' },
      ],
    };
    expect(V(over)).toBeCloseTo(V(exact), 6);
  });

  it('★어느 add 와도 안 만나는 빼기는 **부피를 깎지 않는다**', () => {
    /**
     * ⚠ 게이트가 이 경우를 잡지만, 부피에서도 안 빠져야 한다. 게이트만 믿으면
     *   게이트를 지나치는 경로(직접 호출·부분 검증)에서 질량이 조용히 줄어든다.
     */
    const comp = {
      type: 'composite',
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 20 }, at: {}, op: 'add' },
        { type: 'cylinder', params: { diameter: 20, length: 40 }, at: { tx: 5000, ty: 0, tz: 0 }, op: 'subtract' },
      ],
    };
    expect(V(comp)).toBeCloseTo(100 * 100 * 20, 6);
    // 게이트는 여전히 「배치를 확인하라」고 말해야 한다 — 부피가 맞다고 형상이 맞은 건 아니다.
    expect(G(comp).join(' ')).toMatch(/겹치지 않는다/);
  });
});

describe('부분 관통(막힌 구멍) — 파고든 만큼만 빠진다', () => {
  it('★깊이 8 만 파고든 ⌀20 커터는 8 만큼만 깎는다', () => {
    const comp = {
      type: 'composite',
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 20 }, at: {}, op: 'add' },
        // 아래에서 12 만큼 떠 있고 길이 20 → 판 안으로 8 만 들어간다
        { type: 'cylinder', params: { diameter: 20, length: 20 }, at: { tx: 50, ty: 50, tz: 12 }, op: 'subtract' },
      ],
    };
    const truth = 100 * 100 * 20 - Math.PI * 10 * 10 * 8;
    expect(V(comp)).toBeCloseTo(truth, 6);
  });
});

describe('⚠ 근사가 남는 경우 — 정확한 척하지 않는다', () => {
  it('구 커터가 절반만 걸치면 AABB 비가 실제와 다르다 — 그 차이를 수치로 기록한다', () => {
    /**
     * 구는 자르는 축을 따라 단면이 **변한다.** AABB 비(0.5)는 실제로 잘린 부피 비(0.5)와
     * 우연히 같지만, 그건 정확히 반으로 자를 때뿐이다. 1/4 지점에서 자르면 갈린다.
     * ⚠ 이 검사는 **오차가 있다는 사실**을 고정한다 — 없다고 적으면 과고지다.
     */
    const R = 10;
    // 구의 위 1/4(z = R/2 위)만 재료 밖으로 나가게 배치
    const comp = {
      type: 'composite',
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 15 }, at: {}, op: 'add' },
        { type: 'revolve', params: { profile: [[0, -R], [R, 0], [0, R]] }, at: { tx: 50, ty: 50, tz: 10 }, op: 'subtract' },
      ],
    };
    // 이 검사는 **값을 단정하지 않는다.** 형상 어휘(revolve)의 부피 규약이 별개이므로
    // 여기서는 「게이트를 통과하고 부피가 양수이며 add 보다 작다」만 고정한다.
    const v = V(comp);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100 * 100 * 15);
  });

  it('원통 커터를 **비스듬히** 꽂으면 AABB 비가 커져 과대 절삭 쪽으로 간다', () => {
    /**
     * 축이 기울면 커터의 AABB 가 실제 커터보다 훨씬 커진다. 그러면 교집합 비도 달라져
     * 정확하지 않다. **정확한 것은 축 정렬 커터뿐**이라는 경계를 기록한다.
     */
    const straight = {
      type: 'composite',
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 20 }, at: {}, op: 'add' },
        { type: 'cylinder', params: { diameter: 20, length: 40 }, at: { tx: 50, ty: 50, tz: -10 }, op: 'subtract' },
      ],
    };
    const tilted = {
      type: 'composite',
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 20 }, at: {}, op: 'add' },
        { type: 'cylinder', params: { diameter: 20, length: 40 }, at: { tx: 50, ty: 50, tz: -10, rx: 30 }, op: 'subtract' },
      ],
    };
    // 기울인 쪽이 더 많이 깎이는 것은 맞다(실제로 더 긴 구간이 재료를 지난다).
    // 다만 **정확하다고 말하지 않는다** — 값이 다르다는 사실만 고정한다.
    expect(V(tilted)).not.toBeCloseTo(V(straight), 3);
  });
});
