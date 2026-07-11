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
test('registry: KDS steel verified — draft lifted (2026-07-11 원문 대조)', () => {
  const r = runCalculator('column_buckling', { Fy: 275, Ag: 5000, L: 3000, r: 60, Pu: 100 }, 'KDS');
  assert.equal(r.standardDraft, false);
  assert.ok(r.attribution.includes('공공누리'));
});

// ── 불변량·경계 테스트 (property-based — 공인예제 게이트와 별개로 수학적 정합성 검증) ──
test('wall invariant: within kern, qmax+qmin == 2V/B (사다리꼴 접지압 보존)', () => {
  const r = runCalculator('retaining_wall_stability', {
    H: 4, stemThickness: 0.4, baseWidth: 2.5, baseThickness: 0.4, toeLength: 0.7,
    gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.5, allowableBearing: 200,
  }, 'KDS');
  const { qmax_kPa, qmin_kPa } = r.checks.bearing;
  close(qmax_kPa + qmin_kPa, (2 * r.intermediate.sumV_kN) / 2.5, 0.05);
});

test('wall superposition: surcharge q=10kPa adds exactly Ka·q·H & heel weight (손계산)', () => {
  const r = runCalculator('retaining_wall_stability', {
    H: 4, stemThickness: 0.4, baseWidth: 2.5, baseThickness: 0.4, toeLength: 0.7,
    gammaBackfill: 18, phiBackfill: 30, surcharge: 10, baseFriction: 0.5, allowableBearing: 200,
  }, 'KDS');
  close(r.intermediate.PaSurcharge_kN, 13.3333, 0.1); // (1/3)*10*4
  close(r.intermediate.Mo_kNm, 90.6667, 0.1);         // 64 + 13.333*2
  close(r.intermediate.sumV_kN, 163.28, 0.1);         // 149.28 + 10*1.4
  close(r.intermediate.Mr_kNm, 249.6, 0.1);           // 224.4 + 14*1.8
});

test('wall out-of-kern: narrow base B=1.6m → 삼각분포 폴백, FAIL 판정 (손계산 qmax=221.0)', () => {
  const r = runCalculator('retaining_wall_stability', {
    H: 4, stemThickness: 0.4, baseWidth: 1.6, baseThickness: 0.4, toeLength: 0.4,
    gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.5, allowableBearing: 200,
  }, 'KDS');
  close(r.intermediate.sumV_kN, 101.76, 0.1);
  close(r.checks.eccentricity.e_m, 0.49308, 0.3);
  assert.equal(r.checks.eccentricity.pass, false);
  assert.equal(r.checks.bearing.qmin_kPa, 0);
  close(r.checks.bearing.qmax_kPa, 221.03, 0.5);
  assert.equal(r.verdict, 'FAIL');
});

test('column continuity: 비탄성↔탄성 분기 경계에서 Fcr 연속 (~0.39Fy)', () => {
  const E = 200000, Fy = 345;
  const limit = 4.71 * Math.sqrt(E / Fy); // ≈113.40
  const mk = (slend) => runCalculator('column_buckling', { Fy, Ag: 10000, L: slend * 100, K: 1.0, r: 100, Pu: 0 }, 'AISC360');
  const below = mk(limit - 0.1).intermediate.Fcr_MPa;
  const above = mk(limit + 0.1).intermediate.Fcr_MPa;
  close(below, above, 0.5);
  close(below, 0.39 * Fy, 1.0); // 이론값 0.658^(1/0.44493)≈0.877*0.44493≈0.390Fy
});

test('beam superposition: (w만)+(P만) == (w+P) 모멘트·처짐 가산성', () => {
  const base = { L: 6000, Fy: 275, E: 205000, Sx: 5e5, Aw: 3000, Ix: 7e7 };
  const rw = runCalculator('simple_beam', { ...base, w: 10 }, 'AISC360');
  const rp = runCalculator('simple_beam', { ...base, P: 20 }, 'AISC360');
  const rb = runCalculator('simple_beam', { ...base, w: 10, P: 20 }, 'AISC360');
  close(rw.intermediate.Mmax_kNm + rp.intermediate.Mmax_kNm, rb.intermediate.Mmax_kNm, 0.05);
  close(rw.checks.deflection.delta_mm + rp.checks.deflection.delta_mm, rb.checks.deflection.delta_mm, 0.05);
});

// ── KDS 원문 대조 캘리브레이션 케이스 (2026-07-11: E=210,000·Fnv 표 4.1-9) ──
test('KDS column: E=210000 (표 3.5-1), KL/r=50, Fy=275 — 손계산 Fe=829.05, Fcr=239.34', () => {
  const r = runCalculator('column_buckling', { Fy: 275, Ag: 10000, L: 5000, K: 1.0, r: 100, Pu: 2000 }, 'KDS');
  close(r.intermediate.Fe_MPa, 829.047, 0.1);
  close(r.intermediate.Fcr_MPa, 239.34, 0.2);
  close(r.checks.capacity_LRFD.phiPn_kN, 2154.1, 0.3);
});

test('KDS bolt: F10T-N Fnv=400 (표 4.1-9) — 4×M20 φRn=376.99kN (≠AISC 350.6)', () => {
  const r = runCalculator('bolt_connection', { boltGrade: 'F10T-N', d: 20, nBolts: 4, tPlate: 10, Fu: 400, Vu: 300 }, 'KDS');
  close(r.intermediate.rnShear_kN_perBolt, 125.66, 0.1);
  close(r.checks.capacity_LRFD.phiRn_kN, 376.99, 0.2);
  assert.equal(r.verdict, 'PASS');
});

// ── 리버스 엔지니어링 검증: 공표 예제 수치 역산 재현 (해설서 대체 전략 §7.0) ──
// 원전: FHWA SBDH Vol.14 Splice Design (퍼블릭 도메인, RAG 코퍼스 p.48·56·60)
// A325 7/8" 2면전단(나사 제외): Rn=0.48·Ab·Fub·Ns=69.27kips, φs=0.80 → Rr="55.42 kips/bolt"(p.60 공표)
test('REVERSE-ENG: SBDH Vol.14 공표값 55.42 kips/bolt 재현 (AASHTO 볼트 전단)', () => {
  const KIPS = 4.448222; // kN per kip
  const r = runCalculator('bolt_connection', {
    boltGrade: 'A325-X', d: 22.225, nBolts: 1, shearPlanes: 2,
    tPlate: 25.4, Fu: 586.05, Vu: 0, // t=1.0in, Fu=85ksi (flange) — 지압이 전단보다 큼 → 전단 지배
  }, 'AASHTO');
  assert.equal(r.intermediate.governing, 'shear');
  close(r.intermediate.rnShear_kN_perBolt / KIPS, 69.27, 0.3);          // Rn (nominal, double shear)
  close(r.checks.capacity_LRFD.phiRn_kN / KIPS, 55.42, 0.3);            // 공표값 재현
});

// p.56 공표: Rn_outer = 5×[2.4(0.875)(1.00)(85)] = 892.5 kips (지압, 표준구멍 Lc>2d)
test('REVERSE-ENG: SBDH Vol.14 공표값 892.5 kips 재현 (AASHTO 지압 5본)', () => {
  const KIPS = 4.448222;
  const r = runCalculator('bolt_connection', {
    boltGrade: 'A325-X', d: 22.225, nBolts: 5, shearPlanes: 2,
    tPlate: 25.4, Fu: 586.05, Vu: 0,
  }, 'AASHTO');
  close((r.intermediate.rnBearing_kN_perBolt * 5) / KIPS, 892.5, 0.3);  // 공표값 재현
});

// 교차표준 정합: 동일 역학, 계수만 분기 — KDS/AISC/AASHTO 전단내력 비율 = Fnv·φ 비율과 일치해야 함
test('REVERSE-ENG: 교차표준 정합 — 볼트 내력비 = (Fnv·φ)비 (KDS vs AISC)', () => {
  const base = { d: 20, nBolts: 4, shearPlanes: 1, tPlate: 20, Fu: 400, Vu: 0 };
  const kds = runCalculator('bolt_connection', { ...base, boltGrade: 'F10T-N' }, 'KDS');
  const aisc = runCalculator('bolt_connection', { ...base, boltGrade: 'A325-N' }, 'AISC360');
  const ratio = kds.checks.capacity_LRFD.phiRn_kN / aisc.checks.capacity_LRFD.phiRn_kN;
  close(ratio, (400 * 0.75) / (372 * 0.75), 0.05); // = 400/372
});

// 원전: FHWA SBDH Design Example 3 (curved I-girder) p.154-156 지압보강재 기둥검토 —
// 유효기둥 As=16.2in², rs=3.45in, KL=0.75D=63in, Fy=50ksi: 공표 Pn=790 kips, Pr=0.95·790=750 kips
test('REVERSE-ENG: SBDH DE3 공표값 Pn=790·Pr=750 kips 재현 (AASHTO 압축재)', () => {
  const KIPS = 4.448222, IN = 25.4, KSI = 6.894757;
  const r = runCalculator('column_buckling', {
    Fy: 50 * KSI, E: 29000 * KSI, Ag: 16.2 * IN * IN, L: 63 * IN, K: 1.0, r: 3.45 * IN, Pu: 451 * KIPS,
  }, 'AASHTO');
  close(r.intermediate.Fe_MPa / KSI, 13905 / 16.2, 0.3);       // Fe = Pe/As = 858.3 ksi
  assert.match(r.intermediate.branch, /inelastic/);
  close((r.intermediate.Fcr_MPa * 16.2 * IN * IN) / KSI / (IN * IN), 790, 0.3); // Pn(kips)
  close(r.checks.capacity_LRFD.phiPn_kN / KIPS, 750, 0.3);     // 공표 Pr 재현 (φc=0.95)
  assert.equal(r.verdict, 'PASS');                              // Pu=451 < 750
});
