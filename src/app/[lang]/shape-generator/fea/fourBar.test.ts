/**
 * fourBar — planar four-bar linkage kinematics, verified: the vector loop closes
 * (residual ≈ 0, link lengths preserved) over a full crank rotation; the Grashof rule
 * classifies the mechanism; a Grashof crank-rocker is reachable for every crank angle;
 * and the analytic angular velocities match a finite difference.
 */
import { describe, it, expect } from 'vitest';
import { fourBarPosition, loopResidual, grashof, fourBarVelocity, FourBar } from './fourBar';

const crankRocker: FourBar = { r1: 4, r2: 1, r3: 3.5, r4: 3 }; // shortest = crank

describe('fourBar — linkage kinematics (verified)', () => {
  it('closes the vector loop over a full crank rotation', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const th2 = (deg * Math.PI) / 180;
      const p = fourBarPosition(crankRocker, th2, 1);
      expect(p.reachable).toBe(true);                       // Grashof crank fully rotates
      const res = loopResidual(crankRocker, th2, p.theta3, p.theta4);
      expect(Math.hypot(res[0], res[1])).toBeLessThan(1e-9);
      // the coupler and rocker keep their lengths.
      expect(Math.hypot(p.B[0] - p.A[0], p.B[1] - p.A[1])).toBeCloseTo(crankRocker.r3, 9);
      expect(Math.hypot(p.B[0] - crankRocker.r1, p.B[1])).toBeCloseTo(crankRocker.r4, 9);
    }
  });

  it('classifies the linkage by the Grashof rule', () => {
    const cr = grashof(crankRocker);
    expect(cr.isGrashof).toBe(true);
    expect(cr.type).toBe('crank-rocker');
    expect(grashof({ r1: 1, r2: 3, r3: 3, r4: 2.5 }).type).toBe('double-crank');   // ground shortest
    expect(grashof({ r1: 2, r2: 2, r3: 2, r4: 5 }).isGrashof).toBe(false);          // s+l > p+q
    expect(grashof({ r1: 2, r2: 2, r3: 2, r4: 2 }).type).toBe('change-point');      // s+l = p+q
  });

  it('the analytic angular velocities match a finite difference', () => {
    const th2 = (70 * Math.PI) / 180, omega2 = 2.5, dt = 1e-7;
    const p0 = fourBarPosition(crankRocker, th2, 1);
    const p1 = fourBarPosition(crankRocker, th2 + omega2 * dt, 1);
    const v = fourBarVelocity(crankRocker, p0, omega2);
    expect(v.omega3).toBeCloseTo((p1.theta3 - p0.theta3) / dt, 3);
    expect(v.omega4).toBeCloseTo((p1.theta4 - p0.theta4) / dt, 3);
  });

  it('the two assembly branches are distinct mirror configurations', () => {
    const th2 = (110 * Math.PI) / 180;
    const open = fourBarPosition(crankRocker, th2, 1);
    const crossed = fourBarPosition(crankRocker, th2, -1);
    expect(open.reachable && crossed.reachable).toBe(true);
    expect(Math.abs(open.theta4 - crossed.theta4)).toBeGreaterThan(1e-3); // different rocker angle
    // both still satisfy the loop closure.
    for (const p of [open, crossed]) {
      const r = loopResidual(crankRocker, th2, p.theta3, p.theta4);
      expect(Math.hypot(r[0], r[1])).toBeLessThan(1e-9);
    }
  });

  it('a non-Grashof linkage cannot reach some crank angles', () => {
    const nonG: FourBar = { r1: 2, r2: 2, r3: 2, r4: 5 }; // rocker too long
    let unreachable = 0;
    for (let deg = 0; deg < 360; deg += 10) if (!fourBarPosition(nonG, (deg * Math.PI) / 180, 1).reachable) unreachable++;
    expect(unreachable).toBeGreaterThan(0);
  });
});
