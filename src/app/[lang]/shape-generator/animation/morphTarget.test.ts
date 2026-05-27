import { describe, it, expect } from 'vitest';
import {
  buildTarget,
  evaluateMorph,
  evaluateMorphEased,
  ease,
  normalizeWeights,
  computeTargetStats,
  computeRigStats,
  serializeRig,
  deserializeRig,
  type MorphRig,
} from './morphTarget';

function makeBase(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
}

function makeTargetA(): Float32Array {
  return new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0]); // moves vertex 1 by (1, 0, 0)
}

function makeTargetB(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 0, 0, 0, 3, 0]); // moves vertex 2 by (0, 2, 0)
}

describe('buildTarget', () => {
  it('computes delta correctly', () => {
    const t = buildTarget('a', makeBase(), makeTargetA());
    expect(t.deltas[3]).toBe(1); // x of vertex 1
    expect(t.deltas[4]).toBe(0);
  });

  it('mismatched length throws', () => {
    expect(() => buildTarget('a', new Float32Array([0, 0, 0]), new Float32Array([1, 1]))).toThrow();
  });

  it('builds normal deltas when both arrays provided', () => {
    const t = buildTarget('a', makeBase(), makeTargetA(), {
      baseNormals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      targetNormals: new Float32Array([0, 0, 1, 0, 1, 0, 0, 0, 1]),
    });
    expect(t.normalDeltas).toBeDefined();
  });
});

describe('evaluateMorph', () => {
  it('zero weights returns base', () => {
    const rig: MorphRig = {
      basePositions: makeBase(),
      targets: [buildTarget('a', makeBase(), makeTargetA())],
    };
    const result = evaluateMorph(rig, {});
    expect(Array.from(result.positions)).toEqual(Array.from(makeBase()));
  });

  it('full weight returns target', () => {
    const rig: MorphRig = {
      basePositions: makeBase(),
      targets: [buildTarget('a', makeBase(), makeTargetA())],
    };
    const result = evaluateMorph(rig, { a: 1 });
    expect(Array.from(result.positions)).toEqual(Array.from(makeTargetA()));
  });

  it('half weight = midpoint', () => {
    const rig: MorphRig = {
      basePositions: makeBase(),
      targets: [buildTarget('a', makeBase(), makeTargetA())],
    };
    const result = evaluateMorph(rig, { a: 0.5 });
    expect(result.positions[3]).toBeCloseTo(1.5, 5);
  });

  it('multiple targets blend additively', () => {
    const rig: MorphRig = {
      basePositions: makeBase(),
      targets: [
        buildTarget('a', makeBase(), makeTargetA()),
        buildTarget('b', makeBase(), makeTargetB()),
      ],
    };
    const result = evaluateMorph(rig, { a: 1, b: 1 });
    expect(result.positions[3]).toBe(2); // a moves vertex 1.x by 1
    expect(result.positions[7]).toBe(3); // b moves vertex 2.y by 2
  });
});

describe('evaluateMorphEased', () => {
  it('linear easing matches plain evaluate', () => {
    const rig: MorphRig = {
      basePositions: makeBase(),
      targets: [buildTarget('a', makeBase(), makeTargetA())],
    };
    const plain = evaluateMorph(rig, { a: 0.5 });
    const eased = evaluateMorphEased(rig, { a: 0.5 }, { easing: { a: 'linear' } });
    expect(eased.positions[3]).toBeCloseTo(plain.positions[3]!, 5);
  });

  it('ease-in produces less-than-linear at 0.5', () => {
    const rig: MorphRig = {
      basePositions: makeBase(),
      targets: [buildTarget('a', makeBase(), makeTargetA())],
    };
    const eased = evaluateMorphEased(rig, { a: 0.5 }, { easing: { a: 'ease-in' } });
    expect(eased.positions[3]).toBeLessThan(1.5);
  });
});

describe('ease', () => {
  it('clamps to [0, 1]', () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it('linear identity', () => {
    expect(ease(0.3, 'linear')).toBe(0.3);
  });

  it('ease-out > 0.5 at midpoint', () => {
    expect(ease(0.5, 'ease-out')).toBeGreaterThan(0.5);
  });
});

describe('normalizeWeights', () => {
  it('preserves when sum ≤ target', () => {
    expect(normalizeWeights({ a: 0.3, b: 0.4 })).toEqual({ a: 0.3, b: 0.4 });
  });

  it('scales to sum=1 when over', () => {
    const w = normalizeWeights({ a: 0.6, b: 0.6 });
    expect(w.a! + w.b!).toBeCloseTo(1, 5);
  });
});

describe('computeTargetStats', () => {
  it('reports max + mean delta', () => {
    const target = buildTarget('a', makeBase(), makeTargetA());
    const s = computeTargetStats(target);
    expect(s.maxDeltaMm).toBe(1);
    expect(s.affectedVertexCount).toBe(1);
  });
});

describe('computeRigStats', () => {
  it('reports vertex + target count', () => {
    const rig: MorphRig = {
      basePositions: makeBase(),
      targets: [buildTarget('a', makeBase(), makeTargetA())],
    };
    const s = computeRigStats(rig);
    expect(s.vertexCount).toBe(3);
    expect(s.targetCount).toBe(1);
  });
});

describe('serialization', () => {
  it('round-trips', () => {
    const rig: MorphRig = {
      basePositions: makeBase(),
      targets: [buildTarget('a', makeBase(), makeTargetA(), { name: 'TargetA' })],
    };
    const json = serializeRig(rig);
    const back = deserializeRig(json);
    expect(back.targets[0]!.name).toBe('TargetA');
    expect(Array.from(back.basePositions)).toEqual(Array.from(rig.basePositions));
  });

  it('rejects unknown version', () => {
    expect(() => deserializeRig({ version: 99, basePositions: [], targets: [] })).toThrow();
  });
});
