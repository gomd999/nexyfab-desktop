/**
 * golden.mjs — 계산기 골든벤치(손계산 앵커 N-version 검증).
 *
 * 각 계산기의 결정론 코어를 **독립 손계산**과 대조한다(코드 구현버그 차단). 이는 "공표
 * 예제 재현"과는 다르다 — 표준 해석의 타당성이 아니라 수식 구현의 정확성을 본다. 앵커가
 * 통과한 계산기는 status에서 "공개예제 미충족(draft)"을 "손계산 앵커 검증"으로 승격하되,
 * **"비법정 참고(기술사 날인 영역)"는 유지**한다(설계보조 도구이지 날인 계산서가 아님).
 *
 * 실행: node scripts/engineering-core/golden.mjs
 */
import { runCalculator } from './registry.mjs';

const approx = (a, b, tol = 0.01) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const results = [];
function anchor(calcId, name, input, checkFn) {
  try {
    const r = runCalculator(calcId, input, 'KDS');
    const { pass, detail } = checkFn(r);
    results.push({ calcId, name, pass, detail });
  } catch (e) {
    results.push({ calcId, name, pass: false, detail: 'threw: ' + e.message });
  }
}

// 1) 단순보 — 정역학 M=wL²/8+PL/4, V=wL/2+P/2 (표준상수 무관)
{
  const L = 4000, w = 8, P = 10;
  const M = (w * (L / 1000) ** 2) / 8 + (P * (L / 1000)) / 4; // 26
  const V = (w * (L / 1000)) / 2 + P / 2; // 21
  anchor('simple_beam', 'M=wL²/8+PL/4, V=wL/2+P/2', { L, w, P, Fy: 235, Sx: 5e5, Aw: 3000, Ix: 1e8 }, (r) => ({
    pass: approx(r.intermediate.Mmax_kNm, M) && approx(r.intermediate.Vmax_kN, V),
    detail: `M ${r.intermediate.Mmax_kNm.toFixed(2)}=${M} · V ${r.intermediate.Vmax_kN.toFixed(2)}=${V}`,
  }));
}

// 2) 압축재 좌굴 — KL/r, Fe=π²E/(KL/r)² (E=210000 MPa)
{
  const E = 210000, L = 3000, r = 30, K = 1;
  const slend = (K * L) / r; // 100
  const Fe = (Math.PI ** 2 * E) / slend ** 2; // 207.3
  anchor('column_buckling', 'KL/r=100, Fe=π²E/(KL/r)²', { Fy: 235, Ag: 2000, L, r, K, Pu: 100 }, (r2) => ({
    pass: approx(r2.intermediate.slenderness_KLr, slend) && approx(r2.intermediate.Fe_MPa, Fe),
    detail: `KL/r ${r2.intermediate.slenderness_KLr.toFixed(1)}=${slend} · Fe ${r2.intermediate.Fe_MPa.toFixed(1)}=${Fe.toFixed(1)}`,
  }));
}

// 3) 조경 배수 — 합리식 Q=C·i·A/360
{
  const C = 0.6, i = 120, A = 2;
  const Q = (C * i * A) / 360; // 0.4
  anchor('landscape_drainage', 'Q=C·i·A/360', { areaHa: A, C, i_mmhr: i }, (r) => ({
    pass: approx(r.intermediate.Q_design_m3s, Q),
    detail: `Q ${r.intermediate.Q_design_m3s.toFixed(4)}=${Q}`,
  }));
}

// 4) 옹벽 — 방향성 검증(안정 케이스=PASS, 극단 불안정=FAIL). Ka=tan²(45−φ/2) 내부.
{
  const stable = { H: 3, stemThickness: 0.4, baseWidth: 3.5, baseThickness: 0.5, toeLength: 1.0, gammaBackfill: 18, phiBackfill: 32, baseFriction: 0.55, allowableBearing: 300 };
  anchor('retaining_wall_stability', '방향성: 넉넉한 단면=PASS', stable, (r) => ({
    pass: r.verdict === 'PASS', detail: `verdict ${r.verdict} (넉넉한 저판)`,
  }));
  const slim = { H: 5, stemThickness: 0.2, baseWidth: 1.5, baseThickness: 0.3, toeLength: 0.2, gammaBackfill: 20, phiBackfill: 28, baseFriction: 0.4, allowableBearing: 150 };
  anchor('retaining_wall_stability', '방향성: 빈약한 단면=FAIL', slim, (r) => ({
    pass: r.verdict === 'FAIL', detail: `verdict ${r.verdict} (빈약한 저판)`,
  }));
}

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.calcId.padEnd(24)} ${r.name} — ${r.detail}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\ngolden bench: ${passed}/${results.length}`);

// 앵커 전부 통과한 계산기 목록(status 승격 대상).
const byCalc = {};
for (const r of results) { byCalc[r.calcId] = (byCalc[r.calcId] ?? true) && r.pass; }
export const ANCHORED = Object.entries(byCalc).filter(([, ok]) => ok).map(([id]) => id);
if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('golden.mjs')) {
  console.log('anchored (승격 대상):', ANCHORED.join(', '));
  if (passed < results.length) process.exit(1);
}
