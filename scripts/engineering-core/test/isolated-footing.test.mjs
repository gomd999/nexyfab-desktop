/**
 * 독립기초 골든벤치 — KDS 2021 신형 뚫림전단 성능식 손계산 대조.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';

const close = (actual, expected, tolPct = 0.2) => {
  const diff = (Math.abs(actual - expected) / Math.abs(expected)) * 100;
  assert.ok(diff <= tolPct, `expected ${expected}, got ${actual} (diff ${diff.toFixed(3)}% > ${tolPct}%)`);
};

const FT = { B: 2500, L: 2500, t: 600, d: 500, cb: 500, cl: 500, Pu: 1500, Pservice: 1100, qAllow: 300, fck: 24 };

// ── 케이스 1: 전 과정 손계산 (fck=24, ρ=0.005 기본, 내부기둥) ──
// ks=(300/500)^0.25=0.88012 / kbo=4/√8=1.414→1.25 캡 / fte=0.2√24=0.97980
// fcc=16 / cotψ=√(0.97980×16.97980)/0.97980=4.16292
// cu=500[25√(0.005/24)−300(0.005/24)]=149.172
// vc=0.88012×1.25×0.97980×4.16292×0.298344=1.33879 N/mm²
// b0=4000 → Vc=2677.6kN / VnMax=0.58×24×4000×149.172=8305.9 (캡 미지배)
// 공제 0.75d: (500+750)²=1.5625e6 → Vu=0.24×(6.25e6−1.5625e6)=1125kN
// φVn=0.75×2677.6=2008.2 / 1방향: arm=500 → Vu=300, φVc=0.75×(√24/6)×2500×500=765.5
// 지지력: (1100+2.5²×0.6×24)/6.25=190.4 ≤300
test('isolated_footing: full hand-calc — new KDS punching model', () => {
  const r = runCalculator('isolated_footing', FT);
  const p = r.checks.punching;
  close(p.ks, 0.88012);
  close(p.kbo, 1.25);
  close(p.fte_MPa, 0.9798);
  close(p.cotPsi, 4.16292);
  close(p.cu_mm, 149.172);
  close(p.vc_MPa, 1.33879);
  close(p.Vc_kN, 2677.58);
  close(p.VnMax_kN, 8305.9);
  assert.equal(p.cappedByVnMax, false);
  close(p.Vu_kN, 1125);
  close(p.phiVn_kN, 2008.18);
  close(r.checks.oneWayShear.Vu_kN, 300);
  close(r.checks.oneWayShear.phiVc_kN, 765.466);
  close(r.checks.bearing.q_kPa, 190.4);
  assert.equal(r.verdict, 'PASS');
});

// ── 케이스 2: 모서리 기둥 (αs=2.0) → kbo = 4/√(2×4000/500) = 4/4 = 1.0 ──
test('isolated_footing: corner column alpha_s=2.0 reduces kbo', () => {
  const r = runCalculator('isolated_footing', { ...FT, columnPosition: 'corner' });
  close(r.checks.punching.kbo, 1.0);
  assert.ok(r.checks.punching.vc_MPa < 1.34 * 0.85, 'vc reduced vs interior');
});

// ── 케이스 3: ρ 하한 클램프 (0.003 입력 → 0.005 사용, 식 4.11-7 범위) ──
test('isolated_footing: rho floor clamp at 0.005', () => {
  const r1 = runCalculator('isolated_footing', { ...FT, rho: 0.003 });
  const r2 = runCalculator('isolated_footing', { ...FT, rho: 0.005 });
  close(r1.checks.punching.cu_mm, r2.checks.punching.cu_mm, 0.01);
});

// ── 케이스 4: 지지력 초과 FAIL ──
test('isolated_footing: bearing overload fails', () => {
  const r = runCalculator('isolated_footing', { ...FT, Pservice: 2000, qAllow: 300 });
  // q = (2000+90)/6.25 = 334.4 > 300
  close(r.checks.bearing.q_kPa, 334.4);
  assert.equal(r.checks.bearing.pass, false);
  assert.equal(r.verdict, 'FAIL');
});

// ── 케이스 5: 기하 게이트 ──
test('isolated_footing: geometry gates', () => {
  assert.throws(() => runCalculator('isolated_footing', { ...FT, d: 700 }), /유효깊이/);
  assert.throws(() => runCalculator('isolated_footing', { ...FT, cb: 2600 }), /기둥이 기초보다/);
});
