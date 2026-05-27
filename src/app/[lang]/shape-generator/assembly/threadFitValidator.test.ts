import { describe, it, expect } from 'vitest';
import {
  validateFit,
  engagementCheck,
  tapDrillDiameter,
  summarize,
  EXT_DEVIATION,
  INT_DEVIATION,
  type ExternalThread,
  type InternalThread,
} from './threadFitValidator';

describe('EXT_DEVIATION / INT_DEVIATION', () => {
  it('4g has tighter band than 8g', () => {
    expect(Math.abs(EXT_DEVIATION['4g'].lower)).toBeLessThan(Math.abs(EXT_DEVIATION['8g'].lower));
  });

  it('4H has tighter band than 7H', () => {
    expect(INT_DEVIATION['4H'].upper).toBeLessThan(INT_DEVIATION['7H'].upper);
  });
});

describe('validateFit', () => {
  it('M6 6g/6H → free combination', () => {
    const ext: ExternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6g' };
    const int: InternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6H' };
    const r = validateFit(ext, int);
    expect(r.combination).toBe('free');
    expect(r.canMate).toBe(true);
  });

  it('M6 4g/4H → close', () => {
    const ext: ExternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '4g' };
    const int: InternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '4H' };
    expect(validateFit(ext, int).combination).toBe('close');
  });

  it('nominal mismatch → incompatible', () => {
    const ext: ExternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6g' };
    const int: InternalThread = { nominalMm: 8, pitchMm: 1, toleranceClass: '6H' };
    const r = validateFit(ext, int);
    expect(r.canMate).toBe(false);
    expect(r.combination).toBe('incompatible');
  });

  it('pitch mismatch → incompatible', () => {
    const ext: ExternalThread = { nominalMm: 6, pitchMm: 0.5, toleranceClass: '6g' };
    const int: InternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6H' };
    expect(validateFit(ext, int).canMate).toBe(false);
  });

  it('clearance always positive when matching', () => {
    const ext: ExternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6g' };
    const int: InternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6H' };
    const r = validateFit(ext, int);
    expect(r.maxClearanceMm).toBeGreaterThan(0);
  });

  it('looser bolt class → larger max clearance', () => {
    const ext6: ExternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6g' };
    const ext8: ExternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '8g' };
    const intH: InternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6H' };
    const r6 = validateFit(ext6, intH);
    const r8 = validateFit(ext8, intH);
    expect(r8.maxClearanceMm).toBeGreaterThan(r6.maxClearanceMm);
  });
});

describe('engagementCheck', () => {
  it('steel-on-steel requires 1× D', () => {
    const r = engagementCheck(6, 6, 'steel-on-steel');
    expect(r.required).toBe(6);
    expect(r.ok).toBe(true);
  });

  it('aluminum-on-steel requires 2× D', () => {
    const r = engagementCheck(6, 10, 'al-on-steel');
    expect(r.required).toBe(12);
    expect(r.ok).toBe(false);
  });

  it('ok when actual ≥ required', () => {
    const r = engagementCheck(6, 12, 'al-on-steel');
    expect(r.ok).toBe(true);
  });
});

describe('tapDrillDiameter', () => {
  it('M6×1.0 75% engagement ≈ 5.19 mm', () => {
    expect(tapDrillDiameter(6, 1, 75)).toBeCloseTo(6 - 0.8119, 2);
  });

  it('lower percentage → larger drill', () => {
    expect(tapDrillDiameter(6, 1, 50)).toBeGreaterThan(tapDrillDiameter(6, 1, 75));
  });
});

describe('summarize', () => {
  it('reports canMate + combination', () => {
    const ext: ExternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6g' };
    const int: InternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6H' };
    const r = validateFit(ext, int);
    const s = summarize(r);
    expect(s.canMate).toBe(true);
    expect(s.combination).toBe('free');
  });

  it('warning count tallies', () => {
    const ext: ExternalThread = { nominalMm: 6, pitchMm: 1, toleranceClass: '6g' };
    const int: InternalThread = { nominalMm: 8, pitchMm: 1, toleranceClass: '6H' };
    const r = validateFit(ext, int);
    expect(summarize(r).warningCount).toBeGreaterThan(0);
  });
});
