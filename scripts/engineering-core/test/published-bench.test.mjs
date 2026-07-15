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

// ── 교량 이동하중 엔진 — AASHTO HS-20/HL-93 공표표 재현 ──────────────────
// HB-17 App.A(절대최대·충격 제외): 40ft 449.8·100ft 1524.0·120ft 1883.3 kip-ft, V 55.2 kip.
// HS-20 트럭 = 8/32/32 kip @14ft (FHWA HIF-19-010 p.174 판독 — HL-93 트럭 동일).
import { sweepSimpleSpan } from '../moving-load.mjs';
test('공표예제: HS-20 절대최대모멘트 표(HB-17) 재현 ≤0.1%', () => {
  const hs20 = [{ P: 8, x: 0 }, { P: 32, x: 14 }, { P: 32, x: 28 }];
  const cases = [[40, 449.8, 55.2], [100, 1524.0, 65.3], [120, 1883.3, 66.4]];
  for (const [L, Mpub, Vpub] of cases) {
    const r = sweepSimpleSpan(L, hs20);
    assert.ok(Math.abs(r.Mmax_kNm - Mpub) / Mpub < 0.001, `M(${L}ft) ${r.Mmax_kNm.toFixed(1)} vs ${Mpub}`);
    assert.ok(Math.abs(r.Vmax_kN - Vpub) / Vpub < 0.002, `V(${L}ft) ${r.Vmax_kN.toFixed(1)} vs ${Vpub}`);
  }
});

// Caltrans BDM 4.7 Table 4.7.2: HL-93 조합(트럭×1.33+차선 0.64klf) 100ft → 2821.6 kip-ft
// (Caltrans는 트럭 1520(중앙 관례) 사용 — 절대최대 1524와 0.3% 차: 허용 0.5%)
test('공표예제: Caltrans HL-93 조합(IM 33% 트럭만) 재현 ≤0.5%', () => {
  const hs20 = [{ P: 8, x: 0 }, { P: 32, x: 14 }, { P: 32, x: 28 }];
  const L = 100;
  const M = sweepSimpleSpan(L, hs20).Mmax_kNm * 1.33 + 0.64 * L * L / 8;
  assert.ok(Math.abs(M - 2821.6) / 2821.6 < 0.005, `HL-93 100ft ${M.toFixed(1)} vs 2821.6`);
});

// KL-510 (KDS 24 12 21 원문): 차로 wL²/8 폐형 + 지배조합 성질
test('공표예제: girder_line KL-510 — 차로 폐형·조합 성질', () => {
  const r = runCalculator('girder_line', { span: 30, DF: 1.0 }, 'KDS');
  assert.equal(r.lane.M_kNm, +(12.7 * 900 / 8).toFixed(1), '차로 wL²/8');
  assert.ok(r.truck.M_kNm > 192 * 30 / 4, '트럭 M > 최대축 PL/4');
  assert.ok(r.perLane.M_kNm >= r.truck.M_kNm * 1.25 * 0.999, '조합 ≥ 트럭×(1+IM)');
  // L>60m 차로 감소식
  const r2 = runCalculator('girder_line', { span: 90, DF: 1.0 }, 'KDS');
  assert.equal(r2.lane.w_kNm, +(12.7 * Math.pow(60 / 90, 0.1)).toFixed(2), '차로 감소식 (60/L)^0.1');
});

// ── FHWA NHI-10-025 (GEC 11) Example E4 — MSE 외적안정 LRFD 재현 ──────────
// 원문 p.E4-7~9 판독: 활동 임계 CDR 1.37 · 편심 3.87ft ≤ L/4 · 지지 σv에서 CDR.
test('공표예제: FHWA MSE E4 — 활동 CDR·편심 정확 재현', () => {
  const ft = 0.3048, pcf = 0.1571, psf = 0.0479;
  const r = runCalculator('mse_wall', {
    H: 25.64 * ft, L: 18 * ft, gammaR: 125 * pcf, phiR: 34, gammaF: 125 * pcf,
    phiF: 30, phiFd: 30, surcharge: 250 * psf, bearingResistance: 10500 * psf,
  }, 'KDS');
  assert.ok(Math.abs(r.checks.sliding.CDR - 1.37) < 0.02, `활동 CDR ${r.checks.sliding.CDR}`);
  assert.ok(Math.abs(r.checks.eccentricity.e_m / ft - 3.87) < 0.05, `편심 ${(r.checks.eccentricity.e_m / ft).toFixed(2)}ft`);
  assert.ok(r.checks.bearing.CDR > 1.5 && r.checks.bearing.CDR < 1.85, `지지 CDR ${r.checks.bearing.CDR}`);
  assert.equal(r.verdict, 'PASS');
});

// Bishop 엔진 — φ=0 폐형 앵커 (mα=cosα → FS=Σ(cΔL)/ΣWsinα 정확)
test('Bishop 엔진: φ=0 폐형 앵커', () => {
  const slices = [
    { W: 100, alphaDeg: 30, dx: 10, c: 20, phiDeg: 0 },
    { W: 200, alphaDeg: 10, dx: 10, c: 20, phiDeg: 0 },
    { W: 100, alphaDeg: -10, dx: 10, c: 20, phiDeg: 0 },
  ];
  const closed = slices.reduce((s, x) => s + (x.c * x.dx) / Math.cos(x.alphaDeg * Math.PI / 180), 0)
    / slices.reduce((s, x) => s + x.W * Math.sin(x.alphaDeg * Math.PI / 180), 0);
  const r = runCalculator('slope_bishop', { slices, fsRequired: 1.3 }, 'KDS');
  assert.ok(Math.abs(r.checks.stability.FS - closed) < 0.001, `FS ${r.checks.stability.FS} vs 폐형 ${closed.toFixed(3)}`);
});

// ── USACE EM 1110-2-1902 App.F F-5 — Bishop 간편법 재현 (재판독 교정) ──────
// Figure F-11c 절편표: b열·Δℓ열이 역순 인쇄된 판본 확인(재판독 에이전트 —
// col13 역산·면적 검증 3중 근거) → 교정 b 사용 시 FS 1.340 (공표 1.33, 표
// 반올림 정수합 698/524=1.332). c=1.78/1.60 ksf 원값·W=전중량·Δx 기준.
test('공표예제: USACE Bishop F-5 — FS 1.33 재현 (±1%)', () => {
  const b = [17, 22, 22, 29, 26, 28, 37, 36, 44, 57]; // 인쇄 역순 교정
  const W = [30, 108, 158, 251, 241, 257, 320, 275, 253, 129];
  const alpha = [48, 43, 37, 31, 24, 18, 11, 4, -5, -15];
  const cc = [1.78, 1.78, 1.78, 1.78, 1.78, 1.6, 1.6, 1.6, 1.6, 1.6];
  const phi = [5, 5, 5, 5, 5, 2, 2, 2, 2, 2];
  const slices = b.map((bx, i) => ({ W: W[i], alphaDeg: alpha[i], dx: bx, c: cc[i], phiDeg: phi[i] }));
  const r = runCalculator('slope_bishop', { slices, fsRequired: 1.3 }, 'KDS');
  assert.ok(Math.abs(r.checks.stability.FS - 1.34) < 0.015, `FS ${r.checks.stability.FS} vs 1.33~1.34`);
});

// ── 심화 라운드: Bishop 자동탐색·3경간·PSC 솟음·MSE 내적 ─────────────────────
test('slope_bishop auto: Taylor stability number (phi=0, beta=60) within 1%', () => {
  // Taylor(1937) Ns=0.191 → FS = c/(γH·Ns) = 20/(18·10·0.191) = 0.582 (공표 안정수)
  const r = runCalculator('slope_bishop', { geometry: { H: 10, slopeDeg: 60, gamma: 18, c_kPa: 20, phiDeg: 0.01 }, fsRequired: 1.3 }, 'KDS');
  assert.ok(Math.abs(r.checks.stability.FS - 0.582) / 0.582 < 0.01, `FS ${r.checks.stability.FS}`);
});

test('threeSpanUdlEnvelope: classic anchors 7wL2/60 and alternate-span 0.10125wL2', async () => {
  const { threeSpanUdlEnvelope } = await import('../moving-load.mjs');
  const r = threeSpanUdlEnvelope(10, 10);
  assert.ok(Math.abs(r.MsupMax_kNm - 116.667) < 0.1, `sup ${r.MsupMax_kNm}`);
  assert.ok(Math.abs(r.MspanMax_kNm - 101.25) < 0.3, `span ${r.MspanMax_kNm}`);
});

test('sweepThreeSpan: uniform train reproduces adjacent-span pattern 7wL2/60', async () => {
  const { sweepThreeSpan } = await import('../moving-load.mjs');
  const axles = Array.from({ length: 121 }, (_, i) => ({ P: 2.5, x: i * 0.25 })); // w=10kN/m 등가
  const r = sweepThreeSpan(10, axles, { steps: 800, reverse: false });
  assert.ok(Math.abs(r.MsupMax_kNm - 116.67) < 2, `sup ${r.MsupMax_kNm}`);
});

test('psc_girder camber: elastic closed form Pe·e·L2/8EI and 5wL4/384EI', () => {
  const r = runCalculator('psc_girder', {
    A_mm2: 600000, I_mm4: 2e11, yt_mm: 800, yb_mm: 700, Pj_kN: 3000, e_mm: 400,
    lossImmediate_pct: 5, lossTotal_pct: 20, Mo_kNm: 900, Ms_kNm: 2400, fck: 40, fci: 32,
    camber: { L_m: 30, wSw_kNm: 14.7 },
  }, 'KDS');
  const Eci = 8500 * Math.cbrt(36);
  const up = (2850e3 * 400 * 9e8) / (8 * Eci * 2e11);
  const sw = (5 * 14.7 * Math.pow(30000, 4)) / (384 * Eci * 2e11);
  assert.ok(Math.abs(r.camber.transfer.up_mm - up) < 0.15 && Math.abs(r.camber.transfer.selfWt_mm - sw) < 0.15);
});

test('mse_wall internal: bottom-layer rupture governs (Tmax exceeds Tal) — gate detects', () => {
  const r = runCalculator('mse_wall', {
    H: 8, L: 5.6, gammaR: 20, phiR: 34, gammaF: 19, phiF: 30, surcharge: 12, bearingResistance: 600,
    internal: { Sv_m: 0.8, type: 'steel_strip', Tal_kNm: 50, Rc: 1.0 },
  }, 'KDS');
  const layers = r.internal.layers;
  assert.ok(layers.length === 10 && layers[0].cdrRupture > 3 && layers[layers.length - 1].cdrRupture < 1);
  assert.equal(r.internal.pass, false);
});

// ── 심화 배치 2: 용접·압밀·말뚝·PSC Mn·경계요소 ─────────────────────────────
test('consolidation: classic Tv anchors U50=0.197, U90=0.848 (exact series)', () => {
  const r = runCalculator('consolidation', { H_m: 6, e0: 1.1, Cc: 0.36, sigma0_kPa: 80, dSigma_kPa: 60, cv_m2yr: 2.5 }, 'KDS');
  const t50 = r.time.curve.find((x) => x.U_pct === 50), t90 = r.time.curve.find((x) => x.U_pct === 90);
  assert.ok(Math.abs(t50.Tv - 0.197) < 0.001 && Math.abs(t90.Tv - 0.848) < 0.001);
});

test('weld_connection: closed-form 0.75*0.6*FEXX*0.7s*(L-2s) and beta=1.2-0.002(L/s)', () => {
  const r = runCalculator('weld_connection', { weldSize_mm: 6, length_mm: 200, FEXX_MPa: 490, demandP_kN: 150 }, 'KDS');
  assert.ok(Math.abs(r.checks.strength.phiRn_kN - 174.1) < 0.2);
  const r2 = runCalculator('weld_connection', { weldSize_mm: 6, length_mm: 1000, FEXX_MPa: 490, demandP_kN: 100 }, 'KDS');
  assert.ok(Math.abs(r2.intermediate.Le_mm / 988 - 0.871) < 0.003);
});

test('pile_capacity: homogeneous clay alpha-method closed form', () => {
  const r = runCalculator('pile_capacity', { dia_m: 0.5, length_m: 15, layers: [{ thick_m: 15, type: 'clay', Su_kPa: 50, alpha: 0.9 }], tip: { type: 'clay', Su_kPa: 50 } }, 'KDS');
  assert.ok(Math.abs(r.checks.capacity.Qu_kN - 1148.6) < 1);
});

test('psc_girder ultimate: strain compatibility force balance closes', () => {
  const r = runCalculator('psc_girder', {
    A_mm2: 600000, I_mm4: 2e11, yt_mm: 800, yb_mm: 700, Pj_kN: 3000, e_mm: 400, lossTotal_pct: 20, Mo_kNm: 900, Ms_kNm: 2400, fck: 40,
    ultimate: { b_mm: 1000, dp_mm: 800, Ap_mm2: 1664.4, fpu_MPa: 1860, fpy_MPa: 1580 },
  }, 'KDS');
  const u = r.checks.ultimate;
  const cCheck = (1664.4 * u.fps_MPa) / (0.85 * 40 * 1000 * 0.8);
  assert.ok(Math.abs(cCheck - u.c_mm) < 0.5 && u.fps_MPa > 1580 && u.fps_MPa < 1860);
});

test('shear_wall boundary element: eq 4.7-2 with 0.007 floor', () => {
  const r = runCalculator('shear_wall', {
    walls: [{ lw_mm: 4000, t_mm: 300, h_mm: 30000 }], storyShear_kN: 1000, fck: 27,
    boundary: { wallIndex: 1, c_mm: 900, deltaU_mm: 120 },
  }, 'KDS');
  assert.ok(Math.abs(r.boundaryElement.cLimit_mm - 952) <= 1 && r.boundaryElement.required === false);
});

test('planting_base: KDS 34 tables — soil depth gate and eq 4.4-1 weight', () => {
  const r = runCalculator('planting_base', { soilCheck: { plantType: '심근성교목', soilKind: 'natural', soilGrade: 'high', providedDepth_cm: 80 } }, 'KDS');
  assert.ok(r.checks.soilDepth.surviveMin_cm === 90 && r.checks.soilDepth.growMin_cm === 100 && r.verdict === 'FAIL');
  const w = runCalculator('planting_base', { treeWeight: { rootDia_cm: 30, trunkGroup: 'B', rootBallVol_m3: 0.35 } }, 'KDS');
  assert.ok(Math.abs(w.checks.treeWeight.Wtop_kg - 324) < 2 && w.checks.treeWeight.Wroot_kg === 455);
});

test('fixture_supply: KDS 31 30 15 tables — flow sum and pressure gates', () => {
  const r = runCalculator('fixture_supply', { fixtures: [{ type: '세면기', count: 2 }, { type: '대변기_세정밸브', count: 2 }, { type: '샤워기', count: 1 }], supplyPressure_kPa: 90 }, 'KDS');
  assert.ok(Math.abs(r.checks.flow.sumQ_Ls - 3.58) < 0.01 && r.checks.pressure.requiredMin_kPa === 100 && r.verdict === 'FAIL');
});

// ── 검증 강화 라운드: N경간·용접군·연결보·유토곡선 ──────────────────────────
test('nSpan: n=3 matches threeSpanUdlEnvelope; n=2 truck matches sweepTwoSpan', async () => {
  const m = await import('../moving-load.mjs');
  const a = m.nSpanUdlEnvelope(10, 3, 10), b = m.threeSpanUdlEnvelope(10, 10);
  assert.ok(Math.abs(a.MsupMax_kNm - b.MsupMax_kNm) < 0.01 && Math.abs(a.MspanMax_kNm - b.MspanMax_kNm) < 0.3);
  const ax = [{ P: 100, x: 0 }, { P: 100, x: 3 }];
  const s2 = m.sweepNSpan(10, 2, ax, { steps: 800 }), ref = m.sweepTwoSpan(10, ax);
  assert.ok(Math.abs(s2.MsupMax_kNm - ref.MsupMax_kNm) < 1);
});

test('weld group: elastic vector method centroid and polar J hand-check', () => {
  const r = runCalculator('weld_connection', {
    weldSize_mm: 8, length_mm: 400, nSegments: 3, FEXX_MPa: 490, demandP_kN: 0,
    group: { segments: [{ x1: 0, y1: 0, x2: 0, y2: 200 }, { x1: 0, y1: 0, x2: 100, y2: 0 }, { x1: 0, y1: 200, x2: 100, y2: 200 }], Py_kN: 100, e_mm: 150 },
  }, 'KDS');
  const g = r.checks.group;
  const Jhand = 200 ** 3 / 12 + 200 * 625 + 2 * (100 ** 3 / 12 + 100 * (625 + 10000));
  assert.ok(Math.abs(g.centroid.x - 25) < 0.1 && Math.abs(g.J_mm3 - Jhand) < 2);
});

test('coupling_beam: classification threshold and eq 4.7-3', () => {
  const r = runCalculator('coupling_beam', { ln_mm: 1500, h_mm: 900, b_mm: 400, fck: 27, Vu_kN: 800 }, 'KDS');
  assert.ok(Math.abs(r.checks.classification.VuVsThreshold.threshold_kN - 623.5) < 1 && r.verdict === 'FAIL');
  const r2 = runCalculator('coupling_beam', { ln_mm: 1500, h_mm: 900, b_mm: 400, fck: 27, Vu_kN: 400, diagonal: { Avd_mm2: 2027, fy: 400, zDiag_mm: 600, nBars: 4 } }, 'KDS');
  const sinHand = 0.4 / Math.hypot(1, 0.4);
  assert.ok(Math.abs(r2.checks.diagonal.Vn_kN - (2 * 2027 * 400 * sinHand) / 1000) < 1);
});

test('mass_haul: symmetric cut-fill closes to zero with mid balance', () => {
  const r = runCalculator('mass_haul', { stations: [{ sta_m: 50, cut_m3: 100, fill_m3: 0 }, { sta_m: 100, cut_m3: 100, fill_m3: 0 }, { sta_m: 150, cut_m3: 0, fill_m3: 100 }, { sta_m: 200, cut_m3: 0, fill_m3: 100 }] }, 'KDS');
  assert.ok(r.checks.summary.surplus_m3 === 0 && Math.abs(r.checks.haul.avgHaul_m - 100) < 0.5);
});

// ── W1 폐형 엔진 라운드 ──────────────────────────────────────────────────────
test('W1 closed-form batch: bolt group, shaft, spring, bearing, stack, reverb, joint', () => {
  const bg = runCalculator('bolt_group', { bolts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }, { x: 200, y: 200 }], boltDia_mm: 20, Fnv_MPa: 400, Mz_kNm: 10 }, 'KDS');
  assert.ok(Math.abs(bg.checks.maxBolt.F_kN - 10e3 / (4 * Math.hypot(100, 100))) < 0.05);
  const sh = runCalculator('shaft_design', { M_Nm: 0, T_Nm: 500, d_mm: 40, tauAllow_MPa: 55, Kt: 1.0 }, 'KDS');
  assert.ok(Math.abs(sh.checks.static.tau_MPa - (16 * 5e5) / (Math.PI * 40 ** 3)) < 0.1);
  const sp = runCalculator('spring_design', { d_mm: 5, D_mm: 40, Na: 10, G_MPa: 79000, F_N: 100, tauAllow_MPa: 400 }, 'KDS');
  assert.ok(Math.abs(sp.intermediate.k_Nmm - (79000 * 625) / (8 * 64000 * 10)) < 0.05);
  const bl = runCalculator('bearing_life', { C_kN: 30, type: 'ball', Fr_kN: 30, n_rpm: 1000 }, 'KDS');
  assert.ok(Math.abs(bl.checks.life.L10_Mrev - 1) < 0.001);
  const ts = runCalculator('tolerance_stack', { chain: [{ nominal_mm: 10, tol_mm: 0.1, dir: 1 }, { nominal_mm: 10, tol_mm: 0.1, dir: 1 }, { nominal_mm: 10, tol_mm: 0.1, dir: 1 }, { nominal_mm: 30, tol_mm: 0.1, dir: -1 }] }, 'KDS');
  assert.ok(Math.abs(ts.checks.result.rss_pm - 0.2) < 0.001);
  const rv = runCalculator('reverb_time', { volume_m3: 1000, surfaces: [{ area_m2: 600, alpha: 0.05 }] }, 'KDS');
  assert.ok(Math.abs(rv.checks.reverb.sabine_s - (0.161 * 1000) / 30) < 0.01);
  const ej = runCalculator('expansion_joint', { L_m: 100, dTplus_C: 25, dTminus_C: 30, marginFactor: 1.0 }, 'KDS');
  assert.ok(Math.abs(ej.checks.movement.total_mm - 55) < 0.1);
});

test('W1: point illuminance inverse-square, pump water power, consolidation ext, pile group eta', () => {
  const pi = runCalculator('point_illuminance', { fixtures: [{ x_m: 0, y_m: 0, z_m: 2.85, I_cd: 1000 }], planeZ_m: 0.85, points: [{ x_m: 0, y_m: 0 }], maintenance: 1.0 }, 'KDS');
  assert.ok(Math.abs(pi.points[0].E_lux - 250) < 1);
  const ph = runCalculator('pump_head', { Q_Lmin: 600, staticHead_m: 10, pipeDia_mm: 200, pipeLen_m: 0.001 }, 'KDS');
  assert.ok(Math.abs(ph.checks.power.waterPower_kW - 0.981) < 0.002);
  const co = runCalculator('consolidation', { H_m: 6, e0: 1.1, Cc: 0.36, sigma0_kPa: 80, dSigma_kPa: 60, immediate: { q_kPa: 100, B_m: 2, Es_kPa: 10000 }, secondary: { Calpha: 0.01, t1_yr: 2, t2_yr: 20 } }, 'KDS');
  assert.ok(Math.abs(co.checks.settlement.immediate.Se_mm - 18.2) < 0.1 && Math.abs(co.checks.settlement.secondary.Ss_mm - 28.6) < 0.1);
  const pc = runCalculator('pile_capacity', { dia_m: 0.5, length_m: 15, layers: [{ thick_m: 15, type: 'clay', Su_kPa: 50, alpha: 0.9 }], tip: { type: 'clay', Su_kPa: 50 }, group: { rows: 3, cols: 3, spacing_m: 1.5 } }, 'KDS');
  assert.ok(Math.abs(pc.breakdown.group.eta - 0.727) < 0.002);
});

// ── W2 크롤본 엔진 라운드 ────────────────────────────────────────────────────
test('steel: Lb=0 phiMn=0.9FyZx, column boundary continuity 0.390Fy', () => {
  const b = runCalculator('steel_beam', { Zx_mm3: 1286e3, Sx_mm3: 1170e3, ry_mm: 45.4, Fy_MPa: 275, Lb_mm: 0, Mu_kNm: 250 }, 'KDS');
  assert.ok(Math.abs(b.checks.flexure.phiMn_kNm - (0.9 * 275 * 1286e3) / 1e6) < 0.2);
  const bound = 4.71 * Math.sqrt(205000 / 275);
  const cA = runCalculator('steel_column', { Ag_mm2: 10000, r_mm: 100, K: 1, L_mm: bound * 100 - 1, Fy_MPa: 275, Pu_kN: 500 }, 'KDS');
  const cB = runCalculator('steel_column', { Ag_mm2: 10000, r_mm: 100, K: 1, L_mm: bound * 100 + 1, Fy_MPa: 275, Pu_kN: 500 }, 'KDS');
  assert.ok(Math.abs(cA.checks.compression.Fcr_MPa - cB.checks.compression.Fcr_MPa) < 0.2 && Math.abs(cA.checks.compression.Fcr_MPa - 0.39 * 275) < 0.5);
});

test('earth_retention: Peck sand 0.65gHKa, strut sum equals total, heaving hand-check', () => {
  const r = runCalculator('earth_retention', { H_m: 10, soil: 'sand', gamma: 18, phi: 30, struts: [2, 5, 8], spacing_m: 2.5, D_m: 4, hw_m: 3 }, 'KDS');
  assert.ok(Math.abs(r.checks.pressure.pMax_kPa - 39) < 0.1);
  const sumR = r.checks.struts.levels.reduce((s, x) => s + x.R_kNm, 0);
  assert.ok(Math.abs(sumR - 390) < 1);
  const h = runCalculator('earth_retention', { H_m: 8, soil: 'softClay', gamma: 17, su_kPa: 30, B_m: 10 }, 'KDS');
  assert.ok(Math.abs(h.checks.heaving.FS - (5.7 * 30) / (17 * 8 - (30 * 8) / 7)) < 0.01);
});

test('pavement_walk: joint gates from KDS 34 60 10 (9m/3m)', () => {
  const r = runCalculator('pavement_walk', { type: 'concrete_linear', length_m: 60, width_m: 2, conJoint_m: 4 }, 'KDS');
  assert.equal(r.verdict, 'FAIL');
  const r2 = runCalculator('pavement_walk', { type: 'concrete_linear', length_m: 60, width_m: 2, expJoint_m: 9, conJoint_m: 3 }, 'KDS');
  assert.equal(r2.verdict, 'PASS');
});
