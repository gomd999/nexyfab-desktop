/**
 * RC 보 골든벤치 — 손계산 대조 (KDS 14 20 20/22, 원문 검증 계수).
 * 실행: node --test test/rc-beam.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';

const close = (actual, expected, tolPct = 0.2) => {
  const diff = (Math.abs(actual - expected) / Math.abs(expected)) * 100;
  assert.ok(diff <= tolPct, `expected ${expected}, got ${actual} (diff ${diff.toFixed(3)}% > ${tolPct}%)`);
};

// ── 케이스 1: 인장지배 + 전단 (손계산 전 과정) ──
// b=300,d=500,fck=24(η=1,β1=0.80,εcu=0.0033),fy=400,As=1935
// T=774,000N → c=774000/(0.85·24·300·0.80)=158.088mm, a=126.47
// εt=0.0033(500−158.088)/158.088=0.007138 ≥0.005 → φ=0.85
// Mn=774000×(500−63.235)=338.056kN·m → φMn=287.35 / Mu=250 → ratio 0.870
// Vc=(1/6)√24×300×500=122.474kN / D10@200 2가닥 Av=142.7 → Vs=142.7kN
// φVn=0.75×265.17=198.88 / Vu=150 → ratio 0.754
test('rc_beam: tension-controlled flexure + shear — hand calc', () => {
  const r = runCalculator('rc_beam', { b: 300, d: 500, fck: 24, fy: 400, As: 1935, Mu: 250, Vu: 150, Av: 142.7, s: 200 });
  close(r.intermediate.c_mm, 158.088);
  close(r.intermediate.a_mm, 126.47);
  close(r.intermediate.eps_t, 0.007138);
  assert.equal(r.checks.flexure.phi, 0.85);
  close(r.checks.flexure.Mn_kNm, 338.056);
  close(r.checks.flexure.phiMn_kNm, 287.35);
  close(r.checks.shear.Vc_kN, 122.474);
  close(r.checks.shear.Vs_kN, 142.7);
  close(r.checks.shear.phiVn_kN, 198.88);
  assert.equal(r.verdict, 'PASS');
  // Av,min = max(0.0625√24, 0.35)×300×200/400 = 0.35×150 = 52.5
  close(r.checks.shear.Av_min_mm2, 52.5);
  // 간격: d/2=250 (Vs=142.7 < (1/3)√24·b·d=244.9 → 절반규정 미적용)
  close(r.checks.shear.s_max_mm, 250);
});

// ── 케이스 2: 변화구간 φ 보간 + 연성(최소허용변형률) FAIL ──
// As=3000 → c=1,200,000/4896=245.098, εt=0.0033×254.902/245.098=0.0034321
// εy=0.002 < εt < 0.005 → φ=0.65+0.20×(0.0034321−0.002)/0.003=0.74547
// εt < 0.004(최소허용변형률) → ductility FAIL → verdict FAIL
test('rc_beam: transition-zone phi interpolation + ductility gate FAIL', () => {
  const r = runCalculator('rc_beam', { b: 300, d: 500, fck: 24, fy: 400, As: 3000, Mu: 100 });
  close(r.intermediate.c_mm, 245.098);
  close(r.intermediate.eps_t, 0.0034321);
  close(r.checks.flexure.phi, 0.74547);
  assert.equal(r.checks.ductility.pass, false);
  assert.equal(r.checks.ductility.section, '변화구간');
  assert.equal(r.verdict, 'FAIL');
});

// ── 케이스 3: 압축지배(과보강) — 이분법 평형 불변식 + φ=0.65 ──
test('rc_beam: compression-controlled — equilibrium invariant, phi=0.65', () => {
  const r = runCalculator('rc_beam', { b: 300, d: 500, fck: 24, fy: 400, As: 6000, Mu: 100 });
  const { c_mm: c, eps_t, fs_MPa } = r.intermediate;
  // 평형: C = η0.85fck·b·β1c ≟ T = As·fs
  const C = 1.0 * 0.85 * 24 * 300 * 0.8 * c;
  const T = 6000 * fs_MPa;
  close(C, T, 0.01);
  assert.ok(eps_t < 0.002, 'compression-controlled: eps_t < eps_y');
  assert.equal(r.checks.flexure.phi, 0.65);
  assert.equal(r.checks.ductility.section, '압축지배');
  assert.equal(r.verdict, 'FAIL'); // 연성 게이트
});

// ── 케이스 4: 고강도 fck=60 — 표 4.1-2 값 (εcu=0.0031, η=0.95, β1=0.76) ──
test('rc_beam: fck=60 uses Table 4.1-2 values', () => {
  const r = runCalculator('rc_beam', { b: 300, d: 500, fck: 60, fy: 400, As: 1935, Mu: 100 });
  close(r.intermediate.eps_cu, 0.0031);
  close(r.intermediate.eta, 0.95);
  close(r.intermediate.beta1, 0.76);
});

// ── 케이스 5: Vu > ½φVc + 스터럽 없음 → 최소전단철근 FAIL ──
// ½φVc = 0.5×0.75×122.474 = 45.93 → Vu=60 > 45.93, 스터럽 없음 → FAIL
test('rc_beam: min stirrup gate — Vu > half phiVc without stirrups', () => {
  const r = runCalculator('rc_beam', { b: 300, d: 500, fck: 24, fy: 400, As: 1935, Mu: 100, Vu: 60 });
  assert.equal(r.checks.shear.pass, false);
  assert.ok(r.notes.some((n) => n.includes('최소 전단철근')));
});

// ── 케이스 6: 표준 게이트 — AISC에 rc 파라미터 없음 → 정직한 거부 ──
test('rc_beam: rejects non-KDS standards honestly', () => {
  assert.throws(() => runCalculator('rc_beam', { b: 300, d: 500, fck: 24, fy: 400, As: 1935, Mu: 100 }, 'AISC360'), /rc 파라미터 미탑재/);
});
