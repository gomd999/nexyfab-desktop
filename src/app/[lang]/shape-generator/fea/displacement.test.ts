import { describe, it, expect } from 'vitest';
import {
  deformPositions,
  pickDefaultScale,
  animationFrames,
  displacementMagnitudes,
} from './displacement';
import type { StressField } from './stressField';

function makeField(displacementMm: number[][]): StressField {
  const flat = new Float32Array(displacementMm.flat());
  return {
    vertexCount: displacementMm.length,
    vonMises: new Float32Array(displacementMm.length),
    displacement: flat,
  };
}

const positions3 = new Float32Array([
  0, 0, 0,
  10, 0, 0,
  0, 10, 0,
]);

describe('deformPositions', () => {
  it('applies displacement scaled by factor', () => {
    const field = makeField([[1, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const out = deformPositions(positions3, field, 2);
    expect(out[0]).toBe(2);   // 0 + 1*2
    expect(out[3]).toBe(10);  // 10 + 0*2
  });

  it('returns rest pose when scale = 0', () => {
    const field = makeField([[5, 5, 5], [5, 5, 5], [5, 5, 5]]);
    const out = deformPositions(positions3, field, 0);
    expect(Array.from(out)).toEqual(Array.from(positions3));
  });

  it('does not mutate the input position array', () => {
    const field = makeField([[10, 0, 0], [0, 0, 0], [0, 0, 0]]);
    deformPositions(positions3, field, 5);
    expect(positions3[0]).toBe(0);
  });
});

describe('pickDefaultScale', () => {
  it('picks the scale such that max displacement = 1% of bbox diagonal', () => {
    // bbox diagonal for positions3 = sqrt(10²+10²+0²) ≈ 14.14
    // max disp = 1mm → target = 14.14 * 0.01 / 1 ≈ 0.1414
    const field = makeField([[1, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const s = pickDefaultScale(positions3, field);
    expect(s).toBeCloseTo(14.142 * 0.01, 2);
  });

  it('returns 1 when displacement is zero', () => {
    const field = makeField([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    expect(pickDefaultScale(positions3, field)).toBe(1);
  });

  it('returns 1 when bbox is degenerate (all points coincident)', () => {
    const collapsed = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const field = makeField([[1, 0, 0], [0, 0, 0], [0, 0, 0]]);
    expect(pickDefaultScale(collapsed, field)).toBe(1);
  });

  it('honours custom targetFraction', () => {
    const field = makeField([[1, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const at1 = pickDefaultScale(positions3, field, 0.01);
    const at5 = pickDefaultScale(positions3, field, 0.05);
    expect(at5).toBeCloseTo(at1 * 5, 5);
  });
});

describe('animationFrames', () => {
  it('produces N frames from rest pose to fully-deformed', () => {
    const field = makeField([[2, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const frames = animationFrames(positions3, field, 1, 5);
    expect(frames).toHaveLength(5);
    expect(frames[0][0]).toBe(0); // rest
    expect(frames[4][0]).toBe(2); // fully deformed × scale 1
  });

  it('clamps frame count to ≥ 2', () => {
    const field = makeField([[1, 0, 0], [0, 0, 0], [0, 0, 0]]);
    expect(animationFrames(positions3, field, 1, 1)).toHaveLength(2);
  });
});

describe('displacementMagnitudes', () => {
  it('computes Euclidean magnitudes', () => {
    const field = makeField([[3, 4, 0], [0, 0, 0], [1, 2, 2]]);
    const m = displacementMagnitudes(field);
    expect(m[0]).toBeCloseTo(5);
    expect(m[1]).toBeCloseTo(0);
    expect(m[2]).toBeCloseTo(3);
  });

  it('returns an array length = vertexCount', () => {
    const field = makeField([[1, 0, 0], [0, 1, 0]]);
    expect(displacementMagnitudes(field).length).toBe(2);
  });
});
