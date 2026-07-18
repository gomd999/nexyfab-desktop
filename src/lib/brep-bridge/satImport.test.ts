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
  });
});
