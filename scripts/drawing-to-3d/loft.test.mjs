// ⓒ 로프트 저작 기반 테스트(결정론 · Gemini 불필요).
//   실행: node --test scripts/drawing-to-3d/loft.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  circleProfile, superellipseProfile, polygonProfile, nacaProfile, roundedRectProfile,
  loftMesh, loftPart, loftAlongAxis, demoLoftAssembly,
} from './loft.mjs';

// ── 프로파일 점 개수 정확 ──
test('프로파일 점 개수: circle/superellipse/naca/roundedRect', () => {
  assert.equal(circleProfile(10, 32).length, 32);
  assert.equal(circleProfile(5, 7).length, 7);
  assert.equal(superellipseProfile(10, 6, 48, 2.5).length, 48);
  assert.equal(nacaProfile('4412', 40).length, 40);   // 짝수 n → 정확히 n
  assert.equal(nacaProfile('0012', 60).length, 60);
  assert.equal(roundedRectProfile(20, 12, 3, 50).length, 50);
  // 프로파일은 유한 2D 점
  for (const p of circleProfile(3, 12)) { assert.equal(p.length, 2); assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1])); }
});

test('circleProfile 점들이 반지름 위에 있음', () => {
  const r = 10;
  for (const [x, y] of circleProfile(r, 24)) assert.ok(Math.abs(Math.hypot(x, y) - r) < 1e-9);
});

// ── 원기둥 로프트: verts/faces 개수 + 체적 ≈ πr²h ──
test('원기둥(circle 2스테이션) loftMesh: 위상 + 체적 ≈ πr²h', () => {
  const r = 10, h = 50, n = 64;
  const ring0 = circleProfile(r, n).map(([x, y]) => [x, y, 0]);
  const ring1 = circleProfile(r, n).map(([x, y]) => [x, y, h]);
  const m = loftMesh([ring0, ring1], { caps: true });
  // verts = 2링*n + 캡 중심 2
  assert.equal(m.verts.length, 2 * n + 2);
  // faces = 측면 2n + 캡 2n
  assert.equal(m.faces.length, 2 * n + 2 * n);
  assert.equal(m.triCount, m.faces.length);
  const exact = Math.PI * r * r * h;
  const err = Math.abs(m.volumeMm3 - exact) / exact;
  assert.ok(err < 0.02, `원기둥 체적 오차 ${(err * 100).toFixed(2)}% (측정 ${m.volumeMm3}, 해석 ${exact.toFixed(1)})`);
  // AABB
  assert.ok(Math.abs(m.aabb.min[2] - 0) < 1e-6 && Math.abs(m.aabb.max[2] - h) < 1e-6);
  assert.ok(Math.abs(m.aabb.max[0] - r) < 0.05);
});

// ── 원뿔 로프트: 체적 ≈ π r² h / 3 ──
test('원뿔(circle→apex) loftMesh: 체적 ≈ πr²h/3', () => {
  const r = 12, h = 40, n = 96;
  const base = circleProfile(r, n).map(([x, y]) => [x, y, 0]);
  const apex = Array.from({ length: n }, () => [0, 0, h]); // 정점(점으로 수축한 링)
  const m = loftMesh([base, apex], { caps: true });
  const exact = (Math.PI * r * r * h) / 3;
  const err = Math.abs(m.volumeMm3 - exact) / exact;
  assert.ok(err < 0.02, `원뿔 체적 오차 ${(err * 100).toFixed(2)}% (측정 ${m.volumeMm3}, 해석 ${exact.toFixed(1)})`);
});

// ── 초타원/naca 로프트도 정상 빌드(체적>0) ──
test('superellipse 로프트 빌드 + 체적>0', () => {
  const n = 48;
  const rings = [0, 30, 60].map((z) => superellipseProfile(10, 6, n, 3).map(([x, y]) => [x, y, z]));
  const m = loftMesh(rings, { caps: true });
  assert.ok(m.volumeMm3 > 0);
  assert.equal(m.verts.length, 3 * n + 2);
});

// ── throw: 링 점 개수 불일치 ──
test('링 점 개수 불일치 → throw', () => {
  const ring0 = circleProfile(10, 32).map(([x, y]) => [x, y, 0]);
  const ring1 = circleProfile(10, 24).map(([x, y]) => [x, y, 10]); // 개수 다름
  assert.throws(() => loftMesh([ring0, ring1]), /점 개수 불일치/);
});

// ── throw: 스테이션 1개 ──
test('스테이션 1개 → throw', () => {
  const ring0 = circleProfile(10, 32).map(([x, y]) => [x, y, 0]);
  assert.throws(() => loftMesh([ring0]), /스테이션.*≥2/);
  assert.throws(() => loftMesh([]), /스테이션.*≥2/);
});

// ── throw: 퇴화(동일 링 → 체적 0) ──
test('동일 링 반복(높이 0) → 퇴화 throw', () => {
  const ring = circleProfile(10, 32).map(([x, y]) => [x, y, 0]);
  assert.throws(() => loftMesh([ring, ring.map((p) => [...p])]), /퇴화/);
});

// ── 프로파일 생성기 방어 ──
test('프로파일 생성기 잘못된 입력 → throw', () => {
  assert.throws(() => circleProfile(0, 32), /r>0/);
  assert.throws(() => circleProfile(10, 2), /≥3/);
  assert.throws(() => nacaProfile('4412', 41), /짝수/);        // 홀수 n
  assert.throws(() => nacaProfile('abc', 40), /4자리/);
  assert.throws(() => polygonProfile([[0, 0], [1, 1], [2, 2]]), /퇴화/); // 공선
  assert.throws(() => roundedRectProfile(10, 10, 6, 40), /범위/);       // r 과대
});

// ── loftAlongAxis 헬퍼 ──
test('loftAlongAxis(z축): 원기둥 재현', () => {
  const r = 8, h = 30, n = 64;
  const prof = circleProfile(r, n);
  const stations = [
    { at: [0, 0, 0], scale: 1, rot: 0 },
    { at: [0, 0, h], scale: 1, rot: 0 },
  ];
  const res = loftAlongAxis(prof, stations, { axis: 'z' });
  assert.equal(res.rings.length, 2);
  const exact = Math.PI * r * r * h;
  assert.ok(Math.abs(res.volumeMm3 - exact) / exact < 0.02);
});

test('loftAlongAxis: 스테이션 1개 → throw', () => {
  assert.throws(() => loftAlongAxis(circleProfile(5, 16), [{ at: [0, 0, 0] }], {}), /스테이션.*≥2/);
});

// ── loftPart: 완전 부품 객체 ──
test('loftPart: mesh 부품 규약 준수', () => {
  const n = 40;
  const rings = [0, 20, 40].map((z) => circleProfile(10, n).map(([x, y]) => [x, y, z]));
  const part = loftPart('test_body', rings, { material: 'aluminum', role: 'body' });
  assert.equal(part.type, 'mesh');
  assert.equal(part.id, 'test_body');
  assert.equal(part.material, 'aluminum');
  assert.ok(part.params.volumeMm3 > 0);
  assert.equal(part.params.triCount, part.params.faces.length);
  assert.ok(part.params.aabb.min.length === 3 && part.params.aabb.max.length === 3);
  assert.ok(part.params.verts.length === 3 * n + 2);
});

// ── 데모 어셈블리 ──
test('demoLoftAssembly: 빌드 + 체적>0', () => {
  const asm = demoLoftAssembly();
  assert.equal(asm.domain, 'mech');
  assert.equal(asm.parts.length, 1);
  const p = asm.parts[0];
  assert.equal(p.type, 'mesh');
  assert.ok(p.params.volumeMm3 > 0, `데모 체적 ${p.params.volumeMm3} > 0`);
  assert.ok(p.params.triCount > 0);
  assert.ok(Number.isFinite(p.params.aabb.min[0]));
});

// ───────────── ② 심화: 스윕 + 다중 바디 ─────────────
import { sweepMesh, sweepPart, bodyFromSpec, assemblyFromSpec } from './loft.mjs';

test('sweepMesh: 직선 경로 원 스윕 = 원기둥 (체적 ≈ πr²L)', () => {
  const r = 50, L = 400, path = [];
  for (let i = 0; i <= 8; i++) path.push([0, 0, (i * L) / 8]);
  const g = sweepMesh(circleProfile(1, 48), path, { scale: r });
  const exact = Math.PI * r * r * L;
  assert.ok(Math.abs(g.volumeMm3 - exact) / exact < 0.02, `체적 ${g.volumeMm3} vs ${exact}`);
  assert.ok(g.triCount > 0 && Number.isFinite(g.aabb.max[2]));
});

test('sweepMesh: 곡선(L) 경로도 비틀림 없이 생성', () => {
  const path = [[0, 0, 0], [300, 0, 0], [300, 300, 0], [300, 300, 300]];
  const g = sweepMesh(circleProfile(1, 16), path, { scale: 30 });
  assert.ok(g.volumeMm3 > 0 && g.verts.length > 0);
});

test('sweepMesh: path <2 또는 퇴화 프로파일 → throw', () => {
  assert.throws(() => sweepMesh(circleProfile(1, 12), [[0, 0, 0]], {}));
  assert.throws(() => sweepMesh([[0, 0], [1, 0], [2, 0]], [[0, 0, 0], [0, 0, 10]], {}));
});

test('sweepPart / bodyFromSpec(kind:sweep) → mesh 부품', () => {
  const p = sweepPart('duct', circleProfile(1, 20), [[0, 0, 0], [100, 0, 0], [100, 100, 0]], { scale: 20 });
  assert.equal(p.type, 'mesh');
  assert.ok(p.params.volumeMm3 > 0);
  const b = bodyFromSpec({ id: 'd2', kind: 'sweep', profile: { type: 'circle', r: 1, n: 16 }, path: [[0, 0, 0], [0, 0, 200]], scale: 25 });
  assert.equal(b.id, 'd2');
  assert.ok(b.params.triCount > 0);
});

test('assemblyFromSpec: 다중 바디(loft+sweep) → 어셈블리, id 자동/중복거부', () => {
  const asm = assemblyFromSpec({ name: 'multi', bodies: [
    { id: 'tube', kind: 'sweep', profile: { type: 'circle', r: 1, n: 12 }, path: [[0, 0, 0], [200, 0, 0]], scale: 30 },
    { kind: 'loft', profile: { type: 'roundedRect', w: 2, h: 1, r: 0.2, n: 24 }, stations: [{ at: [0, 0, 300], scale: 80 }, { at: [0, 0, 600], scale: 50 }] },
  ] });
  assert.equal(asm.parts.length, 2);
  assert.deepEqual(asm.parts.map((p) => p.id), ['tube', 'body_1']);
  assert.throws(() => assemblyFromSpec({ bodies: [
    { id: 'x', kind: 'sweep', profile: { type: 'circle', r: 1, n: 8 }, path: [[0, 0, 0], [10, 0, 0]], scale: 5 },
    { id: 'x', kind: 'sweep', profile: { type: 'circle', r: 1, n: 8 }, path: [[0, 0, 0], [10, 0, 0]], scale: 5 },
  ] }), /중복/);
});
