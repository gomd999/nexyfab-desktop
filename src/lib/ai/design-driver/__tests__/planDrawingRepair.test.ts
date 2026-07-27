/**
 * `drawing` 오배치 구조 수리 (260728 §7-1).
 *
 * 벤치 v1(12브리프 × 3회 = 36샘플)에서 **8/36 (22%)** 이 "plan.drawing 이 없고
 * parts[0].drawing 에 있다" 하나로 죽었다 — 단일 최대 실패 원인. 프롬프트로 고치려던
 * 시도는 18샘플 A/B 에서 효과가 없었다(1/18 → 3/18).
 *
 * 수리가 정당한 이유는 하나뿐이다: **어떤 검사도 약해지지 않는다.** 옮겨진 dimensions 는
 * 원래 자리에 있었을 때와 똑같이 drawing 게이트에서 실측되고, 값은 하나도 만들어지거나
 * 바뀌지 않는다. 이 테스트는 그 경계를 고정한다 — 어디까지가 수리이고 어디부터가 날조인지.
 */
import { describe, it, expect } from 'vitest';
import { coerceDesignPlan } from '../llmPlanner';
import { PlannerError } from '../planner';

const PART = {
  partId: 'plate',
  name: 'Plate',
  bodies: [{
    bodyId: 'b0',
    feature: {
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }],
      depth: 10, direction: 'one_sided', mode: 'add',
    },
  }],
};
const DRAWING = {
  paperSize: 'A3',
  dimensions: [
    { id: 'd_w', partId: 'plate', bodyId: 'b0', view: 'top', kind: 'linear', refs: ['e.vert.0', 'e.vert.1'], expected: 100 },
  ],
};

describe('coerceDesignPlan — drawing 오배치 수리', () => {
  it('parts[0].drawing 을 plan.drawing 으로 옮기고, 옮겼다는 사실을 남긴다', () => {
    const plan = coerceDesignPlan({
      planId: 'p1', name: 'n', parts: [{ ...PART, drawing: DRAWING }],
    });
    expect(plan.drawing.dimensions).toHaveLength(1);
    expect(plan.drawing.dimensions[0]!.expected).toBe(100);
    // 조용히 고치지 않는다
    expect(plan.repairs).toHaveLength(1);
    expect(plan.repairs![0]).toContain('plan.parts[0].drawing was moved');
  });

  it('옮긴 내용이 바이트 그대로다 — 값은 하나도 만들거나 바꾸지 않는다', () => {
    const moved = coerceDesignPlan({ planId: 'p1', name: 'n', parts: [{ ...PART, drawing: DRAWING }] });
    const proper = coerceDesignPlan({ planId: 'p1', name: 'n', parts: [PART], drawing: DRAWING });
    expect(moved.drawing).toEqual(proper.drawing);
    // 유일한 차이는 repairs 기록이어야 한다
    expect({ ...moved, repairs: undefined }).toEqual({ ...proper, repairs: undefined });
    expect(proper.repairs).toBeUndefined();
  });

  it('plan.drawing 이 이미 있으면 손대지 않는다 — 모델의 의도를 덮어쓰지 않는다', () => {
    const other = { paperSize: 'A4', dimensions: [] };
    const plan = coerceDesignPlan({
      planId: 'p1', name: 'n', parts: [{ ...PART, drawing: DRAWING }], drawing: other,
    });
    expect(plan.drawing.paperSize).toBe('A4');
    expect(plan.drawing.dimensions).toHaveLength(0);
    expect(plan.repairs).toBeUndefined();
  });

  it('★drawing 을 든 part 가 둘 이상이면 수리하지 않고 거부한다 — 고르는 순간 날조다', () => {
    expect(() => coerceDesignPlan({
      planId: 'p1', name: 'n',
      parts: [{ ...PART, drawing: DRAWING }, { ...PART, partId: 'plate2', drawing: DRAWING }],
    })).toThrow(PlannerError);
    try {
      coerceDesignPlan({
        planId: 'p1', name: 'n',
        parts: [{ ...PART, drawing: DRAWING }, { ...PART, partId: 'plate2', drawing: DRAWING }],
      });
    } catch (e) {
      expect((e as Error).message).toContain('cannot tell which one is the sheet');
    }
  });

  it('어디에도 drawing 이 없으면 종전대로 거부한다 — 없는 도면을 만들어주지 않는다', () => {
    expect(() => coerceDesignPlan({ planId: 'p1', name: 'n', parts: [PART] })).toThrow(PlannerError);
  });

  it('옮긴 drawing 이 잘못된 모양이면 그대로 거부한다 — 수리가 검증을 건너뛰게 하지 않는다', () => {
    expect(() => coerceDesignPlan({
      planId: 'p1', name: 'n', parts: [{ ...PART, drawing: { dimensions: 'nope' } }],
    })).toThrow(PlannerError);
  });
});
