/**
 * mpc — multipoint constraints / RBE2 rigid links by the master–slave transformation,
 * verified against the rigid-arm analytic: an offset force at the slave is carried to
 * the base as a force + moment (v_A = F/k_v, θ_A = F·L/k_θ), the tip follows the
 * rigid-arm compliance v_B = F/k_v + F·L²/k_θ, and the slave obeys rigid-body
 * kinematics exactly.
 */
import { describe, it, expect } from 'vitest';
import { solveWithMPC, rigidLink2D } from './mpc';

// DOFs [uA,vA,θA, uB,vB,θB]; node A grounded by springs, node B rigid-linked at (L,0).
const ku = 1000, kv = 2000, kth = 5e5, L = 50;
function model() {
  const K = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  K[0][0] = ku; K[1][1] = kv; K[2][2] = kth;       // B carries no own stiffness
  const cons = rigidLink2D([0, 1, 2], [3, 4, 5], L, 0);
  return { K, cons };
}

describe('mpc — rigid link (RBE2), verified', () => {
  it('an offset force transmits to the base as a force + moment', () => {
    const { K, cons } = model();
    const F = 100;
    const f = new Array<number>(6).fill(0); f[4] = F; // vertical force at B
    const { u } = solveWithMPC(K, f, cons);
    expect(u[1]).toBeCloseTo(F / kv, 10);            // v_A = F/k_v
    expect(u[2]).toBeCloseTo((F * L) / kth, 12);     // θ_A = F·L/k_θ (moment from the offset)
  });

  it('the rigid-arm tip follows v_B = F/k_v + F·L²/k_θ', () => {
    const { K, cons } = model();
    const F = 100;
    const f = new Array<number>(6).fill(0); f[4] = F;
    const { u } = solveWithMPC(K, f, cons);
    expect(u[4]).toBeCloseTo(F / kv + (F * L * L) / kth, 10);
  });

  it('the slave obeys rigid-body kinematics exactly', () => {
    const { K, cons } = model();
    const f = new Array<number>(6).fill(0); f[4] = 100;
    const { u } = solveWithMPC(K, f, cons);
    const [uA, vA, thA, uB, vB, thB] = u;
    expect(vB - vA - L * thA).toBeCloseTo(0, 10);    // v_B = v_A + L·θ_A
    expect(uB).toBeCloseTo(uA, 12);
    expect(thB).toBeCloseTo(thA, 12);
  });

  it('a pure moment at the master rotates the rigid cluster (v_B = L·θ_A)', () => {
    const { K, cons } = model();
    const M = 1000;
    const f = new Array<number>(6).fill(0); f[2] = M; // moment at A
    const { u } = solveWithMPC(K, f, cons);
    expect(u[2]).toBeCloseTo(M / kth, 12);
    expect(u[4]).toBeCloseTo((L * M) / kth, 10);
  });
});
