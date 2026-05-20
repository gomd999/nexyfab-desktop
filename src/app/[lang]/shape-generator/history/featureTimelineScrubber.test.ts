import { describe, it, expect } from 'vitest';
import {
  FeatureTimelineScrubber,
  diffScrubPositions,
  type FeatureRecord,
} from './featureTimelineScrubber';

function f(id: string, index: number, opts: Partial<FeatureRecord> = {}): FeatureRecord {
  return { id, index, name: id, kind: 'op', ...opts };
}

describe('FeatureTimelineScrubber — setup', () => {
  it('sorts features by index', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('b', 1), f('a', 0)]);
    expect(s.getFeatures()[0]!.id).toBe('a');
  });

  it('initial currentIndex = last', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1), f('c', 2)]);
    expect(s.getState().currentIndex).toBe(2);
  });

  it('empty → currentIndex = -1', () => {
    const s = new FeatureTimelineScrubber();
    expect(s.getState().currentIndex).toBe(-1);
  });
});

describe('scrubTo + step', () => {
  it('scrubTo clamps to valid range', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1)]);
    s.scrubTo(99);
    expect(s.getState().currentIndex).toBe(1);
    s.scrubTo(-10);
    expect(s.getState().currentIndex).toBe(-1);
  });

  it('step(1) advances', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1)]);
    s.scrubTo(0);
    s.step(1);
    expect(s.getState().currentIndex).toBe(1);
  });

  it('activeFeatureIds reflects scrub position', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1), f('c', 2)]);
    s.scrubTo(0);
    expect(s.getState().activeFeatureIds).toEqual(['a']);
    s.scrubTo(2);
    expect(s.getState().activeFeatureIds).toEqual(['a', 'b', 'c']);
  });
});

describe('suppression', () => {
  it('suppressed feature drops out of active list', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1, { suppressed: true }), f('c', 2)]);
    expect(s.getState().activeFeatureIds).toEqual(['a', 'c']);
  });

  it('toggleSuppressed flips state', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1)]);
    s.toggleSuppressed('a');
    expect(s.getState().activeFeatureIds).toEqual(['b']);
  });
});

describe('dependencies', () => {
  it('feature with unmet dep is skipped', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([
      f('a', 0, { suppressed: true }),
      f('b', 1, { dependencyIds: ['a'] }),
    ]);
    expect(s.getState().activeFeatureIds).toEqual([]);
  });
});

describe('append + remove', () => {
  it('appendFeature jumps currentIndex to new last', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0)]);
    s.appendFeature(f('b', 1));
    expect(s.getState().currentIndex).toBe(1);
  });

  it('removeFeature re-indexes', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1), f('c', 2)]);
    s.removeFeature('b');
    const feats = s.getFeatures();
    expect(feats[1]!.index).toBe(1);
    expect(feats[1]!.id).toBe('c');
  });
});

describe('snapshots', () => {
  it('storeSnapshot writes to feature', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0)]);
    s.storeSnapshot('a', { data: { vertCount: 100 }, approximateBytes: 1024 });
    expect(s.featureAt(0)!.snapshot?.approximateBytes).toBe(1024);
  });

  it('getCurrentSnapshot returns latest stored', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1)]);
    s.storeSnapshot('a', { data: 'A', approximateBytes: 10 });
    s.scrubTo(1);
    expect(s.getCurrentSnapshot()?.data).toBe('A');
    s.storeSnapshot('b', { data: 'B', approximateBytes: 20 });
    expect(s.getCurrentSnapshot()?.data).toBe('B');
  });

  it('snapshotMemoryBytes sums all', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1)]);
    s.storeSnapshot('a', { data: '', approximateBytes: 100 });
    s.storeSnapshot('b', { data: '', approximateBytes: 250 });
    expect(s.snapshotMemoryBytes()).toBe(350);
  });

  it('sparsifyTo respects key-frame stride and tail', () => {
    const s = new FeatureTimelineScrubber();
    const feats = Array.from({ length: 20 }, (_, i) => f(`f${i}`, i));
    s.setFeatures(feats);
    for (const ft of feats) {
      s.storeSnapshot(ft.id, { data: ft.id, approximateBytes: 100 });
    }
    s.sparsifyTo(500, 5, 3);
    const remaining = s.getFeatures().filter(x => x.snapshot).length;
    expect(remaining).toBeLessThan(20);
  });
});

describe('observers', () => {
  it('onChange fires on scrub', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1)]);
    let count = 0;
    s.onChange(() => { count++; });
    s.scrubTo(0);
    expect(count).toBeGreaterThan(0);
  });

  it('unsubscribe stops notifications', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0)]);
    let count = 0;
    const off = s.onChange(() => { count++; });
    off();
    s.scrubTo(0);
    expect(count).toBe(0);
  });
});

describe('diffScrubPositions', () => {
  it('forward scrub → only added features', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1), f('c', 2)]);
    const d = diffScrubPositions(s, 0, 2);
    expect(d.added.sort()).toEqual(['b', 'c']);
    expect(d.removed).toEqual([]);
  });

  it('backward scrub → only removed', () => {
    const s = new FeatureTimelineScrubber();
    s.setFeatures([f('a', 0), f('b', 1)]);
    const d = diffScrubPositions(s, 1, 0);
    expect(d.removed).toEqual(['b']);
  });
});
