/**
 * dwgImport 폐형 테스트 — 순수 방출기(dwgDatabaseToDxf)만 검증(WASM 미사용).
 * 실제 DWG 파싱(LibreDWG WASM)은 로컬 코퍼스 벤치로 검증(라이선스=로컬 전용).
 */
import { describe, it, expect } from 'vitest';
import { dwgDatabaseToDxf, stripMtextCodes, type DwgDb } from './dwgImport';

function pairsOf(text: string): Array<[number, string]> {
  const lines = text.split('\n');
  const out: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([parseInt(lines[i], 10), lines[i + 1]]);
  return out;
}

describe('dwgDatabaseToDxf', () => {
  it('LINE/CIRCLE/DIMENSION 을 그룹코드 폐형으로 방출한다', () => {
    const db: DwgDb = {
      entities: [
        { type: 'LINE', layer: 'A', startPoint: { x: 1, y: 2 }, endPoint: { x: 3, y: 4 } },
        { type: 'CIRCLE', layer: 'B', center: { x: 10, y: 20 }, radius: 5 },
        { type: 'DIMENSION', measurement: 1250.5, text: '1250.5' },
      ],
    };
    const { dxfText, stats } = dwgDatabaseToDxf(db);
    expect(stats.emitted).toBe(3);
    const P = pairsOf(dxfText);
    // 섹션 구조: pairs() 2줄 스트라이드에 정렬(dxf-seed 파서 계약)
    expect(P[0]).toEqual([0, 'SECTION']);
    expect(P[1]).toEqual([2, 'ENTITIES']);
    expect(P.at(-2)).toEqual([0, 'ENDSEC']);
    expect(P.at(-1)).toEqual([0, 'EOF']);
    const line = P.findIndex(([c, v]) => c === 0 && v === 'LINE');
    expect(P[line + 1]).toEqual([8, 'A']);
    const get = (from: number, code: number) => P.slice(from).find(([c]) => c === code)?.[1];
    expect(get(line, 10)).toBe('1');
    expect(get(line, 21)).toBe('4');
    const circ = P.findIndex(([c, v]) => c === 0 && v === 'CIRCLE');
    expect(get(circ, 40)).toBe('5');
    const dim = P.findIndex(([c, v]) => c === 0 && v === 'DIMENSION');
    expect(get(dim, 42)).toBe('1250.5');
  });

  it('INSERT 블록을 아핀(이동+회전+스케일-기준점) 전개하고, 비등방 스케일의 원은 테셀레이션한다', () => {
    const db: DwgDb = {
      entities: [
        { type: 'INSERT', name: 'BLK', insertionPoint: { x: 100, y: 0 }, xScale: 2, yScale: 2, rotation: Math.PI / 2 },
        { type: 'INSERT', name: 'BLK', insertionPoint: { x: 0, y: 0 }, xScale: 2, yScale: 1, rotation: 0 },
      ],
      tables: { BLOCK_RECORD: { entries: [{ name: 'BLK', basePoint: { x: 0, y: 0 }, entities: [
        { type: 'LINE', startPoint: { x: 1, y: 0 }, endPoint: { x: 2, y: 0 } },
        { type: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 },
      ] }] } },
    };
    const { dxfText, stats } = dwgDatabaseToDxf(db);
    expect(stats.blockInserts).toBe(2);
    const P = pairsOf(dxfText);
    // 등방 INSERT(회전 90°·스케일 2): (1,0)→(100,2)
    const line1 = P.findIndex(([c, v]) => c === 0 && v === 'LINE');
    const get = (from: number, code: number) => Number(P.slice(from).find(([c]) => c === code)?.[1]);
    expect(get(line1, 10)).toBeCloseTo(100, 6);
    expect(get(line1, 20)).toBeCloseTo(2, 6);
    // 등방 INSERT 의 원은 CIRCLE 로 보존(반경 ×2)
    const circ = P.findIndex(([c, v]) => c === 0 && v === 'CIRCLE');
    expect(circ).toBeGreaterThan(-1);
    expect(get(circ, 40)).toBeCloseTo(2, 6);
    // 비등방(2,1) INSERT 의 원은 폴리라인 테셀레이션 — 근사 집계
    expect(stats.tessellated).toBeGreaterThanOrEqual(1);
    expect(P.some(([c, v]) => c === 0 && v === 'LWPOLYLINE')).toBe(true);
  });

  it('POLYLINE3D(z 보유)는 등고 인입 계약(POLYLINE/VERTEX 30)으로 방출한다', () => {
    const db: DwgDb = {
      entities: [
        { type: 'POLYLINE3D', layer: '7111', vertices: [
          { x: 0, y: 0, z: 50 }, { x: 10, y: 0, z: 50 }, { x: 10, y: 10, z: 50 },
        ] },
      ],
    };
    const { dxfText } = dwgDatabaseToDxf(db);
    const P = pairsOf(dxfText);
    expect(P.filter(([c, v]) => c === 0 && v === 'VERTEX')).toHaveLength(3);
    expect(P.filter(([c]) => c === 30).map(([, v]) => v)).toEqual(['50', '50', '50']);
    expect(P.some(([c, v]) => c === 0 && v === 'SEQEND')).toBe(true);
  });

  it('미지원 엔티티는 건너뛰고 집계하며, maxEntities 초과 시 truncated 를 보고한다', () => {
    const many: DwgDb = {
      entities: [
        { type: 'HATCH' },
        { type: '3DSOLID' },
        ...Array.from({ length: 30 }, (_, i) => ({ type: 'LINE', startPoint: { x: i, y: 0 }, endPoint: { x: i, y: 1 } })),
      ],
    };
    const { stats } = dwgDatabaseToDxf(many, { maxEntities: 10 });
    expect(stats.truncated).toBe(true);
    expect(stats.emitted).toBe(10);
    const full = dwgDatabaseToDxf(many).stats;
    expect(full.skipped.HATCH).toBe(1);
    expect(full.skipped['3DSOLID']).toBe(1);
    expect(full.emitted).toBe(30);
  });
});

describe('dwgDatabaseToDxf 루트 블록 폴백', () => {
  it('모델 공간이 비면 미참조 루트 블록만 항등 방출한다(참조 블록은 중복 방출 금지)', () => {
    const db: DwgDb = {
      entities: [],
      tables: { BLOCK_RECORD: { entries: [
        { name: '*Model_Space', entities: [] },
        { name: '*Paper_Space', entities: [{ type: 'VIEWPORT' }] },
        // 루트: *I3 이 VIEW4 를 참조 — VIEW4 는 직접 방출되면 안 됨(이중 방출)
        { name: '*I3', entities: [{ type: 'INSERT', name: 'Sheet_VIEW4', insertionPoint: { x: 100, y: 0 }, xScale: 1, yScale: 1, rotation: 0 }] },
        { name: 'Sheet_VIEW4', entities: [{ type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 0 } }] },
      ] } },
    };
    const { dxfText, stats } = dwgDatabaseToDxf(db);
    expect(stats.fallbackBlocks).toBe(1); // *I3 만(뷰포트-온리 *Paper_Space 는 무방출)
    const P = pairsOf(dxfText);
    const lines = P.filter(([c, v]) => c === 0 && v === 'LINE');
    expect(lines).toHaveLength(1); // VIEW4 직접 방출이 없어야 1개
    const li = P.findIndex(([c, v]) => c === 0 && v === 'LINE');
    expect(Number(P.slice(li).find(([c]) => c === 10)?.[1])).toBeCloseTo(100, 6); // *I3 배치 반영
  });
});

describe('stripMtextCodes', () => {
  it('MTEXT 인라인 서식을 제거하고 표시 텍스트만 남긴다', () => {
    expect(stripMtextCodes('{\\fArial|b0;HELLO}\\PWORLD')).toBe('HELLO WORLD');
    expect(stripMtextCodes('\\A1;직경 25')).toBe('직경 25');
  });
});
