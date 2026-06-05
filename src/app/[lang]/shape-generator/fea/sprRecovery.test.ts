/**
 * sprRecovery — Superconvergent Patch Recovery, verified: a polynomial stress field
 * sampled at Gauss points is recovered EXACTLY at the nodes by a same-order fit
 * (superconvergence, Z²=0); a lower-order fit smooths higher-order data and the Z²
 * indicator reports the under-fitting error; and noisy samples are averaged out.
 */
import { describe, it, expect } from 'vitest';
import { patchRecover, z2ErrorIndicator } from './sprRecovery';

// Gauss points of a 2×2 element patch (centres at ±1, 2-pt rule).
const g = 1 / Math.sqrt(3);
const gauss: Array<{ x: number; y: number }> = [];
for (const ex of [-1, 1]) for (const ey of [-1, 1]) for (const sx of [-g, g]) for (const sy of [-g, g]) gauss.push({ x: ex + sx, y: ey + sy });
const nodes = [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: -2, y: -2 }, { x: 2, y: -2 }];
const sample = (f: (x: number, y: number) => number) => gauss.map((p) => ({ x: p.x, y: p.y, value: f(p.x, p.y) }));

describe('sprRecovery — superconvergent patch recovery (verified)', () => {
  it('recovers a LINEAR field exactly at the nodes (degree-1 fit)', () => {
    const f = (x: number, y: number) => 2 + 3 * x - 1.5 * y;
    const recovered = patchRecover(sample(f), nodes, 1);
    nodes.forEach((n, i) => expect(recovered[i]).toBeCloseTo(f(n.x, n.y), 9));
    expect(z2ErrorIndicator(sample(f), 1)).toBeLessThan(1e-9); // FE stress already in the space
  });

  it('recovers a QUADRATIC field exactly with a degree-2 fit', () => {
    const f = (x: number, y: number) => 1 + x - 2 * y + 0.5 * x * x + x * y - y * y;
    const recovered = patchRecover(sample(f), nodes, 2);
    nodes.forEach((n, i) => expect(recovered[i]).toBeCloseTo(f(n.x, n.y), 9));
    expect(z2ErrorIndicator(sample(f), 2)).toBeLessThan(1e-9);
  });

  it('the Z² indicator detects under-fitting (degree-1 on a quadratic field)', () => {
    const f = (x: number, y: number) => 1 + x - 2 * y + 0.5 * x * x + x * y - y * y;
    expect(z2ErrorIndicator(sample(f), 1)).toBeGreaterThan(1); // can't represent the quadratic part
    // and a finer/higher-order fit drives it to zero.
    expect(z2ErrorIndicator(sample(f), 2)).toBeLessThan(1e-9);
  });

  it('smooths noisy samples toward the underlying field (least squares)', () => {
    const f = (x: number, y: number) => 2 + 3 * x - 1.5 * y;
    const noisy = sample(f).map((s, i) => ({ ...s, value: s.value + (i % 2 ? 0.1 : -0.1) }));
    const recovered = patchRecover(noisy, [{ x: 0, y: 0 }], 1);
    expect(recovered[0]).toBeCloseTo(f(0, 0), 6);   // ±0.1 noise averages out
    expect(z2ErrorIndicator(noisy, 1)).toBeGreaterThan(0); // residual reflects the noise
  });
});
