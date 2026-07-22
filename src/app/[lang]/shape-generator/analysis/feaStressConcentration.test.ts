/**
 * feaStressConcentration — Track M, the stress half of the M1 acceptance, and an
 * HONEST characterisation of its current limit.
 *
 * A wide plate with a central circular hole under uniaxial tension has a textbook
 * stress-concentration factor Kt = σ_peak / σ_nominal ≈ 3.0. This probes whether
 * the 3D FEM reproduces it.
 *
 * FINDING (2026-06-04): the DISPLACEMENT solve is engineering-accurate (TET10 —
 * see feaAnalyticBenchmark), but STRESS at a curved raiser is NOT: the
 * structured-grid mesher staircases the circular hole and is too coarse around
 * it, and stress is recovered at element centroids, so the peak at the hole edge
 * is smeared. Measured Kt ≈ 1.1–1.6, well below 3.0. Reaching ≈3.0 needs a
 * BOUNDARY-CONFORMING, hole-refined mesh (e.g. BRepMesh → TetGen), which is a
 * separate, larger piece of work.
 *
 * So the active tests pin what IS true and trustworthy today — the solver stays
 * robust on a holed part (converges, finite stress, concentration in the right
 * direction) — and the ≈3.0 acceptance is a documented `.skip` gate.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import { runFEM } from './femSolver';
import type { FEAMaterial } from './simpleFEA';

const steel: FEAMaterial = { youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 250, density: 7.85 };

function plateWithHole(W: number, L: number, T: number, r: number): THREE.BufferGeometry {
  const plate = new THREE.BoxGeometry(L, W, T);
  const hole = new THREE.CylinderGeometry(r, r, T * 3, 48);
  hole.rotateX(Math.PI / 2); // hole axis along Z (through thickness)
  const ev = new Evaluator(); ev.attributes = ['position', 'normal'];
  const res = ev.evaluate(new Brush(plate), new Brush(hole), SUBTRACTION);
  return res.geometry.toNonIndexed();
}
function facesByX(g: THREE.BufferGeometry, wantMin: boolean): number[] {
  const pos = g.attributes.position; const tris = pos.count / 3; const out: number[] = [];
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pos.count; i++) { mn = Math.min(mn, pos.getX(i)); mx = Math.max(mx, pos.getX(i)); }
  for (let f = 0; f < tris; f++) {
    const b = f * 3; const cx = (pos.getX(b) + pos.getX(b + 1) + pos.getX(b + 2)) / 3;
    if (wantMin && Math.abs(cx - mn) < 0.5) out.push(f);
    if (!wantMin && Math.abs(cx - mx) < 0.5) out.push(f);
  }
  return out;
}
function solve(W: number, L: number, T: number, r: number, F: number, maxNodes: number) {
  const g = plateWithHole(W, L, T, r);
  const res = runFEM(g, steel, [
    { type: 'fixed', faceIndices: facesByX(g, true) },
    { type: 'force', faceIndices: facesByX(g, false), value: [F, 0, 0] },
  ], maxNodes);
  const nominal = F / ((W - 2 * r) * T); // net-section nominal stress
  return { res, nominal };
}

describe('FEA stress concentration — plate with hole (Track M)', () => {
  it('stays robust on a holed part: converges with a finite, non-garbage stress field', () => {
    const { res, nominal } = solve(100, 160, 8, 12, 100000, 5000);
    expect(res.converged).toBe(true);
    expect(Number.isFinite(res.maxStress)).toBe(true);
    expect(res.maxStress).toBeGreaterThan(0);
    // physically plausible — not the 1e16 garbage the old solver produced.
    expect(res.maxStress).toBeLessThan(nominal * 50);
  });

  it('detects the concentration qualitatively: peak stress exceeds the nominal', () => {
    const { res, nominal } = solve(100, 160, 8, 12, 100000, 5000);
    expect(res.maxStress).toBeGreaterThan(nominal); // Kt > 1 — a raiser is seen
  });

  // M1 STRESS ACCEPTANCE — un-skipped 2026-07-19 (W1-A / R0-0).
  //
  // This is the classic Kirsch solution: an infinite plate with a circular hole
  // under uniaxial tension has Kt = 3.0 exactly. For a FINITE plate of width W
  // with hole diameter d = 2r, the Howland/Peterson net-section correction is
  //   Kt = 3.00 - 3.13·(d/W) + 3.66·(d/W)² - 1.53·(d/W)³
  // At W=120, r=10 → d/W = 1/6 → Kt ≈ 2.577. The band below (2.5–3.5) covers
  // both the infinite-plate 3.0 and the finite-width 2.58, so it is a fair
  // acceptance for either convention.
  //
  // FIXED 2026-07-22 by Stage-2 graded refinement + boundary snap (femRefine.ts):
  // when a curved stress-raiser is detected, runFEM switches from the uniform voxel
  // grid to a GRADED, boundary-CONFORMING tet mesh (longest-edge bisection with
  // incident-tet closure — no hanging nodes) whose bore nodes are snapped ONTO the
  // true circle, solved with the IC(0) preconditioner. Measured Kt moved 1.03 → the
  // 2.5-3.5 band. This is engineering-grade (not certification-grade); see
  // docs/roadmap/FEA_VALIDATION.md.
  // ⚠ `it.fails` = 알려진 결함의 **자기소멸 부채 표식**(W1-A 260719b).
  //  · 종전 `it.skip` 은 결함을 숨겼다 — 켜 보니 실측 Kt=1.027 로, 파일 상단이 적어둔
  //    "1.1~1.6" 보다도 낮았다(복셀 메셔가 집중을 사실상 감지하지 못함).
  //  · 그래서 목표 단언(2.5<Kt<3.5)은 **그대로 두고** 실패를 기대값으로 선언한다.
  //    CI 는 녹색이되 이 파일을 여는 사람은 목표와 현실을 동시에 본다.
  //  · 경계 정합 메시(BRepMesh→TetGen)로 고쳐지면 **이 테스트가 통과하며 붉어진다** →
  //    표식을 지우도록 강제된다. 조용히 방치될 수 없는 구조.
  //  · 로드맵: W7-A(fea 해석 심화). 그 전까지 이 저장소의 FEA 는 **변위는 신뢰,
  //    곡률 라이저의 응력 피크는 신뢰 불가**로 취급한다.
  it('M1: plate-with-hole Kt ≈ 3.0 — Stage-2 graded refine+snap (engineering-grade)', () => {
    const { res, nominal } = solve(120, 200, 8, 10, 100000, 12000);
    const Kt = res.maxStress / nominal;
    const dW = 20 / 120;
    const ktFinite = 3.0 - 3.13 * dW + 3.66 * dW ** 2 - 1.53 * dW ** 3;
    const msg =
      `achieved Kt=${Kt.toFixed(3)} (maxStress=${res.maxStress.toFixed(4)}, ` +
      `nominal=${nominal.toFixed(4)}); Kirsch infinite-plate=3.000, ` +
      `finite-width Howland=${ktFinite.toFixed(3)}`;
    expect(Kt, msg).toBeGreaterThan(2.5);
    expect(Kt, msg).toBeLessThan(3.5);
  });
});
