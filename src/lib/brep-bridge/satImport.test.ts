/**
 * satImport 폐형 테스트 — SAT 텍스트 스캐너·SAB 바이너리 토크나이저·바디 BFS.
 * 실물 검증은 로컬 코퍼스 벤치(SAT 16/16)·라이선스=로컬 전용.
 */
import { describe, it, expect } from 'vitest';
import { parseSatBodies, parseSabRecords, parseSabBodies, satToNexyfabAssembly } from './satImport';

// 최소 SAT v700: body→lump→shell→face→loop→coedge→edge→vertex→point 2개(0,0,0)~(10,20,30)
const SAT_MIN = [
  '700 0 1 0 ',
  '7 Test 13 ACIS 5.0.1 NT 24 Sun Apr 22 20:09:22 2018 ',
  '1 9.9e-007 1e-010 ',
  'body $-1 -1 $-1 $1 $-1 $-1 #',
  'lump $-1 -1 $-1 $-1 $2 $0 #',
  'shell $-1 -1 $-1 $-1 $-1 $3 $-1 $1 #',
  'face $-1 -1 $-1 $-1 $4 $2 $-1 $-1 forward single #',
  'loop $-1 -1 $-1 $-1 $5 $3 #',
  'coedge $-1 -1 $-1 $5 $5 $-1 $6 forward $4 $-1 #',
  'edge $-1 -1 $-1 $7 0 $8 10 $5 $-1 forward @7 unknown #',
  'vertex $-1 -1 $-1 $6 $9 #',
  'vertex $-1 -1 $-1 $6 $10 #',
  'point $-1 -1 $-1 0 0 0 #',
  'point $-1 -1 $-1 10 20 30 #',
].join('\n');

describe('parseSatBodies (텍스트)', () => {
  it('바디 그래프를 순회해 점군 AABB 를 얻는다', () => {
    const r = parseSatBodies(SAT_MIN);
    expect(r.ok).toBe(true);
    expect(r.bodies).toHaveLength(1);
    const b = r.bodies![0];
    expect(b.aabb!.min).toEqual([0, 0, 0]);
    expect(b.aabb!.max).toEqual([10, 20, 30]);
    expect(r.unitMm).toBe(1);
  });

  it('@N 문자열 리터럴 속 # 로 레코드 경계가 깨지지 않는다', () => {
    // @11 "abc # def gh" — '#' 포함 11바이트 문자열이 레코드를 끊으면 안 됨
    const sat = SAT_MIN.replace('@7 unknown', '@11 abc # def g');
    const r = parseSatBodies(sat);
    expect(r.ok).toBe(true);
    expect(r.bodies![0].aabb!.max).toEqual([10, 20, 30]);
  });

  it('attrib 체인으로는 순회하지 않는다(바디 간 누수 차단)', () => {
    // 두 바디: attrib($11)가 서로의 point 를 참조해도 각 바디는 자기 점만 가져야 함
    const sat = [
      '700 0 2 0 ',
      '7 T 13 ACIS 5.0.1 NT 24 Sun Apr 22 20:09:22 2018 ',
      '1 9.9e-007 1e-010 ',
      'body $6 -1 $-1 $1 $-1 $-1 #', // $6=attrib(다른 바디 점 참조)
      'lump $-1 -1 $-1 $-1 $2 $0 #',
      'shell $-1 -1 $-1 $-1 $-1 $-1 $-1 $1 #',
      'body $-1 -1 $-1 $4 $-1 $-1 #',
      'lump $-1 -1 $-1 $-1 $5 $3 #',
      'shell $-1 -1 $-1 $-1 $-1 $-1 $-1 $4 #',
      'color-adesk-attrib $-1 -1 $-1 $-1 $0 $7 #', // attrib → 다른 바디의 point $7
      'point $-1 -1 $-1 99 99 99 #',
    ].join('\n');
    const r = parseSatBodies(sat);
    // 두 바디 모두 shell 이하 점이 없음 — attrib 경유 99,99,99 를 주우면 실패
    expect(r.ok).toBe(false);
    expect(r.error).toContain('점군');
  });
});

// ── SAB 합성 바이트 ──
function sabBytes(): Uint8Array {
  const parts: number[] = [];
  const pushStr = (tag: number, s: string) => { parts.push(tag, s.length); for (const c of s) parts.push(c.charCodeAt(0)); };
  const pushInt = (v: number) => { const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, v, true); for (let i = 0; i < 4; i++) parts.push(b.getUint8(i)); };
  const pushIntTag = (v: number) => { parts.push(0x04); pushInt(v); };
  const pushPtr = (v: number) => { parts.push(0x0c); pushInt(v); };
  const pushDbl = (tag: number, ...vs: number[]) => { parts.push(tag); for (const v of vs) { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v, true); for (let i = 0; i < 8; i++) parts.push(b.getUint8(i)); } };
  // signature + header
  for (const c of 'ACIS BinaryFile') parts.push(c.charCodeAt(0));
  pushInt(21800); pushInt(0); pushInt(0); pushInt(0);
  pushStr(0x07, 'Test'); pushStr(0x07, 'ACIS 33.0.1'); pushStr(0x07, 'Sun Apr 22 20:09:22 2018');
  pushDbl(0x06, 25.4); pushDbl(0x06, 1e-6); pushDbl(0x06, 1e-10);
  // rec0: body → lump($1)
  pushStr(0x0d, 'body'); pushPtr(-1); pushIntTag(-1); pushPtr(-1); pushPtr(1); pushPtr(-1); pushPtr(-1); parts.push(0x11);
  // rec1: lump → shell($2), body($0)
  pushStr(0x0d, 'lump'); pushPtr(-1); pushIntTag(-1); pushPtr(-1); pushPtr(-1); pushPtr(2); pushPtr(0); parts.push(0x11);
  // rec2: shell → vertex($3)
  pushStr(0x0d, 'shell'); pushPtr(-1); pushIntTag(-1); pushPtr(-1); pushPtr(-1); pushPtr(-1); pushPtr(3); pushPtr(-1); parts.push(0x11);
  // rec3: vertex → point($4)
  pushStr(0x0d, 'vertex'); pushPtr(-1); pushIntTag(-1); pushPtr(-1); pushPtr(4); parts.push(0x11);
  // rec4: point (1,2,3) — LOCATION_VEC
  pushStr(0x0d, 'point'); pushPtr(-1); pushIntTag(-1); pushPtr(-1); pushDbl(0x13, 1, 2, 3); parts.push(0x11);
  // rec5: vertex2 → point($6) — shell 이 $3만 참조하므로 이 점은... (rec3 이 $4만) — 두 번째 점을 rec3 에 못 다니 rec2 를 확장 못함.
  return Uint8Array.from(parts);
}

describe('parseSabRecords / parseSabBodies (바이너리)', () => {
  it('SAB 헤더·토큰 스트림을 해석한다(단위·타입·포인터·vec3)', () => {
    const r = parseSabRecords(sabBytes());
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.unitMm).toBeCloseTo(25.4, 9);
    expect(r.product).toBe('Test');
    expect(r.records.get(0)!.type).toBe('body');
    expect(r.records.get(4)!.type).toBe('point');
    expect(r.records.get(4)!.nums).toEqual([1, 2, 3]);
  });

  it('바디 BFS 로 점군 AABB 를 얻는다(점 1개 바디는 빈 바디로 정직 집계)', () => {
    const r = parseSabBodies(sabBytes());
    // 점이 1개뿐(pts>=2 요건 미달) — 빈 바디로 정직 처리
    expect(r.ok).toBe(false);
  });

  it('satToNexyfabAssembly 는 SAB latin1 문자열 입력도 자동 감지한다', () => {
    const bytes = sabBytes();
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    const r = satToNexyfabAssembly(s, { name: 't' });
    expect(r.error ?? '').not.toContain('시그니처');
  });
});

describe('satToNexyfabAssembly', () => {
  it('단위(inch→mm)를 치수·배치에 적용한다', () => {
    const sat = SAT_MIN.replace('\n1 9.9e-007', '\n25.4 9.9e-007');
    const r = satToNexyfabAssembly(sat, { name: 'unit-test' });
    expect(r.ok).toBe(true);
    const p = r.assembly!.parts[0];
    expect(p.params.width).toBeCloseTo(254, 3);
    expect(p.params.depth).toBeCloseTo(508, 3);
    expect(p.params.height).toBeCloseTo(762, 3);
    expect(r.assembly!.importedApprox).toBe(true);
    expect(r.assembly!.note).toContain('AABB');
    // 표면 참조가 없는 파일 → 다면체 재구성 불가 — 명시 근사 플래그 필수(W5-G)
    expect(r.assembly!.fidelity).toBe('aabb-approximation');
    expect(p.fidelity).toBe('aabb-approximation');
  });
});

// ═══ W5-G(260721): 평면 페이스 다면체 실재구성 ═══

type V3 = [number, number, number];

/** 완전한 SAT B-rep 텍스트 생성기 — face/loop/coedge(파트너 포함)/edge/vertex/point + plane-surface.
 *  좌표·인시던스만 소스가 결정하고, 재구성기는 사이클·방향을 자체 복원하므로
 *  생성기와 임포터가 순서 가정을 공유하지 않는다(교차검증: 아래 리터럴 기대값). */
function buildSat(verts: V3[], faces: number[][], unit = 1): string {
  const nf = faces.length;
  const eKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const edgeIdx = new Map<string, number>();
  for (const f of faces) for (let k = 0; k < f.length; k++) {
    const key = eKey(f[k], f[(k + 1) % f.length]);
    if (!edgeIdx.has(key)) edgeIdx.set(key, edgeIdx.size);
  }
  const nc = faces.reduce((s, f) => s + f.length, 0);
  const ne = edgeIdx.size, nv = verts.length;
  const F = (i: number) => 3 + i, L = (i: number) => 3 + nf + i, S = (i: number) => 3 + 2 * nf + i;
  const C0 = 3 * nf + 3, E0 = C0 + nc, V0 = E0 + ne, P0 = V0 + nv;
  const cIdx: number[][] = [];
  let cj = 0;
  for (const f of faces) cIdx.push(f.map(() => C0 + cj++));
  const coedgeOfDir = new Map<string, number>();
  faces.forEach((f, i) => f.forEach((a, k) => coedgeOfDir.set(`${a}_${f[(k + 1) % f.length]}`, cIdx[i][k])));
  const firstCoedgeOfEdge = new Map<number, number>();
  const firstEdgeOfVert = new Map<number, number>();
  faces.forEach((f, i) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length];
    const e = E0 + edgeIdx.get(eKey(a, b))!;
    if (!firstCoedgeOfEdge.has(e)) firstCoedgeOfEdge.set(e, cIdx[i][k]);
    if (!firstEdgeOfVert.has(a)) firstEdgeOfVert.set(a, e);
    if (!firstEdgeOfVert.has(b)) firstEdgeOfVert.set(b, e);
  }));
  const newell = (f: number[]): V3 => {
    const n: V3 = [0, 0, 0];
    for (let k = 0; k < f.length; k++) {
      const p = verts[f[k]], q = verts[f[(k + 1) % f.length]];
      n[0] += (p[1] - q[1]) * (p[2] + q[2]);
      n[1] += (p[2] - q[2]) * (p[0] + q[0]);
      n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    }
    return n;
  };
  const lines: string[] = [
    '700 0 1 0 ',
    '7 W5GFix 13 ACIS 5.0.1 NT 24 Sun Apr 22 20:09:22 2018 ',
    `${unit} 9.9e-007 1e-010 `,
    'body $-1 -1 $-1 $1 $-1 $-1 #',
    'lump $-1 -1 $-1 $-1 $2 $0 #',
    `shell $-1 -1 $-1 $-1 $-1 $${F(0)} $-1 $1 #`,
  ];
  for (let i = 0; i < nf; i++) lines.push(`face $-1 -1 $-1 $${i + 1 < nf ? F(i + 1) : -1} $${L(i)} $2 $-1 $${S(i)} forward single #`);
  for (let i = 0; i < nf; i++) lines.push(`loop $-1 -1 $-1 $-1 $${cIdx[i][0]} $${F(i)} #`);
  for (let i = 0; i < nf; i++) {
    const f = faces[i];
    const n = newell(f);
    const m = Math.hypot(n[0], n[1], n[2]);
    const nu = n.map((v) => v / m);
    const p0 = verts[f[0]], p1 = verts[f[1]];
    const u: V3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const um = Math.hypot(u[0], u[1], u[2]);
    lines.push(`plane-surface $-1 -1 $-1 ${p0.join(' ')} ${nu.join(' ')} ${u.map((v) => v / um).join(' ')} forward_v I I I I #`);
  }
  faces.forEach((f, i) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length];
    const next = cIdx[i][(k + 1) % f.length], prev = cIdx[i][(k - 1 + f.length) % f.length];
    const partner = coedgeOfDir.get(`${b}_${a}`) ?? -1;
    const e = E0 + edgeIdx.get(eKey(a, b))!;
    lines.push(`coedge $-1 -1 $-1 $${next} $${prev} $${partner} $${e} forward $${L(i)} $-1 #`);
  }));
  for (const [key, k] of edgeIdx) {
    const [a, b] = key.split('_').map(Number);
    lines.push(`edge $-1 -1 $-1 $${V0 + a} 0 $${V0 + b} 1 $${firstCoedgeOfEdge.get(E0 + k)} $-1 forward @7 unknown #`);
  }
  for (let a = 0; a < nv; a++) lines.push(`vertex $-1 -1 $-1 $${firstEdgeOfVert.get(a) ?? -1} $${P0 + a} #`);
  for (let a = 0; a < nv; a++) lines.push(`point $-1 -1 $-1 ${verts[a][0]} ${verts[a][1]} ${verts[a][2]} #`);
  return lines.join('\n');
}

// 20×30×40 박스(정점·페이스 리터럴 — 기대값의 근거)
const BOX_VERTS: V3[] = [
  [0, 0, 0], [20, 0, 0], [20, 30, 0], [0, 30, 0],
  [0, 0, 40], [20, 0, 40], [20, 30, 40], [0, 30, 40],
];
const BOX_FACES = [
  [0, 3, 2, 1], [4, 5, 6, 7],
  [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
];
// 60×40×20 L-프리즘: 풋프린트 (0,0)(60,0)(60,20)(20,20)(20,40)(0,40)·높이 20
// 실부피 = (60·20 + 20·20)·20 = 32000 ≠ AABB 48000
const LP: Array<[number, number]> = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 40], [0, 40]];
const L_VERTS: V3[] = [...LP.map(([x, y]) => [x, y, 0] as V3), ...LP.map(([x, y]) => [x, y, 20] as V3)];
const L_FACES = [
  [5, 4, 3, 2, 1, 0], [6, 7, 8, 9, 10, 11],
  ...LP.map((_, i) => { const j = (i + 1) % 6; return [i, j, j + 6, i + 6]; }),
];

/** 임포트 정점집합 = 소스 정점집합(순서 무관, tol 이내) 검증 */
function expectVertSetEqual(got: Array<[number, number, number]>, want: V3[], tol = 1e-6) {
  expect(got).toHaveLength(want.length);
  for (const w of want) {
    const hit = got.some((g) => Math.abs(g[0] - w[0]) <= tol && Math.abs(g[1] - w[1]) <= tol && Math.abs(g[2] - w[2]) <= tol);
    expect(hit, `소스 정점 ${w} 이(가) 임포트 결과에 없음`).toBe(true);
  }
}

describe('W5-G 평면 다면체 실재구성 (SAT)', () => {
  it('20×30×40 박스 — 정점·부피·표면적·CG 가 소스 정의와 1e-6 일치', () => {
    const r = parseSatBodies(buildSat(BOX_VERTS, BOX_FACES));
    expect(r.ok).toBe(true);
    const poly = r.bodies![0].poly!;
    expect(poly).toBeTruthy();
    expectVertSetEqual(poly.verts, BOX_VERTS);
    expect(poly.faces).toHaveLength(6);
    expect(Math.abs(poly.volume - 24000)).toBeLessThan(1e-6);
    expect(Math.abs(poly.area - 5200)).toBeLessThan(1e-6); // 2(600+1200+800)
    expect(Math.abs(poly.cg[0] - 10)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[1] - 15)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[2] - 20)).toBeLessThan(1e-6);
  });

  it('60×40×20 L-프리즘(비볼록 페이스) — 부피 32000(AABB 48000 아님)·CG(25,15,10)', () => {
    const r = parseSatBodies(buildSat(L_VERTS, L_FACES));
    expect(r.ok).toBe(true);
    const poly = r.bodies![0].poly!;
    expect(poly).toBeTruthy();
    expectVertSetEqual(poly.verts, L_VERTS);
    expect(poly.faces).toHaveLength(8);
    expect(Math.abs(poly.volume - 32000)).toBeLessThan(1e-6);
    expect(Math.abs(poly.area - 7200)).toBeLessThan(1e-6); // 2·1600 + 둘레200·20
    expect(Math.abs(poly.cg[0] - 25)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[1] - 15)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[2] - 10)).toBeLessThan(1e-6);
    // AABB 근사였다면 불가능한 판정: 다면체 부피 < AABB 부피
    const a = r.bodies![0].aabb!;
    const aabbVol = (a.max[0] - a.min[0]) * (a.max[1] - a.min[1]) * (a.max[2] - a.min[2]);
    expect(aabbVol).toBeCloseTo(48000, 6);
    expect(poly.volume).toBeLessThan(aabbVol);
  });

  it('어셈블리 방출 — mesh 부품 + fidelity=brep-polyhedron + 단위 환산(inch)', () => {
    const r = satToNexyfabAssembly(buildSat(BOX_VERTS, BOX_FACES, 25.4), { name: 'boxInch' });
    expect(r.ok).toBe(true);
    expect(r.assembly!.fidelity).toBe('brep-polyhedron');
    const p = r.assembly!.parts[0];
    expect(p.fidelity).toBe('brep-polyhedron');
    expect(String(p.type)).toBe('mesh');
    const prm = p.params as unknown as { volumeMm3: number; areaMm2: number; verts: number[][]; faces: number[][] };
    expect(prm.volumeMm3).toBeCloseTo(24000 * 25.4 ** 3, 3);
    expect(prm.areaMm2).toBeCloseTo(5200 * 25.4 ** 2, 3);
    expect(prm.verts).toHaveLength(8);
    expect(prm.faces).toHaveLength(6);
    expectVertSetEqual(prm.verts as Array<[number, number, number]>, BOX_VERTS.map(([x, y, z]) => [x * 25.4, y * 25.4, z * 25.4] as V3), 1e-6);
    expect(r.stats!.polyParts).toBe(1);
  });

  it('곡면 페이스(cone-surface)는 조용한 박스 대체가 아니라 명시 사유+플래그로 폴백한다', () => {
    // SAT_MIN 의 face 에 cone-surface($11) 참조를 부여
    const sat = SAT_MIN
      .replace('face $-1 -1 $-1 $-1 $4 $2 $-1 $-1 forward single #', 'face $-1 -1 $-1 $-1 $4 $2 $-1 $11 forward single #')
      + '\ncone-surface $-1 -1 $-1 0 0 0 0 0 1 1 0 0 1 0.5 #';
    const r = satToNexyfabAssembly(sat, { name: 'cone' });
    expect(r.ok).toBe(true);
    expect(r.assembly!.fidelity).toBe('aabb-approximation');
    expect(r.assembly!.parts[0].fidelity).toBe('aabb-approximation');
    expect(r.assembly!.importedApprox).toBe(true);
    expect(r.assembly!.note).toContain('cone');
    expect(r.assembly!.note).toContain('AABB');
  });

  it('교차검증 위반(오염된 point 좌표로 비평면 페이스)은 다면체를 내지 않는다 — 날조 방지', () => {
    // 박스의 한 정점을 z 로 5 밀어 4각 페이스가 비평면이 되게 오염
    const bad = [...BOX_VERTS.map((v) => [...v] as V3)];
    bad[6] = [20, 30, 45];
    const r = parseSatBodies(buildSat(bad, BOX_FACES));
    expect(r.ok).toBe(true);
    expect(r.bodies![0].poly).toBeUndefined();
    expect(r.bodies![0].fallbackReason).toBeTruthy();
  });
});
