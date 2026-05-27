import { describe, it, expect } from 'vitest';
import { evaluateFlexSpecs, registerFlexEvaluator, type FlexSpec } from './flexiblePart';
import { identityMatrix, type AssemblyTree, type Matrix4 } from './subAssemblyMotion';

function makeWorld(map: Record<string, Matrix4>): Map<string, Matrix4> {
  return new Map(Object.entries(map));
}

function tree(): AssemblyTree {
  return { rootId: 'root', nodes: new Map() };
}

function translation(x: number, y: number, z: number): Matrix4 {
  return [1, 0, 0, x,  0, 1, 0, y,  0, 0, 1, z,  0, 0, 0, 1];
}

describe('evaluateFlexSpecs · spring', () => {
  it('returns straight-line distance between endpoints', () => {
    const spec: FlexSpec = {
      nodeId: 'spring', flexType: 'spring', paramKey: 'length',
      endpoints: [
        { nodeId: 'a', localPoint: [0, 0, 0] },
        { nodeId: 'b', localPoint: [0, 0, 0] },
      ],
    };
    const world = makeWorld({
      a: identityMatrix(),
      b: translation(10, 0, 0),
    });
    const out = evaluateFlexSpecs([spec], tree(), world);
    expect(out[0]!.value).toBe(10);
  });

  it('clamps to minValue', () => {
    const spec: FlexSpec = {
      nodeId: 'spring', flexType: 'spring', paramKey: 'length',
      endpoints: [
        { nodeId: 'a', localPoint: [0, 0, 0] },
        { nodeId: 'b', localPoint: [0, 0, 0] },
      ],
      minValue: 50,
    };
    const world = makeWorld({ a: identityMatrix(), b: identityMatrix() });
    const out = evaluateFlexSpecs([spec], tree(), world);
    expect(out[0]!.value).toBe(50);
  });
});

describe('evaluateFlexSpecs · hose', () => {
  it('returns 1.15× straight distance', () => {
    const spec: FlexSpec = {
      nodeId: 'hose', flexType: 'hose', paramKey: 'length',
      endpoints: [
        { nodeId: 'a', localPoint: [0, 0, 0] },
        { nodeId: 'b', localPoint: [0, 0, 0] },
      ],
    };
    const world = makeWorld({
      a: identityMatrix(),
      b: translation(100, 0, 0),
    });
    const out = evaluateFlexSpecs([spec], tree(), world);
    expect(out[0]!.value).toBeCloseTo(115, 5);
  });
});

describe('evaluateFlexSpecs · cable', () => {
  it('sums segment lengths through all waypoints', () => {
    const spec: FlexSpec = {
      nodeId: 'cable', flexType: 'cable', paramKey: 'length',
      endpoints: [
        { nodeId: 'a', localPoint: [0, 0, 0] },
        { nodeId: 'b', localPoint: [0, 0, 0] },
        { nodeId: 'c', localPoint: [0, 0, 0] },
      ],
    };
    const world = makeWorld({
      a: identityMatrix(),
      b: translation(10, 0, 0),
      c: translation(10, 20, 0),
    });
    const out = evaluateFlexSpecs([spec], tree(), world);
    expect(out[0]!.value).toBe(30);
  });
});

describe('registerFlexEvaluator', () => {
  it('allows custom flex types to be registered', () => {
    registerFlexEvaluator('test-custom' as never, () => 42);
    const spec: FlexSpec = {
      nodeId: 'x', flexType: 'test-custom' as never,
      paramKey: 'param',
      endpoints: [{ nodeId: 'a', localPoint: [0, 0, 0] }],
    };
    const world = makeWorld({ a: identityMatrix() });
    const out = evaluateFlexSpecs([spec], tree(), world);
    expect(out[0]!.value).toBe(42);
  });
});
