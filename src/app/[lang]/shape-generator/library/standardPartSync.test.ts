import { describe, it, expect } from 'vitest';
import {
  diffCatalog,
  mergeCatalog,
  statsOf,
  summarize,
  type StandardPart,
} from './standardPartSync';

function part(id: string, rev: number, extra: Partial<StandardPart> = {}): StandardPart {
  return {
    id,
    partNumber: `PN-${id}`,
    revision: rev,
    category: 'fastener',
    properties: {},
    ...extra,
  };
}

describe('diffCatalog', () => {
  it('empty local + empty remote → empty diff', () => {
    const d = diffCatalog([], []);
    expect(d.added).toEqual([]);
    expect(d.updated).toEqual([]);
  });

  it('new remote entries reported as added', () => {
    const d = diffCatalog([], [part('a', 1)]);
    expect(d.added).toHaveLength(1);
  });

  it('higher revision reported as updated', () => {
    const d = diffCatalog([part('a', 1)], [part('a', 2)]);
    expect(d.updated).toHaveLength(1);
  });

  it('locally modified part conflicts with remote update', () => {
    const d = diffCatalog([part('a', 1, { locallyModified: true })], [part('a', 2)]);
    expect(d.conflicts).toHaveLength(1);
    expect(d.updated).toHaveLength(0);
  });

  it('obsolete flag picked up', () => {
    const d = diffCatalog([part('a', 1)], [part('a', 1, { obsolete: true })]);
    expect(d.obsoleted).toHaveLength(1);
  });

  it('same revision → no diff', () => {
    const d = diffCatalog([part('a', 1)], [part('a', 1)]);
    expect(d.added.length + d.updated.length + d.obsoleted.length + d.conflicts.length).toBe(0);
  });

  it('local-only parts are not reported', () => {
    const d = diffCatalog([part('a', 1)], []);
    expect(d.added).toEqual([]);
    expect(d.updated).toEqual([]);
  });
});

describe('mergeCatalog', () => {
  it('new remote part is added to merged', () => {
    const r = mergeCatalog([], [part('a', 1)]);
    expect(r.merged.map(p => p.id)).toContain('a');
  });

  it('updated revision replaces local', () => {
    const r = mergeCatalog([part('a', 1)], [part('a', 2)]);
    const merged = r.merged.find(p => p.id === 'a')!;
    expect(merged.revision).toBe(2);
  });

  it('prefer-local keeps local on conflict', () => {
    const r = mergeCatalog(
      [part('a', 1, { locallyModified: true })],
      [part('a', 2)],
      { conflictPolicy: 'prefer-local' },
    );
    const merged = r.merged.find(p => p.id === 'a')!;
    expect(merged.revision).toBe(1);
  });

  it('prefer-remote takes remote on conflict', () => {
    const r = mergeCatalog(
      [part('a', 1, { locallyModified: true })],
      [part('a', 2)],
      { conflictPolicy: 'prefer-remote' },
    );
    const merged = r.merged.find(p => p.id === 'a')!;
    expect(merged.revision).toBe(2);
  });

  it('newest-revision picks remote when remote newer', () => {
    const r = mergeCatalog(
      [part('a', 1, { locallyModified: true })],
      [part('a', 5)],
      { conflictPolicy: 'newest-revision' },
    );
    const merged = r.merged.find(p => p.id === 'a')!;
    expect(merged.revision).toBe(5);
  });

  it('pruneObsolete removes obsolete entries', () => {
    const r = mergeCatalog([part('a', 1)], [part('a', 1, { obsolete: true })], { pruneObsolete: true });
    expect(r.merged.find(p => p.id === 'a')).toBeUndefined();
  });

  it('obsolete kept but flagged when pruneObsolete=false', () => {
    const r = mergeCatalog([part('a', 1)], [part('a', 1, { obsolete: true })], { pruneObsolete: false });
    const merged = r.merged.find(p => p.id === 'a')!;
    expect(merged.obsolete).toBe(true);
  });

  it('reports conflict resolutions', () => {
    const r = mergeCatalog(
      [part('a', 1, { locallyModified: true })],
      [part('a', 2)],
    );
    expect(r.resolutions).toHaveLength(1);
  });
});

describe('statsOf', () => {
  it('counts total + obsolete + locally modified', () => {
    const s = statsOf([
      part('a', 1),
      part('b', 1, { obsolete: true }),
      part('c', 1, { locallyModified: true }),
    ]);
    expect(s.totalParts).toBe(3);
    expect(s.obsoleteCount).toBe(1);
    expect(s.locallyModifiedCount).toBe(1);
  });

  it('groups by category', () => {
    const s = statsOf([
      part('a', 1, { category: 'fastener' }),
      part('b', 1, { category: 'bearing' }),
      part('c', 1, { category: 'fastener' }),
    ]);
    expect(s.categories['fastener']).toBe(2);
    expect(s.categories['bearing']).toBe(1);
  });
});

describe('summarize', () => {
  it('no-change scenario flagged', () => {
    const r = mergeCatalog([part('a', 1)], [part('a', 1)]);
    const s = summarize(r);
    expect(s.noChange).toBe(true);
  });

  it('counts deltas', () => {
    const r = mergeCatalog([], [part('a', 1), part('b', 1)]);
    const s = summarize(r);
    expect(s.addedCount).toBe(2);
    expect(s.totalAfterMerge).toBe(2);
  });
});
