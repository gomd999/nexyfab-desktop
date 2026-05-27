import { describe, it, expect } from 'vitest';
import {
  worstCase, rss, monteCarlo,
  type DimensionLink, type StackupChain,
} from './toleranceStackup';

function link(name: string, nominal: number, plus: number, minus: number, direction: 1 | -1 = 1): DimensionLink {
  return { name, nominalMm: nominal, tolPlusMm: plus, tolMinusMm: minus, direction };
}

describe('worstCase', () => {
  it('sums nominals of additive chain', () => {
    const c: StackupChain = { links: [link('a', 10, 0, 0), link('b', 20, 0, 0)] };
    expect(worstCase(c).nominalMm).toBe(30);
  });

  it('sums absolute tolerances', () => {
    const c: StackupChain = {
      links: [
        link('a', 10, 0.1, -0.1),
        link('b', 20, 0.2, -0.2),
      ],
    };
    const r = worstCase(c);
    expect(r.toleranceMm).toBeCloseTo(0.6, 5); // ±0.1 + ±0.2 = ±0.3 total = 0.6 width
    expect(r.maxMm).toBeCloseTo(30.3, 5);
    expect(r.minMm).toBeCloseTo(29.7, 5);
  });

  it('subtractive direction reduces nominal', () => {
    const c: StackupChain = {
      links: [link('outer', 100, 0.1, -0.1, 1), link('inner', 80, 0.05, -0.05, -1)],
    };
    expect(worstCase(c).nominalMm).toBe(20);
  });

  it('asymmetric tolerances handled correctly', () => {
    const c: StackupChain = { links: [link('a', 10, 0.3, -0.1, 1)] };
    const r = worstCase(c);
    expect(r.maxMm).toBeCloseTo(10.3, 5);
    expect(r.minMm).toBeCloseTo(9.9, 5);
  });
});

describe('rss', () => {
  it('returns smaller sigma than worst-case spread', () => {
    const c: StackupChain = {
      links: [
        link('a', 10, 0.3, -0.3),
        link('b', 20, 0.3, -0.3),
        link('c', 30, 0.3, -0.3),
      ],
    };
    const r = rss(c);
    const wc = worstCase(c);
    // RSS 3σ should be smaller than WC tol/2.
    expect(r.threeSigmaMm).toBeLessThan(wc.toleranceMm / 2);
  });

  it('three-sigma scales with sigma', () => {
    const c: StackupChain = { links: [link('a', 10, 0.3, -0.3)] };
    const r = rss(c);
    expect(r.threeSigmaMm / r.sigmaMm).toBeCloseTo(3, 6);
  });

  it('zero tolerance gives zero sigma', () => {
    const c: StackupChain = { links: [link('a', 10, 0, 0)] };
    expect(rss(c).sigmaMm).toBe(0);
  });
});

describe('monteCarlo', () => {
  it('mean approximately equals nominal for symmetric distributions', () => {
    const c: StackupChain = {
      links: [
        link('a', 10, 0.1, -0.1),
        link('b', 20, 0.2, -0.2),
      ],
    };
    const r = monteCarlo(c, 5000);
    expect(r.meanMm).toBeCloseTo(30, 0); // within ±0.5
  });

  it('sigma matches RSS analytic approx', () => {
    const c: StackupChain = {
      links: [
        link('a', 10, 0.3, -0.3),
        link('b', 20, 0.3, -0.3),
        link('c', 30, 0.3, -0.3),
      ],
    };
    const rssRes = rss(c);
    const mcRes = monteCarlo(c, 10000);
    // Should be close (within 20% — MC noise).
    expect(Math.abs(mcRes.sigmaMm - rssRes.sigmaMm) / rssRes.sigmaMm).toBeLessThan(0.2);
  });

  it('cpkLike returns fraction within window', () => {
    const c: StackupChain = { links: [link('a', 10, 0.3, -0.3)] };
    const r = monteCarlo(c, 5000, 1.0); // 1.0mm window
    expect(r.cpkLike).toBeCloseTo(1.0, 1);
  });

  it('respects uniform distribution', () => {
    const c: StackupChain = {
      links: [{ ...link('a', 10, 0.3, -0.3), distribution: 'uniform' }],
    };
    const r = monteCarlo(c, 5000);
    // Uniform on ±0.3 → sigma = 0.3/√3 ≈ 0.173
    expect(r.sigmaMm).toBeGreaterThan(0.10);
    expect(r.sigmaMm).toBeLessThan(0.25);
  });
});
