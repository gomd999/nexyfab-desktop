// 결정론 어셈블리 빌드 테스트 (Gemini 불필요). node --test assembly.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssembly } from './assembly.mjs';

// 베이스 판 위에 L브래킷을 얹은 2부품 어셈블리
const baseAndBracket = {
  name: 'base+bracket',
  parts: [
    { id: 'base', type: 'plate_with_holes', params: { width: 200, depth: 200, thickness: 10, holes: [{ x: 20, y: 20, d: 8 }] }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'bracket', type: 'l_bracket', params: { legA: 80, legB: 60, width: 40, thickness: 6 }, at: { tx: 60, ty: 80, tz: 10 } }, // 판 위(z=10)에 배치
  ],
};

test('정상 2부품 어셈블리: 게이트 통과 + SCAD 생성 + 간섭 없음', () => {
  const r = buildAssembly(baseAndBracket);
  assert.equal(r.ok, true);
  assert.equal(r.gateErrors.length, 0);
  assert.ok(r.openscad.includes('union()'));
  assert.ok(r.openscad.includes('translate([60, 80, 10])'));
  assert.equal(r.interferences.length, 0); // 브래킷이 판 위(z=10~)라 겹침 없음
});

test('간섭 검출: 두 부품을 같은 위치에 겹치면 경고', () => {
  const clash = {
    name: 'clash',
    parts: [
      { id: 'p1', type: 'plate_with_holes', params: { width: 100, depth: 100, thickness: 20, holes: [] }, at: {} },
      { id: 'p2', type: 'plate_with_holes', params: { width: 100, depth: 100, thickness: 20, holes: [] }, at: { tz: 5 } }, // 15mm 겹침
    ],
  };
  const r = buildAssembly(clash);
  assert.equal(r.ok, true);
  assert.equal(r.interferences.length, 1);
  assert.equal(r.interferences[0].a, 'p1');
  assert.ok(r.interferences[0].overlapMm3 > 0);
});

test('부품 게이트 실패는 어셈블리 실패로 전파', () => {
  const bad = {
    name: 'bad',
    parts: [
      { id: 'ok', type: 'plate_with_holes', params: { width: 100, depth: 100, thickness: 10, holes: [] }, at: {} },
      { id: 'bad', type: 'plate_with_holes', params: { width: 100, depth: 100, thickness: 10, holes: [{ x: 500, y: 500, d: 40 }] }, at: {} },
    ],
  };
  const r = buildAssembly(bad);
  assert.equal(r.ok, false);
  assert.ok(r.gateErrors.some((e) => e.includes('bad')));
});

test('빈 어셈블리 거부', () => {
  assert.equal(buildAssembly({ name: 'x', parts: [] }).ok, false);
});

test('회전 배치: 90° 회전 시 AABB가 치수를 정확히 스왑', () => {
  // 100(x)×40(y)×10(z) 판을 z축 90° 회전 → x↔y 스왑 → 40×100×10
  const asm = {
    name: 'rot', parts: [
      { id: 'p', type: 'plate_with_holes', params: { width: 100, depth: 40, thickness: 10, holes: [] }, at: { rz: 90 } },
    ],
  };
  const r = buildAssembly(asm);
  assert.equal(r.ok, true);
  const bb = r.parts[0].aabb;
  const dx = bb.max[0] - bb.min[0], dy = bb.max[1] - bb.min[1];
  assert.ok(Math.abs(dx - 40) < 1e-6, `dx=${dx} expected 40`);
  assert.ok(Math.abs(dy - 100) < 1e-6, `dy=${dy} expected 100`);
});

test('회전 간섭: 옆으로 세운 판이 이웃과 겹치면 검출', () => {
  const asm = {
    name: 'rotclash', parts: [
      { id: 'a', type: 'plate_with_holes', params: { width: 100, depth: 100, thickness: 10, holes: [] }, at: {} },
      // y축 90° 회전 → 두께10이 x로, 높이100이 z로 서서 a와 겹침
      { id: 'b', type: 'plate_with_holes', params: { width: 100, depth: 100, thickness: 10, holes: [] }, at: { ry: 90, tx: 5, tz: 50 } },
    ],
  };
  const r = buildAssembly(asm);
  assert.equal(r.interferences.length, 1);
  assert.ok(r.interferences[0].note.includes('회전'));
});

// ── #3 어휘확장 (spur_gear · hex_bolt · sheet_profile) ──────────────────────
test('신규 어휘 3종: 게이트 통과 + SCAD + composeIntent 매핑', () => {
  const asm = {
    name: 'vocab14',
    parts: [
      { id: 'gear', type: 'spur_gear', params: { module: 2, teeth: 24, thickness: 10, boreDia: 12 }, at: {} },
      { id: 'bolt', type: 'hex_bolt', params: { threadDia: 12, length: 40 }, at: { tx: 100 } },
      { id: 'hat', type: 'sheet_profile', params: { thickness: 2, width: 100, segments: [20, 40, 60, 40, 20], angles: [90, -90, -90, 90] }, at: { tx: -200 } },
    ],
  };
  const r = buildAssembly(asm);
  assert.equal(r.ok, true);
  assert.equal(r.gateErrors.length, 0);
  assert.equal(r.interferences.length, 0);
  assert.ok(r.openscad.includes('linear_extrude')); // 기어/판금 폴리곤 압출
  // composeIntent: 기어(압출+보어) 2 + 볼트(자루+머리) 2 + 판금 1 = 5 피처
  assert.equal(r.composeIntent.features.length, 5);
  assert.equal(r.composeIntent.features.filter((f) => f.kind === 'extrude').length, 3);
});

test('신규 어휘 게이트: 불량 파라미터는 어셈블리 실패', () => {
  const bad = {
    name: 'badvocab',
    parts: [
      { id: 'g', type: 'spur_gear', params: { module: 2, teeth: 24, thickness: 10, boreDia: 80 }, at: {} }, // 보어가 림 침범
      { id: 'b', type: 'hex_bolt', params: { threadDia: 14, length: 40 }, at: {} }, // 비표준 호칭
    ],
  };
  const r = buildAssembly(bad);
  assert.equal(r.ok, false);
  assert.ok(r.gateErrors.some((e) => e.includes('림')));
  assert.ok(r.gateErrors.some((e) => e.includes('비표준')));
});
