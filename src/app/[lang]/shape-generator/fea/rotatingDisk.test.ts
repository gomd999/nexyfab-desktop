/**
 * rotatingDisk — centrifugal disk stresses, verified: the solid-disk centre stress
 * (3+ν)/8·ρω²R² with σr=σθ at the centre and σr=0 at the free edge; the thin-ring ρv²
 * hoop stress; the annular small-hole concentration factor (2× the solid centre); and
 * the ω² scaling.
 */
import { describe, it, expect } from 'vitest';
import {
  solidDiskCenterStress, solidDiskRadialStress, solidDiskHoopStress,
  rotatingRingStress, annularMaxHoopStress,
} from './rotatingDisk';

const rho = 7850, omega = 314, R = 0.3, nu = 0.3;

describe('rotatingDisk — centrifugal stresses (verified)', () => {
  it('the solid-disk centre stress is (3+ν)/8·ρω²R² (σr=σθ there)', () => {
    const sc = solidDiskCenterStress(rho, omega, R, nu);
    expect(sc).toBeCloseTo(((3 + nu) / 8) * rho * omega ** 2 * R ** 2, 0);
    expect(solidDiskRadialStress(0, rho, omega, R, nu)).toBeCloseTo(sc, 0);
    expect(solidDiskHoopStress(0, rho, omega, R, nu)).toBeCloseTo(sc, 0);
  });

  it('the radial stress vanishes at the free outer edge', () => {
    expect(solidDiskRadialStress(R, rho, omega, R, nu)).toBeCloseTo(0, 3);
    expect(solidDiskHoopStress(R, rho, omega, R, nu)).toBeGreaterThan(0); // hoop still nonzero
  });

  it('a thin rotating ring has hoop stress ρ·v²', () => {
    const v = omega * R;
    expect(rotatingRingStress(rho, v)).toBeCloseTo(rho * v * v, 0);
  });

  it('a tiny central hole doubles the centre stress (concentration factor 2)', () => {
    const sc = solidDiskCenterStress(rho, omega, R, nu);
    expect(annularMaxHoopStress(rho, omega, R, 1e-6, nu) / sc).toBeCloseTo(2, 4);
  });

  it('stress scales with the square of the angular speed', () => {
    const sc = solidDiskCenterStress(rho, omega, R, nu);
    expect(solidDiskCenterStress(rho, 2 * omega, R, nu) / sc).toBeCloseTo(4, 6);
  });
});
