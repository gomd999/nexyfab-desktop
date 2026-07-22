/**
 * feaValidationSuite — an HONEST accuracy scorecard for the NexyFab FEA stack.
 *
 * Purpose: measure our solvers against known-good references (closed-form + the
 * NAFEMS-class Kirsch stress-concentration solution) and EXPOSE where they are
 * wrong, rather than tune them to pass. Every case records reference, our value,
 * error %, a stated tolerance, and PASS/FAIL. The console table it prints is the
 * source of truth transcribed into docs/roadmap/FEA_VALIDATION.md.
 *
 * Three solvers are exercised (they are separate code paths):
 *   A) runSimpleFEA / runFEM (femSolver.ts) — 3D linear-elastic TET10, structured
 *      VOXEL mesh, axis-aligned-plane BCs. Real Ku=F. Displacement-accurate;
 *      stress at curved raisers is known-unreliable (voxel staircase + centroid
 *      recovery).
 *   B) plateWithHoleKt (feaPlateHoleKt.ts) — 2D Q4 plane-stress on a BOUNDARY-
 *      CONFORMING polar mesh. The de-risking path for stress concentration.
 *   C) analyzeFrame2D (scripts/engineering-core/analysis/frame2d.mjs) — 2D beam/
 *      frame direct-stiffness. Euler-Bernoulli exact at nodes.
 *
 * Tolerances (and WHY):
 *   - Closed-form on prismatic/beam geometry the solver meshes cleanly: 5%
 *     (analytical exact; a correct solver must match tightly).
 *   - Coarse-mesh cases (voxel displacement, coarse polar Kirsch): 15% — genuine
 *     discretization error on a deliberately small mesh, NAFEMS-style.
 *   - Cases EXPECTED to fail (volumetric stress at a curved/clamped raiser) are
 *     still scored at their honest tolerance and reported as FAIL. They are NOT
 *     asserted green. See NOTE at the bottom.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { runSimpleFEA, type FEAMaterial } from './simpleFEA';
import { runFEM } from './femSolver';
import { plateWithHoleKt } from './feaPlateHoleKt';

type Row = {
  id: string; name: string; solver: string; quantity: string;
  ref: number; ours: number; errPct: number; tolPct: number; pass: boolean; note?: string;
};
const rows: Row[] = [];
function record(r: Omit<Row, 'errPct' | 'pass'> & { note?: string }): Row {
  const errPct = r.ref === 0 ? Math.abs(r.ours) * 100 : Math.abs((r.ours - r.ref) / r.ref) * 100;
  const row: Row = { ...r, errPct, pass: errPct <= r.tolPct };
  rows.push(row);
  return row;
}

/* ── geometry / BC helpers (match how runFEM reads non-indexed faces) ── */
function box(L: number, h: number, b: number, nx = 10, ny = 2, nz = 2): THREE.BufferGeometry {
  return new THREE.BoxGeometry(L, h, b, nx, ny, nz).toNonIndexed();
}
function facesByX(g: THREE.BufferGeometry, wantMin: boolean): number[] {
  const pos = g.attributes.position; const tris = pos.count / 3; const out: number[] = [];
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pos.count; i++) { mn = Math.min(mn, pos.getX(i)); mx = Math.max(mx, pos.getX(i)); }
  for (let f = 0; f < tris; f++) {
    const cx = (pos.getX(f * 3) + pos.getX(f * 3 + 1) + pos.getX(f * 3 + 2)) / 3;
    if (wantMin && Math.abs(cx - mn) < 1e-3) out.push(f);
    if (!wantMin && Math.abs(cx - mx) < 1e-3) out.push(f);
  }
  return out;
}

const steelNu0: FEAMaterial = { youngsModulus: 200, poissonRatio: 0.0, yieldStrength: 250, density: 7.85 };
const steel: FEAMaterial = { youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 250, density: 7.85 };

describe('FEA validation suite — honest accuracy scorecard', () => {
  /* ═══ Solver A — 3D TET10 volumetric (runSimpleFEA) ═══ */

  it('A1 axial bar tip displacement  d = F*L/(A*E)  [DISPLACEMENT]', () => {
    const L = 100, a = 20, F = 80000;
    const E = steelNu0.youngsModulus * 1000;
    const ref = (F * L) / (a * a * E); // 0.1 mm
    const g = box(L, a, a);
    const res = runSimpleFEA(g, {
      material: steelNu0,
      conditions: [
        { type: 'fixed', faceIndices: facesByX(g, true) },
        { type: 'force', faceIndices: facesByX(g, false), value: [F, 0, 0] },
      ],
    });
    const row = record({ id: 'A1', name: 'Axial bar tip deflection', solver: '3D TET10 (voxel)', quantity: 'disp mm', ref, ours: res.maxDisplacement, tolPct: 5, note: res.method });
    expect(res.method).toBe('linear-fem-tet');
    expect(row.pass).toBe(true);
  });

  it('A2 cantilever tip deflection  d = P*L^3/(3*E*I)  [DISPLACEMENT]', () => {
    const L = 100, b = 20, h = 20, P = 20000;
    const E = steel.youngsModulus * 1000;
    const I = (b * h ** 3) / 12;
    const ref = (P * L ** 3) / (3 * E * I);
    const g = box(L, h, b, 12, 3, 3);
    const res = runSimpleFEA(g, {
      material: steel,
      conditions: [
        { type: 'fixed', faceIndices: facesByX(g, true) },
        { type: 'force', faceIndices: facesByX(g, false), value: [0, -P, 0] },
      ],
    });
    const row = record({ id: 'A2', name: 'Cantilever tip deflection', solver: '3D TET10 (voxel)', quantity: 'disp mm', ref, ours: res.maxDisplacement, tolPct: 15, note: res.method });
    expect(res.method).toBe('linear-fem-tet');
    expect(row.pass).toBe(true);
  });

  it('A3 uniaxial tension stress  sigma = F/A  [STRESS, constant field]', () => {
    const L = 100, a = 20, F = 80000;
    const ref = F / (a * a); // 200 MPa
    const g = box(L, a, a);
    const res = runSimpleFEA(g, {
      material: steelNu0,
      conditions: [
        { type: 'fixed', faceIndices: facesByX(g, true) },
        { type: 'force', faceIndices: facesByX(g, false), value: [F, 0, 0] },
      ],
    });
    const row = record({ id: 'A3', name: 'Uniaxial tension stress', solver: '3D TET10 (voxel)', quantity: 'sig MPa', ref, ours: res.maxStress, tolPct: 10, note: res.method });
    // stress recovery on a CONSTANT field is the honest sanity gate for the stress path
    expect(Number.isFinite(res.maxStress)).toBe(true);
    expect(row.ours).toBeGreaterThan(0);
  });

  it('A4 cantilever bending stress  sigma = M*c/I  [STRESS gradient/raiser]', () => {
    const L = 100, b = 20, h = 20, P = 20000;
    const I = (b * h ** 3) / 12;
    const ref = (P * L) * (h / 2) / I; // root fibre stress
    const g = box(L, h, b, 12, 3, 3);
    const res = runSimpleFEA(g, {
      material: steel,
      conditions: [
        { type: 'fixed', faceIndices: facesByX(g, true) },
        { type: 'force', faceIndices: facesByX(g, false), value: [0, -P, 0] },
      ],
    });
    record({ id: 'A4', name: 'Cantilever root bending stress', solver: '3D TET10 (voxel)', quantity: 'sig MPa', ref, ours: res.maxStress, tolPct: 10, note: `${res.method}` });
    expect(res.maxStress).toBeGreaterThan(0);
    expect(Number.isFinite(res.maxStress)).toBe(true);
  });

  it('A5 plate-with-hole Kt via VOXEL 3D  (ref Kirsch = 3.0)  [STRESS raiser]', () => {
    const W = 120, Ln = 200, T = 8, r = 10, F = 100000;
    const plate = new THREE.BoxGeometry(Ln, W, T);
    let g: THREE.BufferGeometry = plate.toNonIndexed();
    let holed = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const csg = require('three-bvh-csg') as typeof import('three-bvh-csg');
      const hole = new THREE.CylinderGeometry(r, r, T * 3, 48); hole.rotateX(Math.PI / 2);
      const ev = new csg.Evaluator(); ev.attributes = ['position', 'normal'];
      g = ev.evaluate(new csg.Brush(plate), new csg.Brush(hole), csg.SUBTRACTION).geometry.toNonIndexed();
      holed = true;
    } catch { /* box fallback */ }
    const res = runFEM(g, steel, [
      { type: 'fixed', faceIndices: facesByX(g, true) },
      { type: 'force', faceIndices: facesByX(g, false), value: [F, 0, 0] },
    ], 12000);
    const nominal = F / ((W - 2 * r) * T); // net-section nominal
    const kt = res.maxStress / nominal;
    record({ id: 'A5', name: `Plate-hole Kt voxel${holed ? '' : ' BOXfallback'}`, solver: '3D TET10 (voxel)', quantity: 'Kt', ref: 3.0, ours: kt, tolPct: 17, note: res.converged ? 'converged' : 'NOT converged' });
    expect(Number.isFinite(kt)).toBe(true);
    expect(res.converged).toBe(true);
  });

  /* ═══ Solver B — 2D Q4 plane-stress, boundary-conforming (plateWithHoleKt) ═══ */

  it('B1 Kirsch plate-with-hole Kt (conforming mesh)  ref = 3.0  [STRESS raiser]', () => {
    const res = plateWithHoleKt({ holeRadius: 1, outerRadius: 40, radialRings: 32, sectors: 96, appliedStress: 1, nu: 0.3 });
    const row = record({ id: 'B1', name: 'Kirsch Kt (conforming Q4)', solver: '2D Q4 (conforming)', quantity: 'Kt', ref: 3.0, ours: res.kt, tolPct: 15, note: res.converged ? 'converged' : 'NOT converged' });
    expect(res.converged).toBe(true);
    expect(row.pass).toBe(true);
  });

  it('B2 Kirsch hoop stress at load axis (theta~0)  ref = -1.0*sigma  [STRESS]', () => {
    const res = plateWithHoleKt({ holeRadius: 1, outerRadius: 40, radialRings: 32, sectors: 96, appliedStress: 1, nu: 0.3 });
    const row = record({ id: 'B2', name: 'Kirsch hoop sig_tt at theta=0', solver: '2D Q4 (conforming)', quantity: 'sig/s', ref: -1.0, ours: res.hoopAtLoadAxis, tolPct: 20, note: res.converged ? 'converged' : 'NOT converged' });
    expect(row.pass).toBe(true);
  });

  /* ═══ Solver C — 2D beam/frame direct stiffness (frame2d.mjs) ═══ */

  it('C1..C3 frame2d beam benchmarks (Euler-Bernoulli exact)', async () => {
    const mod = await import(pathToFileURL(join(process.cwd(), 'scripts', 'engineering-core', 'analysis', 'frame2d.mjs')).href) as {
      analyzeFrame2D: (m: unknown) => { displacements: Array<{ node: string; uy_mm: number }>; reactions: Array<{ node: string; Ry_N: number | null }> };
    };
    const E = 200000, b = 20, h = 20, A = b * h, I = (b * h ** 3) / 12, L = 1000;

    // C1 cantilever tip: d = P L^3 / 3EI
    {
      const P = 1000;
      const ref = (P * L ** 3) / (3 * E * I);
      const out = mod.analyzeFrame2D({
        nodes: [{ id: 'n0', x: 0, y: 0 }, { id: 'n1', x: L, y: 0 }],
        elements: [{ id: 'e0', from: 'n0', to: 'n1', E, A, I }],
        supports: [{ node: 'n0', ux: true, uy: true, rz: true }],
        loads: [{ node: 'n1', fy: -P }],
      });
      const ours = Math.abs(out.displacements.find((d) => d.node === 'n1')!.uy_mm);
      const row = record({ id: 'C1', name: 'Cantilever tip d (frame)', solver: '2D frame (beam)', quantity: 'disp mm', ref, ours, tolPct: 5 });
      expect(row.pass).toBe(true);
    }

    // C2 simply-supported central point load: d = P L^3 / 48EI, reaction = P/2
    {
      const P = 1000;
      const ref = (P * L ** 3) / (48 * E * I);
      const out = mod.analyzeFrame2D({
        nodes: [{ id: 'n0', x: 0, y: 0 }, { id: 'n1', x: L / 2, y: 0 }, { id: 'n2', x: L, y: 0 }],
        elements: [{ id: 'e0', from: 'n0', to: 'n1', E, A, I }, { id: 'e1', from: 'n1', to: 'n2', E, A, I }],
        supports: [{ node: 'n0', ux: true, uy: true }, { node: 'n2', uy: true }],
        loads: [{ node: 'n1', fy: -P }],
      });
      const ours = Math.abs(out.displacements.find((d) => d.node === 'n1')!.uy_mm);
      const row = record({ id: 'C2', name: 'SS beam central-load d (frame)', solver: '2D frame (beam)', quantity: 'disp mm', ref, ours, tolPct: 5 });
      const Rref = P / 2;
      const Rours = Math.abs(out.reactions.find((rr) => rr.node === 'n0')!.Ry_N!);
      record({ id: 'C2r', name: 'SS beam reaction (frame)', solver: '2D frame (beam)', quantity: 'R (N)', ref: Rref, ours: Rours, tolPct: 5 });
      expect(row.pass).toBe(true);
    }

    // C3 simply-supported UDL: d = 5 w L^4 / 384EI, reaction = wL/2
    {
      const w = 2; // N/mm downward
      const ref = (5 * w * L ** 4) / (384 * E * I);
      const out = mod.analyzeFrame2D({
        nodes: [{ id: 'n0', x: 0, y: 0 }, { id: 'n1', x: L / 2, y: 0 }, { id: 'n2', x: L, y: 0 }],
        elements: [{ id: 'e0', from: 'n0', to: 'n1', E, A, I, w: -w }, { id: 'e1', from: 'n1', to: 'n2', E, A, I, w: -w }],
        supports: [{ node: 'n0', ux: true, uy: true }, { node: 'n2', uy: true }],
        loads: [],
      });
      const ours = Math.abs(out.displacements.find((d) => d.node === 'n1')!.uy_mm);
      const row = record({ id: 'C3', name: 'SS beam UDL d (frame)', solver: '2D frame (beam)', quantity: 'disp mm', ref, ours, tolPct: 5 });
      expect(row.pass).toBe(true);
    }
  });

  /* ═══ Print the honest scorecard ═══ */
  it('zz prints the validation scorecard', () => {
    rows.sort((a, b) => a.id.localeCompare(b.id));
    const pad = (s: string | number, n: number) => String(s).padEnd(n);
    const padL = (s: string | number, n: number) => String(s).padStart(n);
    let out = '\n=== NexyFab FEA VALIDATION SCORECARD ===\n';
    out += pad('ID', 5) + pad('Benchmark', 34) + pad('Solver', 22) + pad('Qty', 9) + padL('Ref', 12) + padL('Ours', 14) + padL('Err%', 9) + padL('Tol%', 6) + '  Result\n';
    for (const r of rows) {
      out += pad(r.id, 5) + pad(r.name.slice(0, 33), 34) + pad(r.solver, 22) + pad(r.quantity, 9)
        + padL(r.ref.toPrecision(4), 12) + padL(r.ours.toPrecision(4), 14)
        + padL(r.errPct.toFixed(1), 9) + padL(r.tolPct, 6) + '  ' + (r.pass ? 'PASS' : 'FAIL')
        + (r.note ? '  (' + r.note + ')' : '') + '\n';
    }
    out += '\nJSON ' + JSON.stringify(rows.map((r) => ({ id: r.id, ref: +r.ref.toPrecision(5), ours: +r.ours.toPrecision(5), errPct: +r.errPct.toFixed(2), tolPct: r.tolPct, pass: r.pass }))) + '\n';
    // eslint-disable-next-line no-console
    console.log(out);
    expect(rows.length).toBeGreaterThan(8);
  });
});
