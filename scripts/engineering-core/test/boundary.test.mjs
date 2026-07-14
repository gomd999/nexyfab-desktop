/**
 * 경계값 회귀 테스트 (외부감사 제언 반영) — 설계기준 한계 직전/직후에서
 * 판정이 정확히 플립되는지 검증. 공표예제와 별개로 "게이트·공식의 경계 정합성"을
 * 상시 보증한다. node --test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';
import boxCulvert from '../calculators/box-culvert-frame.mjs';

// ── timber_beam: 처짐 한계 L/240 경계 플립 ─────────────────────────────────
test('timber: 처짐 한계 직전 PASS / 직후 FAIL 플립', () => {
  // 45×140 pine2, L=2400, 건조: δ = w×(5L⁴/384EI). 한계 10mm가 되는 w를 역산해 ±2% 대조
  const base = { species: 'pine', grade: 2, b: 45, h: 140, L: 2400, duration: 'tenYears' };
  const I = (45 * 140 ** 3) / 12, E = 9000;
  const wLimit = (10 * 384 * E * I) / (5 * 2400 ** 4); // δ=10mm 정확 경계
  const under = runCalculator('timber_beam', { ...base, w: wLimit * 0.98 }, 'KDS');
  const over = runCalculator('timber_beam', { ...base, w: wLimit * 1.02 }, 'KDS');
  assert.equal(under.checks.deflection.pass, true, 'δ 한계 직전은 PASS');
  assert.equal(over.checks.deflection.pass, false, 'δ 한계 직후는 FAIL');
});

// ── timber_beam: 습윤 CM 경계 — 같은 하중이 건조 PASS·습윤 FAIL 되는 창 ────
test('timber: 습윤 CM 적용이 판정을 실제로 바꾼다 (Fb 0.85 창)', () => {
  const base = { species: 'pine', grade: 2, b: 45, h: 140, L: 2400 };
  // 건조 허용 fb=6.0 → 습윤 5.1. 그 사이 응력(≈5.5MPa)을 만드는 w
  const S = (45 * 140 * 140) / 6;
  const wMid = (5.5 * S) / 1e6 / (2.4 * 2.4 / 8); // Mu(kN·m)=fb×S → w 역산
  const dry = runCalculator('timber_beam', { ...base, w: wMid }, 'KDS');
  const wet = runCalculator('timber_beam', { ...base, w: wMid, wetService: true }, 'KDS');
  assert.equal(dry.checks.flexure.pass, true);
  assert.equal(wet.checks.flexure.pass, false, '습윤에서 같은 하중이 FAIL — CM 미적용이면 잡히지 않던 비안전측');
});

// ── retaining wall: 전도 FS 2.0 경계 플립 (저판폭 이분) ─────────────────────
test('옹벽: 전도 FS 기준 2.0 경계에서 플립', () => {
  const soil = { H: 3, stemThickness: 0.3, baseThickness: 0.4, toeLength: 0.6, gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.9, allowableBearing: 500 };
  // baseWidth 이분탐색으로 FS_ot=2.0 경계 찾기
  let lo = 0.95, hi = 2.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = runCalculator('retaining_wall_stability', { ...soil, baseWidth: mid }, 'KDS');
    if (r.checks.overturning.FS >= 2.0) hi = mid; else lo = mid;
  }
  const under = runCalculator('retaining_wall_stability', { ...soil, baseWidth: hi * 0.99 }, 'KDS');
  const over = runCalculator('retaining_wall_stability', { ...soil, baseWidth: hi * 1.01 }, 'KDS');
  assert.equal(under.checks.overturning.pass, false, '경계 직전 FAIL');
  assert.equal(over.checks.overturning.pass, true, '경계 직후 PASS');
});

// ── M-O: kh 경계 — 지진시 활동 FS 1.2 플립 ────────────────────────────────
test('옹벽 지진: kh 증가로 지진시 활동 FS 1.2 경계 플립', () => {
  const base = { H: 3, stemThickness: 0.3, baseWidth: 2, baseThickness: 0.4, toeLength: 0.6, gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.5, allowableBearing: 200 };
  let lo = 0.01, hi = 0.4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = runCalculator('retaining_wall_stability', { ...base, seismicKh: mid }, 'KDS');
    if (r.seismic.checks.sliding.FS >= 1.2) lo = mid; else hi = mid;
  }
  const under = runCalculator('retaining_wall_stability', { ...base, seismicKh: lo * 0.98 }, 'KDS');
  const over = runCalculator('retaining_wall_stability', { ...base, seismicKh: hi * 1.02 }, 'KDS');
  assert.equal(under.seismic.checks.sliding.pass, true);
  assert.equal(over.seismic.checks.sliding.pass, false);
});

// ── rc_beam: 전단철근 최소 요구 경계 (Vu > 0.5φVc) ─────────────────────────
test('rc_beam: Vu가 0.5φVc를 넘는 순간 무스터럽 FAIL', () => {
  const base = { b: 300, d: 550, fck: 24, fy: 400, As: 1548, Mu: 50 };
  const probe = runCalculator('rc_beam', { ...base, Vu: 1 }, 'KDS');
  const phiVc = probe.checks.shear.phiVn_kN; // 무스터럽 φVc... (Vu 작을 때 pass 기준값)
  const under = runCalculator('rc_beam', { ...base, Vu: phiVc * 0.49 }, 'KDS');
  const over = runCalculator('rc_beam', { ...base, Vu: phiVc * 0.55 }, 'KDS');
  assert.equal(under.checks.shear.pass, true, '0.5φVc 미만은 무스터럽 허용');
  assert.equal(over.checks.shear.pass, false, '0.5φVc 초과는 최소 전단철근 요구 → 무스터럽 FAIL');
});

// ── box culvert: 수학 앵커(4면 등압 → wL²/12·wL²/24·잔차0) 상시 회귀 ───────
test('박스암거: 등압 앵커 wL²/12 · 중앙 wL²/24 · 평형잔차 0', () => {
  const w = 10, Lc = 2;
  const r = boxCulvert.run({ innerWidth: Lc - 0.2, innerHeight: Lc - 0.2, wallThk: 0.2, cover: 0, gammaSoil: 0, K: 1, surcharge: w, gammaConcrete: 0 });
  const t = (w * Lc * Lc) / 12, tm = (w * Lc * Lc) / 24;
  for (const m of [r.moments_kNm.cornerTop, r.moments_kNm.cornerBottom, r.moments_kNm.wallAtTop, r.moments_kNm.wallAtBottom]) {
    assert.ok(Math.abs(Math.abs(m) - t) < 0.01, `우각부 ${m} ≠ ±${t}`);
  }
  for (const m of [r.moments_kNm.midTop, r.moments_kNm.midBottom, r.moments_kNm.midWall]) {
    assert.ok(Math.abs(m - tm) < 0.01, `중앙 ${m} ≠ ${tm}`);
  }
  assert.ok(Math.abs(r.equilibriumResidual.jointA) < 1e-6 && Math.abs(r.equilibriumResidual.jointD) < 1e-6);
});

// ── M-O 극한: kh→0 → 정적 Ka 수렴 ─────────────────────────────────────────
test('M-O: kh→0 극한에서 Kae → 정적 Ka 수렴', () => {
  const base = { H: 3, stemThickness: 0.3, baseWidth: 2, baseThickness: 0.4, toeLength: 0.6, gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.5, allowableBearing: 200 };
  const r = runCalculator('retaining_wall_stability', { ...base, seismicKh: 0.0005 }, 'KDS');
  assert.ok(Math.abs(r.seismic.Kae - r.intermediate.Ka) < 0.002, `Kae ${r.seismic.Kae} ≉ Ka ${r.intermediate.Ka}`);
});

// ── occupancy: 피난폭 요구 경계 플립 ───────────────────────────────────────
test('피난폭: 요구폭 경계에서 플립', () => {
  const base = { floorAreaM2: 100, occupantDensityM2: 1.0, exitCount: 2, egressFactorMmPerOcc: 5.0 };
  // 재실자 100 × 5mm = 500mm 요구
  const under = runCalculator('occupancy_egress', { ...base, egressWidthProvidedMm: 495 }, 'KDS');
  const over = runCalculator('occupancy_egress', { ...base, egressWidthProvidedMm: 505 }, 'KDS');
  const key = Object.keys(over.checks).find((k) => /width|폭/i.test(k)) ?? Object.keys(over.checks)[0];
  assert.notEqual(under.checks[key].pass, over.checks[key].pass, '경계에서 판정 변화 필요');
});
