/**
 * arcLength — arc-length (Riks/Crisfield) continuation, verified on the von Mises
 * shallow-truss snap-through: the traced path captures the analytic load limit point,
 * then continues onto the DESCENDING branch (displacement rising while load falls) —
 * which load-controlled Newton cannot, since the tangent stiffness vanishes there.
 */
import { describe, it, expect } from 'vitest';
import { arcLengthSolve } from './arcLength';

// von Mises truss: two bars (EA, initial length L0=1) from supports to a shallow apex
// of height h. Internal vertical force vs apex descent w (engineering strain).
const EA = 1, h = 0.25, a = Math.sqrt(1 - h * h), L0 = 1;
const fint = (w: number) => {
  const L = Math.sqrt(a * a + (h - w) ** 2);
  return -2 * EA * ((L - L0) / L0) * ((h - w) / L);
};
const tangent = (w: number) => (fint(w + 1e-7) - fint(w - 1e-7)) / (2e-7);

// analytic snap-through limit (max of fint over the pre-snap range).
let analyticPmax = -Infinity, wLimit = 0;
for (let w = 0; w < h; w += 1e-6) { const P = fint(w); if (P > analyticPmax) { analyticPmax = P; wLimit = w; } }

describe('arcLength — von Mises truss snap-through (verified)', () => {
  const path = arcLengthSolve({ internalForce: fint, tangent, refLoad: 1, arcLength: 0.004, steps: 60 });
  // first local maximum of the load factor = the snap-through limit point.
  let li = -1;
  for (let i = 1; i < path.length - 1; i++) if (path[i].lambda > path[i - 1].lambda && path[i].lambda >= path[i + 1].lambda) { li = i; break; }

  it('captures the analytic load limit point', () => {
    expect(li).toBeGreaterThan(0);
    expect(path[li].lambda / analyticPmax).toBeGreaterThan(0.99);
    expect(path[li].lambda / analyticPmax).toBeLessThan(1.01);
    expect(path[li].u).toBeCloseTo(wLimit, 2);
  });

  it('traces onto the descending branch past the limit (load control cannot)', () => {
    const after = path.slice(li + 1, li + 10);
    for (let k = 1; k < after.length; k++) expect(after[k].u).toBeGreaterThan(after[k - 1].u); // u keeps rising
    expect(after[after.length - 1].lambda).toBeLessThan(path[li].lambda);                       // load falls
    // the tangent stiffness ≈ 0 at the limit — where load-controlled Newton diverges.
    expect(Math.abs(tangent(wLimit))).toBeLessThan(1e-4);
  });

  it('stays on the equilibrium path (residual f(u) − λ·q ≈ 0)', () => {
    let maxRes = 0;
    for (const p of path) maxRes = Math.max(maxRes, Math.abs(fint(p.u) - p.lambda));
    expect(maxRes).toBeLessThan(1e-8);
  });

  it('advances a roughly constant arc length each step', () => {
    for (let i = 2; i < 20; i++) {
      const ds = Math.hypot(path[i].u - path[i - 1].u, path[i].lambda - path[i - 1].lambda);
      expect(ds).toBeGreaterThan(0.002);
      expect(ds).toBeLessThan(0.01);
    }
  });
});
