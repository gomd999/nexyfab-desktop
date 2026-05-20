import { describe, it, expect } from 'vitest';
import {
  explodeWithGroups,
  listDescendants,
  summarize,
  type PartInSubassembly,
  type SubAssemblyDef,
} from './subAssemblyExplodeGroup';

function part(id: string, sub: string | null, x: number, y: number, z: number): PartInSubassembly {
  return { partId: id, subAssemblyId: sub, assembledPos: { x, y, z } };
}

describe('explodeWithGroups', () => {
  it('empty input → empty positions', () => {
    const r = explodeWithGroups([], []);
    expect(r.explodedPositions.size).toBe(0);
  });

  it('top-level parts explode along direction', () => {
    const parts = [
      part('a', null, 0, 0, 0),
      part('b', null, 0, 0, 10),
    ];
    const r = explodeWithGroups(parts, []);
    expect(r.topLevelPartIds).toHaveLength(2);
  });

  it('sub-assembly members move together', () => {
    const parts = [
      part('a1', 'sub1', 0, 0, 0),
      part('a2', 'sub1', 0, 0, 5),
      part('b', 'sub2', 0, 0, 100),
    ];
    const subs: SubAssemblyDef[] = [
      { id: 'sub1', parentId: null },
      { id: 'sub2', parentId: null },
    ];
    const r = explodeWithGroups(parts, subs, { internalSpacingMm: 0 });
    // sub1 members both moved by the same group offset.
    const a1 = r.explodedPositions.get('a1')!;
    const a2 = r.explodedPositions.get('a2')!;
    expect(a2.z - a1.z).toBeCloseTo(5, 5);
  });

  it('sub-assembly offsets reported', () => {
    const parts = [
      part('a', 'sub1', 0, 0, 0),
      part('b', 'sub2', 0, 0, 50),
    ];
    const subs: SubAssemblyDef[] = [
      { id: 'sub1', parentId: null },
      { id: 'sub2', parentId: null },
    ];
    const r = explodeWithGroups(parts, subs);
    expect(r.subAssemblyOffsets.size).toBe(2);
  });

  it('internal-explode spreads members within sub-assembly', () => {
    const parts = [
      part('a', 'sub1', 0, 0, 0),
      part('b', 'sub1', 10, 0, 0),
      part('c', 'sub1', -10, 0, 0),
    ];
    const subs: SubAssemblyDef[] = [{ id: 'sub1', parentId: null }];
    const noInternal = explodeWithGroups(parts, subs, { internalSpacingMm: 0 });
    const withInternal = explodeWithGroups(parts, subs, { internalSpacingMm: 10 });
    // With internal, members spread further apart.
    const noB = noInternal.explodedPositions.get('b')!;
    const noC = noInternal.explodedPositions.get('c')!;
    const wiB = withInternal.explodedPositions.get('b')!;
    const wiC = withInternal.explodedPositions.get('c')!;
    expect(Math.abs(wiB.x - wiC.x)).toBeGreaterThan(Math.abs(noB.x - noC.x));
  });

  it('all parts have exploded positions', () => {
    const parts = [
      part('a', 'sub1', 0, 0, 0),
      part('b', null, 0, 0, 50),
    ];
    const r = explodeWithGroups(parts, [{ id: 'sub1', parentId: null }]);
    expect(r.explodedPositions.has('a')).toBe(true);
    expect(r.explodedPositions.has('b')).toBe(true);
  });

  it('direction option respected', () => {
    const parts = [part('a', 'sub1', 0, 0, 0), part('b', 'sub2', 0, 0, 50)];
    const subs: SubAssemblyDef[] = [
      { id: 'sub1', parentId: null },
      { id: 'sub2', parentId: null },
    ];
    const rZ = explodeWithGroups(parts, subs, { direction: { x: 0, y: 0, z: 1 }, internalSpacingMm: 0 });
    const rX = explodeWithGroups(parts, subs, { direction: { x: 1, y: 0, z: 0 }, internalSpacingMm: 0 });
    expect(rZ.subAssemblyOffsets.get('sub1')!.offset.z).not.toBe(rX.subAssemblyOffsets.get('sub1')!.offset.z);
  });
});

describe('listDescendants', () => {
  it('includes self', () => {
    const subs: SubAssemblyDef[] = [{ id: 'A', parentId: null }];
    expect(listDescendants('A', subs)).toContain('A');
  });

  it('walks tree', () => {
    const subs: SubAssemblyDef[] = [
      { id: 'A', parentId: null },
      { id: 'B', parentId: 'A' },
      { id: 'C', parentId: 'B' },
    ];
    const desc = listDescendants('A', subs);
    expect(desc.sort()).toEqual(['A', 'B', 'C']);
  });

  it('unknown id returns just itself', () => {
    expect(listDescendants('X', [])).toEqual(['X']);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize({
      explodedPositions: new Map(),
      subAssemblyOffsets: new Map(),
      topLevelPartIds: [],
    });
    expect(s.partCount).toBe(0);
  });

  it('reports counts', () => {
    const parts = [
      part('a', 'sub1', 0, 0, 0),
      part('b', 'sub2', 0, 0, 100),
      part('c', null, 0, 0, 200),
    ];
    const subs: SubAssemblyDef[] = [
      { id: 'sub1', parentId: null },
      { id: 'sub2', parentId: null },
    ];
    const s = summarize(explodeWithGroups(parts, subs));
    expect(s.subAssemblyCount).toBe(2);
    expect(s.topLevelCount).toBe(1);
  });
});
