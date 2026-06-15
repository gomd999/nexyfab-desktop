/**
 * ottoDiesel — air-standard IC-cycle efficiencies, verified: the Otto efficiency rising
 * with compression ratio; the Diesel→Otto limit as the cutoff ratio r_c→1; the
 * Otto > Diesel ordering at equal compression ratio; and the 0<η<1 bound.
 */
import { describe, it, expect } from 'vitest';
import { compressionRatio, ottoEfficiency, dieselEfficiency } from './ottoDiesel';

describe('ottoDiesel — IC-cycle efficiency (verified)', () => {
  const gamma = 1.4;

  it('Otto efficiency rises with compression ratio', () => {
    expect(ottoEfficiency(8, gamma)).toBeCloseTo(1 - 1 / 8 ** 0.4, 9); // 0.5647
    expect(ottoEfficiency(10, gamma)).toBeGreaterThan(ottoEfficiency(8, gamma));
    expect(compressionRatio(0.5, 0.0625)).toBeCloseTo(8, 9);
  });

  it('Diesel approaches Otto as the cutoff ratio r_c→1', () => {
    expect(dieselEfficiency(8, 1.0001, gamma)).toBeCloseTo(ottoEfficiency(8, gamma), 3);
  });

  it('Otto beats Diesel at the same compression ratio', () => {
    expect(ottoEfficiency(8, gamma)).toBeGreaterThan(dieselEfficiency(8, 2, gamma));
    // but a real Diesel uses a much higher r, so it can still out-perform a real Otto
    expect(dieselEfficiency(18, 2, gamma)).toBeGreaterThan(ottoEfficiency(8, gamma));
  });

  it('keeps efficiency within (0,1)', () => {
    for (const r of [6, 10, 18]) {
      expect(ottoEfficiency(r, gamma)).toBeGreaterThan(0);
      expect(ottoEfficiency(r, gamma)).toBeLessThan(1);
      expect(dieselEfficiency(r, 2.5, gamma)).toBeGreaterThan(0);
      expect(dieselEfficiency(r, 2.5, gamma)).toBeLessThan(1);
    }
  });
});
