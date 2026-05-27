import { describe, it, expect } from 'vitest';
import {
  linear,
  reinhardExtended,
  acesFilmic,
  applyToneMapping,
  applyToneMappingRGB,
  exposureMultiplier,
  DEFAULT_TONE_MAPPING,
} from './toneMapping';

describe('linear', () => {
  it('clamps to [0, 1]', () => {
    expect(linear(0.5)).toBe(0.5);
    expect(linear(2)).toBe(1);
    expect(linear(-0.5)).toBe(0);
  });
});

describe('reinhardExtended', () => {
  it('zero maps to zero, very large maps to 1', () => {
    expect(reinhardExtended(0, 4)).toBe(0);
    expect(reinhardExtended(1e9, 4)).toBeLessThanOrEqual(1);
  });

  it('mid-range value sits between 0 and 1', () => {
    const out = reinhardExtended(1.0, 4);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(1);
  });

  it('higher whitePoint preserves more highlight detail', () => {
    const c = 3.0;
    const tight = reinhardExtended(c, 2);
    const loose = reinhardExtended(c, 10);
    expect(loose).toBeLessThan(tight);
  });
});

describe('acesFilmic', () => {
  it('zero maps to zero', () => {
    expect(acesFilmic(0)).toBe(0);
  });

  it('saturates large inputs near 1', () => {
    expect(acesFilmic(100)).toBeGreaterThan(0.9);
    expect(acesFilmic(100)).toBeLessThanOrEqual(1);
  });

  it('mid-grey (~0.18 linear) lands in the upper mid-tone range', () => {
    const grey = acesFilmic(0.18);
    expect(grey).toBeGreaterThan(0.1);
    expect(grey).toBeLessThan(0.5);
  });

  it('is monotonic — larger linear input ⇒ larger output', () => {
    let prev = acesFilmic(0.01);
    for (const v of [0.05, 0.1, 0.5, 1.0, 2.0, 4.0]) {
      const cur = acesFilmic(v);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe('exposureMultiplier', () => {
  it('0 EV = 1×', () => {
    expect(exposureMultiplier(0)).toBe(1);
  });

  it('+1 EV doubles, -1 EV halves', () => {
    expect(exposureMultiplier(1)).toBe(2);
    expect(exposureMultiplier(-1)).toBe(0.5);
  });
});

describe('applyToneMapping', () => {
  it('applies exposure before operator', () => {
    // Linear op at 0.5 input × exposure +1 EV (2×) → clamped 1.
    expect(applyToneMapping(0.5, { op: 'linear', exposureEv: 1 })).toBe(1);
  });

  it('respects the chosen operator', () => {
    expect(applyToneMapping(1, { op: 'linear', exposureEv: 0 })).toBe(1);
    expect(applyToneMapping(1, { op: 'acesFilmic', exposureEv: 0 })).toBeLessThan(1);
  });

  it('uses whitePoint for Reinhard Extended', () => {
    const tight = applyToneMapping(2, { op: 'reinhardExtended', exposureEv: 0, whitePoint: 1 });
    const loose = applyToneMapping(2, { op: 'reinhardExtended', exposureEv: 0, whitePoint: 10 });
    expect(loose).toBeLessThan(tight);
  });

  it('defaults whitePoint to 4.0 when omitted', () => {
    const explicit = applyToneMapping(2, { op: 'reinhardExtended', exposureEv: 0, whitePoint: 4 });
    const implicit = applyToneMapping(2, { op: 'reinhardExtended', exposureEv: 0 });
    expect(implicit).toBeCloseTo(explicit, 6);
  });
});

describe('applyToneMappingRGB', () => {
  it('applies the same operator per channel', () => {
    const [r, g, b] = applyToneMappingRGB([0.5, 0.5, 0.5], DEFAULT_TONE_MAPPING);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('preserves relative channel ordering', () => {
    const [r, g, b] = applyToneMappingRGB([0.1, 0.5, 1.0], DEFAULT_TONE_MAPPING);
    expect(r).toBeLessThan(g);
    expect(g).toBeLessThan(b);
  });
});

describe('DEFAULT_TONE_MAPPING', () => {
  it('defaults to ACES Filmic at 0 EV', () => {
    expect(DEFAULT_TONE_MAPPING.op).toBe('acesFilmic');
    expect(DEFAULT_TONE_MAPPING.exposureEv).toBe(0);
  });
});
