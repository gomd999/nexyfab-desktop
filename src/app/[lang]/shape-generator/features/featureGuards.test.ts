import { describe, it, expect } from 'vitest';
import { guardFeature, guardPipeline } from './featureGuards';
import type { FeatureInstance } from './types';

const f = (overrides: Partial<FeatureInstance>): FeatureInstance => ({
  id: 'test', type: 'fillet', params: { radius: 3 }, enabled: true, ...overrides,
});

describe('guardFeature', () => {
  it('returns null for a valid fillet', () => {
    expect(guardFeature(f({ type: 'fillet', params: { radius: 3 } }))).toBeNull();
  });

  it('flags fillet radius 0', () => {
    const r = guardFeature(f({ type: 'fillet', params: { radius: 0 } }));
    expect(r?.code).toBe('FILLET_RADIUS_INVALID');
  });

  it('flags negative param with suggestedFix', () => {
    const r = guardFeature(f({ type: 'fillet', params: { radius: -5 } }));
    expect(r?.code).toBe('NEGATIVE_PARAM');
    expect(r?.suggestedFix).toBe(5);
  });

  it('flags NaN param', () => {
    const r = guardFeature(f({ type: 'fillet', params: { radius: NaN } }));
    expect(r?.code).toBe('NEGATIVE_PARAM');
  });

  it('flags Infinity param', () => {
    const r = guardFeature(f({ type: 'fillet', params: { radius: Infinity } }));
    expect(r?.code).toBe('NEGATIVE_PARAM');
  });

  it('flags param out of range', () => {
    const r = guardFeature(f({ type: 'fillet', params: { radius: 10000 } }));
    expect(r?.code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('flags shell thickness 0', () => {
    const r = guardFeature(f({ type: 'shell', params: { thickness: 0 } }));
    expect(r?.code).toBe('SHELL_THICKNESS_INVALID');
  });

  it('flags hole diameter 0', () => {
    const r = guardFeature(f({ type: 'hole', params: { diameter: 0 } }));
    expect(r?.code).toBe('HOLE_DIAMETER_INVALID');
  });

  it('flags pattern count 0', () => {
    const r = guardFeature(f({ type: 'linearPattern', params: { count: 0 } }));
    expect(r?.code).toBe('PATTERN_COUNT_INVALID');
  });

  it('flags missing sketch data on sketchExtrude', () => {
    const r = guardFeature(f({ type: 'sketchExtrude', params: {} }));
    expect(r?.code).toBe('MISSING_SKETCH_DATA');
  });

  it('flags empty sketch profile', () => {
    const r = guardFeature(f({
      type: 'sketchExtrude', params: {},
      sketchData: {
        profile: { segments: [], closed: true },
        config: { mode: 'extrude', depth: 10, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
        plane: 'xy', planeOffset: 0, operation: 'add',
      },
    }));
    expect(r?.code).toBe('EMPTY_SKETCH_PROFILE');
  });

  it('flags extrude depth 0', () => {
    const r = guardFeature(f({
      type: 'sketchExtrude', params: {},
      sketchData: {
        profile: { segments: [{ type: 'rect', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }], closed: true },
        config: { mode: 'extrude', depth: 0, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
        plane: 'xy', planeOffset: 0, operation: 'add',
      },
    }));
    expect(r?.code).toBe('EXTRUDE_DEPTH_ZERO');
  });

  it('allows negative angle param', () => {
    expect(guardFeature(f({ type: 'draft', params: { angle: -15 } }))).toBeNull();
  });

  it('allows unknown feature type with sensible defaults', () => {
    expect(guardFeature(f({ type: 'thread', params: { radius: 3 } }))).toBeNull();
  });
});

describe('guardPipeline', () => {
  it('flags empty pipeline', () => {
    const r = guardPipeline([]);
    expect(r?.code).toBe('EMPTY_PIPELINE');
  });

  it('returns first feature error encountered', () => {
    const r = guardPipeline([
      f({ id: 'a', type: 'fillet', params: { radius: 3 } }),
      f({ id: 'b', type: 'shell', params: { thickness: 0 } }),
    ]);
    expect(r?.featureId).toBe('b');
    expect(r?.code).toBe('SHELL_THICKNESS_INVALID');
  });

  it('skips disabled features', () => {
    const r = guardPipeline([
      f({ id: 'a', type: 'fillet', params: { radius: 3 } }),
      f({ id: 'b', type: 'shell', params: { thickness: 0 }, enabled: false }),
    ]);
    expect(r).toBeNull();
  });

  it('returns null when all features pass', () => {
    const r = guardPipeline([
      f({ id: 'a', type: 'fillet', params: { radius: 3 } }),
      f({ id: 'b', type: 'shell', params: { thickness: 2 } }),
    ]);
    expect(r).toBeNull();
  });
});
