import { describe, it, expect } from 'vitest';
import {
  evaluateElements,
  aggregateQuality,
  summarize,
  type ElementGeometry,
} from './elementWarpDetector';

function tri(id: string, a: [number, number, number], b: [number, number, number], c: [number, number, number]): ElementGeometry {
  return { id, kind: 'triangle', nodes: [{ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, { x: c[0], y: c[1], z: c[2] }] };
}

function quad(id: string, nodes: [number, number, number][]): ElementGeometry {
  return { id, kind: 'quad', nodes: nodes.map(n => ({ x: n[0], y: n[1], z: n[2] })) };
}

describe('evaluateElements', () => {
  it('empty input → empty output', () => {
    expect(evaluateElements([])).toEqual([]);
  });

  it('equilateral triangle passes', () => {
    const r = evaluateElements([tri('t1', [0, 0, 0], [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0])]);
    expect(r[0]!.classification).toBe('pass');
  });

  it('high aspect ratio triangle → marginal or fail', () => {
    const r = evaluateElements([tri('t1', [0, 0, 0], [100, 0, 0], [50, 1, 0])]);
    expect(['marginal', 'fail']).toContain(r[0]!.classification);
  });

  it('flat quad passes', () => {
    const r = evaluateElements([quad('q1', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]])]);
    expect(r[0]!.classification).toBe('pass');
    expect(r[0]!.warpAngleDeg).toBeLessThan(1);
  });

  it('warped quad detected', () => {
    const r = evaluateElements([quad('q1', [[0, 0, 0], [1, 0, 0], [1, 1, 1], [0, 1, 0]])]);
    expect(r[0]!.warpAngleDeg).toBeGreaterThan(5);
  });

  it('skew quad detected', () => {
    const r = evaluateElements([quad('q1', [[0, 0, 0], [1, 0, 0], [1.5, 0.5, 0], [0.5, 0.5, 0]])]);
    expect(r[0]!.skewAngleDeg).toBeGreaterThan(0);
  });

  it('jacobian present', () => {
    const r = evaluateElements([tri('t1', [0, 0, 0], [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0])]);
    expect(r[0]!.jacobian).toBeGreaterThan(0);
  });

  it('notes populated for fail', () => {
    const r = evaluateElements([tri('t1', [0, 0, 0], [100, 0, 0], [50, 0.01, 0])]);
    expect(r[0]!.notes.length).toBeGreaterThan(0);
  });

  it('tet element supported', () => {
    const el: ElementGeometry = {
      id: 't',
      kind: 'tet',
      nodes: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
    };
    const r = evaluateElements([el]);
    expect(r[0]!.aspectRatio).toBeGreaterThan(0);
  });

  it('hex element supported', () => {
    const el: ElementGeometry = {
      id: 'h',
      kind: 'hex',
      nodes: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 1 },
      ],
    };
    const r = evaluateElements([el]);
    expect(r[0]!.jacobian).toBeGreaterThan(0);
  });
});

describe('aggregateQuality', () => {
  it('counts pass/marginal/fail', () => {
    const r = evaluateElements([
      tri('good', [0, 0, 0], [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0]),
      tri('bad', [0, 0, 0], [100, 0, 0], [50, 0.01, 0]),
    ]);
    const agg = aggregateQuality(r);
    expect(agg.total).toBe(2);
    expect(agg.passCount + agg.marginalCount + agg.failCount).toBe(2);
  });

  it('empty input → worstJacobian = 1', () => {
    expect(aggregateQuality([]).worstJacobian).toBe(1);
  });
});

describe('summarize', () => {
  it('reports pass fraction', () => {
    const r = evaluateElements([tri('good', [0, 0, 0], [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0])]);
    expect(summarize(r).passFraction).toBe(1);
  });

  it('empty → 1.0 pass fraction', () => {
    expect(summarize([]).passFraction).toBe(1);
  });
});
