import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SSAO,
  SSAO_PRESETS,
  sanitiseSsao,
  generateHemisphereKernel,
} from './ssaoConfig';

describe('SSAO_PRESETS · quality tiers', () => {
  it('preview / standard / hiQuality have ascending sample counts', () => {
    expect(SSAO_PRESETS.preview.samples).toBeLessThan(SSAO_PRESETS.standard.samples);
    expect(SSAO_PRESETS.standard.samples).toBeLessThan(SSAO_PRESETS.hiQuality.samples);
  });

  it('hi-quality intensity ≥ standard ≥ preview', () => {
    expect(SSAO_PRESETS.hiQuality.intensity).toBeGreaterThanOrEqual(SSAO_PRESETS.standard.intensity);
    expect(SSAO_PRESETS.standard.intensity).toBeGreaterThanOrEqual(SSAO_PRESETS.preview.intensity);
  });
});

describe('sanitiseSsao', () => {
  it('clamps samples to [1, 256]', () => {
    expect(sanitiseSsao({ samples: -10 }).samples).toBe(1);
    expect(sanitiseSsao({ samples: 999 }).samples).toBe(256);
    expect(sanitiseSsao({ samples: 33 }).samples).toBe(33);
  });

  it('rounds non-integer samples', () => {
    expect(sanitiseSsao({ samples: 32.7 }).samples).toBe(33);
  });

  it('clamps radius / bias / intensity to safe ranges', () => {
    expect(sanitiseSsao({ radiusMm: 0 }).radiusMm).toBeGreaterThanOrEqual(0.01);
    expect(sanitiseSsao({ radiusMm: 1e6 }).radiusMm).toBeLessThanOrEqual(100);
    expect(sanitiseSsao({ bias: -1 }).bias).toBe(0);
    expect(sanitiseSsao({ bias: 5 }).bias).toBe(1);
    expect(sanitiseSsao({ intensity: 100 }).intensity).toBe(4);
    expect(sanitiseSsao({ intensity: -5 }).intensity).toBe(0);
  });

  it('preserves valid fields verbatim', () => {
    const r = sanitiseSsao({ samples: 16, radiusMm: 1.5, bias: 0.005, intensity: 1.2 });
    expect(r.samples).toBe(16);
    expect(r.radiusMm).toBe(1.5);
    expect(r.bias).toBe(0.005);
    expect(r.intensity).toBe(1.2);
  });

  it('defaults from DEFAULT_SSAO when fields omitted', () => {
    const r = sanitiseSsao({});
    expect(r).toEqual(DEFAULT_SSAO);
  });
});

describe('generateHemisphereKernel · determinism', () => {
  it('same seed produces same kernel across runs', () => {
    const a = generateHemisphereKernel(16, 42);
    const b = generateHemisphereKernel(16, 42);
    expect(a).toEqual(b);
  });

  it('different seeds produce different kernels', () => {
    const a = generateHemisphereKernel(8, 1);
    const b = generateHemisphereKernel(8, 2);
    expect(a).not.toEqual(b);
  });

  it('produces exactly N samples', () => {
    expect(generateHemisphereKernel(7, 12345)).toHaveLength(7);
    expect(generateHemisphereKernel(64, 12345)).toHaveLength(64);
  });
});

describe('generateHemisphereKernel · distribution', () => {
  it('every sample has z ≥ 0 (upper hemisphere)', () => {
    const kernel = generateHemisphereKernel(50, 7);
    for (const [, , z] of kernel) {
      expect(z).toBeGreaterThanOrEqual(0);
    }
  });

  it('samples have non-zero magnitude', () => {
    const kernel = generateHemisphereKernel(20, 7);
    for (const [x, y, z] of kernel) {
      const r = Math.sqrt(x * x + y * y + z * z);
      expect(r).toBeGreaterThan(0);
    }
  });

  it('later samples have larger radius (accelerating distribution)', () => {
    const kernel = generateHemisphereKernel(20, 7);
    const r = (s: [number, number, number]) => Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
    // Compare first and last quartile means.
    const headMean = r(kernel[2]);
    const tailMean = r(kernel[18]);
    expect(tailMean).toBeGreaterThan(headMean);
  });
});
