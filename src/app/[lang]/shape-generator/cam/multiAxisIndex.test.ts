import { describe, it, expect } from 'vitest';
import { planIndexing, emitWcsPreamble, type FaceForIndexing } from './multiAxisIndex';

function face(id: string, n: [number, number, number]): FaceForIndexing {
  return { faceId: id, normal: n, centroid: [0, 0, 0] };
}

describe('planIndexing', () => {
  it('top face (normal +Z) needs no rotation', () => {
    const p = planIndexing([face('top', [0, 0, 1])]);
    expect(p.assignments[0]!.rotA).toBeCloseTo(0, 1);
  });

  it('bottom face (normal -Z) needs 180° A rotation', () => {
    const p = planIndexing([face('bottom', [0, 0, -1])]);
    expect(p.assignments[0]!.rotA).toBeCloseTo(180, 1);
  });

  it('side face (normal +X) needs 90° A rotation', () => {
    const p = planIndexing([face('right', [1, 0, 0])]);
    expect(p.assignments[0]!.rotA).toBeCloseTo(90, 1);
  });

  it('reuses WCS for two faces with same orientation', () => {
    const p = planIndexing([
      face('a', [0, 0, 1]),
      face('b', [0, 0, 1]),
    ]);
    expect(p.totalWcs).toBe(1);
    expect(p.assignments[0]!.wcsIndex).toBe(p.assignments[1]!.wcsIndex);
  });

  it('assigns distinct WCS for distinct orientations', () => {
    const p = planIndexing([
      face('top', [0, 0, 1]),
      face('right', [1, 0, 0]),
      face('front', [0, 1, 0]),
    ]);
    expect(p.totalWcs).toBe(3);
  });

  it('handles cube\'s 6 faces with 6 WCS', () => {
    const p = planIndexing([
      face('+X', [1, 0, 0]),
      face('-X', [-1, 0, 0]),
      face('+Y', [0, 1, 0]),
      face('-Y', [0, -1, 0]),
      face('+Z', [0, 0, 1]),
      face('-Z', [0, 0, -1]),
    ]);
    expect(p.totalWcs).toBe(6);
  });
});

describe('emitWcsPreamble', () => {
  it('emits G54.1 + A/C move', () => {
    const p = planIndexing([face('top', [0, 0, 1])]);
    const txt = emitWcsPreamble(p.assignments[0]!);
    expect(txt).toContain('G54.1 P1');
    expect(txt).toContain('A0.000');
    expect(txt).toContain('C0.000');
  });

  it('includes face id comment for traceability', () => {
    const p = planIndexing([face('myFace', [1, 0, 0])]);
    const txt = emitWcsPreamble(p.assignments[0]!);
    expect(txt).toContain('myFace');
  });
});
