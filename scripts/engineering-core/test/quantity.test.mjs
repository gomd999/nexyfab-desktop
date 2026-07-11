/**
 * 수량산출 룰엔진 골든벤치 — 손계산 대조 (전부 폐형식 기하 산식이라 정확 일치 요구).
 * 실행: node --test test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeoff } from '../quantity/takeoff.mjs';

const get = (r, elIdx, name) => r.elements[elIdx].items.find((i) => i.item === name);
const close = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol + Math.abs(expected) * 1e-9, `expected ${expected}, got ${actual}`);

// ── 옹벽: H=4, t=0.35, B=3.2, tb=0.4, L=10 / ws=0.6, s=0.3, 버림 0.1(여유 0.1) ──
// 손계산: D=0.5 / 터파기 (4.4+0.15)×0.5×10=22.75 / 버림 3.4×0.1×10=3.4
//         구체 0.35×3.6×10 + 3.2×0.4×10 = 12.6+12.8 = 25.4 / 거푸집 2×3.6×10+2×0.4×10 = 80
//         매입 = 3.4+12.8+0(벽체매입 0) = 16.2 → 되메우기 22.75−16.2 = 6.55, 잔토 16.2
test('quantity: retaining wall H=4 — all items match hand calc exactly', () => {
  const r = takeoff([{
    type: 'retaining_wall', H: 4, stemThickness: 0.35, baseWidth: 3.2, baseThickness: 0.4,
    length: 10, workingSpace: 0.6, excavSlope: 0.3, leanThickness: 0.1, leanMargin: 0.1,
  }]);
  close(get(r, 0, '터파기').qty, 22.75);
  close(get(r, 0, '버림콘크리트').qty, 3.4);
  close(get(r, 0, '구체 콘크리트').qty, 25.4);
  close(get(r, 0, '거푸집').qty, 80);
  close(get(r, 0, '되메우기').qty, 6.55);
  close(get(r, 0, '잔토처리').qty, 16.2);
  // 산출근거 산식은 전 항목 필수 (투명 감사)
  for (const it of r.elements[0].items) assert.ok(it.basis.length > 5, `basis missing for ${it.item}`);
  assert.match(r.disclaimer, /표준품셈.*미적용/);
});

// ── 옹벽: 근입 굴착 명시 (excavDepth=1.0) — 벽체 매입부 공제 검증 ──
// D=1.0: 터파기 (4.4+0.3)×1.0×10=47 / 벽체매입 t×(D−tb−tl)×L = 0.35×0.5×10=1.75
// 매입 = 3.4+12.8+1.75 = 17.95 → 되메우기 29.05, 잔토 17.95
test('quantity: retaining wall with explicit embedment depth', () => {
  const r = takeoff([{
    type: 'retaining_wall', H: 4, stemThickness: 0.35, baseWidth: 3.2, baseThickness: 0.4,
    length: 10, workingSpace: 0.6, excavSlope: 0.3, leanThickness: 0.1, leanMargin: 0.1, excavDepth: 1.0,
  }]);
  close(get(r, 0, '터파기').qty, 47);
  close(get(r, 0, '되메우기').qty, 29.05);
  close(get(r, 0, '잔토처리').qty, 17.95);
});

// ── 관로: D=1.5, w=0.8, s=0.3, L=100, 모래 0.1, 관 외경 0.5 ──
// 터파기 (0.8+0.45)×1.5×100=187.5 / 모래 0.8×0.1×100=8 / 관 π×0.25²×100=19.63495
// 되메우기 187.5−8−19.63495 = 159.865 (반올림 3자리)
test('quantity: pipe trench — trapezoid excavation + pipe deduction', () => {
  const r = takeoff([{
    type: 'trench', depth: 1.5, bottomWidth: 0.8, length: 100,
    excavSlope: 0.3, beddingThickness: 0.1, pipeOutsideDia: 0.5,
  }]);
  close(get(r, 0, '터파기').qty, 187.5);
  close(get(r, 0, '모래기초').qty, 8);
  close(get(r, 0, '되메우기').qty, 159.865, 0.001);
});

// ── 포장: A=250, 표층 0.05/기층 0.15/보조기층 0.2, 경계석 120m ──
test('quantity: pavement layers + curb', () => {
  const r = takeoff([{
    type: 'pavement', area: 250, curbLength: 120,
    layers: [
      { name: '표층(아스콘)', thickness: 0.05 },
      { name: '기층', thickness: 0.15 },
      { name: '보조기층', thickness: 0.2 },
    ],
  }]);
  close(get(r, 0, '포장 — 표층(아스콘)').qty, 12.5);
  close(get(r, 0, '포장 — 기층').qty, 37.5);
  close(get(r, 0, '포장 — 보조기층').qty, 50);
  close(get(r, 0, '경계블록 설치').qty, 120);
});

// ── 집계(BOQ): 옹벽 2개 구간 합산 ──
test('quantity: BOQ aggregates same items across elements', () => {
  const wall = {
    type: 'retaining_wall', H: 4, stemThickness: 0.35, baseWidth: 3.2, baseThickness: 0.4,
    length: 10, workingSpace: 0.6, excavSlope: 0.3, leanThickness: 0.1, leanMargin: 0.1,
  };
  const r = takeoff([{ ...wall, id: 'W1' }, { ...wall, id: 'W2', length: 5 }]);
  const conc = r.boq.find((b) => b.item === '구체 콘크리트');
  close(conc.qty, 25.4 + 12.7); // 12.6/2+12.8/2 = 12.7
});

// ── 게이트: 잘못된 입력 거부 ──
test('quantity: input gates — unknown type / non-positive / empty', () => {
  assert.throws(() => takeoff([]), /elements\[\] required/);
  assert.throws(() => takeoff([{ type: 'bridge_deck' }]), /unknown element type/);
  assert.throws(() => takeoff([{ type: 'trench', depth: -1, bottomWidth: 0.8, length: 10 }]), /positive/);
  assert.throws(() => takeoff([{ type: 'pavement', area: 100 }]), /layers/);
});
