/**
 * hydraulics — Pascal-principle hydraulics, verified: P=F/A; the force multiplication
 * F2/F1=A2/A1 with work conservation F1·d1=F2·d2 (no free lunch); the annular rod-side
 * area below the bore; and the flow-speed continuity v=Q/A.
 */
import { describe, it, expect } from 'vitest';
import { pressure, pascalForce, boreArea, annularArea, forceMultiplication, cylinderSpeed, outputStroke } from './hydraulics';

describe('hydraulics — Pascal principle (verified)', () => {
  it('a hydraulic press multiplies force by the area ratio', () => {
    const A1 = boreArea(0.02), A2 = boreArea(0.1), F1 = 100;
    const P = pressure(F1, A1);
    expect(pascalForce(P, A2) / F1).toBeCloseTo(forceMultiplication(A1, A2), 6);
    expect(forceMultiplication(A1, A2)).toBeCloseTo((0.1 / 0.02) ** 2, 9); // 25
  });

  it('work is conserved: the big piston moves less (F1·d1 = F2·d2)', () => {
    const A1 = boreArea(0.02), A2 = boreArea(0.1), F1 = 100;
    const P = pressure(F1, A1), F2 = pascalForce(P, A2);
    const dIn = 0.025, dOut = outputStroke(dIn, A1, A2);
    expect(dOut).toBeCloseTo(dIn * A1 / A2, 9);          // 1 mm out for 25 mm in
    expect(F1 * dIn).toBeCloseTo(F2 * dOut, 6);          // equal work
  });

  it('the rod-side (annular) area is below the bore area', () => {
    const bore = boreArea(0.1), rod = annularArea(0.1, 0.05);
    expect(rod).toBeCloseTo((Math.PI * (0.1 ** 2 - 0.05 ** 2)) / 4, 12);
    expect(rod).toBeLessThan(bore);                      // less force / faster on the rod side
    expect(rod / bore).toBeCloseTo(0.75, 9);             // 1 − (d/D)²
  });

  it('the cylinder speed follows the flow continuity v=Q/A', () => {
    const A = boreArea(0.1);
    expect(cylinderSpeed(1e-3, A)).toBeCloseTo(1e-3 / A, 9);
    // the same flow drives a smaller cylinder faster.
    expect(cylinderSpeed(1e-3, boreArea(0.05))).toBeGreaterThan(cylinderSpeed(1e-3, A));
  });

  it('pressure relates force and area linearly', () => {
    expect(pressure(2000, 0.01)).toBeCloseTo(200000, 6);
    expect(pascalForce(200000, 0.02)).toBeCloseTo(4000, 6); // same pressure, double area ⇒ double force
  });
});
