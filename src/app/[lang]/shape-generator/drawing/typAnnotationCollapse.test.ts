import { describe, it, expect } from 'vitest';
import {
  collapseDimensions,
  expandCallouts,
  summarize,
  type DimensionEntity,
} from './typAnnotationCollapse';

function dim(id: string, value: string, kind: DimensionEntity['featureKind'] = 'hole', tolerance?: string, x?: number, y?: number): DimensionEntity {
  const d: DimensionEntity = { id, value, featureKind: kind };
  if (tolerance !== undefined) d.tolerance = tolerance;
  if (x !== undefined && y !== undefined) d.position = { x, y };
  return d;
}

describe('collapseDimensions', () => {
  it('empty input → empty result', () => {
    const r = collapseDimensions([]);
    expect(r.callouts).toEqual([]);
    expect(r.unique).toEqual([]);
  });

  it('groups identical dimensions', () => {
    const dims = [
      dim('h1', 'Ø6.5'),
      dim('h2', 'Ø6.5'),
      dim('h3', 'Ø6.5'),
    ];
    const r = collapseDimensions(dims);
    expect(r.callouts).toHaveLength(1);
    expect(r.callouts[0]!.quantity).toBe(3);
  });

  it('different values → separate callouts', () => {
    const dims = [
      dim('h1', 'Ø6.5'),
      dim('h2', 'Ø8'),
    ];
    const r = collapseDimensions(dims);
    expect(r.callouts).toHaveLength(0);
    expect(r.unique).toHaveLength(2);
  });

  it('different tolerances → separate', () => {
    const dims = [
      dim('h1', 'Ø6.5', 'hole', 'H7'),
      dim('h2', 'Ø6.5', 'hole', 'H8'),
    ];
    const r = collapseDimensions(dims);
    expect(r.callouts).toHaveLength(0);
    expect(r.unique).toHaveLength(2);
  });

  it('minCount respected', () => {
    const dims = [dim('h1', 'Ø6.5'), dim('h2', 'Ø6.5')];
    const tight = collapseDimensions(dims, { minCount: 3 });
    expect(tight.callouts).toHaveLength(0);
    expect(tight.unique).toHaveLength(2);
  });

  it('TYP label when preferred', () => {
    const dims = [dim('h1', 'M6'), dim('h2', 'M6')];
    const r = collapseDimensions(dims, { preferTypLabel: true });
    expect(r.callouts[0]!.displayLabel).toContain('TYP');
  });

  it('"PLACES" label by default', () => {
    const dims = [dim('h1', 'Ø6.5'), dim('h2', 'Ø6.5')];
    const r = collapseDimensions(dims, { preferTypLabel: false });
    expect(r.callouts[0]!.displayLabel).toContain('PLACES');
  });

  it('spatial cluster keeps far-apart dimensions separate', () => {
    const dims = [
      dim('h1', 'Ø6.5', 'hole', undefined, 0, 0),
      dim('h2', 'Ø6.5', 'hole', undefined, 5, 0),
      dim('h3', 'Ø6.5', 'hole', undefined, 1000, 0),
    ];
    const r = collapseDimensions(dims, { spatialClusterDistance: 100 });
    // h1+h2 collapse, h3 is far away (unique).
    expect(r.callouts.length + r.unique.length).toBeGreaterThan(1);
  });

  it('suppressed ids tracked', () => {
    const dims = [dim('h1', 'Ø6.5'), dim('h2', 'Ø6.5'), dim('h3', 'Ø6.5')];
    const r = collapseDimensions(dims);
    expect(r.callouts[0]!.suppressedIds).toContain('h2');
    expect(r.callouts[0]!.suppressedIds).toContain('h3');
  });

  it('total suppressed count', () => {
    const dims = [
      dim('a1', 'Ø6'), dim('a2', 'Ø6'), dim('a3', 'Ø6'),
      dim('b1', 'M8'), dim('b2', 'M8'),
    ];
    const r = collapseDimensions(dims);
    expect(r.suppressedCount).toBe(3);
  });
});

describe('expandCallouts', () => {
  it('returns flat list including suppressed entries', () => {
    const dims = [dim('a', 'Ø6'), dim('b', 'Ø6')];
    const r = collapseDimensions(dims);
    const expanded = expandCallouts(r);
    expect(expanded).toHaveLength(2);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize([], collapseDimensions([]));
    expect(s.beforeCount).toBe(0);
  });

  it('collapse ratio < 1 means collapsed', () => {
    const dims = [dim('h1', 'Ø6'), dim('h2', 'Ø6'), dim('h3', 'Ø6')];
    const s = summarize(dims, collapseDimensions(dims));
    expect(s.collapseRatio).toBeLessThan(1);
  });

  it('largest quantity reported', () => {
    const dims = [dim('h1', 'Ø6'), dim('h2', 'Ø6'), dim('h3', 'Ø6')];
    const s = summarize(dims, collapseDimensions(dims));
    expect(s.largestQuantity).toBe(3);
  });
});
