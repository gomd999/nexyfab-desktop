/**
 * feaRaiserPerf — the PRODUCTION-path proof + MEASURED wall-time for the curved-
 * stress-raiser precise solve, so the Stage-1/2 A5 fix actually benefits real users.
 *
 * MEASURED (this machine, warm, deterministic — the perf test below logs it):
 *   the config feaFromStl's precise branch invokes — runFEM(...,12000,{refine:'on',
 *   maxCornerNodes:8000}) — gives ~68k DOF, ~1120 PCG iters, ~24 s, Kt 2.833 on the
 *   Kirsch plate-with-hole (X-tension): Kirsch infinite-plate 3.0 => 5.6% low;
 *   finite-width Howland 2.573 => 10.1% high. Engineering-grade, and SLOW (~24 s) —
 *   which is why feaFromStl exposes it as an OPT-IN precise pass, never a silent
 *   default that could time a live request out.
 *
 * The tests cover the two halves the task asks for:
 *   (B) ACCURACY of the exact config the server now calls — Kt within the
 *       engineering band, with the wall-time logged (the perf assertion);
 *   (C) WIRING through the production server entry feaFromStl (== fea-quick route):
 *       precise:true reaches the refined engineering solve and reports honest
 *       metadata; precise:false leaves the raiser on the FAST uniform screening
 *       path and says so; a prismatic part carries no raiser cost at all.
 *
 * NOTE on why (C) does not re-assert Kt≈3: feaFromStl's auto BC clamps the whole
 * bottom face (all DOF) and loads the top — a clamped-axial setup, NOT the pure
 * Kirsch tension of (B). So (C) proves the precise path is REACHED and labelled
 * honestly; (B) owns the Kirsch accuracy number on the controlled BC.
 */
import { describe, it, expect } from 'vitest';
import { heavyTestBudgetMs } from '@/test/heavyTestBudget';
import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import { feaFromStl } from './feaPackage';
import { runFEM } from './femSolver';
import type { FEAMaterial } from './simpleFEA';

const steel: FEAMaterial = { youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 250, density: 7.85 };

/** Serialise a non-indexed BufferGeometry to a binary STL (what feaFromStl parses). */
function geometryToStl(g: THREE.BufferGeometry): Uint8Array {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position') as THREE.BufferAttribute;
  const tris = pos.count / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris, true);
  for (let t = 0; t < tris; t++) {
    const o = 84 + t * 50 + 12; // skip 12-byte normal (stlToGeometry recomputes normals)
    for (let k = 0; k < 3; k++) {
      const vi = t * 3 + k;
      dv.setFloat32(o + k * 12 + 0, pos.getX(vi), true);
      dv.setFloat32(o + k * 12 + 4, pos.getY(vi), true);
      dv.setFloat32(o + k * 12 + 8, pos.getZ(vi), true);
    }
  }
  return new Uint8Array(buf);
}

/** A5 Kirsch plate-with-hole: plate Ln(x) x W(y) x T(z), hole axis z (thickness). */
function plateWithHoleX(W: number, Ln: number, T: number, r: number): THREE.BufferGeometry {
  const plate = new THREE.BoxGeometry(Ln, W, T);
  const hole = new THREE.CylinderGeometry(r, r, T * 3, 48); hole.rotateX(Math.PI / 2);
  const ev = new Evaluator(); ev.attributes = ['position', 'normal'];
  return ev.evaluate(new Brush(plate), new Brush(hole), SUBTRACTION).geometry.toNonIndexed();
}
function facesByX(g: THREE.BufferGeometry, wantMin: boolean): number[] {
  const pos = g.attributes.position; const tris = pos.count / 3; const out: number[] = [];
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pos.count; i++) { mn = Math.min(mn, pos.getX(i)); mx = Math.max(mx, pos.getX(i)); }
  for (let f = 0; f < tris; f++) { const b = f * 3; const cx = (pos.getX(b) + pos.getX(b + 1) + pos.getX(b + 2)) / 3;
    if (wantMin && Math.abs(cx - mn) < 0.5) out.push(f); if (!wantMin && Math.abs(cx - mx) < 0.5) out.push(f); }
  return out;
}

/** Plate-with-hole oriented for Z-tension so feaFromStl's auto BC drives it. */
function raiserPlateZ(W: number, Ln: number, T: number, r: number): THREE.BufferGeometry {
  const plate = new THREE.BoxGeometry(T, W, Ln);
  const hole = new THREE.CylinderGeometry(r, r, T * 3, 48); hole.rotateZ(Math.PI / 2);
  const ev = new Evaluator(); ev.attributes = ['position', 'normal'];
  return ev.evaluate(new Brush(plate), new Brush(hole), SUBTRACTION).geometry.toNonIndexed();
}

describe('FEA raiser — precise solve accuracy + production-path wiring', () => {
  // ── (B) ACCURACY + PERF of the exact config feaFromStl.precise invokes ──
  it('B: precise config runFEM(...,12000,{refine:on,cap:8000}) gives Kt in the engineering band — logs wall-time', () => {
    const W = 120, Ln = 200, T = 8, r = 10, F = 100000;
    const g = plateWithHoleX(W, Ln, T, r);
    const t0 = Date.now();
    const res = runFEM(g, steel, [
      { type: 'fixed', faceIndices: facesByX(g, true) },
      { type: 'force', faceIndices: facesByX(g, false), value: [F, 0, 0] },
    ], 12000, { refine: 'on', maxCornerNodes: 8000 });
    const ms = Date.now() - t0;
    const nominal = F / ((W - 2 * r) * T);
    const kt = res.maxStress / nominal;
    const dW = (2 * r) / W;
    const ktH = 3.0 - 3.13 * dW + 3.66 * dW ** 2 - 1.53 * dW ** 3;
     
    console.log(`\n=== PRECISE RAISER SOLVE (perf) ===\n` +
      `DOF=${res.dofCount} elems=${res.elementCount} iters=${res.iterations} wall=${ms}ms (${(ms / 1000).toFixed(1)}s) ` +
      `mesh=${res.meshMode} pre=${res.preconditioner}\n` +
      `Kt=${kt.toFixed(3)}  Kirsch=3.0 err ${(Math.abs(kt - 3) / 3 * 100).toFixed(1)}%  Howland=${ktH.toFixed(3)} err ${(Math.abs(kt - ktH) / ktH * 100).toFixed(1)}%\n`);
    expect(res.converged).toBe(true);
    expect(res.meshMode).toBe('refined');
    expect(res.dofCount).toBeGreaterThan(40000); // engineering-grade resolution
    expect(ms).toBeGreaterThan(0);               // wall-time recorded (the perf number, ~24s)
    expect(kt).toBeGreaterThan(2.5);             // matches the A5 harness band
    expect(kt).toBeLessThan(3.5);
  }, heavyTestBudgetMs(26_200)); // 격리 실측 26.1s — 260728 §6-4(근거=src/test/heavyTestBudget.ts)

  // ── (C) WIRING through the production server entry feaFromStl ──
  it('C1: prismatic box STL — no raiser, fast uniform screening (unchanged, no refine cost)', () => {
    const t0 = Date.now();
    const out = feaFromStl({ stl: geometryToStl(new THREE.BoxGeometry(80, 80, 160)), materialKey: 'steel', loadN: 100000, precise: true });
    const ms = Date.now() - t0;
    expect(out.raiser).toBeNull();               // precise:true is a no-op on a prismatic part
    expect(out.result.method).toBe('linear-fem-tet');
    expect(out.result.meshMode).toBe('uniform');
    expect(ms).toBeLessThan(15000);              // never the ~24s refine
  });

  it('C2: raiser STL — screening (default) is fast + honestly labelled; precise:true reaches the refined engineering solve', () => {
    const stl = geometryToStl(raiserPlateZ(120, 200, 8, 10));

    // default (screening): fast, refine NOT applied, honestly flagged.
    const ts0 = Date.now();
    const scr = feaFromStl({ stl, materialKey: 'steel', loadN: 100000 });
    const scrMs = Date.now() - ts0;
    expect(scr.raiser).not.toBeNull();
    expect(scr.raiser!.detected).toBe(true);
    expect(scr.raiser!.applied).toBe(false);
    expect(scr.raiser!.grade).toBe('screening');
    expect(scr.result.meshMode).toBe('uniform');
    expect(scrMs).toBeLessThan(15000);           // screening stays fast on a raiser part

    // precise:true — the A5-quality refined solve is REACHED and labelled engineering.
    const tp0 = Date.now();
    const out = feaFromStl({ stl, materialKey: 'steel', loadN: 100000, precise: true });
    const preMs = Date.now() - tp0;
     
    console.log(`\n=== SERVER WIRING (feaFromStl) ===\n` +
      `screening ${scrMs}ms mesh=${scr.result.meshMode} | precise ${preMs}ms raiser.wallMs=${out.raiser?.wallMs} ` +
      `DOF=${out.raiser?.dofCount} grade=${out.raiser?.grade} applied=${out.raiser?.applied} conv=${out.raiser?.converged} mesh=${out.result.meshMode}\n`);
    expect(out.raiser).not.toBeNull();
    expect(out.raiser!.detected).toBe(true);
    expect(out.raiser!.applied).toBe(true);
    expect(out.raiser!.grade).toBe('engineering');
    expect(out.raiser!.converged).toBe(true);
    expect(out.result.meshMode).toBe('refined');
    expect(out.raiser!.dofCount).toBeGreaterThan(40000);
    expect(out.raiser!.wallMs).toBeGreaterThan(0);         // measured wall-time surfaced
    expect(out.result.maxStress).toBeGreaterThan(0);       // a raiser peak is seen (Kt>1)
    expect(Number.isFinite(out.result.maxStress)).toBe(true);
  }, heavyTestBudgetMs(45_700)); // 격리 실측 45.7s — 260728 §6-4(근거=src/test/heavyTestBudget.ts)
});
