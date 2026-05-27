import { describe, it, expect } from 'vitest';
import {
  perlin2D,
  fractalNoise,
  worley2D,
  makePerlinTexture,
  makeCheckerTexture,
  makeStripeTexture,
  makeBrickTexture,
  makeWorleyTexture,
  makeWoodGrainTexture,
  makeMarbleTexture,
  multiplyTextures,
  mixTextures,
  bakeTexture,
} from './proceduralTexture';

describe('perlin2D', () => {
  it('returns value in approximately [-1, 1]', () => {
    for (let i = 0; i < 50; i++) {
      const v = perlin2D(i * 0.7, i * 1.3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  it('deterministic for same input', () => {
    expect(perlin2D(1.5, 2.5)).toBe(perlin2D(1.5, 2.5));
  });

  it('different inputs give different outputs', () => {
    expect(perlin2D(0.1, 0.2)).not.toBe(perlin2D(5, 5));
  });
});

describe('fractalNoise', () => {
  it('multiple octaves average around 0', () => {
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += fractalNoise(i * 0.13, i * 0.27);
    expect(Math.abs(sum / 100)).toBeLessThan(0.5);
  });
});

describe('worley2D', () => {
  it('returns non-negative distance', () => {
    expect(worley2D(0.3, 0.7)).toBeGreaterThanOrEqual(0);
  });

  it('deterministic', () => {
    expect(worley2D(1.5, 2.5)).toBe(worley2D(1.5, 2.5));
  });
});

describe('makeCheckerTexture', () => {
  it('returns one of the two colors', () => {
    const t = makeCheckerTexture(8);
    const c = t(0.1, 0.1);
    expect(c[0] === 1 || c[0] === 0).toBe(true);
  });

  it('adjacent cells alternate', () => {
    const t = makeCheckerTexture(4, [1, 0, 0], [0, 0, 1]);
    expect(t(0.1, 0.1)).not.toEqual(t(0.4, 0.1));
  });
});

describe('makePerlinTexture', () => {
  it('interpolates between two colors', () => {
    const t = makePerlinTexture(2, [0, 0, 0], [1, 1, 1]);
    const c = t(0.5, 0.5);
    expect(c[0]).toBeGreaterThanOrEqual(0);
    expect(c[0]).toBeLessThanOrEqual(1);
  });
});

describe('makeStripeTexture', () => {
  it('horizontal stripes vary in v', () => {
    const t = makeStripeTexture(10, 'horizontal');
    expect(t(0.5, 0.05)).not.toEqual(t(0.5, 0.15));
  });

  it('vertical stripes vary in u', () => {
    const t = makeStripeTexture(10, 'vertical');
    expect(t(0.05, 0.5)).not.toEqual(t(0.15, 0.5));
  });
});

describe('makeBrickTexture', () => {
  it('produces both brick and mortar colors', () => {
    const t = makeBrickTexture(6, 4);
    // Sample a 20×20 grid; both colors should appear.
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const c = t(i / 20, j / 20);
        seen.add(c.join(','));
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('makeWorleyTexture', () => {
  it('returns RGB in [0, 1]', () => {
    const t = makeWorleyTexture(0.2);
    const c = t(0.5, 0.5);
    expect(c[0]).toBeGreaterThanOrEqual(0);
    expect(c[0]).toBeLessThanOrEqual(1);
  });
});

describe('makeWoodGrainTexture', () => {
  it('returns RGB in [0, 1]', () => {
    const t = makeWoodGrainTexture();
    const c = t(0.5, 0.5);
    expect(c[0]).toBeGreaterThanOrEqual(0);
    expect(c[0]).toBeLessThanOrEqual(1);
  });
});

describe('makeMarbleTexture', () => {
  it('produces variation', () => {
    const t = makeMarbleTexture();
    const samples = [t(0.1, 0.1), t(0.5, 0.5), t(0.9, 0.9)];
    const same = samples.every(s => s[0] === samples[0]![0]);
    expect(same).toBe(false);
  });
});

describe('multiplyTextures', () => {
  it('multiplies channels', () => {
    const a = makeCheckerTexture(2, [0.5, 0.5, 0.5], [1, 1, 1]);
    const b = makeStripeTexture(2, 'horizontal', [0.5, 0.5, 0.5], [1, 1, 1]);
    const t = multiplyTextures(a, b);
    const c = t(0.5, 0.5);
    expect(c[0]).toBeLessThanOrEqual(1);
  });
});

describe('mixTextures', () => {
  it('mix=0 → first texture', () => {
    const a = makeCheckerTexture(2, [0, 0, 0], [1, 1, 1]);
    const b = makeCheckerTexture(2, [1, 0, 0], [0, 0, 1]);
    const t = mixTextures(a, b, 0);
    expect(t(0.1, 0.1)).toEqual(a(0.1, 0.1));
  });

  it('mix=1 → second texture', () => {
    const a = makeCheckerTexture(2, [0, 0, 0], [1, 1, 1]);
    const b = makeCheckerTexture(2, [1, 0, 0], [0, 0, 1]);
    const t = mixTextures(a, b, 1);
    expect(t(0.1, 0.1)).toEqual(b(0.1, 0.1));
  });
});

describe('bakeTexture', () => {
  it('produces RGBA byte array', () => {
    const t = makeCheckerTexture(4);
    const baked = bakeTexture(t, 16, 16);
    expect(baked.data.length).toBe(16 * 16 * 4);
  });

  it('alpha channel = 255', () => {
    const t = makePerlinTexture(2);
    const baked = bakeTexture(t, 4, 4);
    for (let i = 3; i < baked.data.length; i += 4) {
      expect(baked.data[i]).toBe(255);
    }
  });
});
