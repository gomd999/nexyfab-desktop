import { describe, it, expect } from 'vitest';
import {
  DxfBlocksLibrary,
  resolveInsert,
  flatten,
  summarize,
  type DxfBaseEntity,
  type DxfBlockDefinition,
} from './dxfBlocksLibrary';

function makeBoltBlock(): DxfBlockDefinition {
  return {
    name: 'BOLT',
    origin: { x: 0, y: 0 },
    entities: [
      { type: 'CIRCLE', cx: 0, cy: 0, r: 1 },
      { type: 'LINE', x0: -1.5, y0: 0, x1: 1.5, y1: 0 },
    ],
  };
}

function makePanelBlock(): DxfBlockDefinition {
  return {
    name: 'PANEL',
    origin: { x: 0, y: 0 },
    entities: [
      { type: 'LINE', x0: 0, y0: 0, x1: 10, y1: 0 },
      { type: 'INSERT', blockName: 'BOLT', x: 2, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
      { type: 'INSERT', blockName: 'BOLT', x: 8, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
    ],
  };
}

describe('DxfBlocksLibrary', () => {
  it('starts empty', () => {
    const lib = new DxfBlocksLibrary();
    expect(lib.size()).toBe(0);
    expect(lib.names()).toEqual([]);
  });

  it('add + get + remove', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    expect(lib.size()).toBe(1);
    expect(lib.get('BOLT')?.name).toBe('BOLT');
    expect(lib.remove('BOLT')).toBe(true);
    expect(lib.size()).toBe(0);
  });

  it('overwrites on duplicate add', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    lib.add({ name: 'BOLT', origin: { x: 0, y: 0 }, entities: [] });
    expect(lib.size()).toBe(1);
    expect(lib.get('BOLT')?.entities).toEqual([]);
  });

  it('detects no cycle for clean library', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    lib.add(makePanelBlock());
    expect(lib.hasCycle()).toBe(false);
  });

  it('detects cycle when a block references itself', () => {
    const lib = new DxfBlocksLibrary();
    lib.add({
      name: 'CYC',
      origin: { x: 0, y: 0 },
      entities: [{ type: 'INSERT', blockName: 'CYC', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 }],
    });
    expect(lib.hasCycle()).toBe(true);
  });
});

describe('resolveInsert', () => {
  it('resolves a single-level INSERT', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    const insert: DxfBaseEntity = { type: 'INSERT', blockName: 'BOLT', x: 5, y: 5, rotationDeg: 0, scaleX: 1, scaleY: 1 };
    const r = resolveInsert(insert, lib);
    expect(r.resolved).toHaveLength(2);
    const circle = r.resolved.find(e => e.entity.type === 'CIRCLE');
    expect(circle).toBeDefined();
    if (circle && circle.entity.type === 'CIRCLE') {
      expect(circle.entity.cx).toBeCloseTo(5, 5);
      expect(circle.entity.cy).toBeCloseTo(5, 5);
    }
  });

  it('applies uniform scale to circles', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    const insert: DxfBaseEntity = { type: 'INSERT', blockName: 'BOLT', x: 0, y: 0, rotationDeg: 0, scaleX: 3, scaleY: 3 };
    const r = resolveInsert(insert, lib);
    const circle = r.resolved.find(e => e.entity.type === 'CIRCLE');
    if (circle && circle.entity.type === 'CIRCLE') {
      expect(circle.entity.r).toBeCloseTo(3, 5);
    }
  });

  it('applies rotation', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    const insert: DxfBaseEntity = { type: 'INSERT', blockName: 'BOLT', x: 0, y: 0, rotationDeg: 90, scaleX: 1, scaleY: 1 };
    const r = resolveInsert(insert, lib);
    const line = r.resolved.find(e => e.entity.type === 'LINE');
    if (line && line.entity.type === 'LINE') {
      // Original line went from (-1.5, 0) to (1.5, 0); after 90° rotation, it goes (0, -1.5) to (0, 1.5).
      expect(line.entity.x0).toBeCloseTo(0, 3);
      expect(line.entity.y0).toBeCloseTo(-1.5, 3);
    }
  });

  it('resolves nested INSERTs', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    lib.add(makePanelBlock());
    const insert: DxfBaseEntity = { type: 'INSERT', blockName: 'PANEL', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 };
    const r = resolveInsert(insert, lib);
    // PANEL has 1 LINE + 2 INSERTs (each BOLT → 2 entities) = 5 entities total.
    expect(r.resolved).toHaveLength(5);
    expect(r.maxDepthObserved).toBeGreaterThanOrEqual(1);
  });

  it('reports missing blocks', () => {
    const lib = new DxfBlocksLibrary();
    const insert: DxfBaseEntity = { type: 'INSERT', blockName: 'GHOST', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 };
    const r = resolveInsert(insert, lib);
    expect(r.missing).toEqual(['GHOST']);
    expect(r.resolved).toEqual([]);
  });

  it('breaks cycles', () => {
    const lib = new DxfBlocksLibrary();
    lib.add({
      name: 'A',
      origin: { x: 0, y: 0 },
      entities: [{ type: 'INSERT', blockName: 'A', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 }],
    });
    const insert: DxfBaseEntity = { type: 'INSERT', blockName: 'A', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 };
    const r = resolveInsert(insert, lib);
    expect(r.cycleDetected).toBe(true);
  });

  it('records block path', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    lib.add(makePanelBlock());
    const insert: DxfBaseEntity = { type: 'INSERT', blockName: 'PANEL', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 };
    const r = resolveInsert(insert, lib);
    const nested = r.resolved.find(e => e.blockPath.length === 2);
    expect(nested?.blockPath).toEqual(['PANEL', 'BOLT']);
  });
});

describe('flatten', () => {
  it('passes through non-INSERT entities', () => {
    const lib = new DxfBlocksLibrary();
    const entities: DxfBaseEntity[] = [{ type: 'LINE', x0: 0, y0: 0, x1: 5, y1: 5 }];
    const r = flatten(entities, lib);
    expect(r.resolved).toHaveLength(1);
    expect(r.resolved[0]!.blockPath).toEqual([]);
  });

  it('mixed root entities + INSERTs', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    const entities: DxfBaseEntity[] = [
      { type: 'LINE', x0: 0, y0: 0, x1: 5, y1: 0 },
      { type: 'INSERT', blockName: 'BOLT', x: 5, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
    ];
    const r = flatten(entities, lib);
    expect(r.resolved).toHaveLength(3); // line + 2 entities from BOLT
  });

  it('dedups missing block names', () => {
    const lib = new DxfBlocksLibrary();
    const entities: DxfBaseEntity[] = [
      { type: 'INSERT', blockName: 'GHOST', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
      { type: 'INSERT', blockName: 'GHOST', x: 5, y: 5, rotationDeg: 0, scaleX: 1, scaleY: 1 },
    ];
    const r = flatten(entities, lib);
    expect(r.missing).toEqual(['GHOST']);
  });
});

describe('summarize', () => {
  it('counts blocks and entities', () => {
    const lib = new DxfBlocksLibrary();
    lib.add(makeBoltBlock());
    lib.add(makePanelBlock());
    const s = summarize(lib);
    expect(s.blockCount).toBe(2);
    expect(s.entityCount).toBe(5);
    expect(s.nestedInsertCount).toBe(2);
    expect(s.hasCycle).toBe(false);
  });
});
