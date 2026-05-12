import { describe, it, expect } from 'vitest';
import { METRIC_FASTENERS, METRIC_SIZES, lookupMetric, bosl2Spec } from '../isoFasteners';

describe('ISO metric fastener catalog', () => {
  it('covers M3 through M16', () => {
    expect(METRIC_SIZES).toEqual(['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M14', 'M16']);
  });

  it('coarse pitch matches ISO 261', () => {
    // Spot-check standard values.
    expect(METRIC_FASTENERS.M3.pitch).toBe(0.5);
    expect(METRIC_FASTENERS.M8.pitch).toBe(1.25);
    expect(METRIC_FASTENERS.M16.pitch).toBe(2.0);
  });

  it('hex across-flats follows DIN 933 / DIN 934', () => {
    expect(METRIC_FASTENERS.M6.hexAcrossFlats).toBe(10);
    expect(METRIC_FASTENERS.M8.hexAcrossFlats).toBe(13);
    expect(METRIC_FASTENERS.M12.hexAcrossFlats).toBe(19);
  });

  it('clearance hole is larger than nominal, tap hole is smaller', () => {
    for (const size of METRIC_SIZES) {
      const f = METRIC_FASTENERS[size];
      expect(f.clearanceHole).toBeGreaterThan(f.d);
      expect(f.tapHole).toBeLessThan(f.d);
    }
  });

  it('lookupMetric is case-insensitive', () => {
    expect(lookupMetric('m8')?.pitch).toBe(1.25);
    expect(lookupMetric('M8')?.pitch).toBe(1.25);
    expect(lookupMetric('m99')).toBeNull();
  });

  it('bosl2Spec returns BOSL2-formatted string', () => {
    expect(bosl2Spec('M8', 30)).toBe('M8x1.25,30');
    expect(bosl2Spec('M3', 10)).toBe('M3x0.5,10');
    expect(bosl2Spec('M99', 10)).toBeNull();
  });
});
