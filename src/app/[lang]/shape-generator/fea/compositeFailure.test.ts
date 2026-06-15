/**
 * compositeFailure — first-ply failure criteria, verified: every criterion reports
 * a unit index at the corresponding uniaxial/shear strength; the Tsai-Wu strength
 * ratio scales the stress to failure (R=2 at half load, R·σ gives FI=1); Hashin
 * splits the failure mode correctly; and the Tsai-Wu interaction predicts failure
 * for a biaxial state the non-interactive max-stress criterion calls safe.
 */
import { describe, it, expect } from 'vitest';
import { maxStressIndex, tsaiWuIndex, tsaiWuStrengthRatio, hashinIndex, PlyStrength } from './compositeFailure';

const X: PlyStrength = { Xt: 1500, Xc: 1200, Yt: 50, Yc: 250, S: 70 };

describe('compositeFailure — first-ply failure (verified)', () => {
  it('every criterion gives a unit index at the uniaxial/shear strengths', () => {
    expect(maxStressIndex({ sigma1: X.Xt, sigma2: 0, tau12: 0 }, X)).toBeCloseTo(1, 10);
    expect(tsaiWuIndex({ sigma1: X.Xt, sigma2: 0, tau12: 0 }, X)).toBeCloseTo(1, 10);
    expect(tsaiWuIndex({ sigma1: 0, sigma2: X.Yt, tau12: 0 }, X)).toBeCloseTo(1, 10);
    expect(tsaiWuIndex({ sigma1: 0, sigma2: 0, tau12: X.S }, X)).toBeCloseTo(1, 10);
    expect(maxStressIndex({ sigma1: -X.Xc, sigma2: 0, tau12: 0 }, X)).toBeCloseTo(1, 10);
    expect(maxStressIndex({ sigma1: 0, sigma2: -X.Yc, tau12: 0 }, X)).toBeCloseTo(1, 10);
  });

  it('the Tsai-Wu strength ratio scales the stress to failure', () => {
    expect(tsaiWuStrengthRatio({ sigma1: X.Xt, sigma2: 0, tau12: 0 }, X)).toBeCloseTo(1, 6);
    expect(tsaiWuStrengthRatio({ sigma1: X.Xt / 2, sigma2: 0, tau12: 0 }, X)).toBeCloseTo(2, 6); // half load
    // R·σ reaches exactly the failure surface.
    const s = { sigma1: 600, sigma2: 30, tau12: 40 };
    const R = tsaiWuStrengthRatio(s, X);
    expect(tsaiWuIndex({ sigma1: s.sigma1 * R, sigma2: s.sigma2 * R, tau12: s.tau12 * R }, X)).toBeCloseTo(1, 8);
  });

  it('Hashin identifies the failure mode (fibre/matrix, tension/compression)', () => {
    expect(hashinIndex({ sigma1: X.Xt, sigma2: 0, tau12: 0 }, X).mode).toBe('fibreTension');
    expect(hashinIndex({ sigma1: X.Xt, sigma2: 0, tau12: 0 }, X).maxIndex).toBeCloseTo(1, 10);
    expect(hashinIndex({ sigma1: -X.Xc, sigma2: 0, tau12: 0 }, X).mode).toBe('fibreCompression');
    expect(hashinIndex({ sigma1: 0, sigma2: X.Yt, tau12: 0 }, X).mode).toBe('matrixTension');
    // at the transverse compressive strength the Hashin matrix-compression index = 1.
    const mc = hashinIndex({ sigma1: 0, sigma2: -X.Yc, tau12: 0 }, X);
    expect(mc.mode).toBe('matrixCompression');
    expect(mc.maxIndex).toBeCloseTo(1, 6);
  });

  it('Tsai-Wu interaction predicts failure where max-stress is safe (biaxial)', () => {
    const biaxial = { sigma1: 1400, sigma2: 40, tau12: 0 };
    expect(maxStressIndex(biaxial, X)).toBeLessThan(1);    // each component below its strength
    expect(tsaiWuIndex(biaxial, X)).toBeGreaterThan(1);    // but the interaction fails it
  });

  it('a safe stress state gives index < 1 and R > 1', () => {
    const s = { sigma1: 300, sigma2: 10, tau12: 20 };
    expect(tsaiWuIndex(s, X)).toBeLessThan(1);
    expect(tsaiWuStrengthRatio(s, X)).toBeGreaterThan(1);
    expect(maxStressIndex(s, X)).toBeLessThan(1);
  });
});
