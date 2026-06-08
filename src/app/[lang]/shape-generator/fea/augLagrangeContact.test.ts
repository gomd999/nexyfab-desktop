/**
 * augLagrangeContact — verifies the iterative normal-contact solver against the
 * closed-form 1D reaction, and shows it beats pure penalty on penetration.
 */
import { describe, it, expect } from 'vitest';
import { solveAugLagrangeContact, purePenaltyPenetrationMm } from './augLagrangeContact';

// k=1000 N/mm, gap 0.5 mm, F=2000 N. F/k=2.0 > 0.5 → contact.
// Exact: u → 0.5 mm, reaction R = F − k·g0 = 2000 − 500 = 1500 N.
const base = { structuralStiffness: 1000, initialGapMm: 0.5, appliedForceN: 2000 };

describe('solveAugLagrangeContact', () => {
  it('no contact when the gap does not close (F/k ≤ g0)', () => {
    const r = solveAugLagrangeContact({ structuralStiffness: 1000, initialGapMm: 5, appliedForceN: 2000 });
    expect(r.contactActive).toBe(false);
    expect(r.contactForceN).toBe(0);
    expect(r.displacementMm).toBeCloseTo(2.0, 6); // F/k
  });

  it('contact: penetration → ~0 and reaction = F − k·g0 (closed form)', () => {
    const r = solveAugLagrangeContact(base);
    expect(r.contactActive).toBe(true);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.penetrationMm)).toBeLessThan(1e-6);
    expect(r.displacementMm).toBeCloseTo(0.5, 5);
    expect(r.contactForceN).toBeCloseTo(1500, 2);
  });

  it('drives penetration ~independent of penalty (the augmented-Lagrange property)', () => {
    const soft = solveAugLagrangeContact({ ...base, penaltyStiffness: 1e3 });
    const stiff = solveAugLagrangeContact({ ...base, penaltyStiffness: 1e6 });
    expect(Math.abs(soft.penetrationMm)).toBeLessThan(1e-6);
    expect(Math.abs(stiff.penetrationMm)).toBeLessThan(1e-6);
    // both recover the same reaction regardless of ε
    expect(soft.contactForceN).toBeCloseTo(1500, 1);
    expect(stiff.contactForceN).toBeCloseTo(1500, 1);
  });

  it('beats pure penalty at a modest penalty stiffness', () => {
    const eps = 1e3;
    const aug = solveAugLagrangeContact({ ...base, penaltyStiffness: eps });
    const penaltyPen = purePenaltyPenetrationMm({ ...base, penaltyStiffness: eps });
    // pure penalty leaves (2000−500)/(1000+1000) = 0.75 mm of penetration
    expect(penaltyPen).toBeCloseTo(0.75, 3);
    expect(Math.abs(aug.penetrationMm)).toBeLessThan(penaltyPen * 1e-4); // ≫ better
  });

  it('converges in a handful of sweeps for ε ≫ k', () => {
    const r = solveAugLagrangeContact({ ...base, penaltyStiffness: 1e5 });
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThan(10);
  });
});
