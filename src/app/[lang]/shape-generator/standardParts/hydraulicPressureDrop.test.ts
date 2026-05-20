import { describe, it, expect } from 'vitest';
import {
  reynolds,
  swameeJainFriction,
  frictionFactor,
  pressureDrop,
  suggestBore,
  FLUID_PRESETS,
  FITTING_K,
} from './hydraulicPressureDrop';

const oil = FLUID_PRESETS['iso-vg-46-40c']!;

describe('reynolds', () => {
  it('zero flow → Re=0', () => {
    expect(reynolds(0, 10, oil).reynolds).toBe(0);
  });

  it('grows linearly with flow rate', () => {
    const r1 = reynolds(10, 10, oil).reynolds;
    const r2 = reynolds(20, 10, oil).reynolds;
    expect(r2 / r1).toBeCloseTo(2, 1);
  });

  it('water (lower viscosity) → higher Re than oil', () => {
    const water = FLUID_PRESETS['water-20c']!;
    expect(reynolds(20, 10, water).reynolds).toBeGreaterThan(reynolds(20, 10, oil).reynolds);
  });

  it('classifies state correctly', () => {
    expect(reynolds(0.1, 10, oil).state).toBe('laminar');
    const turb = reynolds(200, 10, FLUID_PRESETS['water-20c']!);
    expect(turb.state).toBe('turbulent');
  });

  it('velocity = Q/A', () => {
    // 60 LPM = 0.001 m³/s. D=10mm → A=π·25e-6 ≈ 7.85e-5. v ≈ 12.7 m/s.
    const r = reynolds(60, 10, oil);
    expect(r.velocityMs).toBeCloseTo(12.73, 1);
  });
});

describe('swameeJainFriction', () => {
  it('matches Moody-chart point for smooth turbulent flow', () => {
    // Re=1e5, smooth → f ≈ 0.018.
    const f = swameeJainFriction(1e5, 1e-6);
    expect(f).toBeGreaterThan(0.016);
    expect(f).toBeLessThan(0.022);
  });

  it('rougher pipe → higher f', () => {
    const smooth = swameeJainFriction(1e5, 1e-6);
    const rough = swameeJainFriction(1e5, 1e-2);
    expect(rough).toBeGreaterThan(smooth);
  });
});

describe('frictionFactor', () => {
  it('laminar = 64 / Re', () => {
    expect(frictionFactor(1000, 0.001)).toBeCloseTo(64 / 1000, 6);
  });

  it('continuous across transition zone', () => {
    const justBelow = frictionFactor(2299, 0.001);
    const justAbove = frictionFactor(2301, 0.001);
    expect(Math.abs(justBelow - justAbove)).toBeLessThan(0.02);
  });
});

describe('pressureDrop', () => {
  it('straight pipe section drops as expected', () => {
    const r = pressureDrop(
      [{ innerDiameterMm: 12, lengthM: 5 }],
      [],
      30,
      oil,
    );
    expect(r.pressureDropBar).toBeGreaterThan(0);
    expect(r.pipeDropBar).toBeGreaterThan(0);
    expect(r.fittingDropBar).toBe(0);
  });

  it('fittings contribute minor loss', () => {
    const noFittings = pressureDrop([{ innerDiameterMm: 12, lengthM: 5 }], [], 30, oil);
    const withFittings = pressureDrop(
      [{ innerDiameterMm: 12, lengthM: 5 }],
      [{ type: 'elbow-90-sharp', count: 4, boreMm: 12 }],
      30,
      oil,
    );
    expect(withFittings.fittingDropBar).toBeGreaterThan(0);
    expect(withFittings.pressureDropBar).toBeGreaterThan(noFittings.pressureDropBar);
  });

  it('longer pipe → larger drop', () => {
    const short = pressureDrop([{ innerDiameterMm: 12, lengthM: 1 }], [], 30, oil);
    const long  = pressureDrop([{ innerDiameterMm: 12, lengthM: 10 }], [], 30, oil);
    expect(long.pressureDropBar).toBeGreaterThan(short.pressureDropBar * 5);
  });

  it('larger bore → smaller drop', () => {
    const small = pressureDrop([{ innerDiameterMm: 8, lengthM: 5 }], [], 30, oil);
    const big   = pressureDrop([{ innerDiameterMm: 20, lengthM: 5 }], [], 30, oil);
    expect(big.pressureDropBar).toBeLessThan(small.pressureDropBar);
  });

  it('per-segment details emitted', () => {
    const r = pressureDrop(
      [{ innerDiameterMm: 12, lengthM: 5 }],
      [{ type: 'check-valve', count: 1, boreMm: 12 }],
      30,
      oil,
    );
    expect(r.pipeDetails).toHaveLength(1);
    expect(r.fittingDetails).toHaveLength(1);
    expect(r.fittingDetails[0]!.k).toBe(FITTING_K['check-valve']);
  });
});

describe('suggestBore', () => {
  it('suction line picks larger bore (slower target velocity)', () => {
    const suction = suggestBore(30, 'suction');
    const pressure = suggestBore(30, 'pressure');
    expect(suction).toBeGreaterThanOrEqual(pressure);
  });

  it('returns biggest standard size if flow too high', () => {
    const r = suggestBore(99999, 'pressure');
    expect(r).toBe(50);
  });
});
