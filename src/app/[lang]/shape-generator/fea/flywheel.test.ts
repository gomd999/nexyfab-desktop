/**
 * flywheel — rotational energy storage and speed regulation, verified: the E=½Iω²
 * energy with ω² scaling; the energy-swing identity ΔE = ½I(ω_max²−ω_min²) =
 * I·ω_mean²·C_s; the inverse inertia sizing I = ΔE/(ω_mean²·C_s); and the thin-ring
 * inertia mr².
 */
import { describe, it, expect } from 'vitest';
import { kineticEnergy, energyFluctuation, coefficientOfFluctuation, requiredInertia, ringInertia } from './flywheel';

describe('flywheel — energy storage & regulation (verified)', () => {
  const I = ringInertia(50, 0.4); // 8 kg·m²

  it('stores E=½Iω² scaling with ω²', () => {
    expect(I).toBeCloseTo(8, 12);
    expect(kineticEnergy(I, 100)).toBeCloseTo(0.5 * I * 100 ** 2, 9); // 40 kJ
    expect(kineticEnergy(I, 200) / kineticEnergy(I, 100)).toBeCloseTo(4, 9);
  });

  it('relates the energy swing to the fluctuation coefficient', () => {
    const wmax = 105, wmin = 95, wmean = (wmax + wmin) / 2;
    const Cs = coefficientOfFluctuation(wmax, wmin, wmean);
    expect(Cs).toBeCloseTo(0.1, 9);
    expect(energyFluctuation(I, wmax, wmin)).toBeCloseTo(I * wmean ** 2 * Cs, 6); // ΔE = Iω̄²Cs
  });

  it('sizes the inertia inversely from the required energy swing', () => {
    const wmax = 105, wmin = 95, wmean = 100;
    const Cs = coefficientOfFluctuation(wmax, wmin, wmean);
    const dE = energyFluctuation(I, wmax, wmin);
    expect(requiredInertia(dE, wmean, Cs)).toBeCloseTo(I, 6);
    // a tighter regulation (smaller Cs) needs a bigger flywheel
    expect(requiredInertia(dE, wmean, Cs / 2)).toBeCloseTo(2 * I, 6);
  });
});
