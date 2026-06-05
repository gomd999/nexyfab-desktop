/**
 * slopeStability — limit-equilibrium factor of safety, verified: the dry-cohesionless
 * infinite slope FS=tanφ/tanβ (=1 at β=φ, <1 when β>φ); cohesion raising FS; the
 * sliding-block FS; Bishop's method reducing to the infinite slope for a single
 * cohesionless slice; and Bishop converging independent of the initial guess.
 */
import { describe, it, expect } from 'vitest';
import { infiniteSlopeDryCohesionless, infiniteSlopeFS, slidingBlockFS, bishopFS, Slice } from './slopeStability';

const deg = (d: number) => (d * Math.PI) / 180;
const phi = deg(30);

describe('slopeStability — limit equilibrium (verified)', () => {
  it('the dry cohesionless infinite slope is FS = tanφ/tanβ', () => {
    expect(infiniteSlopeDryCohesionless(phi, deg(20))).toBeCloseTo(Math.tan(phi) / Math.tan(deg(20)), 12);
    expect(infiniteSlopeDryCohesionless(phi, deg(30))).toBeCloseTo(1, 9);   // β = φ ⇒ critical
    expect(infiniteSlopeDryCohesionless(phi, deg(40))).toBeLessThan(1);     // β > φ ⇒ failure
  });

  it('cohesion raises the factor of safety', () => {
    const beta = deg(35);
    expect(infiniteSlopeFS(0, phi, 18, 3, beta)).toBeLessThan(1);            // β>φ cohesionless ⇒ unstable
    expect(infiniteSlopeFS(10, phi, 18, 3, beta)).toBeGreaterThan(infiniteSlopeFS(0, phi, 18, 3, beta));
  });

  it('the sliding-block FS combines cohesion and friction over the driving force', () => {
    const W = 100, beta = deg(25), c = 5, area = 2;
    const expected = (c * area + W * Math.cos(beta) * Math.tan(phi)) / (W * Math.sin(beta));
    expect(slidingBlockFS(W, beta, c, area, phi)).toBeCloseTo(expected, 12);
  });

  it('Bishop reduces to the infinite slope for a single cohesionless slice', () => {
    const alpha = deg(20);
    const fs = bishopFS([{ weight: 100, baseAngle: alpha, width: 10, c: 0, phi }]);
    expect(fs).toBeCloseTo(Math.tan(phi) / Math.tan(alpha), 6);             // = infinite slope FS
  });

  it("Bishop's iteration converges independent of the initial guess", () => {
    const slices: Slice[] = [
      { weight: 80, baseAngle: deg(35), width: 5, c: 10, phi },
      { weight: 120, baseAngle: deg(15), width: 5, c: 10, phi },
      { weight: 60, baseAngle: deg(-5), width: 5, c: 10, phi },
    ];
    const fs1 = bishopFS(slices, 1.0);
    const fs2 = bishopFS(slices, 2.5);
    expect(fs1).toBeCloseTo(fs2, 6);                                        // same fixed point
    expect(fs1).toBeGreaterThan(0);
  });
});
