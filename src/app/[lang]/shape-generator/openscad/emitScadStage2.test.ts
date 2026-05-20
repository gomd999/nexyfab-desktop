import { describe, it, expect } from 'vitest';
import {
  emitFilletStage2,
  emitChamferStage2,
  emitShellStage2,
  emitDraftStage2,
  emitThreadStage2,
  emitPolygonFromSegments,
  emitSketchExtrudeStage2,
  tryEmitStage2,
} from './emitScadStage2';
import type { FeatureInstance } from '../features/types';

describe('emitFilletStage2', () => {
  it('produces minkowski + sphere with the requested radius', () => {
    const r = emitFilletStage2('cube([10,10,10])', 2);
    expect(r.improved).toBe(true);
    expect(r.code).toContain('minkowski()');
    expect(r.code).toContain('sphere(r=2');
  });

  it('clamps radius to a minimum (avoid zero-size sphere)', () => {
    const r = emitFilletStage2('cube([10,10,10])', 0);
    expect(r.code).toMatch(/sphere\(r=0\.1/);
  });
});

describe('emitChamferStage2', () => {
  it('emits minkowski + rotated cube', () => {
    const r = emitChamferStage2('cube([10,10,10])', 1.5);
    expect(r.code).toContain('minkowski()');
    expect(r.code).toContain('cube([1.5, 1.5, 1.5]');
    expect(r.code).toContain('rotate([45, 45, 0])');
  });
});

describe('emitShellStage2', () => {
  it('produces difference-of-offsets shell', () => {
    const r = emitShellStage2('cube([10,10,10])', 1);
    expect(r.code).toContain('difference()');
    expect(r.code).toContain('minkowski()');
  });
});

describe('emitDraftStage2', () => {
  it('produces hull between top + bottom scaled', () => {
    const r = emitDraftStage2('cube([10,10,10])', 5, 20);
    expect(r.code).toContain('hull()');
    expect(r.code).toContain('translate([0, 0, 20])');
  });

  it('scale factor reflects draft angle', () => {
    // tan(45°) ≈ 1, so scale ≈ 2.
    const r = emitDraftStage2('cube([10,10,10])', 45, 10);
    expect(r.code).toMatch(/scale\(\[1\.99\d+|scale\(\[2/);
  });
});

describe('emitThreadStage2', () => {
  it('emits helical for-loop', () => {
    const r = emitThreadStage2(10, 1.5, 20);
    expect(r.code).toContain('for (i = [0 :');
    expect(r.code).toContain('rotate([0, 0, angle])');
  });

  it('turn count scales with length / pitch', () => {
    const r10 = emitThreadStage2(10, 1.0, 10);
    const r100 = emitThreadStage2(10, 1.0, 100);
    const get = (s: string): number => parseInt(s.match(/0 : (\d+)/)![1]!, 10);
    expect(get(r100.code)).toBeGreaterThan(get(r10.code) * 5);
  });
});

describe('emitPolygonFromSegments', () => {
  it('emits polygon with vertex list', () => {
    const r = emitPolygonFromSegments([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]);
    expect(r).toBe('polygon([[0, 0], [10, 0], [5, 10]])');
  });

  it('falls back to square when fewer than 3 verts', () => {
    const r = emitPolygonFromSegments([{ x: 0, y: 0 }]);
    expect(r).toContain('square');
  });
});

describe('emitSketchExtrudeStage2', () => {
  it('improved=true when sketch has real segments', () => {
    const r = emitSketchExtrudeStage2('cube([10,10,10])', [
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 },
    ], 8);
    expect(r.improved).toBe(true);
    expect(r.code).toContain('linear_extrude(height=8)');
    expect(r.code).toContain('polygon');
  });

  it('improved=false when no segment data', () => {
    const r = emitSketchExtrudeStage2('cube([10,10,10])', undefined, 8);
    expect(r.improved).toBe(false);
  });

  it('respects subtract operation', () => {
    const r = emitSketchExtrudeStage2('cube([10,10,10])', [
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 },
    ], 4, 'subtract');
    expect(r.code).toContain('difference()');
  });
});

describe('tryEmitStage2', () => {
  const makeFeature = (type: string, params: Record<string, number>): FeatureInstance => ({
    id: 't',
    type: type as FeatureInstance['type'],
    enabled: true,
    params,
  });

  it('returns null for unsupported feature types', () => {
    expect(tryEmitStage2(makeFeature('mirror', {}), 'cube([])')).toBeNull();
  });

  it('returns null for disabled features', () => {
    const f = makeFeature('fillet', { radius: 2 });
    f.enabled = false;
    expect(tryEmitStage2(f, 'cube([])')).toBeNull();
  });

  it('handles fillet', () => {
    const r = tryEmitStage2(makeFeature('fillet', { radius: 2 }), 'cube([])');
    expect(r?.improved).toBe(true);
  });

  it('handles thread with default params', () => {
    const r = tryEmitStage2(makeFeature('thread', {}), 'cube([])');
    expect(r?.code).toContain('for');
  });
});
