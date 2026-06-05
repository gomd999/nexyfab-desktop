/**
 * thinLens — Gaussian thin-lens imaging, verified: the symmetric conjugate (object at 2f
 * ⇒ image at 2f, m=−1); the image at f for an object at infinity; the lens equation
 * 1/f=1/d_o+1/d_i; and a biconvex lensmaker focal length.
 */
import { describe, it, expect } from 'vitest';
import { imageDistance, magnification, objectDistance, lensmakerFocalLength, lensPower } from './thinLens';

describe('thinLens — Gaussian optics (verified)', () => {
  const f = 0.1;

  it('images an object at 2f back to 2f with unit inverted magnification', () => {
    const di = imageDistance(f, 2 * f);
    expect(di).toBeCloseTo(2 * f, 12);
    expect(magnification(di, 2 * f)).toBeCloseTo(-1, 12);  // same size, inverted
  });

  it('focuses an object at infinity to the focal point', () => {
    expect(imageDistance(f, 1e9)).toBeCloseTo(f, 6);
    expect(Math.abs(magnification(imageDistance(f, 1e9), 1e9))).toBeLessThan(1e-6); // tiny image
  });

  it('satisfies the lens equation 1/f = 1/d_o + 1/d_i', () => {
    const dObj = 0.15, di = imageDistance(f, dObj);
    expect(1 / dObj + 1 / di).toBeCloseTo(1 / f, 9);
    expect(objectDistance(f, di)).toBeCloseTo(dObj, 9);    // round trip
  });

  it('gives a biconvex lensmaker focal length and power', () => {
    expect(lensmakerFocalLength(1.5, 0.1, -0.1)).toBeCloseTo(0.1, 9); // symmetric biconvex
    expect(lensPower(0.1)).toBeCloseTo(10, 12);                       // 10 dioptres
  });
});
