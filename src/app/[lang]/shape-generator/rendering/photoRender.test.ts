import { describe, it, expect } from 'vitest';
import {
  PRESETS, resolveResolution, estimateRenderTime, clampConfig,
  type PathTracingConfig,
} from './pathTracingConfig';
import {
  OVERRIDE_PRESETS, resolveBodyMaterial, mergePbr, adjust,
  type MaterialOverride,
} from './materialOverride';

describe('PathTracingConfig presets', () => {
  it('has 5 presets', () => {
    expect(Object.keys(PRESETS)).toHaveLength(5);
  });

  it('quality scales with preset', () => {
    expect(PRESETS.preview.samplesPerPixel).toBeLessThan(PRESETS.standard.samplesPerPixel);
    expect(PRESETS.standard.samplesPerPixel).toBeLessThan(PRESETS.production.samplesPerPixel);
  });

  it('resolveResolution 16:9 with 1920 long-side returns 1920x1080', () => {
    const [w, h] = resolveResolution(PRESETS.standard);
    expect(w).toBe(1920);
    expect(h).toBe(1080);
  });

  it('resolveResolution 9:16 portrait returns wider:height', () => {
    const portrait: PathTracingConfig = { ...PRESETS.draft, aspectRatio: '9:16' };
    const [w, h] = resolveResolution(portrait);
    expect(h).toBeGreaterThan(w);
  });

  it('estimateRenderTime is monotonic with samples', () => {
    const a = estimateRenderTime(PRESETS.preview);
    const b = estimateRenderTime(PRESETS.production);
    expect(b).toBeGreaterThan(a);
  });

  it('clampConfig forces safe values', () => {
    const insane: PathTracingConfig = {
      ...PRESETS.standard, samplesPerPixel: 999999, maxBounces: 100, exposure: 99,
    };
    const r = clampConfig(insane);
    expect(r.samplesPerPixel).toBeLessThanOrEqual(16384);
    expect(r.maxBounces).toBeLessThanOrEqual(32);
    expect(r.exposure).toBeLessThanOrEqual(10);
  });
});

describe('OVERRIDE_PRESETS', () => {
  it('contains 10 presets', () => {
    expect(Object.keys(OVERRIDE_PRESETS)).toHaveLength(10);
  });

  it('gold has high metalness + low roughness', () => {
    const g = OVERRIDE_PRESETS.gold;
    expect(g.metalness).toBe(1.0);
    expect(g.roughness).toBeLessThan(0.3);
  });

  it('glass has transmission set', () => {
    expect(OVERRIDE_PRESETS.glass.transmission).toBeGreaterThan(0.9);
  });

  it('plastic has clearcoat', () => {
    expect(OVERRIDE_PRESETS['plastic-white'].clearcoat).toBe(1.0);
  });
});

describe('resolveBodyMaterial', () => {
  it('uses preset when no perBody override', () => {
    const o: MaterialOverride = { preset: 'gold' };
    const m = resolveBodyMaterial(o, 'body1');
    expect(m.metalness).toBe(1.0);
  });

  it('per-body override wins', () => {
    const o: MaterialOverride = {
      preset: 'gold',
      perBody: { body1: { baseColor: [0, 0, 0], metalness: 0, roughness: 1 } },
    };
    const m = resolveBodyMaterial(o, 'body1');
    expect(m.metalness).toBe(0);
  });
});

describe('mergePbr', () => {
  it('patch overrides individual fields', () => {
    const merged = mergePbr(OVERRIDE_PRESETS.gold, { roughness: 0.5 });
    expect(merged.metalness).toBe(1.0); // kept from gold
    expect(merged.roughness).toBe(0.5);  // patched
  });
});

describe('adjust', () => {
  it('clamps roughness in [0, 1]', () => {
    const r = adjust(OVERRIDE_PRESETS.gold, { roughnessDelta: 5 });
    expect(r.roughness).toBeLessThanOrEqual(1);
  });

  it('metalness delta works', () => {
    const r = adjust(OVERRIDE_PRESETS.clay, { metalnessDelta: 0.5 });
    expect(r.metalness).toBe(0.5);
  });
});
