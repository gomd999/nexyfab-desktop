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
