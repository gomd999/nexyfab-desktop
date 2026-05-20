import { describe, it, expect } from 'vitest';
import {
  QUALITY_BUNDLES,
  resolveQualityBundle,
  overrideQualityBundle,
} from './qualityPresets';

describe('QUALITY_BUNDLES · tier ordering', () => {
  it('pixelRatio ascending: preview < standard < hiQuality', () => {
    expect(QUALITY_BUNDLES.preview.pixelRatio).toBeLessThan(QUALITY_BUNDLES.standard.pixelRatio);
    expect(QUALITY_BUNDLES.standard.pixelRatio).toBeLessThan(QUALITY_BUNDLES.hiQuality.pixelRatio);
  });

  it('MSAA ascending', () => {
    expect(QUALITY_BUNDLES.preview.msaa).toBeLessThan(QUALITY_BUNDLES.hiQuality.msaa);
  });

  it('shadowMapSize ascending', () => {
    expect(QUALITY_BUNDLES.preview.shadowMapSize).toBeLessThan(QUALITY_BUNDLES.standard.shadowMapSize);
    expect(QUALITY_BUNDLES.standard.shadowMapSize).toBeLessThan(QUALITY_BUNDLES.hiQuality.shadowMapSize);
  });

  it('frameBudgetMs ascending (hi-quality allows longer frames)', () => {
    expect(QUALITY_BUNDLES.preview.frameBudgetMs).toBeLessThan(QUALITY_BUNDLES.hiQuality.frameBudgetMs);
  });
});

describe('QUALITY_BUNDLES · feature gating', () => {
  it('preview disables SSAO / bloom / DoF', () => {
    const p = QUALITY_BUNDLES.preview;
    expect(p.ssaoEnabled).toBe(false);
    expect(p.bloomEnabled).toBe(false);
    expect(p.dofEnabled).toBe(false);
  });

  it('standard enables SSAO + bloom but not DoF', () => {
    const s = QUALITY_BUNDLES.standard;
    expect(s.ssaoEnabled).toBe(true);
    expect(s.bloomEnabled).toBe(true);
    expect(s.dofEnabled).toBe(false);
  });

  it('hi-quality enables everything', () => {
    const h = QUALITY_BUNDLES.hiQuality;
    expect(h.ssaoEnabled).toBe(true);
    expect(h.bloomEnabled).toBe(true);
    expect(h.dofEnabled).toBe(true);
  });
});

describe('resolveQualityBundle', () => {
  it('returns the bundle for known tier strings', () => {
    expect(resolveQualityBundle('preview').tier).toBe('preview');
    expect(resolveQualityBundle('hiQuality').tier).toBe('hiQuality');
  });

  it('falls back to standard for unknown strings', () => {
    expect(resolveQualityBundle('ludicrous').tier).toBe('standard');
    expect(resolveQualityBundle('').tier).toBe('standard');
  });
});

describe('overrideQualityBundle', () => {
  it('overrides top-level fields', () => {
    const base = QUALITY_BUNDLES.standard;
    const out = overrideQualityBundle(base, { bloomEnabled: false });
    expect(out.bloomEnabled).toBe(false);
    expect(out.ssaoEnabled).toBe(true); // unchanged
  });

  it('deep-merges sub-objects (ssao / bloom / dof / pmrem)', () => {
    const base = QUALITY_BUNDLES.standard;
    const out = overrideQualityBundle(base, {
      bloom: { intensity: 0.1, threshold: 1.2, softKnee: 0.5, iterations: 5 },
    });
    expect(out.bloom.intensity).toBe(0.1);
    expect(out.bloom.iterations).toBe(5);
    // SSAO untouched.
    expect(out.ssao).toEqual(base.ssao);
  });

  it('does not mutate the base bundle', () => {
    const base = QUALITY_BUNDLES.standard;
    const beforeIntensity = base.bloom.intensity;
    overrideQualityBundle(base, { bloom: { ...base.bloom, intensity: 0.01 } });
    expect(base.bloom.intensity).toBe(beforeIntensity);
  });
});
