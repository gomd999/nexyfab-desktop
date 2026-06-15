/**
 * contact — frictionless node-to-rigid-wall (Signorini) contact by active set,
 * verified against the analytic spring-against-a-wall: below the gap the wall does
 * not react and the displacement is the free F/k; once the gap closes the contact
 * displacement clamps at the gap (no penetration), every contact reaction is
 * compressive (complementarity), and the wall carries exactly F − k·δ.
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8RigidContact, consistentFaceLoad } from './contact';

const E = 210000, nu = 0.3;
const nx = 4, ny = 2, nz = 2, h = 10;
const grid = new TopologyGrid(nx, ny, nz);
const L = nx * h, A = (ny * h) * (nz * h), k = (E * A) / L;
const delta = 0.02;

// symmetry-plane supports (uniaxial stress) + the +x face is the contact surface.
const fixed = new Map<number, number>();
for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) fixed.set(grid.node(0, iy, iz) * 3 + 0, 0);
for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) fixed.set(grid.node(ix, 0, iz) * 3 + 1, 0);
for (let ix = 0; ix <= nx; ix++) for (let iy = 0; iy <= ny; iy++) fixed.set(grid.node(ix, iy, 0) * 3 + 2, 0);
const face: number[] = [];
for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) face.push(grid.node(nx, iy, iz));
const endU = (u: Float64Array) => u[grid.node(nx, 1, 1) * 3 + 0];
const solve = (F: number) => hex8RigidContact(grid, { E, nu, cell: h, fixed, load: consistentFaceLoad(grid, 'x', true, F, 0), contactNodes: face, normalAxis: 0, gap: delta });

describe('contact — node-to-rigid-wall active set (verified)', () => {
  it('does not contact when the free displacement is below the gap (u = F/k)', () => {
    const F = k * delta * 0.5;                  // free end would reach 0.5·δ
    const r = solve(F);
    expect(r.activeSet.length).toBe(0);
    expect(endU(r.displacement)).toBeCloseTo(F / k, 6);
    expect(endU(r.displacement)).toBeLessThan(delta);
  });

  it('clamps at the gap with no penetration once contact closes', () => {
    const r = solve(k * delta * 2);
    let maxU = 0; for (const nd of face) maxU = Math.max(maxU, r.displacement[nd * 3 + 0]);
    expect(maxU).toBeLessThanOrEqual(delta + 1e-9);          // no penetration
    expect(endU(r.displacement)).toBeCloseTo(delta, 6);      // clamped to the wall
    expect(r.activeSet.length).toBe(face.length);            // whole face in contact
  });

  it('the wall reaction equals F − k·δ and is compressive (complementarity)', () => {
    const F = k * delta * 2;
    const r = solve(F);
    let sumR = 0; for (const v of r.reactions.values()) sumR += v;
    expect(sumR).toBeCloseTo(-(F - k * delta), 0);           // wall carries F − kδ
    for (const v of r.reactions.values()) expect(v).toBeLessThanOrEqual(1e-6); // pushes, never pulls
  });

  it('the wall reaction grows linearly with applied load past contact', () => {
    const reaction = (F: number) => { let s = 0; for (const v of solve(F).reactions.values()) s += v; return -s; };
    const r3 = reaction(k * delta * 3), r2 = reaction(k * delta * 2);
    // R = F − kδ ⇒ ΔR = ΔF for equal-area loading.
    expect(r3 - r2).toBeCloseTo(k * delta, 0);
  });
});
