import { describe, it, expect } from 'vitest';
import { buildScaleBar, summarize } from './scaleBar';

describe('buildScaleBar', () => {
  it('default options produce non-empty result', () => {
    const r = buildScaleBar();
    expect(r.bands.length).toBeGreaterThan(0);
    expect(r.ticks.length).toBeGreaterThan(0);
    expect(r.labels.length).toBeGreaterThan(0);
  });

  it('real length = drawn × ratio', () => {
    const r = buildScaleBar({ preset: '1:50', drawnLengthMm: 100 });
    expect(r.realLengthMm).toBe(5000);
  });

  it('1:1 has no scale factor', () => {
    const r = buildScaleBar({ preset: '1:1', drawnLengthMm: 50 });
    expect(r.realLengthMm).toBe(50);
  });

  it('alternating black/white bands', () => {
    const r = buildScaleBar({ majorDivisions: 4, subdivisionsInExtension: 0 });
    for (let i = 0; i < 4; i++) {
      expect(r.bands[i]!.fill).toBe(i % 2 === 0 ? 'black' : 'white');
    }
  });

  it('extension subdivisions add ticks to the left', () => {
    const noExt = buildScaleBar({ subdivisionsInExtension: 0 });
    const withExt = buildScaleBar({ subdivisionsInExtension: 5 });
    expect(withExt.ticks.length).toBeGreaterThan(noExt.ticks.length);
  });

  it('major label count = majorDivisions + 1 (+extension)', () => {
    const r = buildScaleBar({ majorDivisions: 4, subdivisionsInExtension: 0, showEndLabels: false });
    expect(r.labels).toHaveLength(5);
  });

  it('showEndLabels appends preset label', () => {
    const r = buildScaleBar({ preset: '1:100', showEndLabels: true });
    const hasPreset = r.labels.some(l => l.text === '1:100');
    expect(hasPreset).toBe(true);
  });

  it('totalLengthMm matches drawnLengthMm', () => {
    const r = buildScaleBar({ drawnLengthMm: 75 });
    expect(r.totalLengthMm).toBe(75);
  });

  it('larger scale → larger real length', () => {
    const small = buildScaleBar({ preset: '1:10' });
    const big = buildScaleBar({ preset: '1:500' });
    expect(big.realLengthMm).toBeGreaterThan(small.realLengthMm);
  });
});

describe('summarize', () => {
  it('reports band/tick/label counts', () => {
    const r = buildScaleBar();
    const s = summarize(r, '1:50');
    expect(s.bandCount).toBe(r.bands.length);
    expect(s.tickCount).toBe(r.ticks.length);
    expect(s.labelCount).toBe(r.labels.length);
  });

  it('scale ratio extracted', () => {
    const s = summarize(buildScaleBar({ preset: '1:200' }), '1:200');
    expect(s.scaleRatio).toBe(200);
  });
});
