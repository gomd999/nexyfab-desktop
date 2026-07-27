/**
 * holeTable.test.ts — Phase 4.3 follow-up of NexyFab Pro own-CAD (ADR-013).
 *
 * Covers the happy path (sorted table, THRU vs blind depth labels), grouping
 * collapse with counts, origin subtraction, precision, CSV emission, and the
 * validation guards (bad diameter, empty id, non-finite coords).
 */

import { describe, it, expect } from 'vitest';
import { buildHoleTable, holeTableToCsv, HoleTableError, THRU_LABEL, type HoleSpec, holeTagsById } from './holeTable';

describe('buildHoleTable', () => {
  it('builds a sorted table with THRU and blind depth labels', () => {
    const holes: HoleSpec[] = [
      { id: 'h2', x: 10, y: 5, diameter: 6 }, // through
      { id: 'h1', x: 0, y: 0, diameter: 8, depth: 5 }, // blind
    ];
    const rows = buildHoleTable(holes);
    expect(rows).toHaveLength(2);
    // sorted by x ascending: h1 (x=0) before h2 (x=10)
    expect(rows[0].tag).toBe('A1');
    expect(rows[0].x).toBe(0);
    expect(rows[0].diameter).toBe(8);
    expect(rows[0].depthLabel).toBe('↧ 5.00');
    expect(rows[0].count).toBe(1);
    expect(rows[1].tag).toBe('A2');
    expect(rows[1].x).toBe(10);
    expect(rows[1].depthLabel).toBe(THRU_LABEL);
  });

  it('uses (x, y) then id as a deterministic tie-breaker', () => {
    const holes: HoleSpec[] = [
      { id: 'z', x: 1, y: 1, diameter: 3 },
      { id: 'a', x: 1, y: 1, diameter: 3 },
      { id: 'm', x: 1, y: 0, diameter: 3 },
    ];
    const rows = buildHoleTable(holes);
    // y ascending within same x, then id ascending for the (1,1) pair
    expect(rows.map((r) => r.tag)).toEqual(['A1', 'A2', 'A3']);
    expect(rows[0].y).toBe(0); // m
    expect(rows[1].y).toBe(1);
    expect(rows[2].y).toBe(1);
  });

  it('collapses identical holes into one counted row when groupIdentical', () => {
    const holes: HoleSpec[] = [
      { id: 'a', x: 0, y: 0, diameter: 6 },
      { id: 'b', x: 10, y: 0, diameter: 6 },
      { id: 'c', x: 20, y: 0, diameter: 6 },
      { id: 'd', x: 5, y: 0, diameter: 8, depth: 4 },
    ];
    const rows = buildHoleTable(holes, { groupIdentical: true });
    expect(rows).toHaveLength(2);
    const sixRow = rows.find((r) => r.diameter === 6)!;
    expect(sixRow.count).toBe(3);
    const eightRow = rows.find((r) => r.diameter === 8)!;
    expect(eightRow.count).toBe(1);
    expect(eightRow.depthLabel).toBe('↧ 4.00');
    // tags are re-assigned over final ordering
    expect(rows.map((r) => r.tag)).toEqual(['A1', 'A2']);
  });

  it('does not group holes that differ only by depth', () => {
    const holes: HoleSpec[] = [
      { id: 'a', x: 0, y: 0, diameter: 6 }, // through
      { id: 'b', x: 1, y: 0, diameter: 6, depth: 3 }, // blind
    ];
    const rows = buildHoleTable(holes, { groupIdentical: true });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.count === 1)).toBe(true);
  });

  it('subtracts the datum origin to produce signed deltas', () => {
    const holes: HoleSpec[] = [
      { id: 'a', x: 100, y: 50, diameter: 5 },
      { id: 'b', x: 90, y: 60, diameter: 5 },
    ];
    const rows = buildHoleTable(holes, { originX: 100, originY: 50 });
    const a = rows.find((r) => r.tag !== undefined && r.x === 0)!;
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
    const b = rows.find((r) => r.x === -10)!;
    expect(b.x).toBe(-10);
    expect(b.y).toBe(10);
  });

  it('formats coordinates and diameter to the requested precision', () => {
    const holes: HoleSpec[] = [
      { id: 'a', x: 1.23456, y: -2.34567, diameter: 3.14159 },
    ];
    const rows = buildHoleTable(holes, { precision: 3 });
    expect(rows[0].x).toBe(1.235);
    expect(rows[0].y).toBe(-2.346);
    expect(rows[0].diameter).toBe(3.142);
  });

  it('normalizes -0 deltas to 0', () => {
    const holes: HoleSpec[] = [{ id: 'a', x: 5, y: 5, diameter: 2 }];
    const rows = buildHoleTable(holes, { originX: 5, originY: 5 });
    expect(Object.is(rows[0].x, 0)).toBe(true);
    expect(Object.is(rows[0].y, 0)).toBe(true);
  });

  it('throws on empty id', () => {
    expect(() => buildHoleTable([{ id: '', x: 0, y: 0, diameter: 5 }])).toThrow(
      HoleTableError,
    );
  });

  it('throws on non-positive diameter', () => {
    expect(() => buildHoleTable([{ id: 'a', x: 0, y: 0, diameter: 0 }])).toThrow(
      /diameter must be a positive/,
    );
    expect(() => buildHoleTable([{ id: 'a', x: 0, y: 0, diameter: -3 }])).toThrow(
      HoleTableError,
    );
  });

  it('throws on non-finite coords and bad precision/depth', () => {
    expect(() =>
      buildHoleTable([{ id: 'a', x: Infinity, y: 0, diameter: 5 }]),
    ).toThrow(HoleTableError);
    expect(() =>
      buildHoleTable([{ id: 'a', x: 0, y: 0, diameter: 5 }], { precision: -1 }),
    ).toThrow(/precision/);
    expect(() =>
      buildHoleTable([{ id: 'a', x: 0, y: 0, diameter: 5, depth: 0 }]),
    ).toThrow(/depth/);
  });
});

describe('holeTableToCsv', () => {
  it('emits a header row plus one CSV line per row', () => {
    const rows = buildHoleTable(
      [
        { id: 'a', x: 0, y: 0, diameter: 6 },
        { id: 'b', x: 10, y: 0, diameter: 8, depth: 5 },
      ],
    );
    const csv = holeTableToCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Tag,X,Y,Diameter,Depth,Count');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('A1,0,0,6,THRU,1');
    expect(lines[2]).toBe('A2,10,0,8,↧ 5.00,1');
  });

  it('quotes fields containing commas or quotes', () => {
    const csv = holeTableToCsv([
      { tag: 'A1', x: 0, y: 0, diameter: 5, depthLabel: 'a,b"c', count: 1, holeIds: ['h1'] },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('A1,0,0,5,"a,b""c",1');
  });
});

/**
 * 그림↔표 짝짓기의 역참조 (260728). 태그 규칙은 `buildHoleTable` 에만 있고, 뷰 안의
 * 구멍 원은 이 맵으로 **같은 태그**를 읽는다 — 규칙을 두 번 구현하지 않는다.
 */
describe('holeTagsById — 구멍 id → 표 태그', () => {
  const holes = [
    { id: 'h1', x: 10, y: 10, diameter: 6 },
    { id: 'h2', x: 90, y: 10, diameter: 6 },
    { id: 'h3', x: 50, y: 50, diameter: 12 },
  ];

  it('그룹핑을 켜면 동일 치수 구멍이 같은 태그를 공유한다', () => {
    const m = holeTagsById(holes, { groupIdentical: true });
    expect(m.get('h1')).toBe(m.get('h2'));      // ⌀6 두 개는 한 행
    expect(m.get('h3')).not.toBe(m.get('h1'));  // ⌀12 는 다른 행
    expect(new Set([...m.values()]).size).toBe(2);
  });

  it('그룹핑을 끄면 구멍마다 다른 태그가 붙는다', () => {
    const m = holeTagsById(holes, {});
    expect(new Set([...m.values()]).size).toBe(3);
  });

  it('태그 값이 buildHoleTable 이 실제로 매긴 것과 일치한다 (규칙 중복 없음)', () => {
    const rows = buildHoleTable(holes, { groupIdentical: true });
    const m = holeTagsById(holes, { groupIdentical: true });
    for (const row of rows) {
      for (const id of row.holeIds) expect(m.get(id)).toBe(row.tag);
    }
  });
});
