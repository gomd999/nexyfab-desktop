/**
 * friction-clamp.test.mjs — **조절 기구가 자세를 유지하는가** (260803).
 *
 * `desk_stand` 를 만들고 §10.4 를 재 보니 이 제품의 **유일한 공학 문제**가 판정되지
 * 않았다: 「각도 0~45° 가 유지되는가」·「높이가 흘러내리지 않는가」.
 * 계산기 61종 중 이걸 하는 것이 없었다.
 *
 * ⚠ 이 회귀의 절반은 **「안 한다」를 지킨다.** μ·K 는 시험값이라 기본값을 넣으면
 *   결과가 시험 근거를 잃는다 — 미입력이면 **판정하지 않아야** 한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalculator } from '../registry.mjs';

const run = (input) => runCalculator('friction_clamp', input);

test('해석해 앵커 — 내경 0 원판의 유효반경은 (2/3)Ro', () => {
  const r = run({ mode: 'hinge', mu: 0.3, nSurfaces: 2, axialForceN: 1000, outerDia: 18, innerDia: 0, demandTorqueNm: 1 });
  assert.ok(Math.abs(r.intermediate['유효반경_mm'] - 6) < 1e-9, `r_eff=${r.intermediate['유효반경_mm']}`);
});

test('해석해 앵커 — 환형 (2/3)(Ro³−Ri³)/(Ro²−Ri²)', () => {
  const r = run({ mode: 'hinge', mu: 0.25, nSurfaces: 8, axialForceN: 2000, outerDia: 18, innerDia: 8, demandTorqueNm: 3 });
  const exact = (2 / 3) * ((9 ** 3 - 4 ** 3) / (9 ** 2 - 4 ** 2));
  assert.ok(Math.abs(r.intermediate['유효반경_mm'] - exact) < 1e-9);
  // T = n·μ·F·r_eff = 8·0.25·2000·6.8205 / 1000
  assert.ok(Math.abs(r.checks['유지토크']['유지_Nm'] - (8 * 0.25 * 2000 * exact) / 1000) < 1e-9);
});

test('토크→축력 환산은 F = T/(K·d)', () => {
  const r = run({ mode: 'clamp', mu: 0.2, nSurfaces: 2, tightenTorqueNm: 10, torqueCoefK: 0.2, boltDia: 6, demandForceN: 100 });
  assert.ok(Math.abs(r.intermediate['축력_N'] - (10 * 1000) / (0.2 * 6)) < 1e-9);
  assert.match(r.intermediate['축력근거'], /시험값/);
});

test('★축력을 정할 수 없으면 판정하지 않는다 — K 기본값을 끼워 넣지 않는다', () => {
  const r = run({ mode: 'hinge', mu: 0.3, nSurfaces: 2, outerDia: 18, innerDia: 8 });
  assert.equal(r.verdict, null);
  assert.ok(r.needInputs.some((x) => x.field === 'torqueCoefK'));
});

test('★소요를 안 주면 유지력만 내고 판정은 null — 통과했다고 말하지 않는다', () => {
  const r = run({ mode: 'hinge', mu: 0.3, nSurfaces: 2, axialForceN: 1000, outerDia: 18, innerDia: 8 });
  assert.equal(r.verdict, null);
  assert.ok(r.checks['유지토크']['유지_Nm'] > 0);
  assert.ok(r.needInputs.some((x) => x.field === 'demandTorqueNm'));
});

test('소요가 유지력을 넘으면 FAIL — 판정이 실제로 갈린다', () => {
  const base = { mode: 'hinge', mu: 0.1, nSurfaces: 2, axialForceN: 200, outerDia: 18, innerDia: 8 };
  assert.equal(run({ ...base, demandTorqueNm: 0.1 }).verdict, 'PASS');
  assert.equal(run({ ...base, demandTorqueNm: 100 }).verdict, 'FAIL');
});

test('기하 게이트 — 외경 ≤ 내경은 거부', () => {
  assert.throws(() => run({ mode: 'hinge', mu: 0.3, nSurfaces: 2, axialForceN: 1000, outerDia: 8, innerDia: 8, demandTorqueNm: 1 }), /geometry gate/);
});

test('★한계를 결과에 싣는다 — 크리프·풀림·마모 미반영을 숨기지 않는다', () => {
  const r = run({ mode: 'hinge', mu: 0.3, nSurfaces: 2, axialForceN: 1000, outerDia: 18, innerDia: 8, demandTorqueNm: 1 });
  const notes = r.notes.join(' ');
  assert.match(notes, /크리프|풀림|마모/);
  assert.match(notes, /시험값/);
});

test('clamp 모드 — 미끄럼 저항 V = n·μ·F', () => {
  const r = run({ mode: 'clamp', mu: 0.25, nSurfaces: 4, axialForceN: 1500, demandForceN: 1000 });
  assert.ok(Math.abs(r.checks['미끄럼저항']['저항_N'] - 4 * 0.25 * 1500) < 1e-9);
  assert.equal(r.verdict, 'PASS');
});
