/**
 * boundaryFunction — **표 밖을 지어내지 않는가** (260801).
 *
 * 잡는 것은 「보간이 되나」가 아니라, 경계조건에서 값을 지어내면 생기는 일이다:
 *   · 표 밖 외삽 → 측정도 계산도 아닌 하중이 해석에 들어간다
 *   · 실패를 0 으로 채움 → 그 순간 하중이 사라져 응답이 조용히 작아진다
 */
import { describe, expect, it } from 'vitest';
import { evaluateBcFunction, evaluateBcSeries, validateTable, type TableSpec } from './boundaryFunction';

const table: TableSpec = { kind: 'table', points: [[0, 0], [1, 100], [2, 50]] };

describe('보간', () => {
  it('표를 선형 보간한다', () => {
    const r = evaluateBcFunction(table, 0.5);
    expect(r.ok && r.value).toBeCloseTo(50, 6);
  });

  it('격점에서는 정확히 그 값', () => {
    for (const [x, y] of table.points) {
      const r = evaluateBcFunction(table, x);
      expect(r.ok && r.value).toBeCloseTo(y, 9);
    }
  });

  it('램프·계단·사인을 해석적으로 준다', () => {
    const ramp = evaluateBcFunction({ kind: 'ramp', x0: 0, y0: 0, x1: 10, y1: 200 }, 2.5);
    expect(ramp.ok && ramp.value).toBeCloseTo(50, 9);
    const step = evaluateBcFunction({ kind: 'step', at: 5, before: 0, after: 9 }, 5);
    expect(step.ok && step.value).toBe(9);
    const sine = evaluateBcFunction({ kind: 'sine', amplitude: 10, freq: 1, mean: 3 }, 0.25);
    expect(sine.ok && sine.value).toBeCloseTo(13, 6);
  });
});

describe('★표 밖을 외삽하지 않는다', () => {
  it('★기본은 거부 — 범위 밖 값을 만들지 않는다', () => {
    const r = evaluateBcFunction(table, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('외삽하지 않는다');
      expect(r.reason).toContain('0~2');
    }
  });

  it('★clamp 는 **명시적으로 골라야** 하고, 골랐다는 사실이 결과에 남는다', () => {
    const r = evaluateBcFunction({ ...table, outOfRange: 'clamp' }, 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(50);
      expect(r.note).toContain('clamp');
    }
  });

  it('램프도 구간 밖은 같은 규칙을 따른다', () => {
    const spec = { kind: 'ramp', x0: 0, y0: 0, x1: 10, y1: 200 } as const;
    expect(evaluateBcFunction(spec, 11).ok).toBe(false);
    expect(evaluateBcFunction({ ...spec, outOfRange: 'clamp' }, 11).ok).toBe(true);
  });

  it('★사인·계단은 정의역 제한이 없다 — 해석 함수라 외삽이라는 개념이 없다', () => {
    expect(evaluateBcFunction({ kind: 'sine', amplitude: 1, freq: 1 }, 1e6).ok).toBe(true);
    expect(evaluateBcFunction({ kind: 'step', at: 0, before: 1, after: 2 }, -1e6).ok).toBe(true);
  });
});

describe('★잘못된 표를 말없이 고치지 않는다', () => {
  it('★x 가 오름차순이 아니면 **정렬해 주지 않고** 거부한다', () => {
    const bad: TableSpec = { kind: 'table', points: [[0, 0], [2, 1], [1, 2]] };
    expect(validateTable(bad)).toContain('오름차순');
    expect(evaluateBcFunction(bad, 0.5).ok).toBe(false);
  });

  it('점이 하나뿐이면 보간할 구간이 없다고 말한다', () => {
    expect(validateTable({ kind: 'table', points: [[0, 1]] })).toContain('점이 하나');
  });

  it('비유한 값을 담은 점을 거부한다', () => {
    expect(validateTable({ kind: 'table', points: [[0, 0], [1, NaN]] })).toContain('유효한');
  });

  it('평가점이 NaN 이면 거부한다 — 0 으로 두면 하중 없음으로 읽힌다', () => {
    expect(evaluateBcFunction(table, NaN).ok).toBe(false);
  });
});

describe('★시계열 — 실패를 0 으로 채우지 않는다', () => {
  it('★범위 밖 점은 빠지고, 빠졌다는 사실이 남는다', () => {
    const r = evaluateBcSeries(table, [0, 1, 2, 3]);
    expect(r.values).toHaveLength(3);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.x).toBe(3);
    // 0 이 끼어들지 않았는지 — 끼면 그 시각 하중이 사라진 것으로 해석된다
    expect(r.values.some((v) => v.x === 3)).toBe(false);
  });

  it('clamp 를 쓰면 값은 나오되 안내가 함께 남는다', () => {
    const r = evaluateBcSeries({ ...table, outOfRange: 'clamp' }, [0, 3]);
    expect(r.values).toHaveLength(2);
    expect(r.failures).toHaveLength(0);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('전부 정상이면 실패 목록이 비어 있다 — 과탐 없음', () => {
    const r = evaluateBcSeries(table, [0, 0.5, 1, 1.5, 2]);
    expect(r.failures).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });
});
