import { describe, it, expect } from 'vitest';
import {
  SelectionSetManager,
  filterByRule,
  summarize,
  type ElementMetadata,
} from './selectionSetManager';

describe('SelectionSetManager — CRUD', () => {
  it('createSet stores it', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 's1', name: 'Top faces', kind: 'face' });
    expect(m.get('s1')?.name).toBe('Top faces');
  });

  it('deleteSet removes it', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 's1', name: 'x', kind: 'face' });
    m.deleteSet('s1');
    expect(m.get('s1')).toBeNull();
  });

  it('renameSet updates name + timestamp', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 's1', name: 'old', kind: 'face' });
    m.renameSet('s1', 'new');
    expect(m.get('s1')?.name).toBe('new');
  });

  it('listByKind filters by element kind', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 'f1', name: 'faces', kind: 'face' });
    m.createSet({ id: 'e1', name: 'edges', kind: 'edge' });
    expect(m.listByKind('face')).toHaveLength(1);
  });
});

describe('membership', () => {
  it('addToSet adds elements', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 's1', name: 'x', kind: 'face' });
    m.addToSet('s1', ['f1', 'f2']);
    expect(m.get('s1')?.elementIds.size).toBe(2);
  });

  it('removeFromSet drops elements', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 's1', name: 'x', kind: 'face', elementIds: ['f1', 'f2', 'f3'] });
    m.removeFromSet('s1', ['f2']);
    expect(m.get('s1')?.elementIds.has('f2')).toBe(false);
  });

  it('setMembership replaces all', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 's1', name: 'x', kind: 'face', elementIds: ['old'] });
    m.setMembership('s1', ['new']);
    expect([...m.get('s1')!.elementIds]).toEqual(['new']);
  });
});

describe('rules', () => {
  const elements: ElementMetadata[] = [
    { id: 'top', kind: 'face', direction: [0, 0, 1], areaMm2: 100, tags: ['outer'] },
    { id: 'bot', kind: 'face', direction: [0, 0, -1], areaMm2: 100 },
    { id: 'side', kind: 'face', direction: [1, 0, 0], areaMm2: 50, tags: ['outer'] },
    { id: 'tiny', kind: 'face', direction: [0, 1, 0], areaMm2: 1 },
    { id: 'e1', kind: 'edge', convexity: 'convex' },
    { id: 'e2', kind: 'edge', convexity: 'concave' },
  ];

  it('all-elements matches every face', () => {
    expect(filterByRule({ kind: 'all-elements' }, 'face', elements)).toHaveLength(4);
  });

  it('by-tag matches tagged faces', () => {
    const r = filterByRule({ kind: 'by-tag', tag: 'outer' }, 'face', elements);
    expect(r).toEqual(['top', 'side']);
  });

  it('planar-facing picks +Z faces', () => {
    const r = filterByRule({ kind: 'planar-facing', direction: [0, 0, 1], toleranceDeg: 10 }, 'face', elements);
    expect(r).toEqual(['top']);
  });

  it('edge-convexity convex picks convex edges', () => {
    const r = filterByRule({ kind: 'edge-convexity', convexity: 'convex' }, 'edge', elements);
    expect(r).toEqual(['e1']);
  });

  it('min-area filters small faces', () => {
    const r = filterByRule({ kind: 'min-area', minMm2: 50 }, 'face', elements);
    expect(r.sort()).toEqual(['bot', 'side', 'top']);
  });

  it('max-area picks tiny faces', () => {
    expect(filterByRule({ kind: 'max-area', maxMm2: 10 }, 'face', elements)).toEqual(['tiny']);
  });

  it('resolveRule mutates set membership', () => {
    const m = new SelectionSetManager();
    m.createSet({
      id: 's1', name: 'top-faces', kind: 'face',
      rule: { kind: 'planar-facing', direction: [0, 0, 1], toleranceDeg: 10 },
    });
    m.resolveRule('s1', elements);
    expect([...m.get('s1')!.elementIds]).toEqual(['top']);
  });

  it('resolveAllRules updates every rule-based set', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 'a', name: 'top', kind: 'face', rule: { kind: 'planar-facing', direction: [0, 0, 1], toleranceDeg: 10 } });
    m.createSet({ id: 'b', name: 'tiny', kind: 'face', rule: { kind: 'max-area', maxMm2: 10 } });
    m.resolveAllRules(elements);
    expect(m.get('a')!.elementIds.size).toBe(1);
    expect(m.get('b')!.elementIds.size).toBe(1);
  });
});

describe('set operations', () => {
  it('union merges members', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 'a', name: 'A', kind: 'face', elementIds: ['f1', 'f2'] });
    m.createSet({ id: 'b', name: 'B', kind: 'face', elementIds: ['f2', 'f3'] });
    const u = m.union('a', 'b', 'u', 'AuB');
    expect([...u!.elementIds].sort()).toEqual(['f1', 'f2', 'f3']);
  });

  it('intersect → common members', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 'a', name: 'A', kind: 'face', elementIds: ['f1', 'f2'] });
    m.createSet({ id: 'b', name: 'B', kind: 'face', elementIds: ['f2', 'f3'] });
    const i = m.intersect('a', 'b', 'i', 'AnB');
    expect([...i!.elementIds]).toEqual(['f2']);
  });

  it('subtract → A minus B', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 'a', name: 'A', kind: 'face', elementIds: ['f1', 'f2'] });
    m.createSet({ id: 'b', name: 'B', kind: 'face', elementIds: ['f2', 'f3'] });
    const s = m.subtract('a', 'b', 's', 'A-B');
    expect([...s!.elementIds]).toEqual(['f1']);
  });

  it('kind mismatch returns null', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 'a', name: 'A', kind: 'face' });
    m.createSet({ id: 'b', name: 'B', kind: 'edge' });
    expect(m.union('a', 'b', 'u', 'u')).toBeNull();
  });
});

describe('serialization', () => {
  it('round-trips sets', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 's1', name: 'Top', kind: 'face', elementIds: ['f1', 'f2'] });
    const json = m.serialize();
    const m2 = new SelectionSetManager();
    m2.load(json);
    expect([...m2.get('s1')!.elementIds].sort()).toEqual(['f1', 'f2']);
  });

  it('rejects unknown version', () => {
    const m = new SelectionSetManager();
    expect(() => m.load({ version: 99, sets: [] })).toThrow();
  });
});

describe('summarize', () => {
  it('counts sets + rules', () => {
    const m = new SelectionSetManager();
    m.createSet({ id: 's1', name: 'A', kind: 'face', elementIds: ['f1'] });
    m.createSet({ id: 's2', name: 'B', kind: 'face', rule: { kind: 'all-elements' } });
    const s = summarize(m);
    expect(s.setCount).toBe(2);
    expect(s.setsWithRules).toBe(1);
    expect(s.totalElementReferences).toBe(1);
  });
});
