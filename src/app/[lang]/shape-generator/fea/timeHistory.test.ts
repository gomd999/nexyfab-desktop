/**
 * timeHistory — Newmark-β direct time integration, verified against the analytic
 * single-mode response: undamped free vibration at the natural frequency with
 * preserved amplitude (energy conservation), the damped envelope e^{−ζω t} (via
 * the logarithmic decrement), and the static limit (settles to K⁻¹F).
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8TimeHistory } from './timeHistory';
import { assembleHex8Modal, fixedFaceNodes } from './modalFEM';
import { computeModes } from './modalAnalysis';

const mat = { E: 210000, nu: 0.3, rho: 7.85e-9 };
const grid = new TopologyGrid(12, 2, 2);
const fixed = fixedFaceNodes(grid, 'x');
const opts = { ...mat, cell: 10, fixed };

// first mode (shape + frequency) from the verified modal solver.
const asm = assembleHex8Modal(grid, opts);
const mode1 = computeModes({ stiffness: asm.Kff, massDiag: asm.Mdiag, modeCount: 1, maxIters: 300 })[0];
const f1 = mode1.frequencyHz, w1 = 2 * Math.PI * f1;
const phi = Float64Array.from(mode1.vector);
let dof = 0, mx = 0;
for (let i = 0; i < asm.nFree; i++) if (Math.abs(phi[i]) > mx) { mx = Math.abs(phi[i]); dof = i; }
const T1 = 1 / f1, dt = T1 / 50;

/** Local maxima of |series| with their times — for envelope / log-decrement fits. */
function peaks(series: number[], times: number[]): Array<{ t: number; a: number }> {
  const out: Array<{ t: number; a: number }> = [];
  for (let i = 1; i < series.length - 1; i++) {
    const m = Math.abs(series[i]);
    if (m > Math.abs(series[i - 1]) && m >= Math.abs(series[i + 1])) out.push({ t: times[i], a: m });
  }
  return out;
}

describe('timeHistory — Newmark-β dynamics (verified)', () => {
  it('undamped free vibration follows cos(ω₁t) and conserves amplitude', () => {
    const r = hex8TimeHistory(grid, { ...opts, dt, steps: 150, initialDisp: phi, probeFreeDofs: [dof] });
    const p = r.probe[0], u0 = p[0];
    let maxRelErr = 0;
    for (let i = 0; i < r.times.length; i++) {
      const analytic = u0 * Math.cos(w1 * r.times[i]);
      maxRelErr = Math.max(maxRelErr, Math.abs(p[i] - analytic) / Math.abs(u0));
    }
    expect(maxRelErr).toBeLessThan(0.05);        // small Newmark period drift over 3 cycles
    // amplitude preserved (average-acceleration Newmark adds no numerical damping).
    let lateMax = 0;
    for (let i = r.times.length - 50; i < r.times.length; i++) lateMax = Math.max(lateMax, Math.abs(p[i]));
    expect(lateMax / Math.abs(u0)).toBeGreaterThan(0.98);
    expect(lateMax / Math.abs(u0)).toBeLessThan(1.02);
  });

  it('Rayleigh-damped response decays at the analytic rate (log decrement → ζ)', () => {
    const zeta = 0.05, betaR = 2 * zeta / w1; // C = β_R K ⇒ ζ₁ = β_R ω₁/2
    const r = hex8TimeHistory(grid, { ...opts, dt, steps: 200, initialDisp: phi, rayleighBeta: betaR, probeFreeDofs: [dof] });
    const pk = peaks(r.probe[0], r.times).filter((q) => q.a > 0);
    // linear fit ln(a) = ln(a0) − ζω₁·t over the peaks ⇒ slope = −ζω₁.
    const n = pk.length;
    let st = 0, sl = 0, stt = 0, stl = 0;
    for (const q of pk) { const l = Math.log(q.a); st += q.t; sl += l; stt += q.t * q.t; stl += q.t * l; }
    const slope = (n * stl - st * sl) / (n * stt - st * st);
    const zetaMeasured = -slope / w1;
    expect(zetaMeasured / zeta).toBeGreaterThan(0.9);
    expect(zetaMeasured / zeta).toBeLessThan(1.1);
  });

  it('a constant load with damping settles to the static solution K⁻¹F', () => {
    const tip = grid.node(12, 1, 1);
    const tdof = asm.dofToFree[tip * 3 + 1];
    const load = new Float64Array(asm.nFree); load[tdof] = 500;
    const betaR = 4 * (2 * 0.05 / w1);           // heavier damping → settle fast
    const r = hex8TimeHistory(grid, { ...opts, dt: T1 / 20, steps: 2000, load, rayleighBeta: betaR, probeFreeDofs: [tdof] });
    // static reference K u = F.
    const K = asm.Kff, nF = asm.nFree;
    const x = new Float64Array(nF), res = Float64Array.from(load), p = Float64Array.from(load), Ap = new Float64Array(nF);
    const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < nF; i++) s += u[i] * v[i]; return s; };
    let rr = dot(res, res);
    for (let it = 0; it < 3000; it++) {
      for (let i = 0; i < nF; i++) { const row = i * nF; let s = 0; for (let j = 0; j < nF; j++) s += K[row + j] * p[j]; Ap[i] = s; }
      const al = rr / (dot(p, Ap) || 1e-300);
      for (let i = 0; i < nF; i++) { x[i] += al * p[i]; res[i] -= al * Ap[i]; }
      const rn = dot(res, res); if (rn < 1e-20) break;
      const be = rn / rr; for (let i = 0; i < nF; i++) p[i] = res[i] + be * p[i]; rr = rn;
    }
    expect(r.finalDisp[tdof] / x[tdof]).toBeGreaterThan(0.99);
    expect(r.finalDisp[tdof] / x[tdof]).toBeLessThan(1.01);
  });
});
