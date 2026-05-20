import { describe, it, expect } from 'vitest';
import {
  rainbowColour,
  heatmapColour,
  stressToColour,
  colourField,
  type ColormapSettings,
} from './stressColormap';

describe('rainbowColour · endpoints + midpoint', () => {
  it('t=0 → blue', () => {
    const [r, g, b] = rainbowColour(0);
    expect(b).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(0.1);
    expect(g).toBeLessThan(0.1);
  });

  it('t=1 → red', () => {
    const [r, g, b] = rainbowColour(1);
    expect(r).toBeGreaterThan(0.9);
    expect(g).toBeLessThan(0.1);
    expect(b).toBeLessThan(0.1);
  });

  it('t=0.5 → green', () => {
    const [r, g, b] = rainbowColour(0.5);
    expect(g).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(0.1);
    expect(b).toBeLessThan(0.1);
  });
});

describe('heatmapColour · monotonic luminance', () => {
  it('t=0 → black', () => {
    expect(heatmapColour(0)).toEqual([0, 0, 0]);
  });

  it('t=1 → white', () => {
    expect(heatmapColour(1)).toEqual([1, 1, 1]);
  });

  it('luminance increases monotonically with t', () => {
    let prev = 0;
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const [r, g, b] = heatmapColour(t);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      expect(lum).toBeGreaterThanOrEqual(prev);
      prev = lum;
    }
  });
});

describe('stressToColour · range mapping', () => {
  const settings: ColormapSettings = { name: 'rainbow', domain: [0, 100] };

  it('value at min → blue', () => {
    const [r, g, b] = stressToColour(0, settings);
    expect(b).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(0.1);
  });

  it('value above max clamps to red', () => {
    const [r, , b] = stressToColour(9999, settings);
    expect(r).toBeGreaterThan(0.9);
    expect(b).toBeLessThan(0.1);
  });

  it('NaN / Infinity returns grey', () => {
    expect(stressToColour(NaN, settings)).toEqual([0.5, 0.5, 0.5]);
    expect(stressToColour(Infinity, settings)).toEqual([0.5, 0.5, 0.5]);
  });

  it('heatmap respects the name', () => {
    const heat: ColormapSettings = { name: 'heatmap', domain: [0, 1] };
    expect(stressToColour(0, heat)).toEqual([0, 0, 0]);
    expect(stressToColour(1, heat)).toEqual([1, 1, 1]);
  });

  it('banded quantises t into discrete steps', () => {
    const banded: ColormapSettings = { name: 'banded', domain: [0, 100], bands: 4 };
    // Two adjacent values that fall in the same band should yield same colour.
    const a = stressToColour(10, banded);
    const b = stressToColour(15, banded);
    expect(a).toEqual(b);
  });

  it('log scale stretches low values', () => {
    const lin: ColormapSettings = { name: 'rainbow', domain: [1, 1000] };
    const log: ColormapSettings = { name: 'rainbow', domain: [1, 1000], log: true };
    // At value=10, log normalisation t = log10(10) / log10(1000) = 1/3 → green-ish.
    // Linear t = (10-1)/999 ≈ 0.009 → near-blue.
    const linT = stressToColour(10, lin);
    const logT = stressToColour(10, log);
    expect(linT[2]).toBeGreaterThan(logT[2]); // linear stays bluer
  });
});

describe('colourField · bulk', () => {
  it('emits 3 floats per input value', () => {
    const out = colourField([0, 50, 100], { name: 'rainbow', domain: [0, 100] });
    expect(out.length).toBe(9);
  });

  it('matches per-value stressToColour for each entry', () => {
    const settings: ColormapSettings = { name: 'heatmap', domain: [0, 100] };
    const bulk = colourField([25, 75], settings);
    const single0 = stressToColour(25, settings);
    const single1 = stressToColour(75, settings);
    expect(bulk[0]).toBeCloseTo(single0[0]);
    expect(bulk[3]).toBeCloseTo(single1[0]);
  });
});
