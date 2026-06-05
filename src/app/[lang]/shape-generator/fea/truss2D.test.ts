/**
 * truss2D — planar pin-jointed truss by the direct stiffness method, verified: the
 * single-bar elongation PL/EA with a recovered member force equal to the applied load;
 * the symmetric two-bar truss member force P/(2 sinθ) (tension positive) with joint
 * equilibrium 2·F·sinθ = P; and the static determinacy count m + r − 2j.
 */
import { describe, it, expect } from 'vitest';
import { solveTruss, determinacy } from './truss2D';

const EA = 2e8; // N (e.g. E=200 GPa × A=1e-3 m²)

describe('truss2D — direct stiffness (verified)', () => {
  it('a single axial bar elongates by PL/EA and carries the full load', () => {
    // node0 pinned, node1 free along x; axial load P at node1
    const P = 1000, L = 1;
    const r = solveTruss(
      [{ x: 0, y: 0 }, { x: L, y: 0 }],
      [{ i: 0, j: 1, EA }],
      new Set([0, 1, 3]),          // node0 (u,v) fixed, node1 v fixed
      new Map([[2, P]]),           // node1 u-load
    );
    expect(r.displacement[2]).toBeCloseTo((P * L) / EA, 12); // PL/EA
    expect(r.memberForces[0]).toBeCloseTo(P, 6);             // tension = P
  });

  it('a symmetric two-bar truss splits the load as P/(2 sinθ) in tension', () => {
    // A(0,0) B(2,0) pinned, apex C(1,-1) below; load P downward at C.
    const nodes = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: -1 }];
    const members = [{ i: 0, j: 2, EA }, { i: 1, j: 2, EA }];
    const P = 1000;
    const r = solveTruss(nodes, members, new Set([0, 1, 2, 3]), new Map([[5, -P]]));
    const sinTheta = 1 / Math.SQRT2;          // bars at 45° below horizontal
    const expF = P / (2 * sinTheta);          // 707.11 N
    expect(r.memberForces[0]).toBeCloseTo(expF, 6);
    expect(r.memberForces[1]).toBeCloseTo(expF, 6);          // symmetry
    expect(r.memberForces[0]).toBeGreaterThan(0);            // tension (load hangs below)
    // joint equilibrium at C: vertical components balance the load
    expect(2 * r.memberForces[0] * sinTheta).toBeCloseTo(P, 6);
  });

  it('counts static determinacy m + r − 2j', () => {
    expect(determinacy(2, 4, 3)).toBe(0);   // two-bar truss above: determinate
    expect(determinacy(1, 3, 2)).toBe(0);   // single bar with a pin+roller: determinate
    expect(determinacy(13, 3, 8)).toBe(0);  // classic 8-joint determinate truss
    expect(determinacy(14, 3, 8)).toBe(1);  // one redundant member ⇒ indeterminate
    expect(determinacy(1, 3, 3)).toBe(-2);  // too few members ⇒ mechanism
  });
});
