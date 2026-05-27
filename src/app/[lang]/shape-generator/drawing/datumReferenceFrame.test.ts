import { describe, it, expect } from 'vitest';
import {
  validateDrf,
  bonusTolerance,
  formatFcf,
  buildFcf,
} from './datumReferenceFrame';

describe('validateDrf', () => {
  it('plane-plane-plane locks 6 DOFs exactly', () => {
    const r = validateDrf({
      primary:   { letter: 'A', kind: 'plane', modifier: null },
      secondary: { letter: 'B', kind: 'plane', modifier: null },
      tertiary:  { letter: 'C', kind: 'plane', modifier: null },
    });
    expect(r.totalDof).toBe(6);
    expect(r.isOverConstrained).toBe(false);
    expect(r.isUnderConstrained).toBe(false);
  });

  it('primary-only DRF is under-constrained when no tertiary expected', () => {
    const r = validateDrf({ primary: { letter: 'A', kind: 'plane', modifier: null } });
    expect(r.totalDof).toBe(3);
    expect(r.isUnderConstrained).toBe(false); // no tertiary, so no flag
  });

  it('cylinder primary takes 4 DOFs', () => {
    const r = validateDrf({
      primary: { letter: 'A', kind: 'cylinder', modifier: null },
    });
    expect(r.primaryDof).toBe(4);
  });

  it('flags under-constrained when tertiary is set but DOFs < 6', () => {
    const r = validateDrf({
      primary: { letter: 'A', kind: 'point', modifier: null },
      secondary: { letter: 'B', kind: 'plane', modifier: null }, // 2
      tertiary:  { letter: 'C', kind: 'point', modifier: null }, // 0
    });
    expect(r.isUnderConstrained).toBe(true);
  });
});

describe('bonusTolerance', () => {
  it('returns 0 when modifier is S', () => {
    const fcf = buildFcf({ type: 'position', tolerance: 0.2, primary: 'A', toleranceMaterial: 'S' });
    expect(bonusTolerance(fcf, 10, 10.5, 9.5)).toBe(0);
  });

  it('M: bonus = |actual - MMC|', () => {
    const fcf = buildFcf({ type: 'position', tolerance: 0.2, primary: 'A', toleranceMaterial: 'M' });
    // Hole: MMC = 10 (smallest), actual = 10.3
    expect(bonusTolerance(fcf, 10.3, 10, 11)).toBeCloseTo(0.3, 6);
  });

  it('L: bonus = |LMC - actual|', () => {
    const fcf = buildFcf({ type: 'position', tolerance: 0.2, primary: 'A', toleranceMaterial: 'L' });
    expect(bonusTolerance(fcf, 10.3, 10, 11)).toBeCloseTo(0.7, 6);
  });
});

describe('formatFcf', () => {
  it('renders ⌭|tolerance|datum chain', () => {
    const fcf = buildFcf({
      type: 'position',
      tolerance: 0.25,
      primary: 'A',
      secondary: 'B',
      tertiary: 'C',
    });
    const txt = formatFcf(fcf);
    expect(txt).toContain('⌖');
    expect(txt).toContain('A|B|C');
  });

  it('shows position tolerance with ⌀ prefix', () => {
    const fcf = buildFcf({ type: 'position', tolerance: 0.5, primary: 'A' });
    expect(formatFcf(fcf)).toContain('⌀0.5');
  });

  it('flatness has no ⌀ prefix', () => {
    const fcf = buildFcf({ type: 'flatness', tolerance: 0.1, primary: 'A' });
    expect(formatFcf(fcf)).not.toContain('⌀');
  });

  it('shows datum modifier (M) inline', () => {
    const fcf = buildFcf({
      type: 'position',
      tolerance: 0.25,
      primary: 'A',
      secondaryModifier: 'M', secondary: 'B',
    });
    expect(formatFcf(fcf)).toContain('B(M)');
  });
});

describe('buildFcf', () => {
  it('defaults primary kind to plane', () => {
    const fcf = buildFcf({ type: 'flatness', tolerance: 0.1, primary: 'A' });
    expect(fcf.drf.primary.kind).toBe('plane');
  });

  it('captures secondary + tertiary when supplied', () => {
    const fcf = buildFcf({
      type: 'position',
      tolerance: 0.25,
      primary: 'A',
      secondary: 'B',
      tertiary: 'C',
    });
    expect(fcf.drf.secondary?.letter).toBe('B');
    expect(fcf.drf.tertiary?.letter).toBe('C');
  });
});
