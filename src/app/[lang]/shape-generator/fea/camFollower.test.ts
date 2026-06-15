/**
 * camFollower — cam-follower motion programs, verified: both SHM and cycloidal rises
 * reach 0→h with zero end velocity; SHM has an acceleration JUMP at the ends while
 * cycloidal is smooth (zero end acceleration); the analytic velocity and acceleration
 * equal finite differences of s and v; and the peak-velocity coefficients (SHM π/2,
 * cycloidal 2).
 */
import { describe, it, expect } from 'vitest';
import { shm, cycloidal, peakVelocityCoefficient } from './camFollower';

const beta = Math.PI / 2, h = 20, omega = 10;

describe('camFollower — motion programs (verified)', () => {
  it('both rises go 0→h with zero velocity at the ends', () => {
    for (const f of [shm, cycloidal]) {
      expect(f(0, beta, h, omega).s).toBeCloseTo(0, 9);
      expect(f(beta, beta, h, omega).s).toBeCloseTo(h, 6);
      expect(f(0, beta, h, omega).v).toBeCloseTo(0, 9);
      expect(f(beta, beta, h, omega).v).toBeCloseTo(0, 6);
    }
  });

  it('SHM jumps in acceleration at the ends; cycloidal is smooth (a=0)', () => {
    expect(Math.abs(shm(0, beta, h, omega).a)).toBeGreaterThan(100);       // acceleration shock
    expect(cycloidal(0, beta, h, omega).a).toBeCloseTo(0, 6);              // smooth start
    expect(cycloidal(beta, beta, h, omega).a).toBeCloseTo(0, 6);          // smooth end
  });

  it('the velocity and acceleration are the derivatives of s and v', () => {
    const th = 0.3 * beta, d = 1e-7;
    const fdV = ((cycloidal(th + d, beta, h, omega).s - cycloidal(th - d, beta, h, omega).s) / (2 * d)) * omega;
    expect(cycloidal(th, beta, h, omega).v).toBeCloseTo(fdV, 3);
    const fdA = ((cycloidal(th + d, beta, h, omega).v - cycloidal(th - d, beta, h, omega).v) / (2 * d)) * omega;
    expect(cycloidal(th, beta, h, omega).a).toBeCloseTo(fdA, 2);
  });

  it('the peak velocities match the coefficients (SHM π/2, cycloidal 2)·(hω/β)', () => {
    let vSHM = 0, vCyc = 0;
    for (let t = 0; t <= beta; t += beta / 2000) { vSHM = Math.max(vSHM, shm(t, beta, h, omega).v); vCyc = Math.max(vCyc, cycloidal(t, beta, h, omega).v); }
    expect(vSHM).toBeCloseTo(peakVelocityCoefficient('shm') * (h * omega) / beta, 2);
    expect(vCyc).toBeCloseTo(peakVelocityCoefficient('cycloidal') * (h * omega) / beta, 2);
    expect(vCyc).toBeGreaterThan(vSHM);                 // cycloidal trades higher peak v for smoothness
  });

  it('the displacement is monotone through the rise', () => {
    let prev = -1;
    for (let t = 0; t <= beta; t += beta / 50) { const s = cycloidal(t, beta, h, omega).s; expect(s).toBeGreaterThanOrEqual(prev - 1e-9); prev = s; }
  });
});
