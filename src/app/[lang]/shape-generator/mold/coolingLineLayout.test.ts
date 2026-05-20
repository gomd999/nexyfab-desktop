import { describe, it, expect } from 'vitest';
import {
  generateLayout,
  estimateHeatRemovalKw,
  checkUniformity,
  summarize,
  WATER,
  type CavityBounds,
} from './coolingLineLayout';

const cavity: CavityBounds = { lengthMm: 200, widthMm: 100, depthFromCavityMm: 12 };

describe('generateLayout', () => {
  it('produces multiple parallel channels for normal cavity', () => {
    const r = generateLayout(cavity, WATER, { diameterMm: 10, targetReynolds: 10000, scheme: 'parallel' });
    expect(r.channels.length).toBeGreaterThan(1);
  });

  it('all channels at same diameter', () => {
    const r = generateLayout(cavity, WATER, { diameterMm: 8, targetReynolds: 10000, scheme: 'parallel' });
    expect(r.channels.every(c => c.diameterMm === 8)).toBe(true);
  });

  it('channel spacing follows 3×diameter pitch', () => {
    const r = generateLayout(cavity, WATER, { diameterMm: 10, targetReynolds: 10000, scheme: 'parallel' });
    if (r.channels.length >= 2) {
      const pitch = r.channels[1]!.start.y - r.channels[0]!.start.y;
      expect(pitch).toBeCloseTo(30, 1);
    }
  });

  it('flow rate is positive', () => {
    const r = generateLayout(cavity, WATER, { diameterMm: 10, targetReynolds: 10000, scheme: 'parallel' });
    expect(r.flowRateLpm).toBeGreaterThan(0);
  });

  it('parallel scheme has higher total flow than series', () => {
    const par = generateLayout(cavity, WATER, { diameterMm: 10, targetReynolds: 10000, scheme: 'parallel' });
    const ser = generateLayout(cavity, WATER, { diameterMm: 10, targetReynolds: 10000, scheme: 'series' });
    expect(par.flowRateLpm).toBeGreaterThan(ser.flowRateLpm);
  });

  it('pressure drop reported', () => {
    const r = generateLayout(cavity, WATER, { diameterMm: 10, targetReynolds: 10000, scheme: 'series' });
    expect(r.pressureDropKpa).toBeGreaterThan(0);
  });

  it('narrow cavity → single channel + recommendation', () => {
    const narrow: CavityBounds = { lengthMm: 100, widthMm: 20, depthFromCavityMm: 12 };
    const r = generateLayout(narrow, WATER, { diameterMm: 10, targetReynolds: 10000, scheme: 'parallel' });
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('laminar Re → warning', () => {
    const r = generateLayout(cavity, WATER, { diameterMm: 10, targetReynolds: 2000, scheme: 'parallel' });
    expect(r.recommendations.some(rec => rec.includes('laminar') || rec.includes('Re'))).toBe(true);
  });

  it('deep channel → warning', () => {
    const deep: CavityBounds = { lengthMm: 200, widthMm: 100, depthFromCavityMm: 30 };
    const r = generateLayout(deep, WATER, { diameterMm: 10, targetReynolds: 10000, scheme: 'parallel' });
    expect(r.recommendations.some(rec => rec.includes('cooling effectiveness'))).toBe(true);
  });
});

describe('estimateHeatRemovalKw', () => {
  it('higher dT → more heat removed', () => {
    const r = generateLayout(cavity);
    const low = estimateHeatRemovalKw(r, WATER, 20, 22);
    const high = estimateHeatRemovalKw(r, WATER, 20, 30);
    expect(high).toBeGreaterThan(low);
  });

  it('zero dT → zero heat removal', () => {
    const r = generateLayout(cavity);
    expect(estimateHeatRemovalKw(r, WATER, 25, 25)).toBe(0);
  });
});

describe('checkUniformity', () => {
  it('within target → true', () => {
    const r = generateLayout(cavity);
    expect(checkUniformity(r, 3, 2)).toBe(true);
  });

  it('over target → false', () => {
    const r = generateLayout(cavity);
    expect(checkUniformity(r, 1, 2)).toBe(false);
  });

  it('single channel always fails', () => {
    const narrow: CavityBounds = { lengthMm: 100, widthMm: 20, depthFromCavityMm: 12 };
    const r = generateLayout(narrow);
    expect(checkUniformity(r, 3, 1)).toBe(false);
  });
});

describe('summarize', () => {
  it('reports counts + flow', () => {
    const r = generateLayout(cavity);
    const s = summarize(r);
    expect(s.channelCount).toBeGreaterThan(0);
    expect(s.flowRateLpm).toBeGreaterThan(0);
  });
});
