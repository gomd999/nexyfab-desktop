/**
 * patternFromSketch — end-to-end Phase 2.4 pipeline tests for linear +
 * circular patterns.
 *
 * Mirror of revolveFromSketch.test.ts shape. Pure unit tests, no DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  linearPatternFromSketch,
  circularPatternFromSketch,
} from './patternFromSketch';
import { deserializeFeatureTree, serializeFeatureTree } from '@/lib/cad/featureTreePersist';
import type { SolverViewState } from './solverToProfile';

function rect(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 10 },
      { id: 'p4', x: 0, y: 10 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

describe('linearPatternFromSketch', () => {
  it('returns a persistable dependency tree for downstream editing', () => {
    const r = linearPatternFromSketch(rect(), {
      child: { depth: 10 },
      count: 3,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 20,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tree.nodes[1]?.dependencies).toEqual(['linear_pattern_child']);
      expect(r.tree.nodes[1]?.payload).toMatchObject({
        kind: 'linear_pattern',
        childId: 'linear_pattern_child',
      });
      expect(deserializeFeatureTree(serializeFeatureTree(r.tree))).toMatchObject({ ok: true });
    }
  });
  it('rect + count=4 along +X → SCAD with linear_extrude child + for loop translate', () => {
    const r = linearPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 4,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 15,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Child body is an extrude.
      expect(r.scad).toContain('linear_extrude(height=5');
      expect(r.scad).toContain('polygon([');
      // Pattern wrapper.
      expect(r.scad).toContain('module nexyfab_pattern_child');
      expect(r.scad).toMatch(/for \(i = \[0 : 3\]\)/);
      expect(r.scad).toMatch(/translate\(\[15 \* i, 0 \* i, 0 \* i\]\)/);
      expect(r.loop.points.length).toBe(4);
    }
  });

  it('normalizes a non-unit direction before applying spacing', () => {
    const r = linearPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 3,
      direction: { x: 10, y: 0, z: 0 }, // non-unit (len=10)
      spacing: 8,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Direction normalized to (1,0,0) → translate step = 8.
      expect(r.scad).toMatch(/translate\(\[8 \* i, 0 \* i, 0 \* i\]\)/);
    }
  });

  it('no closed loop → ok=false', () => {
    const open: SolverViewState = {
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
    };
    const r = linearPatternFromSketch(open, {
      child: { depth: 5 },
      count: 3,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/closed|dangling/i);
  });

  it('rejects non-positive depth before touching the sketch', () => {
    const r = linearPatternFromSketch(rect(), {
      child: { depth: 0 },
      count: 3,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/depth/i);
  });

  it('rejects count < 1 / non-integer / > 1000 via IR builder', () => {
    const base = {
      child: { depth: 5 },
      direction: { x: 1, y: 0, z: 0 },
      spacing: 10,
    } as const;
    const zero = linearPatternFromSketch(rect(), { ...base, count: 0 });
    expect(zero.ok).toBe(false);
    const frac = linearPatternFromSketch(rect(), { ...base, count: 2.5 });
    expect(frac.ok).toBe(false);
    const huge = linearPatternFromSketch(rect(), { ...base, count: 1001 });
    expect(huge.ok).toBe(false);
  });

  it('rejects zero-length direction', () => {
    const r = linearPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 3,
      direction: { x: 0, y: 0, z: 0 },
      spacing: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/zero-length/i);
  });

  it('rejects non-positive spacing', () => {
    const r = linearPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 3,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/spacing/i);
  });

  it('multiple loops: picks the largest-area one for the child', () => {
    const state: SolverViewState = {
      points: [
        // small 5×5 (area 25)
        { id: 'sa', x: 1, y: 0 }, { id: 'sb', x: 6, y: 0 },
        { id: 'sc', x: 6, y: 5 }, { id: 'sd', x: 1, y: 5 },
        // large 20×10 (area 200)
        { id: 'la', x: 100, y: 0 }, { id: 'lb', x: 120, y: 0 },
        { id: 'lc', x: 120, y: 10 }, { id: 'ld', x: 100, y: 10 },
      ],
      lines: [
        { id: 'sl1', p1: 'sa', p2: 'sb' }, { id: 'sl2', p1: 'sb', p2: 'sc' },
        { id: 'sl3', p1: 'sc', p2: 'sd' }, { id: 'sl4', p1: 'sd', p2: 'sa' },
        { id: 'll1', p1: 'la', p2: 'lb' }, { id: 'll2', p1: 'lb', p2: 'lc' },
        { id: 'll3', p1: 'lc', p2: 'ld' }, { id: 'll4', p1: 'ld', p2: 'la' },
      ],
    };
    const r = linearPatternFromSketch(state, {
      child: { depth: 5 },
      count: 2,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.loop.signedArea)).toBeCloseTo(200, 5);
    }
  });

  it('feature replay wraps SCAD in `// === id (name) ===` envelope', () => {
    const r = linearPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 3,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 10,
      featureName: 'MyArray',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('=== linear_pattern_1 (MyArray) ===');
    }
  });
});

describe('circularPatternFromSketch', () => {
  it('rect + count=6 around Z axis at origin → SCAD with rotate loop', () => {
    const r = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 6,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('linear_extrude(height=5');
      expect(r.scad).toContain('module nexyfab_pattern_child');
      expect(r.scad).toMatch(/for \(i = \[0 : 5\]\)/);
      expect(r.scad).toMatch(/rotate\(a = i \* 60, v = \[0, 0, 1\]\)/);
    }
  });

  it('partial sweep uses (count-1) spacings — e.g. count=4 over 270° → 90° step', () => {
    const r = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
      totalAngleDegrees: 270,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/rotate\(a = i \* 90, v = \[0, 0, 1\]\)/);
    }
  });

  it('non-origin axis origin → emits translate(O) ... translate(-O) wrapper', () => {
    const r = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 3,
      axisOrigin: { x: 100, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('translate([100, 0, 0])');
      expect(r.scad).toContain('translate([-100, 0, 0])');
    }
  });

  it('normalizes axis direction', () => {
    const r = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 10 }, // non-unit
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('v = [0, 0, 1]');
    }
  });

  it('no closed loop → ok=false', () => {
    const open: SolverViewState = {
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
    };
    const r = circularPatternFromSketch(open, {
      child: { depth: 5 },
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/closed|dangling/i);
  });

  it('rejects count < 2 via IR builder', () => {
    const r = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 1,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects count > 1000', () => {
    const r = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 1001,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects zero-length axis direction', () => {
    const r = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 0 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/zero-length/i);
  });

  it('rejects totalAngle out of (0, 360]', () => {
    const tooBig = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
      totalAngleDegrees: 400,
    });
    expect(tooBig.ok).toBe(false);
    const zero = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
      totalAngleDegrees: 0,
    });
    expect(zero.ok).toBe(false);
  });

  it('feature replay wraps SCAD in `// === id (name) ===` envelope', () => {
    const r = circularPatternFromSketch(rect(), {
      child: { depth: 5 },
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
      featureName: 'Ring',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('=== circular_pattern_1 (Ring) ===');
    }
  });
});
