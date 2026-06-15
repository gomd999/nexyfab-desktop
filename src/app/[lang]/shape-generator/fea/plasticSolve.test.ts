/**
 * plasticSolve — global Newton-Raphson J2 elastoplastic solve with the consistent
 * algorithmic tangent. Verified: the tangent matches a finite-difference of the
 * stress to machine precision (and is symmetric); a uniaxial bar reproduces the
 * analytic bilinear stress–strain curve (slope E, yield σ_y, post-yield tangent
 * E_t = EH/(E+H)) and the corresponding reaction.
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { materialTangentJ2, hex8PlasticSolve } from './plasticSolve';
import { zeroState, J2Material } from './plasticityJ2';

const mat: J2Material = { E: 210000, nu: 0.3, yield0: 250, hardening: 2000 };

describe('plasticSolve — consistent algorithmic tangent', () => {
  it('matches a finite-difference of the stress (plastic regime) and is symmetric', () => {
    const eps = [0.003, -0.0008, -0.0008, 0.0005, 0, 0]; // beyond yield
    const base = materialTangentJ2(eps, zeroState(), mat);
    expect(base.stress[0]).not.toBe(0);                  // genuinely plastic
    const d = 1e-8;
    let maxErr = 0, maxD = 0;
    for (let j = 0; j < 6; j++) {
      const ep = eps.slice(), em = eps.slice(); ep[j] += d; em[j] -= d;
      const sp = materialTangentJ2(ep, zeroState(), mat).stress;
      const sm = materialTangentJ2(em, zeroState(), mat).stress;
      for (let i = 0; i < 6; i++) {
        const fd = (sp[i] - sm[i]) / (2 * d);
        maxErr = Math.max(maxErr, Math.abs(fd - base.D[i][j]));
        maxD = Math.max(maxD, Math.abs(base.D[i][j]));
      }
    }
    expect(maxErr / maxD).toBeLessThan(1e-4);            // consistent tangent = d(stress)/d(strain)
    let asym = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) asym = Math.max(asym, Math.abs(base.D[i][j] - base.D[j][i]));
    expect(asym).toBeLessThan(1e-6);
  });

  it('reduces to the elastic stiffness below yield', () => {
    const small = [1e-5, 0, 0, 0, 0, 0];                 // well below yield
    const r = materialTangentJ2(small, zeroState(), mat);
    const G = mat.E / (2 * (1 + mat.nu)), K = mat.E / (3 * (1 - 2 * mat.nu)), lam = K - 2 * G / 3;
    expect(r.D[0][0]).toBeCloseTo(lam + 2 * G, 3);
    expect(r.D[0][1]).toBeCloseTo(lam, 3);
    expect(r.D[3][3]).toBeCloseTo(G, 3);
  });
});

describe('plasticSolve — uniaxial bar (global Newton, verified vs bilinear curve)', () => {
  const nx = 4, ny = 2, nz = 2, h = 10;
  const grid = new TopologyGrid(nx, ny, nz);
  const L = nx * h, A = (ny * h) * (nz * h);
  const epsY = mat.yield0 / mat.E, dMax = 3 * epsY * L;
  const steps = 15;

  // symmetry-plane BCs (back faces roller) + prescribed stretch on the +x face.
  const fixed = new Map<number, number>();
  for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) fixed.set(grid.node(0, iy, iz) * 3 + 0, 0);
  for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) fixed.set(grid.node(ix, 0, iz) * 3 + 1, 0);
  for (let ix = 0; ix <= nx; ix++) for (let iy = 0; iy <= ny; iy++) fixed.set(grid.node(ix, iy, 0) * 3 + 2, 0);
  for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) fixed.set(grid.node(nx, iy, iz) * 3 + 0, dMax);
  const reactionDofs: number[] = [];
  for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) reactionDofs.push(grid.node(nx, iy, iz) * 3 + 0);

  const res = hex8PlasticSolve(grid, { material: mat, cell: h, fixedDisp: fixed, loadSteps: steps, reactionDofs });
  const sigma = (s: number) => res.reactionHistory[s] / A;
  const strain = (s: number) => ((s + 1) / steps) * dMax / L;

  it('converges every load step', () => {
    expect(res.converged).toBe(true);
    expect(Math.max(...res.newtonIters)).toBeLessThan(20);
  });

  it('the elastic branch has slope E and yields at σ_y', () => {
    const slope = (sigma(1) - sigma(0)) / (strain(1) - strain(0));
    expect(slope).toBeCloseTo(mat.E, -1);                // within ~10 (≈E to 5 sig figs)
    // step 5 sits at ε ≈ ε_y ⇒ σ ≈ σ_y.
    const atYield = res.reactionHistory.findIndex((_, s) => strain(s) >= epsY * 0.999);
    expect(sigma(atYield)).toBeGreaterThan(mat.yield0 * 0.98);
    expect(sigma(atYield)).toBeLessThan(mat.yield0 * 1.03);
  });

  it('the post-yield tangent equals E_t = EH/(E+H)', () => {
    const Et = (mat.E * mat.hardening) / (mat.E + mat.hardening);
    const slope = (sigma(steps - 1) - sigma(11)) / (strain(steps - 1) - strain(11));
    expect(slope / Et).toBeGreaterThan(0.97);
    expect(slope / Et).toBeLessThan(1.03);
  });

  it('the stress follows the analytic bilinear law σ(ε)', () => {
    const Et = (mat.E * mat.hardening) / (mat.E + mat.hardening);
    for (let s = 0; s < steps; s++) {
      const e = strain(s);
      const analytic = e <= epsY ? mat.E * e : mat.yield0 + Et * (e - epsY);
      expect(Math.abs(sigma(s) - analytic) / analytic).toBeLessThan(0.01);
    }
  });
});
