import { describe, it, expect } from 'vitest';
import { estimateTime, formatMinutes } from './cuttingTime';

describe('estimateTime', () => {
  it('cut length / cut feed = cut minutes', () => {
    const r = estimateTime(
      { cutLengthMm: 500, rapidLengthMm: 0 },
      { cutFeedMmPerMin: 1000, rapidFeedMmPerMin: 5000 },
    );
    expect(r.cutMinutes).toBeCloseTo(0.5, 4);
  });

  it('rapid length / rapid feed = rapid minutes', () => {
    const r = estimateTime(
      { cutLengthMm: 0, rapidLengthMm: 5000 },
      { cutFeedMmPerMin: 1000, rapidFeedMmPerMin: 5000 },
    );
    expect(r.rapidMinutes).toBeCloseTo(1, 4);
  });

  it('plunge subtracts from cut and uses plunge feed', () => {
    const r = estimateTime(
      { cutLengthMm: 100, rapidLengthMm: 0, plungeLengthMm: 20 },
      { cutFeedMmPerMin: 1000, rapidFeedMmPerMin: 5000, plungeFeedMmPerMin: 200 },
    );
    expect(r.cutMinutes).toBeCloseTo((100 - 20) / 1000, 4);
    expect(r.plungeMinutes).toBeCloseTo(20 / 200, 4);
  });

  it('overheads accumulate from per-pass / tool-change / spindle-start', () => {
    const r = estimateTime(
      { cutLengthMm: 0, rapidLengthMm: 0, passCount: 5 },
      { cutFeedMmPerMin: 1000, rapidFeedMmPerMin: 5000 },
      { perPassSec: 6, toolChangeSec: 30, spindleStartSec: 12 },
    );
    // Overhead = 5*6 + 30 + 12 = 72 s = 1.2 min
    expect(r.overheadMinutes).toBeCloseTo(72 / 60, 4);
  });

  it('totalMinutes is the sum of all components', () => {
    const r = estimateTime(
      { cutLengthMm: 1000, rapidLengthMm: 500, plungeLengthMm: 100, passCount: 2 },
      { cutFeedMmPerMin: 800, rapidFeedMmPerMin: 4000, plungeFeedMmPerMin: 200 },
      { perPassSec: 5 },
    );
    const sum = r.cutMinutes + r.rapidMinutes + r.plungeMinutes + r.overheadMinutes;
    expect(r.totalMinutes).toBeCloseTo(sum, 6);
  });

  it('defaults plunge feed to half of cut feed when omitted', () => {
    const explicit = estimateTime(
      { cutLengthMm: 100, rapidLengthMm: 0, plungeLengthMm: 100 },
      { cutFeedMmPerMin: 1000, rapidFeedMmPerMin: 5000, plungeFeedMmPerMin: 500 },
    );
    const implicit = estimateTime(
      { cutLengthMm: 100, rapidLengthMm: 0, plungeLengthMm: 100 },
      { cutFeedMmPerMin: 1000, rapidFeedMmPerMin: 5000 },
    );
    expect(implicit.plungeMinutes).toBeCloseTo(explicit.plungeMinutes, 5);
  });
});

describe('formatMinutes', () => {
  it('under an hour → "Nm"', () => {
    expect(formatMinutes(45)).toBe('45m');
  });

  it('over an hour → "Hh MMm"', () => {
    expect(formatMinutes(125)).toBe('2h 05m');
  });

  it('non-finite → em dash', () => {
    expect(formatMinutes(NaN)).toBe('—');
    expect(formatMinutes(-1)).toBe('—');
  });
});
