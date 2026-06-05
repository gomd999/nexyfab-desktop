/**
 * coRotBeam — geometrically nonlinear (large-rotation) co-rotational 2D beam,
 * verified against the exact elastica: a cantilever under a pure end moment curls
 * into a perfect circular arc of radius R = EI/M, with the tip at (R·sinΘ,
 * R(1−cosΘ)) and rotation Θ = ML/EI. The small-load limit recovers linear beam
 * theory (PL³/3EI).
 */
import { describe, it, expect } from 'vitest';
import { coRotBeamSolve } from './coRotBeam';

const L = 100, EI = 1e6, EA = 1e8;

describe('coRotBeam — large-deflection cantilever (verified vs elastica)', () => {
  for (const Theta of [Math.PI / 2, (2 * Math.PI) / 3, Math.PI]) {
    it(`pure end moment Θ=${Theta.toFixed(3)} curls into a circular arc`, () => {
      const M = (Theta * EI) / L, R = L / Theta;
      const r = coRotBeamSolve({ nElems: 20, length: L, EA, EI, endMoment: M, loadSteps: 20 });
      expect(r.converged).toBe(true);
      expect(r.tip.rotation).toBeCloseTo(Theta, 3);                 // tip rotation = ML/EI
      expect(r.tip.x).toBeCloseTo(R * Math.sin(Theta), 0);          // exact circle, ±1
      expect(r.tip.y).toBeCloseTo(R * (1 - Math.cos(Theta)), 0);
      // the deflection is genuinely large (not a linearisable regime).
      expect(Math.abs(r.tip.y) / L).toBeGreaterThan(0.3);
    });
  }

  it('recovers linear beam theory for a small tip force (w = PL³/3EI)', () => {
    const P = 1;
    const r = coRotBeamSolve({ nElems: 20, length: L, EA, EI, tipForce: P, loadSteps: 5 });
    expect(r.tip.y).toBeCloseTo((P * L ** 3) / (3 * EI), 4);
  });

  it('Newton-Raphson converges in few iterations per load step', () => {
    const r = coRotBeamSolve({ nElems: 20, length: L, EA, EI, endMoment: (Math.PI * EI) / L, loadSteps: 20 });
    expect(Math.max(...r.newtonIters)).toBeLessThan(15);            // quadratic convergence
  });
});
