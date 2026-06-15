/**
 * craigBampton — component-mode synthesis (dynamic substructuring), verified on a
 * fixed-free spring-mass chain: the reduced model's lowest natural frequencies
 * converge to the full model's as fixed-interface modes are added, and it is far
 * more accurate than Guyan (no internal modes) for dynamics.
 */
import { describe, it, expect } from 'vitest';
import { craigBampton, naturalFrequencies } from './craigBampton';

// fixed-free spring-mass chain (n DOFs, unit spring/mass).
function chain(n: number): { K: number[][]; M: number[][] } {
  const K = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) { M[i][i] = 1; K[i][i] = i < n - 1 ? 2 : 1; }
  for (let i = 0; i < n - 1; i++) { K[i][i + 1] = -1; K[i + 1][i] = -1; }
  return { K, M };
}

const n = 10;
const { K, M } = chain(n);
const full = naturalFrequencies(K, M, 4);
const reduced = (nModes: number) => {
  const cb = craigBampton(K, M, [n - 1], nModes);    // keep the tip (interface)
  return { cb, freqs: naturalFrequencies(cb.Kr, cb.Mr, Math.min(3, 1 + nModes)) };
};

describe('craigBampton — component-mode synthesis (verified)', () => {
  it('reduces to the boundary DOFs + the chosen number of internal modes', () => {
    const { cb } = reduced(5);
    expect(cb.Kr.length).toBe(1 + 5);                  // 1 boundary + 5 modes
    expect(cb.Mr.length).toBe(1 + 5);
  });

  it('the fundamental frequency converges to the full model as modes are added', () => {
    const err = (nModes: number) => Math.abs(reduced(nModes).freqs[0] - full[0]) / full[0];
    expect(err(0)).toBeGreaterThan(0.02);              // Guyan: poor for dynamics (~8%)
    expect(err(2)).toBeLessThan(0.01);                 // a couple of modes ⇒ <1%
    expect(err(5)).toBeLessThan(1e-3);                 // converged
    expect(err(5)).toBeLessThan(err(2));               // monotone improvement
    expect(err(2)).toBeLessThan(err(0));
  });

  it('beats Guyan: the lowest three frequencies are accurate with enough modes', () => {
    const { freqs } = reduced(5);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(freqs[i] - full[i]) / full[i]).toBeLessThan(2e-3);
    }
    // Craig–Bampton frequencies bound the true ones from above (Rayleigh–Ritz).
    expect(freqs[0]).toBeGreaterThan(full[0] - 1e-9);
  });
});
