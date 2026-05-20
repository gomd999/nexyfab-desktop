import { describe, it, expect } from 'vitest';
import {
  createRegistry,
  addBody,
  removeBody,
  getBody,
  listBodies,
  listByKind,
  listByTag,
  setVisible,
  toggleVisible,
  setLocked,
  reorder,
  estimateCombineVolume,
  planCombine,
  planSplit,
  summarizeRegistry,
  type Body,
} from './bodyManagement';

function makeBody(id: string, overrides: Partial<Body> = {}): Body {
  return {
    id,
    name: id,
    kind: 'solid',
    volumeMm3: 1000,
    surfaceAreaMm2: 600,
    bbox: { min: [0, 0, 0], max: [10, 10, 10] },
    visible: true,
    locked: false,
    tags: [],
    ...overrides,
  };
}

describe('registry CRUD', () => {
  it('add + list preserves insertion order', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    addBody(r, makeBody('b'));
    addBody(r, makeBody('c'));
    expect(listBodies(r).map(b => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('remove drops from list', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    addBody(r, makeBody('b'));
    expect(removeBody(r, 'a')).toBe(true);
    expect(listBodies(r).map(b => b.id)).toEqual(['b']);
  });

  it('get returns body or undefined', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    expect(getBody(r, 'a')?.id).toBe('a');
    expect(getBody(r, 'missing')).toBeUndefined();
  });
});

describe('filters', () => {
  it('listByKind', () => {
    const r = createRegistry();
    addBody(r, makeBody('a', { kind: 'solid' }));
    addBody(r, makeBody('b', { kind: 'surface' }));
    addBody(r, makeBody('c', { kind: 'wire' }));
    expect(listByKind(r, 'solid').map(b => b.id)).toEqual(['a']);
    expect(listByKind(r, 'surface').map(b => b.id)).toEqual(['b']);
  });

  it('listByTag', () => {
    const r = createRegistry();
    addBody(r, makeBody('a', { tags: ['main'] }));
    addBody(r, makeBody('b', { tags: ['main', 'cover'] }));
    addBody(r, makeBody('c', { tags: ['cover'] }));
    expect(listByTag(r, 'main').map(b => b.id)).toEqual(['a', 'b']);
  });
});

describe('visibility + lock', () => {
  it('toggleVisible flips', () => {
    const r = createRegistry();
    addBody(r, makeBody('a', { visible: true }));
    expect(toggleVisible(r, 'a')).toBe(false);
    expect(toggleVisible(r, 'a')).toBe(true);
  });

  it('setVisible', () => {
    const r = createRegistry();
    addBody(r, makeBody('a', { visible: true }));
    setVisible(r, 'a', false);
    expect(getBody(r, 'a')?.visible).toBe(false);
  });

  it('setLocked', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    setLocked(r, 'a', true);
    expect(getBody(r, 'a')?.locked).toBe(true);
  });
});

describe('reorder', () => {
  it('moves body to new index', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    addBody(r, makeBody('b'));
    addBody(r, makeBody('c'));
    reorder(r, 'c', 0);
    expect(listBodies(r).map(b => b.id)).toEqual(['c', 'a', 'b']);
  });

  it('unknown id returns false', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    expect(reorder(r, 'missing', 0)).toBe(false);
  });
});

describe('combine operations', () => {
  it('union estimate = 0.85 × sum', () => {
    const e = estimateCombineVolume([makeBody('a'), makeBody('b')], 'union');
    expect(e).toBe(2000 * 0.85);
  });

  it('intersect estimate = 0.5 × min', () => {
    const a = makeBody('a', { volumeMm3: 1000 });
    const b = makeBody('b', { volumeMm3: 500 });
    expect(estimateCombineVolume([a, b], 'intersect')).toBe(250);
  });

  it('planCombine returns descriptor + new id', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    addBody(r, makeBody('b'));
    const p = planCombine(r, ['a', 'b'], 'union');
    expect(p?.consumedIds).toEqual(['a', 'b']);
    expect(p?.op).toBe('union');
  });

  it('locked body refuses combine', () => {
    const r = createRegistry();
    addBody(r, makeBody('a', { locked: true }));
    addBody(r, makeBody('b'));
    expect(planCombine(r, ['a', 'b'], 'union')).toBeNull();
  });

  it('single body → null', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    expect(planCombine(r, ['a'], 'union')).toBeNull();
  });
});

describe('split operations', () => {
  it('split body returns 2 halves when keepBoth=true', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    const p = planSplit(r, {
      sourceId: 'a',
      cutPlane: { point: [5, 5, 5], normal: [0, 0, 1] },
      keepBoth: true,
    });
    expect(p?.positiveBodyId).toBeDefined();
    expect(p?.negativeBodyId).toBeDefined();
  });

  it('keepBoth=false → no negative half', () => {
    const r = createRegistry();
    addBody(r, makeBody('a'));
    const p = planSplit(r, {
      sourceId: 'a',
      cutPlane: { point: [5, 5, 5], normal: [0, 0, 1] },
      keepBoth: false,
    });
    expect(p?.negativeBodyId).toBeNull();
  });

  it('locked body refuses split', () => {
    const r = createRegistry();
    addBody(r, makeBody('a', { locked: true }));
    expect(planSplit(r, {
      sourceId: 'a',
      cutPlane: { point: [0, 0, 0], normal: [1, 0, 0] },
      keepBoth: true,
    })).toBeNull();
  });
});

describe('summarizeRegistry', () => {
  it('counts by kind + totals', () => {
    const r = createRegistry();
    addBody(r, makeBody('a', { kind: 'solid', volumeMm3: 1000, surfaceAreaMm2: 600 }));
    addBody(r, makeBody('b', { kind: 'surface', volumeMm3: 0, surfaceAreaMm2: 400 }));
    addBody(r, makeBody('c', { kind: 'solid', volumeMm3: 500, surfaceAreaMm2: 300, locked: true, visible: false }));
    const s = summarizeRegistry(r);
    expect(s.bodyCount).toBe(3);
    expect(s.byKind.solid).toBe(2);
    expect(s.byKind.surface).toBe(1);
    expect(s.totalVolumeMm3).toBe(1500);
    expect(s.visibleCount).toBe(2);
    expect(s.lockedCount).toBe(1);
  });
});
