/**
 * 치수 약속의 산술을 엔진으로 (260728) — §6-1(부피)의 치수 판.
 *
 * 실측(bench v1): b-11 경사 심이 **3/3** 으로 `aligned` 슬랜트 길이에서 죽었다.
 * 실측 122.576(=√(120²+25²))은 **옳았고** 모델의 약속이 매 실행마다 달랐다
 * (125 · 120.208 · 122.066 — 추측 중이라는 뜻). 260727 §5-4 가 "옳은 측정 + 틀린 약속"
 * 으로 이름 붙인 축이다.
 *
 * ⚠ 독립성은 §6-1 과 똑같이 지킨다: 항은 **브리프 치수**에서 오고 측정 기하에서 오지
 * 않는다. 측정값에서 expected 를 유도하면 그 순간 검사가 항등식이 된다.
 */
import { describe, it, expect } from 'vitest';
import { derivedDimensionMm, derivationLine } from '../volumeDecomposition';
import { buildDrawingArtifact, drawingGate } from '../drawingGate';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { DesignPlan } from '../types';

/** 경사 심: 길이 120, 한쪽 40 다른쪽 15, 두께 10 (벤치 b-11 형상). */
const SHIM: ExtrudeFeature = {
  kind: 'extrude',
  loop: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 15 }, { x: 0, y: 40 }],
  depth: 10, direction: 'one_sided', mode: 'add',
};

describe('derivedDimensionMm — 엔진이 계산한다', () => {
  it('hypotenuse: 슬랜트의 진짜 길이', () => {
    // 벤치 v1 에서 게이트가 실제로 **측정한** 값과 같아야 한다 — 그게 이 유도의 목적이다.
    expect(derivedDimensionMm({ kind: 'hypotenuse', legAMm: 120, legBMm: 25 })).toBeCloseTo(122.57650672131263, 9);
  });
  it('sum / difference', () => {
    expect(derivedDimensionMm({ kind: 'sum', termsMm: [30, 40, 50] })).toBe(120);
    expect(derivedDimensionMm({ kind: 'difference', fromMm: 60, minusMm: [5, 5] })).toBe(50);
  });
  it('성립하지 않는 유도는 거부한다 — 음수/0 을 치수로 내보내지 않는다', () => {
    expect(() => derivedDimensionMm({ kind: 'difference', fromMm: 10, minusMm: [6, 6] })).toThrow(RangeError);
    expect(() => derivedDimensionMm({ kind: 'hypotenuse', legAMm: 0, legBMm: 5 })).toThrow(RangeError);
    expect(() => derivedDimensionMm({ kind: 'sum', termsMm: [] })).toThrow(RangeError);
  });
  it('근거 한 줄이 남는다 — "왜 이 숫자인가"', () => {
    expect(derivationLine({ kind: 'hypotenuse', legAMm: 120, legBMm: 25 })).toContain('√(120² + 25²)');
  });
});

const plan = (dim: Record<string, unknown>): DesignPlan => ({
  planId: 'p', name: 'shim',
  parts: [{ partId: 'shim', name: 'Shim', bodies: [{ bodyId: 'b0', feature: SHIM }] }],
  drawing: { paperSize: 'A3', scale: 1, dimensions: [{ id: 'd_slope', partId: 'shim', bodyId: 'b0', view: 'top', kind: 'aligned', refs: ['e.vert.2', 'e.vert.3'], ...dim } as never] },
});

describe('drawingGate — expectedFrom 이 약속의 산술을 대신한다', () => {
  it('★expected 없이 expectedFrom 만 줘도 통과한다 — 모델은 산술을 전혀 안 한다', () => {
    const p = plan({ expectedFrom: { kind: 'hypotenuse', legAMm: 120, legBMm: 25 } });
    const res = drawingGate(p, buildDrawingArtifact(p));
    expect(res.pass).toBe(true);
    expect(res.notes.join(' ')).toContain('√(120² + 25²)');
  });

  it('종전처럼 손으로 적은 틀린 약속은 그대로 잡힌다 (b-11 재현)', () => {
    const p = plan({ expected: 125 });
    const res = drawingGate(p, buildDrawingArtifact(p));
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('deviates from expected 125');
  });

  it('산술 오류는 측정 불일치와 **다른 문장**으로 보고된다', () => {
    // 유도식은 맞는데 숫자를 손으로 잘못 적은 경우
    const p = plan({ expectedFrom: { kind: 'hypotenuse', legAMm: 120, legBMm: 25 }, expected: 125 });
    const res = drawingGate(p, buildDrawingArtifact(p));
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('arithmetic error in the stated promise');
    expect(res.reason).not.toContain('deviates from expected');
  });

  it('유도가 성립하지 않으면 게이트가 거부한다 — 잘못된 수를 통과시키지 않는다', () => {
    const p = plan({ expectedFrom: { kind: 'difference', fromMm: 10, minusMm: [20] } });
    const res = drawingGate(p, buildDrawingArtifact(p));
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('expectedFrom invalid');
  });

  it('expectedFrom 이 없으면 종전과 동일 (하위호환)', () => {
    const a = drawingGate(plan({}), buildDrawingArtifact(plan({})));
    expect(a.pass).toBe(true); // expected 없음 = 값 검사 안 함(종전 계약)
  });
});
