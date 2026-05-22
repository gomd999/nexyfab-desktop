import { describe, it, expect } from 'vitest';
import { clampFeatureParams, isSchemaKnownFeature, isBuildableFeatureType, FEATURE_PARAM_RANGES } from '../featureParamSchema';
import { getFeatureDefinition, FEATURE_MAP } from '../index';

describe('featureParamSchema — clamp AI feature params to the real ranges', () => {
  it('clamps an out-of-range fillet radius down to the schema max', () => {
    const out = clampFeatureParams('fillet', { radius: 50, segments: 4 });
    expect(out).not.toBeNull();
    expect(out!.radius).toBe(20);   // max
    expect(out!.segments).toBe(4);  // in range, kept
  });

  it('rounds integer params and fills missing ones with defaults', () => {
    const out = clampFeatureParams('fillet', { radius: 3, segments: 2.7 })!;
    expect(out.segments).toBe(3);    // rounded
    expect(out.engine).toBe(1);      // missing → default
  });

  it('drops params not in the schema', () => {
    const out = clampFeatureParams('chamfer', { distance: 2, bogus: 999, hack: -1 })!;
    expect(out).toEqual({ distance: 2, engine: 1 });
    expect('bogus' in out).toBe(false);
  });

  it('clamps a below-min value up to the schema min', () => {
    expect(clampFeatureParams('hole', { diameter: 0.1 })!.diameter).toBe(1);
    expect(clampFeatureParams('shell', { wallThickness: -5 })!.wallThickness).toBe(0.5);
  });

  it('returns null for unknown feature types (caller uses generic clamp)', () => {
    expect(clampFeatureParams('weldment', { x: 1 })).toBeNull();
    expect(isSchemaKnownFeature('fillet')).toBe(true);
    expect(isSchemaKnownFeature('weldment')).toBe(false);
  });

  it('recognises buildable feature types and rejects hallucinated ones', () => {
    expect(isBuildableFeatureType('fillet')).toBe(true);
    expect(isBuildableFeatureType('sweep')).toBe(true);
    expect(isBuildableFeatureType('sketchExtrude')).toBe(true);
    expect(isBuildableFeatureType('teleport')).toBe(false);
    expect(isBuildableFeatureType('')).toBe(false);
  });

  it('KNOWN_FEATURE_TYPES covers every buildable FEATURE_MAP feature', () => {
    for (const type of Object.keys(FEATURE_MAP)) {
      expect(isBuildableFeatureType(type), `FEATURE_MAP.${type} must be AI-allowed`).toBe(true);
    }
  });

  // Drift guard: the pure runtime ranges must mirror the real FeatureDefinition
  // params (which live behind the heavy feature graph). This test imports the
  // registry so the lightweight copy can't silently diverge.
  it('stays in sync with the actual FeatureDefinition param ranges', () => {
    for (const [type, ranges] of Object.entries(FEATURE_PARAM_RANGES)) {
      const def = getFeatureDefinition(type as Parameters<typeof getFeatureDefinition>[0]);
      expect(def, `feature def for ${type}`).toBeTruthy();
      for (const [key, r] of Object.entries(ranges)) {
        const p = def!.params.find(pp => pp.key === key);
        expect(p, `${type}.${key} exists in registry`).toBeTruthy();
        expect(p!.min, `${type}.${key}.min`).toBe(r.min);
        expect(p!.max, `${type}.${key}.max`).toBe(r.max);
        expect(p!.default, `${type}.${key}.default`).toBe(r.default);
      }
    }
  });
});
