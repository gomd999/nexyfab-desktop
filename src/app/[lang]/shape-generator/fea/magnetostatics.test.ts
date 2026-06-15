/**
 * magnetostatics — closed-form Biot-Savart fields, verified: the loop centre field
 * μ0I/2R and its 1/z³ far-field; the finite-solenoid closed form matching a Biot-
 * Savart integral over its loops and tending to μ0nI as it lengthens; and the
 * straight-wire (μ0I/2πr) and toroid (μ0NI/2πr) fields.
 */
import { describe, it, expect } from 'vitest';
import {
  MU0, loopFieldOnAxis, solenoidFieldOnAxis, infiniteSolenoidField,
  straightWireField, toroidField, solenoidFieldByIntegration,
} from './magnetostatics';

const I = 10, R = 0.05, n = 1000;

describe('magnetostatics — Biot-Savart fields (verified)', () => {
  it('the circular loop field is μ0I/2R at the centre and falls as 1/z³ far away', () => {
    expect(loopFieldOnAxis(I, R, 0)).toBeCloseTo((MU0 * I) / (2 * R), 12);
    const z = 1; // z >> R
    expect(loopFieldOnAxis(I, R, z) / ((MU0 * I * R * R) / (2 * z ** 3))).toBeCloseTo(1, 2);
  });

  it('the finite-solenoid closed form matches a Biot-Savart loop integral', () => {
    const L = 1;
    expect(solenoidFieldByIntegration(I, n, R, L, 0) / solenoidFieldOnAxis(I, n, R, L, 0)).toBeCloseTo(1, 4);
    // off-centre too.
    expect(solenoidFieldByIntegration(I, n, R, L, 0.2) / solenoidFieldOnAxis(I, n, R, L, 0.2)).toBeCloseTo(1, 3);
  });

  it('a long solenoid tends to the ideal interior field μ0nI', () => {
    const ideal = infiniteSolenoidField(I, n);
    expect(solenoidFieldOnAxis(I, n, R, 1, 0) / ideal).toBeGreaterThan(0.99);   // already close at L=1
    expect(solenoidFieldOnAxis(I, n, R, 100, 0) / ideal).toBeGreaterThan(0.9999); // L >> R ⇒ μ0nI
    expect(ideal).toBeCloseTo(MU0 * n * I, 12);
  });

  it('the field at the solenoid end is about half the interior field', () => {
    const ideal = infiniteSolenoidField(I, n);
    const atEnd = solenoidFieldOnAxis(I, n, R, 100, 50); // z = L/2 (the end)
    expect(atEnd / ideal).toBeCloseTo(0.5, 2);           // classic half-field at the mouth
  });

  it('reproduces the straight-wire and toroid fields', () => {
    expect(straightWireField(I, 0.1)).toBeCloseTo((MU0 * I) / (2 * Math.PI * 0.1), 12);
    expect(toroidField(I, 500, 0.2)).toBeCloseTo((MU0 * 500 * I) / (2 * Math.PI * 0.2), 12);
    // wire field falls as 1/r.
    expect(straightWireField(I, 0.2) / straightWireField(I, 0.1)).toBeCloseTo(0.5, 12);
  });
});
