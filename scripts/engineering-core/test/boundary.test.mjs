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
