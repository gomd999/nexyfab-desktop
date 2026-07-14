/**
 * 공표예제 재현 벤치 (§7.0 게이트) — 퍼블릭도메인 원문에서 **직독한 숫자만** 사용.
 * 소싱: 2026-07-14 리서치 에이전트 (원문 PDF fetch + 산술 검산 완료. 날조 없음).
 *
 * 이원화 원칙: 여기는 "보편 수식"의 공표 재현 — KDS 고유계수(β1·φ계수·허용응력값)는
 * kds.json 원문 대조로 별도 커버. 방법이 다른 예제(USACE 쐐기법 등)는 재현 가능한
 * 원자(Ka 등)만 대조하고 방법 플래그를 명시한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';

const close = (got, want, tolPct, label) =>
  assert.ok(Math.abs(got - want) <= Math.abs(want) * tolPct / 100, `${label}: got ${got}, want ${want} (±${tolPct}%)`);

// ── 합리식 — FHWA HEC-22 3rd ed. (FHWA-NHI-10-009, 2009) §3.2.2 (PD) ─────────
test('[공표] HEC-22 Example 3-3 기존조건: C=0.235·i=48mm/hr·A=17.55ha → Q=0.55 m³/s', () => {
  const r = runCalculator('landscape_drainage', { areaHa: 17.55, C: 0.235, i_mmhr: 48 }, 'KDS');
  close(Number(r.intermediate.Q_design_m3s), 0.55, 1.0, 'Q(기존)');
});

test('[공표] HEC-22 Example 3-3 개발후: C=0.315·i=58mm/hr·A=17.55ha → Q=0.89 m³/s', () => {
  const r = runCalculator('landscape_drainage', { areaHa: 17.55, C: 0.315, i_mmhr: 58 }, 'KDS');
  close(Number(r.intermediate.Q_design_m3s), 0.89, 1.0, 'Q(개발후)');
});

// ── Mononobe-Okabe — USACE WES ITL-92-11 (Ebeling & Morrison, 1992) Ch.4 (PD) ─
// Example 9: H=20ft, γ=120pcf, φ'=35°, δ=0, β=5°, kh=0.2, kv=−0.1343 → KAE=0.4044, PAE=11,009 lb/ft
test('[공표] ITL-92-11 Ex.9: 일반 M-O KAE=0.4044 · PAE=11,009 lb/ft 재현', () => {
  const H_m = 20 * 0.3048;                 // 6.096 m
  const gamma = 120 * 0.157087;            // pcf → kN/m³ = 18.8504
  const r = runCalculator('retaining_wall_stability', {
    H: H_m, stemThickness: 0.3, baseWidth: 3, baseThickness: 0.5, toeLength: 0.8,
    gammaBackfill: gamma, phiBackfill: 35, baseFriction: 0.6, allowableBearing: 500,
    seismicKh: 0.2, seismicKv: -0.1343, backfillSlopeDeg: 5, wallFrictionDeg: 0,
  }, 'KDS');
  close(r.seismic.Kae, 0.4044, 0.3, 'KAE');
  // PAE(kN/m) → lb/ft (1 kN/m = 68.5218 lb/ft)
  const paeLbFt = r.seismic.Pae_kN * 68.5218;
  close(paeLbFt, 11009, 0.6, 'PAE lb/ft');
});

// Example 7/8: φ'=30°, δ=3°, β=6°, kh=0.1, kv=±0.067 → KAE 쌍 {0.4268, 0.4154}
// kv 부호 관례: 본 계산기는 ψ=atan(kh/(1−kv)) — Ex.9(kv=−0.1343→ψ=10°)로 앵커됨.
// ITL 전사본의 Ex.7/8 kv 부호 라벨은 반대 관례로 읽혔음(값 쌍은 동일 재현) — 앵커 관례로 짝 매김.
test('[공표] ITL-92-11 Ex.7/8: KAE 쌍 {0.4268, 0.4154} 재현 (kv 관례=Ex.9 앵커)', () => {
  const base = {
    H: 6.096, stemThickness: 0.3, baseWidth: 3, baseThickness: 0.5, toeLength: 0.8,
    gammaBackfill: 18.85, phiBackfill: 30, baseFriction: 0.6, allowableBearing: 500,
    seismicKh: 0.1, backfillSlopeDeg: 6, wallFrictionDeg: 3,
  };
  const rPlus = runCalculator('retaining_wall_stability', { ...base, seismicKv: +0.067 }, 'KDS');
  const rMinus = runCalculator('retaining_wall_stability', { ...base, seismicKv: -0.067 }, 'KDS');
  close(rPlus.seismic.Kae, 0.4268, 0.5, 'KAE(1−kv=0.933)');
  close(rMinus.seismic.Kae, 0.4154, 0.5, 'KAE(1−kv=1.067)');
});

// ── 옹벽 Ka 원자 — USACE EM 1110-2-2502 (2022) Appendix D (PD) ────────────────
// 원문: 개발강도 φd=14° → KA=(1−sin14)/(1+sin14)=0.61. (전체 예제는 쐐기법·수압·인장균열
// 포함이라 방법 상이 — Rankine Ka 원자만 대조, 방법 플래그 명시)
test('[공표·부분] EM-2502(2022) App.D: Rankine Ka(φ=14°)=0.61 원자 재현', () => {
  const r = runCalculator('retaining_wall_stability', {
    H: 7.62, stemThickness: 0.4, baseWidth: 6.1, baseThickness: 0.6, toeLength: 1.5,
    gammaBackfill: 18, phiBackfill: 14, baseFriction: 0.53, allowableBearing: 500,
  }, 'KDS');
  close(r.intermediate.Ka, 0.61, 1.0, 'Ka(φd=14)');
});

// ── 목재 단면성능 원자 — USDA FS EM 7700-8 Timber Bridges (1990) Ex.7-9 (PD) ──
// 6×18 실치수 5.5×17.5 in → S=280.73 in³, I=2,456.38 in⁴. (허용응력측은 NDS 수종값이라
// KDS 계산기와 재료표 상이 — 단면성능·역학 원자만 재현)
test('[공표·부분] EM 7700-8 Ex.7-9: 단면성능 S=280.73in³ · I=2456.38in⁴ 재현', () => {
  const b = 5.5 * 25.4, h = 17.5 * 25.4; // mm
  const r = runCalculator('timber_beam', { species: 'pine', grade: 1, b, h, L: 5182, w: 1.0 }, 'KDS');
  const S_in3 = r.intermediate.S_mm3 / 16387.064;
  const I_in4 = r.intermediate.I_mm4 / 416231.4256;
  close(S_in3, 280.73, 0.2, 'S in³');
  close(I_in4, 2456.38, 0.2, 'I in⁴');
});

// ── 박스암거 교차 대조 — FHWA-IP-83-6 (1983) App.D.1 Throat (PD) ─────────────
// 원문은 계수식(G1~G4, eq3.8) 설계법 — 우리 처짐각법 정해와 **방법 상이**. 동일 하중·
// 중심선 기하로 교차 대조: 우각부 모멘트 자릿수·부호 일치 확인(±25% 허용, 편차 기록).
// 원문: B'=7.67ft·D'=6.67ft·T=8in, Pv=1,426psf, ps=690/176psf → Mo,max=−67,680 in-lb/ft
test('[공표·교차] FHWA-IP-83-6 App.D.1: 우각부 모멘트 교차 대조(방법 상이 — ±25%)', async () => {
  const calc = (await import('../calculators/box-culvert-frame.mjs')).default;
  const ft = 0.3048, psf = 0.0478803; // → kPa
  // 우리 입력으로 등가 재구성: 연직 wv=1,426psf 직접 주려면 cover·γ 대신 surcharge 사용, 자중 제외
  const r = calc.run({
    innerWidth: 7.67 * ft, innerHeight: 6.67 * ft, wallThk: (8 / 12) * ft,
    cover: 0, gammaSoil: 0, K: 1, surcharge: 0, gammaConcrete: 0,
    // 측압 사다리꼴은 K·γ 경로라 직접 주입 불가 → 등가: γ·K 재구성
  });
  // 직접 재구성이 제한적이므로 두 번째 방식: wv는 surcharge로, 측압 최대(690psf)를 등가 K·γ(z)로 근사 불가한
  // 부분이 있어, 여기서는 '상판 등분포 단독' 항만 대조: 원문 계수식의 상판 항 wv·(B')²·G 계열과
  // 우리 정해의 상판 모멘트 스케일 비교 — 완전 등가 하중 재구성은 후속(사다리꼴 주입 인터페이스 필요).
  const r2 = calc.run({
    innerWidth: 7.67 * ft, innerHeight: 6.67 * ft, wallThk: (8 / 12) * ft,
    cover: 0, gammaSoil: 0, K: (690 / 1426), surcharge: 1426 * psf, gammaConcrete: 0,
  });
  // 원문 Mo,max=−67,680 in-lb/ft → kN·m/m: ×0.000112985/0.3048 = 25.08 kN·m/m... 정확 환산:
  const MoPub = 67680 * 0.112984829 / 1000 / 0.3048; // in-lb/ft → kN·m/m = 25.09
  const got = Math.abs(r2.moments_kNm.cornerTop);
  const dev = Math.abs(got - MoPub) / MoPub * 100;
  console.log(`  [교차기록] 우리 ${got.toFixed(2)} vs 공표 ${MoPub.toFixed(2)} kN·m/m — 편차 ${dev.toFixed(1)}% (측압 균등근사·방법 상이)`);
  assert.ok(got > 0 && Number.isFinite(got), '유한 모멘트');
  assert.ok(dev < 25, `교차 편차 ${dev.toFixed(1)}% ≥ 25% — 하중 재구성 확인 필요`);
});

// ── 국토해양부 2008 「도로암거 표준도 구조계산서」 P1-16 (통로1련 4.0×4.0m, 토피 2.0) ──
// 출처: CODIL CIGCOS910033 (정부간행물 11-1611000-000332-01, 원문 p.36 사용하중 단면력).
// 모델 차이(명시): 원문=SAP2000 비등두께+지반스프링(BEF)+헌치+활하중 포락선 / 본 계산기=
// 처짐각법 강체지지·무헌치·단일재하. → 상우각(스프링 영향 최소)은 근접, 하부는 스프링
// 차이·상판중앙은 포락선 미적용으로 계통 편차 — 허용치를 부위별로 정직하게 분리.
test('공표예제: 국토부 2008 암거 P1-16 — 상우각 ≤5%·하부 ≤12% 재현', () => {
  const r = runCalculator('box_culvert_frame', {
    innerWidth: 4.0, innerHeight: 4.0, wallThk: 0.35, topThk: 0.40, botThk: 0.45,
    cover: 2.0, gammaSoil: 19.0, K: 0.5, gammaConcrete: 24.5,
    surchargeV: 18.079, pTopOverride: 25.9, pBotOverride: 67.937,
  }, 'KDS');
  assert.equal(r.geometry.spanL_m, 4.35, '중심선 스팬 = 원문 4.350');
  assert.equal(r.geometry.wallH_m, 4.42, '중심선 벽고 ≈ 원문 4.425');
  const dev = (ours, pub) => Math.abs((Math.abs(ours) - pub) / pub);
  assert.ok(dev(r.moments_kNm.cornerTop, 84.65) < 0.05, `상우각 ${r.moments_kNm.cornerTop} vs −84.65`);
  assert.ok(dev(r.moments_kNm.cornerBottom, 91.72) < 0.12, `하우각 ${r.moments_kNm.cornerBottom} vs −91.72 (지반스프링 차이)`);
  assert.ok(dev(r.moments_kNm.midBottom, 108.64) < 0.12, `하판중앙 ${r.moments_kNm.midBottom} vs 108.64`);
  // 상판중앙: 원문 91.82는 활하중 포락선(측압 최소 케이스) — 단일재하는 하회함을 명시적 문서화
  assert.ok(r.moments_kNm.midTop < 91.82, '단일재하 midTop < 포락선값 (비보수 방향 — 계산기 노트로 경고)');
});

// ── 국토부 2008 H1-28 (수로1련 3.0×3.0m, 토피 5.0 — 토압 지배 케이스) ──
test('공표예제: 국토부 2008 암거 H1-28 — 토피 5m 스케일링', () => {
  // Wd1=95.0(=19×5), WI1=10.0(토피≥4m 상수), 측압 49.4→81.937 + WI2 5.0
  const r = runCalculator('box_culvert_frame', {
    innerWidth: 3.0, innerHeight: 3.0, wallThk: 0.30, topThk: 0.40, botThk: 0.45,
    cover: 5.0, gammaSoil: 19.0, K: 0.5, gammaConcrete: 24.5,
    surchargeV: 10.0, pTopOverride: 54.4, pBotOverride: 86.937,
  }, 'KDS');
  const dev = (ours, pub) => Math.abs((Math.abs(ours) - pub) / pub);
  assert.ok(dev(r.moments_kNm.cornerTop, 77.24) < 0.12, `상우각 ${r.moments_kNm.cornerTop} vs −77.24`);
  assert.ok(dev(r.moments_kNm.cornerBottom, 74.55) < 0.15, `하우각 ${r.moments_kNm.cornerBottom} vs −74.55`);
});

// ── 국토부 2008 P1-16 — Winkler(Kv 17778.5, p.11) + 포락선(표 12-2, p.24) 완전 재현 ──
// 원문과 동일 모델링: 지반스프링(절점 Kv×분담폭)·부재별 두께·사용하중 3조합 포락선.
// 잔여 편차 = 헌치(250×250) 미모델 — 하부는 보수측(+6~11%)으로만 벗어남을 고정.
test('공표예제: 국토부 P1-16 Winkler+포락선 — 상판 ≤3%·하부 보수측 ≤13%', () => {
  const r = runCalculator('box_culvert_frame', {
    innerWidth: 4.0, innerHeight: 4.0, wallThk: 0.35, topThk: 0.40, botThk: 0.45,
    cover: 2.0, gammaSoil: 19.0, K: 0.5, gammaConcrete: 24.5,
    surchargeV: 18.079, pTopOverride: 25.9, pBotOverride: 67.937,
    subgradeKs: 17778.519, EcMPa: 27000, envelope: true,
  }, 'KDS');
  const dev = (ours, pub) => (Math.abs(ours) - pub) / pub;
  assert.ok(Math.abs(dev(r.moments_kNm.cornerTop, 84.65)) < 0.03, `상우각 ${r.moments_kNm.cornerTop}`);
  assert.ok(Math.abs(dev(r.moments_kNm.midTop, 91.82)) < 0.03, `상판중앙 ${r.moments_kNm.midTop} (포락선 ③측압0.5 지배)`);
  assert.equal(r.governingCase.midTop, '③측압 0.5', '지배 조합 = 원문 조합3');
  const db = dev(r.moments_kNm.cornerBottom, 91.72), dm = dev(r.moments_kNm.midBottom, 108.64);
  assert.ok(db >= -0.02 && db < 0.13, `하우각 보수측 ${r.moments_kNm.cornerBottom}`);
  assert.ok(dm >= -0.02 && dm < 0.13, `하판중앙 보수측 ${r.moments_kNm.midBottom}`);
});

// ── 국토부 2008 「도로옹벽 표준도 구조계산서」 T-7 (역T형 H=6.0m) — RC 부재 게이트 ──
// 출처: CODIL OTMCEC090356 p.128~131. KCI 2007 기준(φf 0.85·φv 0.75·Vc=√fck/6)
// = KDS 14 20 동일 계보 — φ 차이 없음. 재현: φMn 3단면·φVc 소수점 일치.
test('공표예제: 국토부 옹벽 T-7 — rc_beam φMn·φVc 3단면 ≤0.1%', () => {
  const c1 = runCalculator('rc_beam', { b: 1000, d: 520, fck: 24, fy: 400, As: 2292, Mu: 325.827, Vu: 167.364 }, 'KDS');
  assert.ok(Math.abs(c1.checks.flexure.phiMn_kNm - 387.715) < 0.4, `벽체하단 φMn ${c1.checks.flexure.phiMn_kNm}`);
  assert.ok(Math.abs(c1.checks.shear.phiVn_kN - 318.434) < 0.4, `벽체하단 φVc ${c1.checks.shear.phiVn_kN}`);
  const c2 = runCalculator('rc_beam', { b: 1000, d: 370, fck: 24, fy: 400, As: 1146, Mu: 49.943, Vu: 50 }, 'KDS');
  assert.ok(Math.abs(c2.checks.flexure.phiMn_kNm - 139.789) < 0.2, `벽체중앙 φMn ${c2.checks.flexure.phiMn_kNm}`);
  const c3 = runCalculator('rc_beam', { b: 1000, d: 520, fck: 24, fy: 400, As: 794.4, Mu: 68.134, Vu: 209.982 }, 'KDS');
  assert.ok(Math.abs(c3.checks.flexure.phiMn_kNm - 138.346) < 0.2, `앞굽 φMn ${c3.checks.flexure.phiMn_kNm}`);
});

// ── StructurePoint 띠기둥 P-M 상관도 (ACI 318-14 공개 예제) — 공칭값 비교 ──
// 16×16in·fc′5000psi·fy60ksi·8-#9. 공칭 Pn·Mn만 비교(φ는 ACI 0.90/0.65 vs KDS
// 0.85/0.65 상이 — 명시). 단위환산: 1kip=4.4482kN, 1k-ft=1.3558kN·m.
test('공표예제: SP 기둥 P-M — Po·εs=0점 공칭 ≤0.5%', () => {
  const inp = { b: 406.4, h: 406.4, dPrime: 63.5, fck: 34.474, fy: 413.685, Ast: 5161.3 };
  const r0 = runCalculator('rc_column_pm', { ...inp, Pu: 4257, Mu: 353.9 }, 'KDS');
  assert.ok(Math.abs(r0.intermediate.Po_kN - 1530 * 4.4482) / (1530 * 4.4482) < 0.005, `Po ${r0.intermediate.Po_kN}`);
  assert.ok(Math.abs(r0.intermediate.Pn_kN - 957 * 4.4482) / (957 * 4.4482) < 0.005, `εs=0 Pn ${r0.intermediate.Pn_kN}`);
  assert.ok(Math.abs(r0.intermediate.Mn_kNm - 261 * 1.3558) / (261 * 1.3558) < 0.005, `εs=0 Mn ${r0.intermediate.Mn_kNm}`);
  assert.ok(Math.abs(r0.intermediate.c_mm - 13.5 * 25.4) < 1, `중립축 c ${r0.intermediate.c_mm}`);
});
