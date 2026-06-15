/**
 * buoyancy — hydrostatic flotation and metacentric stability, verified: the flotation
 * balance F_B(V_disp)=W; the rectangular-barge metacentric radius BM=B²/(12d); the
 * GM=BM−BG stability sign; and the widening-beam stabilising effect (BM ∝ B²).
 */
import { describe, it, expect } from 'vitest';
import { buoyantForce, displacedVolume, metacentricRadius, metacentricHeight, rightingMoment, rectangularWaterplaneI } from './buoyancy';

describe('buoyancy — flotation + metacentric stability (verified)', () => {
  const rho = 1025, g = 9.80665, W = 5e6; // seawater, 5 MN displacement

  it('floats when buoyancy balances weight', () => {
    const V = displacedVolume(W, rho, g);
    expect(buoyantForce(rho, g, V)).toBeCloseTo(W, 3);
  });

  it('gives the rectangular-barge BM = B²/(12d)', () => {
    const L = 30, B = 10, d = 2;
    const I = rectangularWaterplaneI(L, B), V = L * B * d;
    expect(metacentricRadius(I, V)).toBeCloseTo((B * B) / (12 * d), 9); // 4.1667 m
  });

  it('is stable when GM = BM − BG > 0 and gives a positive righting moment', () => {
    const L = 30, B = 10, d = 2;
    const I = rectangularWaterplaneI(L, B), V = L * B * d;
    const GM = metacentricHeight(I, V, 2);                  // BG = 2 m
    expect(GM).toBeGreaterThan(0);                          // 2.1667 m ⇒ stable
    expect(rightingMoment(W, GM, (10 * Math.PI) / 180)).toBeGreaterThan(0);
    expect(metacentricHeight(I, V, 6)).toBeLessThan(0);     // high CG ⇒ unstable
  });

  it('a wider beam raises BM (∝ B²) and stabilises', () => {
    const L = 30, d = 2;
    const bm10 = metacentricRadius(rectangularWaterplaneI(L, 10), L * 10 * d);
    const bm14 = metacentricRadius(rectangularWaterplaneI(L, 14), L * 14 * d);
    expect(bm14 / bm10).toBeCloseTo((14 / 10) ** 2, 6);    // BM ∝ B²
  });
});
