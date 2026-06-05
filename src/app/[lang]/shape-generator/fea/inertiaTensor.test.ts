/**
 * inertiaTensor — principal moments of inertia (symmetric-3×3 eigenvalues), verified: a
 * diagonal tensor returning its diagonal sorted; a block tensor whose principal moments
 * are {Ixx±Ixy, Izz}; the trace invariant Σλ = Ixx+Iyy+Izz; and the parallel-axis shift.
 */
import { describe, it, expect } from 'vitest';
import { principalMomentsOfInertia, traceInertia, parallelAxisInertia } from './inertiaTensor';

describe('inertiaTensor — principal moments (verified)', () => {
  it('returns the diagonal (sorted) for a diagonal tensor', () => {
    expect(principalMomentsOfInertia(2, 5, 8, 0, 0, 0)).toEqual([8, 5, 2]);
  });

  it('diagonalises a block tensor to {Ixx±Ixy, Izz}', () => {
    // Ixx=Iyy=10, Izz=4, product Ixy=3 ⇒ eigenvalues 13, 7, 4
    const e = principalMomentsOfInertia(10, 10, 4, 3, 0, 0);
    expect(e[0]).toBeCloseTo(13, 9);
    expect(e[1]).toBeCloseTo(7, 9);
    expect(e[2]).toBeCloseTo(4, 9);
  });

  it('preserves the trace invariant Σλ = Ixx+Iyy+Izz', () => {
    const e = principalMomentsOfInertia(20, 30, 40, 5, 6, 7);
    expect(e[0] + e[1] + e[2]).toBeCloseTo(traceInertia(20, 30, 40), 9); // 90
    expect(e[0]).toBeGreaterThanOrEqual(e[1]);                           // sorted descending
    expect(e[1]).toBeGreaterThanOrEqual(e[2]);
  });

  it('applies the parallel-axis theorem I = I_cm + m·d²', () => {
    expect(parallelAxisInertia(2, 5, 3)).toBeCloseTo(2 + 5 * 9, 12); // 47
    expect(parallelAxisInertia(2, 5, 0)).toBeCloseTo(2, 12);         // no shift at the centroid
  });
});
