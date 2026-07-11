/**
 * RC 기둥 P-M 골든벤치 — 손계산 대조 (변형률 적합, c=200 전 과정 수계산).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';

const close = (actual, expected, tolPct = 0.2) => {
  const diff = (Math.abs(actual - expected) / Math.abs(expected)) * 100;
  assert.ok(diff <= tolPct, `expected ${expected}, got ${actual} (diff ${diff.toFixed(3)}% > ${tolPct}%)`);
};

const SEC = { b: 400, h: 400, dPrime: 60, fck: 24, fy: 400, Ast: 3200 };

// ── 케이스 1: c=200 손계산 전 과정 ──
// a=160, Cc=0.85×24×400×160=1,305,600
// 상부(60, 블록 내): εs=0.0033×140/200=0.00231→fs=400, F=1600×(400−20.4)=607,360
// 하부(340): εs=−0.00231→fs=−400, F=−640,000
// Pn=1,272,960N / Mn=1,305,600×120+607,360×140+640,000×140=331.296kN·m
// e=260.27mm / εt=0.00231→변화구간 φ=0.65+0.2×(0.00231−0.002)/0.003=0.67067
// φPn=853.7kN
test('rc_column_pm: c=200 strain-compatibility hand calc', () => {
  const e = 331.296e6 / 1272960; // mm — 손계산 편심
  const Pu = 800;
  const r = runCalculator('rc_column_pm', { ...SEC, Pu, Mu: (Pu * e) / 1000 });
  close(r.intermediate.c_mm, 200, 0.3);
  close(r.intermediate.Pn_kN, 1272.96, 0.3);
  close(r.intermediate.Mn_kNm, 331.296, 0.3);
  close(r.intermediate.eps_t, 0.00231, 0.5);
  close(r.intermediate.phi, 0.670667, 0.3);
  close(r.checks.pm.phiPn_kN, 853.66, 0.3);
  assert.equal(r.intermediate.section, '변화구간');
  assert.equal(r.verdict, 'PASS');
});

// ── 케이스 2: 축력 상한 φPn(max) — 식 4.1-17 (띠 0.80) ──
// Po=0.85×24×(160000−3200)+400×3200=4,478,720N → φPn,max=0.80×0.65×Po=2328.93kN
test('rc_column_pm: axial cap by eq 4.1-17 (tied 0.80)', () => {
  const r = runCalculator('rc_column_pm', { ...SEC, Pu: 2500, Mu: 25 });
  assert.equal(r.checks.pm.cappedByPnMax, true);
  close(r.checks.pm.phiPn_kN, 2328.934);
  close(r.intermediate.Po_kN, 4478.72);
  assert.equal(r.verdict, 'FAIL'); // 2500 > 2328.93
});

// ── 케이스 3: 나선철근 — 0.85 계수 + φ 0.70 ──
// φPn,max = 0.85×0.70×4478.72 = 2664.84
test('rc_column_pm: spiral uses 0.85 cap and phi 0.70', () => {
  const r = runCalculator('rc_column_pm', { ...SEC, Pu: 2500, Mu: 25, transverse: 'spiral' });
  close(r.checks.pm.phiPnMax_kN, 2664.838);
  assert.equal(r.verdict, 'PASS'); // 2500 < 2664.84
});

// ── 케이스 4: 철근비 게이트 (§4.3.2(1): 0.01~0.08) ──
test('rc_column_pm: rho gate — under 1% FAIL', () => {
  const r = runCalculator('rc_column_pm', { ...SEC, Ast: 1200, Pu: 500, Mu: 50 }); // ρ=0.0075
  assert.equal(r.checks.rho.pass, false);
  assert.equal(r.verdict, 'FAIL');
});

// ── 케이스 5: 편심 과대(e=50m) — 상관곡선 저축력 구간 해로 수렴, 과대 ratio FAIL ──
// 저축력 한계에서 φMn≈보 거동(As/2 인장): 이분법이 발산 없이 유효 해를 반환해야 함
test('rc_column_pm: extreme eccentricity converges on low-axial branch', () => {
  const r = runCalculator('rc_column_pm', { ...SEC, Pu: 10, Mu: 500 });
  assert.equal(r.verdict, 'FAIL');
  assert.ok(r.checks.pm.ratio > 2, `expected ratio>2, got ${r.checks.pm.ratio}`);
  assert.ok(r.intermediate.Pn_kN > 0, 'solution stays on compression branch');
});
