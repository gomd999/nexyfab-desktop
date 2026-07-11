// 결정론 편집 적용부 테스트 (Gemini 불필요). node --test edit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from './edit.mjs';

const plate = { type: 'plate_with_holes', width: 180, depth: 90, thickness: 8, holes: [{ x: 12, y: 12, d: 8 }, { x: 168, y: 78, d: 8 }], confidence: 1 };

test('setParams: 알려진 필드만 갱신', () => {
  const { extraction, changes } = applyPatch(plate, { setParams: { thickness: 12, width: 200 } });
  assert.equal(extraction.thickness, 12);
  assert.equal(extraction.width, 200);
  assert.equal(extraction.depth, 90); // 미언급 불변
  assert.ok(changes.length === 2);
});

test('미지 필드·비정상 값은 무시 (AI 헛것 방어)', () => {
  const { extraction } = applyPatch(plate, { setParams: { bogusField: 5, thickness: -3, width: 0 } });
  assert.equal(extraction.thickness, 8);   // 음수 거부
  assert.equal(extraction.width, 180);     // 0 거부
  assert.equal('bogusField' in extraction, false);
});

test('holes.add / removeNearest / setDiameterAll', () => {
  let r = applyPatch(plate, { holes: { setDiameterAll: 10 } });
  assert.deepEqual(r.extraction.holes.map(h => h.d), [10, 10]);

  r = applyPatch(plate, { holes: { add: [{ x: 90, y: 45, d: 6 }] } });
  assert.equal(r.extraction.holes.length, 3);

  r = applyPatch(plate, { holes: { removeNearest: [{ x: 13, y: 13 }] } });
  assert.equal(r.extraction.holes.length, 1);
  assert.deepEqual(r.extraction.holes[0], { x: 168, y: 78, d: 8 }); // 가까운 (12,12) 삭제됨
});

test('원본 불변성 (순수 함수)', () => {
  applyPatch(plate, { setParams: { thickness: 99 }, holes: { add: [{ x: 1, y: 1, d: 1 }] } });
  assert.equal(plate.thickness, 8);
  assert.equal(plate.holes.length, 2);
});

test('boltCount는 정수로 반올림', () => {
  const flange = { type: 'flange', outerDia: 150, boreDia: 50, thickness: 12, bcd: 100, boltHoleD: 10, boltCount: 6, confidence: 1 };
  const { extraction } = applyPatch(flange, { setParams: { boltCount: 8.4 } });
  assert.equal(extraction.boltCount, 8);
});
