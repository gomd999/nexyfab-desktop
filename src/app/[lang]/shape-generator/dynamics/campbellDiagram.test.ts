import { describe, it, expect } from 'vitest';
import {
  compute, excitationHz, modeCurve, summarize,
  type CampbellInput,
} from './campbellDiagram';

const base: CampbellInput = {
  modes: [{ id: 'mode1', baseFreqHz: 50 }, { id: 'mode2', baseFreqHz: 120 }],
  excitationOrders: [1, 2, 3],
  maxSpeedRpm: 6000,
};

describe('compute', () => {
  it('finds crossings within speed range', () => {
    const r = compute(base);
    expect(r.crossings.length).toBeGreaterThan(0);
  });

  it('1× crossing of 50 Hz mode at 3000 rpm', () => {
    const r = compute(base);
    const c = r.crossings.find(x => x.modeId === 'mode1' && x.order === 1);
    expect(c?.speedRpm).toBeCloseTo(3000, 0); // 50 Hz × 60 / 1
  });

  it('2× crossing at half the 1× speed', () => {
    const r = compute(base);
    const c1 = r.crossings.find(x => x.modeId === 'mode1' && x.order === 1)!;
    const c2 = r.crossings.find(x => x.modeId === 'mode1' && x.order === 2)!;
    expect(c2.speedRpm).toBeCloseTo(c1.speedRpm / 2, 0);
  });

  it('crossings sorted by speed', () => {
    const r = compute(base);
    for (let i = 1; i < r.crossings.length; i++) {
      expect(r.crossings[i]!.speedRpm).toBeGreaterThanOrEqual(r.crossings[i - 1]!.speedRpm);
    }
  });

  it('excludes crossings beyond max speed', () => {
    const r = compute({ ...base, maxSpeedRpm: 1000 });
    expect(r.crossings.every(c => c.speedRpm <= 1000)).toBe(true);
  });

  it('flags critical near operating speed', () => {
    const r = compute({ ...base, operatingRpm: 3000 });
    expect(r.crossings.some(c => c.nearOperating)).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('operating margin = nearest critical distance', () => {
    const r = compute({ ...base, operatingRpm: 3300 });
    expect(r.operatingMarginRpm).not.toBeNull();
    expect(r.operatingMarginRpm!).toBeGreaterThanOrEqual(0);
  });

  it('gyroscopic slope shifts crossing', () => {
    const stiff = compute({ ...base, modes: [{ id: 'm', baseFreqHz: 50, speedSlopeHzPerRpm: 0.005 }] });
    const flat = compute({ ...base, modes: [{ id: 'm', baseFreqHz: 50 }] });
    const cs = stiff.crossings.find(c => c.order === 1)!;
    const cf = flat.crossings.find(c => c.order === 1)!;
    expect(cs.speedRpm).not.toBeCloseTo(cf.speedRpm, 0);
  });

  it('no modes → warning', () => {
    expect(compute({ ...base, modes: [] }).warnings.length).toBeGreaterThan(0);
  });
});

describe('excitationHz', () => {
  it('order × rpm/60', () => {
    expect(excitationHz(3, 1200)).toBeCloseTo(60, 6);
  });
});

describe('modeCurve', () => {
  it('flat mode → constant frequency', () => {
    const c = modeCurve({ id: 'm', baseFreqHz: 50 }, 6000, 5);
    expect(c.every(p => Math.abs(p.freqHz - 50) < 1e-9)).toBe(true);
  });

  it('sloped mode rises with speed', () => {
    const c = modeCurve({ id: 'm', baseFreqHz: 50, speedSlopeHzPerRpm: 0.01 }, 6000, 5);
    expect(c[c.length - 1]!.freqHz).toBeGreaterThan(c[0]!.freqHz);
  });
});

describe('summarize', () => {
  it('reports critical count', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.criticalCount).toBe(r.crossings.length);
  });
});
