import { describe, it, expect } from 'vitest';
import {
  compute,
  baseAmpacity,
  summarize,
  type AmpacityInput,
} from './conductorAmpacity';

const base: AmpacityInput = {
  designCurrentA: 40,
};

describe('compute', () => {
  it('temp derating = 1 at 30°C ambient', () => {
    const r = compute({ ...base, ambientTempC: 30, insulationRatingC: 70 });
    expect(r.tempDerating).toBeCloseTo(1, 6);
  });

  it('hotter ambient → lower derating', () => {
    const cool = compute({ ...base, ambientTempC: 30 });
    const hot = compute({ ...base, ambientTempC: 50 });
    expect(hot.tempDerating).toBeLessThan(cool.tempDerating);
  });

  it('grouping reduces capacity', () => {
    const single = compute({ ...base, groupedCircuits: 1 });
    const grouped = compute({ ...base, groupedCircuits: 4 });
    expect(grouped.groupingDerating).toBeLessThan(single.groupingDerating);
  });

  it('selects a conductor carrying the load', () => {
    const r = compute(base);
    expect(r.selectedAreaMm2).not.toBeNull();
    expect(r.deratedAmpacityA).toBeGreaterThanOrEqual(40);
  });

  it('higher current → larger conductor', () => {
    const lo = compute({ designCurrentA: 20 });
    const hi = compute({ designCurrentA: 100 });
    expect(hi.selectedAreaMm2!).toBeGreaterThan(lo.selectedAreaMm2!);
  });

  it('derating + grouping force a bigger size', () => {
    const easy = compute({ designCurrentA: 60, ambientTempC: 30, groupedCircuits: 1 });
    const harsh = compute({ designCurrentA: 60, ambientTempC: 55, groupedCircuits: 6 });
    expect(harsh.selectedAreaMm2!).toBeGreaterThan(easy.selectedAreaMm2!);
  });

  it('voltage drop computed with run + voltage', () => {
    const r = compute({ designCurrentA: 40, runLengthM: 50, voltageV: 230 });
    expect(r.voltageDropPercent).not.toBeNull();
    expect(r.voltageDropPercent!).toBeGreaterThan(0);
  });

  it('excessive VD → warning', () => {
    const r = compute({ designCurrentA: 40, runLengthM: 500, voltageV: 230 });
    expect(r.warnings.some(w => w.includes('Voltage drop'))).toBe(true);
  });

  it('huge load exceeds table → warning', () => {
    const r = compute({ designCurrentA: 5000 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero current → warning', () => {
    const r = compute({ designCurrentA: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('baseAmpacity', () => {
  it('returns table value', () => {
    expect(baseAmpacity(2.5)).toBe(27);
  });

  it('unknown size → null', () => {
    expect(baseAmpacity(3.3)).toBeNull();
  });
});

describe('summarize', () => {
  it('reports size + ampacity', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.selectedAreaMm2).toBe(r.selectedAreaMm2);
    expect(s.deratedAmpacityA).toBe(r.deratedAmpacityA);
  });
});
