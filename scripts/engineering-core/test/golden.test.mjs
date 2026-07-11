/**
 * 골든벤치 — 손계산으로 독립 검증한 수치와 대조 (③ 검증층).
 * 실행: node --test test/
 * NOTE: 현재는 자체 손계산 케이스. §7.0 공개 게이트는 "공인 예제(기준 해설·교과서) ≥10 PASS" — Wave 2에서 확충.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';

const close = (actual, expected, tolPct = 0.5) => {
  const diff = Math.abs(actual - expected) / Math.abs(expected) * 100;
  assert.ok(diff <= tolPct, `expected ${expected}, got ${actual} (diff ${diff.toFixed(3)}% > ${tolPct}%)`);
};

// ── 옹벽 안정 (손계산: Ka=1/3, Pa=48kN, ΣV=149.28, Mr=224.4, Mo=64) ──
test('retaining wall: H=4m cantilever — FS/e/qmax match hand calc', () => {
  const r = runCalculator('retaining_wall_stability', {
    H: 4, stemThickness: 0.4, baseWidth: 2.5, baseThickness: 0.4, toeLength: 0.7,
    gammaConcrete: 24, gammaBackfill: 18, phiBackfill: 30, surcharge: 0,
    baseFriction: 0.5, allowableBearing: 200,
  }, 'KDS');
  close(r.intermediate.Ka, 1 / 3, 0.1);
  close(r.intermediate.PaSoil_kN, 48.0, 0.1);
  close(r.intermediate.sumV_kN, 149.28, 0.1);
  close(r.intermediate.Mr_kNm, 224.4, 0.1);
  close(r.intermediate.Mo_kNm, 64.0, 0.1);
  close(r.checks.overturning.FS, 3.506, 0.2);
  close(r.checks.sliding.FS, 1.555, 0.2);
  close(r.checks.eccentricity.e_m, 0.17551, 0.3);
  close(r.checks.bearing.qmax_kPa, 84.86, 0.3);
  assert.equal(r.verdict, 'PASS');
});

test('retaining wall: sliding failure detected (low friction)', () => {
  const r = runCalculator('retaining_wall_stability', {
    H: 4, stemThickness: 0.4, baseWidth: 2.5, baseThickness: 0.4, toeLength: 0.7,
    gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.3, allowableBearing: 200,
  }, 'KDS');
  assert.equal(r.checks.sliding.pass, false);
  assert.equal(r.verdict, 'FAIL');
});

test('retaining wall: geometry gate throws', () => {
  assert.throws(() => runCalculator('retaining_wall_stability', {
    H: 4, stemThickness: 1.5, baseWidth: 2.0, baseThickness: 0.4, toeLength: 0.7,
    gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.5, allowableBearing: 200,
  }, 'KDS'), /geometry gate/);
});

// ── 압축재 좌굴 (AISC E3, 손계산: Fe=789.57, Fcr=287.3 / Fe=87.73, Fcr=76.94) ──
test('column buckling: inelastic branch KL/r=50, Fy=345', () => {
  const r = runCalculator('column_buckling', { Fy: 345, Ag: 10000, L: 5000, K: 1.0, r: 100, Pu: 2000 }, 'AISC360');
  close(r.intermediate.Fe_MPa, 789.568, 0.1);
  assert.match(r.intermediate.branch, /inelastic/);
  close(r.intermediate.Fcr_MPa, 287.3, 0.2);
  close(r.checks.capacity_LRFD.phiPn_kN, 2585.9, 0.3);
  assert.equal(r.verdict, 'PASS');
});

test('column buckling: elastic branch KL/r=150', () => {
  const r = runCalculator('column_buckling', { Fy: 345, Ag: 10000, L: 15000, K: 1.0, r: 100, Pu: 800 }, 'AISC360');
  close(r.intermediate.Fe_MPa, 87.730, 0.1);
  assert.match(r.intermediate.branch, /elastic/);
  close(r.intermediate.Fcr_MPa, 76.94, 0.2);
  close(r.checks.capacity_LRFD.phiPn_kN, 692.4, 0.3);
  assert.equal(r.verdict, 'FAIL'); // Pu=800 > φPn=692
});

test('column buckling: slenderness gate KL/r>200 throws', () => {
  assert.throws(() => runCalculator('column_buckling', { Fy: 345, Ag: 10000, L: 25000, K: 1.0, r: 100, Pu: 100 }, 'AISC360'), /slenderness gate/);
});

// ── 단순보 (손계산: M=45kNm, V=30kN, σ=90MPa, δ=11.76mm @E=205GPa,Ix=7e7) ──
test('simple beam: UDL 10kN/m, L=6m', () => {
  const r = runCalculator('simple_beam', { L: 6000, w: 10, Fy: 275, E: 205000, Sx: 5e5, Aw: 3000, Ix: 7e7 }, 'AISC360');
  close(r.intermediate.Mmax_kNm, 45.0, 0.1);
  close(r.intermediate.Vmax_kN, 30.0, 0.1);
  close(r.checks.bending.sigma_MPa, 90.0, 0.1);
  close(r.checks.shear.tau_MPa, 10.0, 0.1);
  close(r.checks.deflection.delta_mm, 11.76, 0.2);
  assert.equal(r.checks.deflection.limitSpec, 'L/240'); // AISC360 default
  assert.equal(r.verdict, 'PASS');
});

test('simple beam: zero-load gate throws', () => {
  assert.throws(() => runCalculator('simple_beam', { L: 6000, Fy: 275, Sx: 5e5, Aw: 3000, Ix: 7e7 }, 'AISC360'), /load gate/);
});

// ── 볼트접합 (손계산: rn_shear=116.87kN, rn_bearing=192kN, φRn=350.6kN) ──
test('bolt connection: 4×M20 A325-N single shear', () => {
  const r = runCalculator('bolt_connection', { boltGrade: 'A325-N', d: 20, nBolts: 4, shearPlanes: 1, tPlate: 10, Fu: 400, Vu: 300 }, 'AISC360');
  close(r.intermediate.rnShear_kN_perBolt, 116.87, 0.1);
  close(r.intermediate.rnBearing_kN_perBolt, 192.0, 0.1);
  assert.equal(r.intermediate.governing, 'shear');
  close(r.checks.capacity_LRFD.phiRn_kN, 350.60, 0.2);
  assert.equal(r.verdict, 'PASS');
});

test('bolt connection: thin plate flips governing to bearing', () => {
  const r = runCalculator('bolt_connection', { boltGrade: 'A325-N', d: 20, nBolts: 4, tPlate: 5, Fu: 400, Vu: 300 }, 'AISC360');
  assert.equal(r.intermediate.governing, 'bearing'); // 2.4*20*5*400/1000=96 < 116.87
  close(r.intermediate.rnBearing_kN_perBolt, 96.0, 0.1);
});

// ── 레지스트리 게이트 ──
test('registry: unknown field rejected', () => {
  assert.throws(() => runCalculator('column_buckling', { Fy: 345, Ag: 10000, L: 5000, r: 100, Pu: 0, hacker: 1 }, 'AISC360'), /unknown field/);
});
test('registry: KDS standard is flagged draft', () => {
  const r = runCalculator('column_buckling', { Fy: 275, Ag: 5000, L: 3000, r: 60, Pu: 100 }, 'KDS');
  assert.equal(r.standardDraft, true);
});
