import { describe, it, expect } from 'vitest';
import {
  srgbToLinear,
  linearToSrgb,
  srgbToLinearRgb,
  linearToSrgbRgb,
  acesFilmic,
  reinhardTone,
  linearRgbToXyz,
  xyzToLinearRgb,
  xyzToLab,
  labToXyz,
  deltaE76,
  hslToRgb,
  rgbToHsl,
  hexToRgb,
  rgbToHex,
  chromaticAdaptation,
  ILLUMINANTS,
} from './colorManagement';

describe('sRGB ↔ linear', () => {
  it('round-trips a mid value', () => {
    const v = 0.5;
    expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 5);
  });

  it('0 maps to 0', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(linearToSrgb(0)).toBe(0);
  });

  it('1 maps to 1', () => {
    expect(srgbToLinear(1)).toBeCloseTo(1, 4);
    expect(linearToSrgb(1)).toBeCloseTo(1, 4);
  });

  it('rgb form round-trips', () => {
    const c: [number, number, number] = [0.2, 0.5, 0.8];
    const r = linearToSrgbRgb(srgbToLinearRgb(c));
    expect(r[0]).toBeCloseTo(c[0], 5);
  });
});

describe('tone-mapping', () => {
  it('acesFilmic clamps to [0, 1]', () => {
    for (const v of [0, 0.5, 1, 5, 100]) {
      const r = acesFilmic(v);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('reinhardTone saturates toward 1', () => {
    expect(reinhardTone(1000)).toBeCloseTo(1, 2);
    expect(reinhardTone(0)).toBe(0);
  });
});

describe('XYZ ↔ RGB', () => {
  it('white maps to D65-ish XYZ', () => {
    const xyz = linearRgbToXyz([1, 1, 1]);
    expect(xyz[1]).toBeCloseTo(1, 2);
  });

  it('round-trips', () => {
    const rgb: [number, number, number] = [0.4, 0.6, 0.8];
    const back = xyzToLinearRgb(linearRgbToXyz(rgb));
    expect(back[0]).toBeCloseTo(rgb[0], 4);
    expect(back[1]).toBeCloseTo(rgb[1], 4);
    expect(back[2]).toBeCloseTo(rgb[2], 4);
  });
});

describe('XYZ ↔ LAB', () => {
  it('reference white maps to L=100', () => {
    const lab = xyzToLab(ILLUMINANTS.D65!);
    expect(lab[0]).toBeCloseTo(100, 1);
  });

  it('round-trips', () => {
    const xyz = [0.4, 0.5, 0.6] as [number, number, number];
    const back = labToXyz(xyzToLab(xyz));
    expect(back[0]).toBeCloseTo(xyz[0], 4);
  });
});

describe('deltaE76', () => {
  it('identical colors → 0', () => {
    expect(deltaE76([50, 0, 0], [50, 0, 0])).toBe(0);
  });

  it('non-zero for different colors', () => {
    expect(deltaE76([50, 0, 0], [50, 20, 0])).toBeGreaterThan(0);
  });
});

describe('HSL ↔ RGB', () => {
  it('grayscale: s=0 → r=g=b', () => {
    const rgb = hslToRgb([0, 0, 0.5]);
    expect(rgb[0]).toBe(rgb[1]);
    expect(rgb[1]).toBe(rgb[2]);
  });

  it('round-trips through HSL', () => {
    const rgb: [number, number, number] = [0.6, 0.3, 0.8];
    const back = hslToRgb(rgbToHsl(rgb));
    expect(back[0]).toBeCloseTo(rgb[0], 4);
  });

  it('pure red has hue 0', () => {
    const hsl = rgbToHsl([1, 0, 0]);
    expect(hsl[0]).toBeCloseTo(0, 5);
  });
});

describe('Hex ↔ RGB', () => {
  it('roundtrips primary red', () => {
    expect(rgbToHex(hexToRgb('#ff0000'))).toBe('#ff0000');
  });

  it('rgbToHex pads single-digit channels', () => {
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
  });

  it('invalid input → black', () => {
    expect(hexToRgb('not-hex')).toEqual([0, 0, 0]);
  });
});

describe('chromaticAdaptation', () => {
  it('same source + dest is identity', () => {
    const xyz: [number, number, number] = [0.4, 0.5, 0.6];
    const r = chromaticAdaptation(ILLUMINANTS.D65!, ILLUMINANTS.D65!, xyz);
    expect(r[0]).toBeCloseTo(xyz[0], 3);
  });

  it('D65 → D50 shifts color', () => {
    const xyz: [number, number, number] = [0.4, 0.5, 0.6];
    const r = chromaticAdaptation(ILLUMINANTS.D65!, ILLUMINANTS.D50!, xyz);
    expect(r).not.toEqual(xyz);
  });
});

describe('ILLUMINANTS', () => {
  it('D65 has Y=1 (normalized)', () => {
    expect(ILLUMINANTS.D65![1]).toBe(1);
  });

  it('A (incandescent) is warmer than D65', () => {
    expect(ILLUMINANTS.A![0]).toBeGreaterThan(ILLUMINANTS.D65![0]);
  });
});
