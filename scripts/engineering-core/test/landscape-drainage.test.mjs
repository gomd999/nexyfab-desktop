/**
 * 조경 배수 골든벤치 — 합리식·Manning 손계산 대조 (폐형식 정확 일치).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';

const close = (actual, expected, tolPct = 0.05) => {
  const diff = (Math.abs(actual - expected) / Math.abs(expected)) * 100;
  assert.ok(diff <= tolPct, `expected ${expected}, got ${actual} (diff ${diff.toFixed(4)}% > ${tolPct}%)`);
};

// 합리식: Q = 0.85×100×0.5/360 = 0.1180556 m³/s
// Manning D=300,S=0.01,n=0.013: A=0.0706858, R=0.075, Q=76.9231×0.0706858×0.075^(2/3)×0.1=0.096701 → 초과 FAIL
test('landscape_drainage: rational method + Manning D300 — capacity FAIL', () => {
  const r = runCalculator('landscape_drainage', { areaHa: 0.5, C: 0.85, i_mmhr: 100, pipeDia_mm: 300, slope: 0.01 });
  close(r.intermediate.Q_design_m3s, 0.1180556);
  close(r.intermediate.Q_capacity_m3s, 0.096701);
  close(r.intermediate.v_full_ms, 1.368, 0.1);
  assert.equal(r.checks.capacity.pass, false);
  assert.equal(r.verdict, 'FAIL');
});

// D=450 → Qcap=0.285106, ratio 0.4141 PASS / v=1.7927 (0.8~3.0 내)
test('landscape_drainage: D450 passes with velocity in range', () => {
  const r = runCalculator('landscape_drainage', { areaHa: 0.5, C: 0.85, i_mmhr: 100, pipeDia_mm: 450, slope: 0.01 });
  close(r.intermediate.Q_capacity_m3s, 0.285106);
  close(r.checks.capacity.ratio, 0.41408, 0.1);
  close(r.intermediate.v_full_ms, 1.7927, 0.1);
  assert.equal(r.verdict, 'PASS');
});

// 관거 미입력 → 유출량 산정만
test('landscape_drainage: runoff-only mode without pipe', () => {
  const r = runCalculator('landscape_drainage', { areaHa: 2, C: 0.3, i_mmhr: 80 });
  close(r.intermediate.Q_design_m3s, (0.3 * 80 * 2) / 360);
  assert.equal(r.verdict, 'PASS');
  assert.ok(r.checks.runoff);
});

// 게이트: 관경 입력 시 경사 필수
test('landscape_drainage: pipe requires slope', () => {
  assert.throws(() => runCalculator('landscape_drainage', { areaHa: 0.5, C: 0.85, i_mmhr: 100, pipeDia_mm: 300 }), /slope 필수/);
});
