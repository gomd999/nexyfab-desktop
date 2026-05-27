import { describe, it, expect } from 'vitest';
import {
  decodeGrayCode,
  decodePhaseShift,
  unwrapPhase1D,
  disparityToDepth,
  summarizeDecoding,
  generateGrayCodePatterns,
} from './structuredLight';

describe('decodeGrayCode', () => {
  it('decodes a simple 2-bit pattern', () => {
    // 4 pixels, 2 bits encode columns 0..3.
    const images = {
      width: 4, height: 1,
      brightestPixels: new Float32Array([1, 1, 1, 1]),
      darkestPixels: new Float32Array([0, 0, 0, 0]),
      patternImages: [
        new Float32Array([0, 0, 1, 1]), // MSB
        new Float32Array([0, 1, 1, 0]), // LSB (gray code)
      ],
    };
    const r = decodeGrayCode(images);
    // Gray code 00→0, 01→1, 11→2, 10→3.
    expect(r.disparity[0]).toBe(0);
    expect(r.disparity[1]).toBe(1);
    expect(r.disparity[2]).toBe(2);
    expect(r.disparity[3]).toBe(3);
  });

  it('low contrast → reliability 0', () => {
    const images = {
      width: 2, height: 1,
      brightestPixels: new Float32Array([0.5, 0.5]),
      darkestPixels: new Float32Array([0.45, 0.45]),
      patternImages: [new Float32Array([0.5, 0.5])],
    };
    const r = decodeGrayCode(images, { contrastThreshold: 0.1 });
    expect(r.reliability[0]).toBe(0);
    expect(r.disparity[0]).toBe(-1);
  });
});

describe('decodePhaseShift', () => {
  it('decodes a uniform sine pattern', () => {
    const images = {
      width: 4, height: 1,
      phase0: new Float32Array([0.5, 0.5, 0.5, 0.5]),
      phase120: new Float32Array([0.5, 0.5, 0.5, 0.5]),
      phase240: new Float32Array([0.5, 0.5, 0.5, 0.5]),
    };
    // Identical phases → zero modulation → reliability 0.
    const r = decodePhaseShift(images);
    expect(r.reliability[0]).toBe(0);
  });

  it('returns phase in [0, 1]', () => {
    const images = {
      width: 1, height: 1,
      phase0: new Float32Array([0.8]),
      phase120: new Float32Array([0.4]),
      phase240: new Float32Array([0.2]),
    };
    const r = decodePhaseShift(images);
    expect(r.disparity[0]).toBeGreaterThanOrEqual(0);
    expect(r.disparity[0]).toBeLessThanOrEqual(1);
  });
});

describe('unwrapPhase1D', () => {
  it('unwraps a phase ramp', () => {
    const wrapped = new Float32Array([0.1, 0.3, 0.5, 0.7, 0.9, 0.1, 0.3]);
    const r = unwrapPhase1D(wrapped);
    expect(r[6]).toBeGreaterThan(r[0]!);
  });

  it('single sample preserved', () => {
    expect(unwrapPhase1D(new Float32Array([0.5]))[0]).toBe(0.5);
  });
});

describe('disparityToDepth', () => {
  it('produces finite depth for valid pixels', () => {
    const map = {
      width: 2, height: 1,
      disparity: new Float32Array([0.1, 0.5]),
      reliability: new Float32Array([1, 1]),
    };
    const depth = disparityToDepth(map, {
      baselineMm: 100, focalPx: 500, projectorColumns: 1024,
    });
    for (const d of depth) expect(isFinite(d)).toBe(true);
  });

  it('invalid disparity → 0', () => {
    const map = {
      width: 1, height: 1,
      disparity: new Float32Array([-1]),
      reliability: new Float32Array([0]),
    };
    const depth = disparityToDepth(map, { baselineMm: 100, focalPx: 500, projectorColumns: 1024 });
    expect(depth[0]).toBe(0);
  });
});

describe('summarizeDecoding', () => {
  it('reports valid fraction', () => {
    const map = {
      width: 4, height: 1,
      disparity: new Float32Array([0, 1, -1, 3]),
      reliability: new Float32Array([1, 0.8, 0, 0.9]),
    };
    const s = summarizeDecoding(map);
    expect(s.validPixels).toBe(3);
    expect(s.validFraction).toBeCloseTo(0.75, 5);
  });

  it('empty input → 0', () => {
    const map = {
      width: 0, height: 0,
      disparity: new Float32Array(0),
      reliability: new Float32Array(0),
    };
    expect(summarizeDecoding(map).validFraction).toBe(0);
  });
});

describe('generateGrayCodePatterns', () => {
  it('produces N patterns of given column count', () => {
    const patterns = generateGrayCodePatterns(8, 3);
    expect(patterns).toHaveLength(3);
    for (const p of patterns) expect(p.length).toBe(8);
  });

  it('pattern bytes are 0 or 255', () => {
    const patterns = generateGrayCodePatterns(8, 3);
    for (const p of patterns) {
      for (const b of p) expect(b === 0 || b === 255).toBe(true);
    }
  });
});
