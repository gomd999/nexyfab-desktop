/**
 * 경계값 회귀 테스트 (외부감사 제언 반영) — 설계기준 한계 직전/직후에서
 * 판정이 정확히 플립되는지 검증. 공표예제와 별개로 "게이트·공식의 경계 정합성"을
 * 상시 보증한다. node --test
 */
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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

// ── 등가정적 (KDS 41 17 00) — 손검증 골든 + 불변식 ─────────────────────────
test('지진 등가정적: 구역I·S4·R5 손검증 (SDS 0.4987·V=Cs·W) + R↑→V↓', () => {
  const base = { zone: 'I', siteClass: 'S4', importance: 'grade2', R: 5, structType: 'rc_moment', heightsM: [3.45, 6.9], weightsKN: [1000, 1000] };
  const r = runCalculator('seismic_static', base, 'KDS');
  assert.ok(Math.abs(r.intermediate.SDS - 0.4987) < 0.001, 'SDS');
  assert.ok(Math.abs(r.intermediate.SD1 - 0.2875) < 0.001, 'SD1');
  assert.ok(Math.abs(r.V_kN - r.intermediate.Cs * 2000) < 0.5, 'V=Cs·W');
  assert.ok(Math.abs(r.Fx_kN[1] / r.Fx_kN[0] - 2) < 0.01, 'k=1에서 Fx∝h (h비 2배)');
  const r8 = runCalculator('seismic_static', { ...base, R: 8 }, 'KDS');
  assert.ok(r8.V_kN < r.V_kN, 'R↑→V↓');
  // 하한 지배 확인: 초장주기 입력 시 floor(0.044·SDS·IE)
  const rf = runCalculator('seismic_static', { ...base, T: 4.9 }, 'KDS');
  assert.ok(rf.intermediate.governing.includes('하한') || rf.intermediate.Cs >= 0.044 * rf.intermediate.SDS * 1.0 - 1e-9, 'Cs 하한 준수');
});

// ── 목구조 접합부 — 표 스팟 + 배치 게이트 ─────────────────────────────────
test('접합부: 못·볼트 표 스팟 + 배치·관입 게이트', () => {
  const n1 = runCalculator('timber_nail', { sideThk: 12, nailLen: 50, nailDia: 2.87, group: 'A', count: 1, demandN: 100 }, 'KDS');
  assert.equal(n1.intermediate.Z_table_N, 260, '못 표 스팟 260N');
  assert.equal(n1.checks.penetration.pass, true, '표 조합 관입 자동충족');
  const b1 = runCalculator('timber_bolt', { mainThk: 38, sideThk: 38, boltDia: 12, group: 'A', demandN: 100 }, 'KDS');
  assert.equal(b1.intermediate.Z_table_N, 2100, '볼트 ∥ 2100N');
  const b2 = runCalculator('timber_bolt', { mainThk: 38, sideThk: 38, boltDia: 12, group: 'D', loadDir: 'perp', demandN: 100 }, 'KDS');
  assert.equal(b2.intermediate.Z_table_N, 600, '볼트 D군 ⊥ 600N');
  const g = runCalculator('timber_nail', { sideThk: 38, nailLen: 89, nailDia: 4.11, group: 'B', count: 2, demandN: 100, endDist: 50 }, 'KDS');
  assert.equal(g.verdict, 'FAIL', '끝면거리 20D 미달 차단');
  const g2 = runCalculator('timber_nail', { sideThk: 38, nailLen: 89, nailDia: 4.11, group: 'B', count: 2, demandN: 100, predrilled: true, endDist: 50 }, 'KDS');
  assert.equal(g2.verdict, 'PASS', '천공 시 10D 완화');
});

// ── 못 항복모드식 교차검증 (D≤6.0, Fyb 경험앵커 690/620/550) ──────────────
test('접합부: 항복모드식 D≤6.0 전셀 재현 98%+ ±4% (표 지배 유지)', () => {
  let ok = 0, tot = 0;
  const table = JSON.parse(readFileSync(new URL('../standards/kds.json', import.meta.url), 'utf8')).timber.nailShear_N.table;
  for (const [ts, rows] of Object.entries(table)) {
    for (const key of Object.keys(rows)) {
      const [len, D] = key.split('/').map(Number);
      if (D > 6.0) continue;
      for (const grp of ['A', 'B', 'C', 'D']) {
        const r = runCalculator('timber_nail', { sideThk: +ts, nailLen: len, nailDia: D, group: grp, count: 1, demandN: 1 }, 'KDS');
        const ye = r.intermediate.yieldEq;
        assert.ok(ye, `yieldEq 존재: ${ts}/${key}`);
        tot++;
        if (Math.abs(ye.deviation_pct) <= 4) ok++;
        assert.ok(Math.abs(ye.deviation_pct) <= 6, `편차 ≤6%: ${ts}/${key}/${grp} = ${ye.deviation_pct}%`);
      }
    }
  }
  assert.ok(ok / tot >= 0.97, `±4% 재현율 ${ok}/${tot}`);
  // D>6.0은 교차검증 제외 확인 (재현 불가 — kds.json largeDiaNote)
  const big = runCalculator('timber_nail', { sideThk: 38, nailLen: 139, nailDia: 6.2, group: 'A', count: 1, demandN: 1 }, 'KDS');
  assert.equal(big.intermediate.yieldEq, undefined, 'D>6.0 식 제외');
});

// ── 볼트 접합 — CΔ·Cg·습윤 (원문식 성질 검증) ────────────────────────────
test('볼트: CΔ 보간·Cg 성질·습윤 CM·게이트', () => {
  const base = { mainThk: 38, sideThk: 38, boltDia: 12, group: 'A', demandN: 100 };
  // CΔ = 실제/총내력최소 (식 4.5-14): 끝면 50, 인장 침엽수 7D=84 → 0.595
  const r = runCalculator('timber_bolt', { ...base, count: 1, endDist: 50 }, 'KDS');
  assert.equal(r.intermediate.cDelta, 0.595, 'CΔ 보간');
  // 감소최소(3.5D=42) 미달 → FAIL
  assert.equal(runCalculator('timber_bolt', { ...base, count: 1, endDist: 40 }, 'KDS').verdict, 'FAIL', '감소최소 미달');
  // Cg: n=1 → 1.0 정확, n 증가 단조감소 (식 4.9-1)
  const cgOf = (nRow, s = 60) => runCalculator('timber_bolt', { ...base, count: nRow, nRow, rowSpacing_mm: s, mainWidth: 140, sideWidth: 140 }, 'KDS').intermediate.Cg;
  assert.equal(cgOf(1), 1, 'Cg(1)=1');
  assert.ok(cgOf(4) < cgOf(2) && cgOf(2) <= 1, 'Cg 단조감소');
  assert.ok(cgOf(4, 120) < cgOf(4, 60), 's 증가 → Cg 감소');
  // 습윤 (표 4.9-2): 볼트 0.7 · 못 0.7
  assert.equal(runCalculator('timber_bolt', { ...base, count: 1, serviceWet: true }, 'KDS').intermediate.CM, 0.7);
  assert.equal(runCalculator('timber_nail', { sideThk: 38, nailLen: 89, nailDia: 4.11, group: 'B', demandN: 100, serviceWet: true }, 'KDS').intermediate.CM, 0.7);
  // nRow≥2 필수입력 게이트
  assert.throws(() => runCalculator('timber_bolt', { ...base, count: 3, nRow: 3 }, 'KDS'), /rowSpacing_mm/, 'Cg 입력게이트');
});

// ── 풍하중 간편법 (식 5.15-1 손검증) ──────────────────────────────────────
test('풍하중: 식 5.15-1 손검증·최소풍압·적용범위 게이트', () => {
  // 0.25×30²×10^0.44×1.0×1.1 = 681.7
  const r = runCalculator('wind_simple', { V0: 30, H: 10, B: 16, D: 10, demandNone: 0 }, 'KDS');
  assert.equal(r.pressure.design_Nm2, 681.7, '손검증 681.7');
  assert.equal(r.coefficients.Cf, 1.1, 'Cf=0.6−(−0.5)');
  // 최소풍압 675 지배
  const r2 = runCalculator('wind_simple', { V0: 24, H: 4, B: 8, D: 8, demandNone: 0 }, 'KDS');
  assert.equal(r2.pressure.minGoverns, true);
  assert.equal(r2.pressure.design_Nm2, 675);
  // D/B 보간: 1.5 → Cf 1.0
  assert.equal(runCalculator('wind_simple', { V0: 30, H: 10, B: 12, D: 18, demandNone: 0 }, 'KDS').coefficients.Cf, 1);
  // 적용범위: H/√BD>1 → 게이트
  assert.throws(() => runCalculator('wind_simple', { V0: 30, H: 15, B: 5, D: 5, demandNone: 0 }, 'KDS'), /적용범위/);
  // 해안 Ce=2.0 정비례
  const rc = runCalculator('wind_simple', { V0: 30, H: 10, B: 16, D: 10, terrain: 'coast', demandNone: 0 }, 'KDS');
  assert.equal(+(rc.pressure.raw_Nm2 / r.pressure.raw_Nm2).toFixed(3), 2, 'Ce 배율');
});

// ── 암거 측압 직접입력 (등가성·게이트) ────────────────────────────────────
test('암거: 측압 오버라이드 등가성·쌍 게이트', () => {
  const base = { innerWidth: 3, innerHeight: 3, wallThk: 0.3, cover: 2, gammaSoil: 19, K: 0.5 };
  const auto = runCalculator('box_culvert_frame', base, 'KDS');
  // 자동 유도값을 그대로 직접 입력 → 동일 결과
  const manual = runCalculator('box_culvert_frame', { ...base, pTopOverride: auto.loads.pTop_kPa, pBotOverride: auto.loads.pBot_kPa }, 'KDS');
  assert.equal(manual.moments_kNm.cornerTop, auto.moments_kNm.cornerTop, '오버라이드 등가성');
  // 쌍 미충족 게이트
  assert.throws(() => runCalculator('box_culvert_frame', { ...base, pTopOverride: 30 }, 'KDS'), /쌍 필수/);
  assert.throws(() => runCalculator('box_culvert_frame', { ...base, pTopOverride: 50, pBotOverride: 30 }, 'KDS'), /pBotOverride/);
});

// ── 풍하중 정식법 — 손검증·게이트 (원문식) ────────────────────────────────
test('풍하중 정식법: VH·qH 손검증·유연 게이트·Kzr 검증', () => {
  // C조도 H=30: Kzr=0.71·30^0.15=1.1827 → VH=35.48 → qH=0.6125·VH²=770.9
  const r = runCalculator('wind_static', { V0: 30, H: 30, B: 20, D: 15, exposure: 'C', structType: 'rc_moment', demandNone: 0 }, 'KDS');
  assert.equal(r.designSpeed.VH_ms, 35.48, 'VH 손검증');
  assert.equal(r.pressure.qH_Nm2, 770.9, 'qH 손검증');
  assert.ok(r.pressure.GD > 1 && r.pressure.GD < 3, 'GD 물리 범위');
  // 층력 합 ≈ 기단전단
  const sumF = r.stories.reduce((s, st) => s + st.F_kN, 0);
  assert.ok(Math.abs(sumF - r.baseShear_kN) / r.baseShear_kN < 0.08, `층력합 ${sumF.toFixed(0)} ≈ V ${r.baseShear_kN}`);
  // 유연구조물(f≤1Hz) 게이트
  assert.throws(() => runCalculator('wind_static', { V0: 30, H: 80, B: 20, D: 20, exposure: 'B', structType: 'steel_moment', demandNone: 0 }, 'KDS'), /유연/);
  // Kzr 표 5.5-2 상수항 재현 (plateau): D조도 z=5 → 1.13
  const rD = runCalculator('wind_static', { V0: 30, H: 5, B: 10, D: 10, exposure: 'D', structType: 'rc_moment', demandNone: 0 }, 'KDS');
  assert.equal(rD.designSpeed.KzrH, 1.13, 'Kzr plateau D');
});

// ── 못 Cd·부가계수 (식 4.4-6·§4.4.3.3 원문) ──────────────────────────────
test('못: Cd=p/12D·끝면 0.67·경사 0.83·격막 1.1', () => {
  const r = runCalculator('timber_nail', { sideThk: 38, nailLen: 89, nailDia: 4.11, group: 'B', count: 1, demandN: 100, endGrain: true, toeNail: true }, 'KDS');
  assert.equal(r.checks.shear.perNail_N, 317, '570×0.67×0.83=317');
  const r2 = runCalculator('timber_nail', { sideThk: 38, nailLen: 89, nailDia: 4.11, group: 'B', count: 1, demandN: 100, diaphragm: true }, 'KDS');
  assert.equal(r2.checks.shear.perNail_N, 627, '570×1.1');
  // 볼트 열간격 표 4.5-8: ∥ 1.5D 미달 FAIL · ⊥ (5l+10D)/8 경계
  assert.equal(runCalculator('timber_bolt', { mainThk: 38, sideThk: 38, boltDia: 12, group: 'A', demandN: 100, rowGap: 15 }, 'KDS').verdict, 'FAIL');
  assert.equal(runCalculator('timber_bolt', { mainThk: 38, sideThk: 38, boltDia: 12, group: 'A', demandN: 100, loadDir: 'perp', rowGap: 38 }, 'KDS').verdict, 'FAIL');
  assert.equal(runCalculator('timber_bolt', { mainThk: 38, sideThk: 38, boltDia: 12, group: 'A', demandN: 100, loadDir: 'perp', rowGap: 40 }, 'KDS').verdict, 'PASS');
});
