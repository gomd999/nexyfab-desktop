// 결정론 조립 구속 리졸버 테스트. 실행: node --test assembly-constraints.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConstraints } from './assembly-constraints.mjs';

const box = (id, w, d, h, extra = {}) => ({ id, type: 'box', params: { width: w, depth: d, height: h }, ...extra });
// resolved 부품의 at 조회
const at = (asm, id) => asm.parts.find((p) => p.id === id).at;

test('offset: 대상 원점 + (dx,dy,dz) 절대 배치', () => {
  const asm = {
    parts: [
      box('base', 10, 10, 10, { at: { tx: 10, ty: 20, tz: 30 } }),
      box('child', 5, 5, 5, { constraints: [{ type: 'offset', to: 'base', dx: 5, dy: 6, dz: 7 }] }),
    ],
  };
  const r = resolveConstraints(asm);
  assert.deepEqual(at(r, 'child'), { tx: 15, ty: 26, tz: 37 });
});

test('concentric: 지정 축에서 AABB 중심 정렬(offset 반영)', () => {
  // base 100x100x20 @원점 -> x중심=50. child 20x20x20 -> 로컬 x중심=10.
  const asm = {
    parts: [
      box('base', 100, 100, 20, { at: { tx: 0, ty: 0, tz: 0 } }),
      box('child', 20, 20, 20, { constraints: [{ type: 'concentric', to: 'base', axis: 'x' }] }),
    ],
  };
  const r = resolveConstraints(asm);
  // tx = 50 - 10 = 40 -> child 월드 x중심 = 40+10 = 50 = base 중심
  assert.equal(at(r, 'child').tx, 40);
  // 지정 안 한 축은 미설정(undefined 유지)
  assert.equal(at(r, 'child').ty, undefined);

  // offset 적용 버전
  const r2 = resolveConstraints({
    parts: [
      box('base', 100, 100, 20),
      box('child', 20, 20, 20, { constraints: [{ type: 'concentric', to: 'base', axis: 'x', offset: 5 }] }),
    ],
  });
  assert.equal(at(r2, 'child').tx, 45); // 50 + 5 - 10
});

test('onFace top: 이 부품 바닥이 대상 상단 + gap 에 앉음', () => {
  // base 100x100x20 @원점 -> top(max z)=20. child 10x10x5 -> 로컬 min z=0.
  const asm = {
    parts: [
      box('base', 100, 100, 20),
      box('child', 10, 10, 5, { constraints: [{ type: 'onFace', to: 'base', face: 'top', gap: 2 }] }),
    ],
  };
  const r = resolveConstraints(asm);
  assert.equal(at(r, 'child').tz, 22); // 20 + 2 - 0
});

test('onFace right/bottom: x·z 반대면 접촉', () => {
  const r = resolveConstraints({
    parts: [
      box('base', 100, 100, 20, { at: { tx: 5, ty: 0, tz: 0 } }), // 월드 x: 5..105
      box('c1', 10, 10, 10, { constraints: [{ type: 'onFace', to: 'base', face: 'right' }] }),
      box('c2', 10, 10, 10, { constraints: [{ type: 'onFace', to: 'base', face: 'bottom', gap: 1 }] }),
    ],
  });
  // right: 이 부품 min x 가 대상 max x(105)에 접촉 -> tx = 105 - 0 = 105
  assert.equal(at(r, 'c1').tx, 105);
  // bottom: 이 부품 max z 가 대상 min z(0) - gap 에 접촉 -> tz = 0 - 1 - 10 = -11
  assert.equal(at(r, 'c2').tz, -11);
});

test('mirror: 대상 배치를 월드 평면(yz) 대칭', () => {
  // target box 10x10x10 @tx30 -> 월드 중심 [35,5,5]. child 동일 형상.
  const asm = {
    parts: [
      box('t', 10, 10, 10, { at: { tx: 30, ty: 0, tz: 0 } }),
      box('m', 10, 10, 10, { constraints: [{ type: 'mirror', to: 't', plane: 'yz' }] }),
    ],
  };
  const r = resolveConstraints(asm);
  // yz 평면(x=0) 대칭: mirrored 중심 = [-35,5,5]. child 로컬 중심 [5,5,5].
  // tx = -35 - 5 = -40, ty = 5 - 5 = 0, tz = 0
  assert.deepEqual(at(r, 'm'), { tx: -40, ty: 0, tz: 0 });
  // 검증: child 월드 중심 = [-40+5, 5, 5] = [-35,5,5] (t 의 x-반전)
});

test('centerline: 월드 축(z)에 중심 정렬 — 수직 두 축만 0', () => {
  // child 10x20x30 @tz100. 로컬 중심 [5,10,15].
  const asm = {
    parts: [
      box('c', 10, 20, 30, { at: { tz: 100 }, constraints: [{ type: 'centerline', axis: 'z' }] }),
    ],
  };
  const r = resolveConstraints(asm);
  assert.equal(at(r, 'c').tx, -5);  // 0 - 5
  assert.equal(at(r, 'c').ty, -10); // 0 - 10
  assert.equal(at(r, 'c').tz, 100); // 축 방향은 보존
});

test('위상정렬: 참조 역순 정의도 의존 먼저 해석(offset 체인)', () => {
  // 배열 순서 C,B,A 지만 A<-B<-C 의존.
  const asm = {
    parts: [
      box('C', 5, 5, 5, { constraints: [{ type: 'offset', to: 'B', dx: 10, dy: 0, dz: 0 }] }),
      box('B', 5, 5, 5, { constraints: [{ type: 'offset', to: 'A', dx: 10, dy: 0, dz: 0 }] }),
      box('A', 5, 5, 5, { at: { tx: 0, ty: 0, tz: 0 } }),
    ],
  };
  const r = resolveConstraints(asm);
  assert.equal(at(r, 'B').tx, 10);
  assert.equal(at(r, 'C').tx, 20);
});

test('회전 부품: 구속은 회전 반영 AABB 를 쓰고 회전은 보존', () => {
  // child 10x20x30 를 ry:90 회전. placedAabb 규약 ry90: (x,y,z)->(z,y,-x).
  // 로컬 aabb [0,0,0]~[10,20,30] 회전 후 월드 x = z범위 [0,30], 중심 x=15.
  const r = resolveConstraints({
    parts: [
      box('base', 100, 100, 20),
      box('child', 10, 20, 30, { at: { ry: 90 }, constraints: [{ type: 'concentric', to: 'base', axis: 'x' }] }),
    ],
  });
  const a = at(r, 'child');
  assert.equal(a.ry, 90); // 회전 보존
  // base x중심=50, child 회전 후 x중심=15 -> tx = 50 - 15 = 35
  assert.equal(a.tx, 35);
});

test('구속 없는 부품은 기존 at 유지', () => {
  const orig = { tx: 7, ty: 8, tz: 9, rz: 45 };
  const r = resolveConstraints({ parts: [box('solo', 5, 5, 5, { at: orig })] });
  assert.deepEqual(at(r, 'solo'), orig);
});

test('throw: 순환 구속', () => {
  const asm = {
    parts: [
      box('A', 5, 5, 5, { constraints: [{ type: 'offset', to: 'B', dx: 1, dy: 0, dz: 0 }] }),
      box('B', 5, 5, 5, { constraints: [{ type: 'offset', to: 'A', dx: 1, dy: 0, dz: 0 }] }),
    ],
  };
  assert.throws(() => resolveConstraints(asm), /순환 구속/);
});

test('throw: 알 수 없는 to id', () => {
  const asm = { parts: [box('A', 5, 5, 5, { constraints: [{ type: 'offset', to: 'ghost', dx: 1, dy: 0, dz: 0 }] })] };
  assert.throws(() => resolveConstraints(asm), /알 수 없는 to id/);
});

test('throw: 알 수 없는 구속 타입', () => {
  const asm = { parts: [box('A', 5, 5, 5, { constraints: [{ type: 'weld', to: 'A' }] })] };
  assert.throws(() => resolveConstraints(asm), /알 수 없는 구속 타입/);
});

test('throw: 알 수 없는 face / axis', () => {
  assert.throws(() => resolveConstraints({
    parts: [box('b', 5, 5, 5), box('a', 5, 5, 5, { constraints: [{ type: 'onFace', to: 'b', face: 'sideways' }] })],
  }), /알 수 없는 face/);
  assert.throws(() => resolveConstraints({
    parts: [box('a', 5, 5, 5, { constraints: [{ type: 'centerline', axis: 'w' }] })],
  }), /알 수 없는 axis/);
});

test('throw: 자기참조 구속', () => {
  assert.throws(() => resolveConstraints({
    parts: [box('A', 5, 5, 5, { constraints: [{ type: 'concentric', to: 'A', axis: 'x' }] })],
  }), /자기참조/);
});
