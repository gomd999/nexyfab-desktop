import { describe, it, expect } from 'vitest';
import {
  analyzeDrift,
  nextCalibrationDate,
  temperatureCorrelation,
  summarize,
  type CalibrationEvent,
} from './cmmCalibrationDrift';

function ev(date: string, measured: number, nominal: number, temp?: number): CalibrationEvent {
  const e: CalibrationEvent = { date, measured, nominal };
  if (temp !== undefined) e.temperatureC = temp;
  return e;
}

describe('analyzeDrift', () => {
  it('empty → no drift', () => {
    const r = analyzeDrift([]);
    expect(r.driftRateMmPerDay).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('single event → no trend', () => {
    const r = analyzeDrift([ev('2026-01-01', 10, 10)]);
    expect(r.driftRateMmPerDay).toBe(0);
  });

  it('linear drift → slope detected', () => {
    const events = [
      ev('2026-01-01', 10.000, 10),
      ev('2026-01-11', 10.001, 10),
      ev('2026-01-21', 10.002, 10),
    ];
    const r = analyzeDrift(events);
    expect(r.driftRateMmPerDay).toBeGreaterThan(0);
  });

  it('R² high for clean trend', () => {
    const events = Array.from({ length: 10 }, (_, i) => ev(`2026-01-${10 + i}`, 10 + i * 0.001, 10));
    const r = analyzeDrift(events);
    expect(r.rSquared).toBeGreaterThan(0.9);
  });

  it('outlier flagged', () => {
    const events = [
      ev('2026-01-01', 10.000, 10),
      ev('2026-01-03', 10.0005, 10),
      ev('2026-01-05', 10.001, 10),
      ev('2026-01-07', 10.0015, 10),
      ev('2026-01-09', 10.002, 10),
      ev('2026-01-11', 10.500, 10), // single far outlier
      ev('2026-01-13', 10.003, 10),
      ev('2026-01-15', 10.0035, 10),
      ev('2026-01-17', 10.004, 10),
    ];
    const r = analyzeDrift(events, { toleranceMm: 0.01, outlierSigma: 1.5 });
    expect(r.outlierIndices.length).toBeGreaterThan(0);
  });

  it('daysUntilOutOfTolerance positive', () => {
    const events = Array.from({ length: 5 }, (_, i) => ev(`2026-01-${10 + i}`, 10 + i * 0.0005, 10));
    const r = analyzeDrift(events, { toleranceMm: 0.01, outlierSigma: 2.5 });
    expect(r.daysUntilOutOfTolerance).toBeGreaterThan(0);
  });

  it('warns when latest already out of tolerance', () => {
    const events = [
      ev('2026-01-01', 10.0, 10),
      ev('2026-01-15', 10.05, 10),
    ];
    const r = analyzeDrift(events, { toleranceMm: 0.01, outlierSigma: 2.5 });
    expect(r.warnings.some(w => w.includes('out of tolerance'))).toBe(true);
  });

  it('zero-slope when measurements constant', () => {
    const events = [
      ev('2026-01-01', 10, 10),
      ev('2026-01-10', 10, 10),
      ev('2026-01-20', 10, 10),
    ];
    const r = analyzeDrift(events);
    expect(r.driftRateMmPerDay).toBeCloseTo(0, 5);
  });
});

describe('nextCalibrationDate', () => {
  it('adds N days', () => {
    const result = nextCalibrationDate(ev('2026-01-01', 10, 10), 30);
    expect(result).toBe('2026-01-31');
  });
});

describe('temperatureCorrelation', () => {
  it('strong correlation → thermallyDriven', () => {
    const events = [
      ev('2026-01-01', 10.0, 10, 20),
      ev('2026-01-02', 10.001, 10, 22),
      ev('2026-01-03', 10.002, 10, 24),
      ev('2026-01-04', 10.003, 10, 26),
    ];
    const r = temperatureCorrelation(events);
    expect(r.thermallyDriven).toBe(true);
  });

  it('no temperature data → correlation 0', () => {
    const events = [ev('2026-01-01', 10, 10), ev('2026-01-02', 10.001, 10)];
    expect(temperatureCorrelation(events).correlation).toBe(0);
  });

  it('low correlation → not thermally driven', () => {
    const events = [
      ev('2026-01-01', 10.0, 10, 20),
      ev('2026-01-02', 10.0, 10, 22),
      ev('2026-01-03', 10.001, 10, 21),
      ev('2026-01-04', 10.0, 10, 23),
      ev('2026-01-05', 10.0, 10, 22),
      ev('2026-01-06', 10.001, 10, 20),
    ];
    expect(temperatureCorrelation(events).thermallyDriven).toBe(false);
  });
});

describe('summarize', () => {
  it('reports event count + drift', () => {
    const events = [ev('2026-01-01', 10, 10), ev('2026-01-10', 10.001, 10)];
    const r = analyzeDrift(events);
    const s = summarize(events, r);
    expect(s.eventCount).toBe(2);
    expect(s.driftRateMmPerDay).toBe(r.driftRateMmPerDay);
  });
});
