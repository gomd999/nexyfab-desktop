import { describe, it, expect } from 'vitest';
import {
  sizeSeat,
  recommendRoughness,
  preloadRecommendation,
  summarize,
  type BearingSize,
} from './bearingSeatSizer';

const bearing: BearingSize = { innerMm: 25, outerMm: 52, widthMm: 15 };

describe('sizeSeat', () => {
  it('defaults: rotating-inner medium → k6 / J7', () => {
    const r = sizeSeat(bearing);
    expect(r.shaftTolerance).toBe('k6');
    expect(r.housingTolerance).toBe('J7');
  });

  it('heavy load uses tighter shaft', () => {
    const r = sizeSeat(bearing, { series: 'deep-groove', loadDirection: 'rotating-inner', loadClass: 'heavy', highTemp: false });
    expect(r.shaftTolerance).toBe('n6');
  });

  it('rotating-outer flips housing tolerance', () => {
    const r = sizeSeat(bearing, { series: 'deep-groove', loadDirection: 'rotating-outer', loadClass: 'medium', highTemp: false });
    expect(r.housingTolerance).toBe('K7');
  });

  it('high temp warns + loosens shaft', () => {
    const r = sizeSeat(bearing, { series: 'deep-groove', loadDirection: 'rotating-inner', loadClass: 'medium', highTemp: true });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('tapered-roller → shoulder-and-nut retention', () => {
    const r = sizeSeat(bearing, { series: 'tapered-roller', loadDirection: 'rotating-inner', loadClass: 'medium', highTemp: false });
    expect(r.retentionMethod).toBe('shoulder-and-nut');
  });

  it('rotating-outer → shoulder-and-cap', () => {
    const r = sizeSeat(bearing, { series: 'deep-groove', loadDirection: 'rotating-outer', loadClass: 'medium', highTemp: false });
    expect(r.retentionMethod).toBe('shoulder-and-cap');
  });

  it('shoulder height > 0', () => {
    const r = sizeSeat(bearing);
    expect(r.shoulderHeightMm).toBeGreaterThan(0);
  });

  it('recommended dims match bearing', () => {
    const r = sizeSeat(bearing);
    expect(r.recommendedShaftDimMm).toBe(bearing.innerMm);
    expect(r.recommendedHousingDimMm).toBe(bearing.outerMm);
  });

  it('light load → snap-ring retention', () => {
    const r = sizeSeat(bearing, { series: 'deep-groove', loadDirection: 'rotating-inner', loadClass: 'light', highTemp: false });
    expect(r.retentionMethod).toBe('snap-ring');
  });
});

describe('recommendRoughness', () => {
  it('heavy load → finer Ra', () => {
    const heavy = recommendRoughness({ loadClass: 'heavy' });
    const light = recommendRoughness({ loadClass: 'light' });
    expect(heavy.shaftRaMicron).toBeLessThan(light.shaftRaMicron);
  });

  it('housing rougher than shaft', () => {
    const r = recommendRoughness();
    expect(r.housingRaMicron).toBeGreaterThan(r.shaftRaMicron);
  });
});

describe('preloadRecommendation', () => {
  it('null for deep-groove', () => {
    expect(preloadRecommendation(bearing, { series: 'deep-groove' })).toBeNull();
  });

  it('positive force for angular-contact', () => {
    const r = preloadRecommendation(bearing, { series: 'angular-contact' });
    expect(r?.preloadN).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports fit classes', () => {
    const r = sizeSeat(bearing);
    const s = summarize(r);
    expect(s.housingTolerance).toBe(r.housingTolerance);
    expect(s.shaftTolerance).toBe(r.shaftTolerance);
  });
});
