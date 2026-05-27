import { describe, it, expect } from 'vitest';
import {
  diffDrawings,
  groupByFeature,
  autoDescribeECN,
  summarize,
  type DrawingSnapshot,
} from './ecnDiffViewer';

function makeSnapshot(rev: string, partial: Partial<DrawingSnapshot> = {}): DrawingSnapshot {
  return {
    drawingId: 'D1',
    revision: rev,
    dimensions: [],
    notes: [],
    gdtCallouts: [],
    views: [],
    titleBlock: {},
    ...partial,
  };
}

describe('diffDrawings', () => {
  it('identical snapshots → no changes', () => {
    const a = makeSnapshot('A');
    const b = makeSnapshot('A');
    expect(diffDrawings(a, b).totalChanges).toBe(0);
  });

  it('added dimension → minor', () => {
    const a = makeSnapshot('A');
    const b = makeSnapshot('B', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.1, minus: 0.1 }] });
    const r = diffDrawings(a, b);
    expect(r.changes.some(c => c.kind === 'dim-added')).toBe(true);
    expect(r.minorCount).toBeGreaterThan(0);
  });

  it('removed dimension → critical', () => {
    const a = makeSnapshot('A', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.1, minus: 0.1 }] });
    const b = makeSnapshot('B');
    const r = diffDrawings(a, b);
    expect(r.changes.some(c => c.kind === 'dim-removed' && c.severity === 'critical')).toBe(true);
  });

  it('changed nominal → major', () => {
    const a = makeSnapshot('A', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.1, minus: 0.1 }] });
    const b = makeSnapshot('B', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 11, plus: 0.1, minus: 0.1 }] });
    const r = diffDrawings(a, b);
    expect(r.changes.some(c => c.kind === 'dim-value-changed' && c.severity === 'major')).toBe(true);
  });

  it('loosened tolerance → critical', () => {
    const a = makeSnapshot('A', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.05, minus: 0.05 }] });
    const b = makeSnapshot('B', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.1, minus: 0.1 }] });
    const r = diffDrawings(a, b);
    expect(r.changes.some(c => c.kind === 'dim-tol-changed' && c.severity === 'critical')).toBe(true);
  });

  it('tightened tolerance → major (not critical)', () => {
    const a = makeSnapshot('A', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.1, minus: 0.1 }] });
    const b = makeSnapshot('B', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.05, minus: 0.05 }] });
    const r = diffDrawings(a, b);
    expect(r.changes.some(c => c.kind === 'dim-tol-changed' && c.severity === 'major')).toBe(true);
  });

  it('removed GD&T → critical', () => {
    const a = makeSnapshot('A', { gdtCallouts: [{ id: 'g1', symbol: 'position', toleranceMm: 0.1, datumChain: ['A', 'B', 'C'] }] });
    const b = makeSnapshot('B');
    const r = diffDrawings(a, b);
    expect(r.changes.some(c => c.kind === 'gdt-removed' && c.severity === 'critical')).toBe(true);
  });

  it('note edited → minor', () => {
    const a = makeSnapshot('A', { notes: [{ id: 'n1', text: 'old' }] });
    const b = makeSnapshot('B', { notes: [{ id: 'n1', text: 'new' }] });
    expect(diffDrawings(a, b).changes.some(c => c.kind === 'note-edited')).toBe(true);
  });

  it('view added → minor', () => {
    const a = makeSnapshot('A', { views: ['front'] });
    const b = makeSnapshot('B', { views: ['front', 'top'] });
    expect(diffDrawings(a, b).changes.some(c => c.kind === 'view-added')).toBe(true);
  });

  it('title-block field changed', () => {
    const a = makeSnapshot('A', { titleBlock: { drawnBy: 'Alice' } });
    const b = makeSnapshot('B', { titleBlock: { drawnBy: 'Bob' } });
    expect(diffDrawings(a, b).changes.some(c => c.kind === 'titleblock-changed')).toBe(true);
  });

  it('revision labels passed through', () => {
    const r = diffDrawings(makeSnapshot('A'), makeSnapshot('B'));
    expect(r.fromRevision).toBe('A');
    expect(r.toRevision).toBe('B');
  });
});

describe('groupByFeature', () => {
  it('groups dimension changes by featureId', () => {
    const a = makeSnapshot('A', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.1, minus: 0.1 }] });
    const b = makeSnapshot('B', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 11, plus: 0.1, minus: 0.1 }] });
    const groups = groupByFeature(diffDrawings(a, b));
    expect(groups.has('F1')).toBe(true);
  });
});

describe('autoDescribeECN', () => {
  it('produces a description string', () => {
    const a = makeSnapshot('A', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.05, minus: 0.05 }] });
    const b = makeSnapshot('B', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.1, minus: 0.1 }] });
    const text = autoDescribeECN(diffDrawings(a, b));
    expect(text).toContain('A → B');
    expect(text).toContain('critical');
  });
});

describe('summarize', () => {
  it('reports counts + hasBreakingChanges', () => {
    const a = makeSnapshot('A', { dimensions: [{ id: 'd1', featureId: 'F1', nominal: 10, plus: 0.05, minus: 0.05 }] });
    const b = makeSnapshot('B');
    const s = summarize(diffDrawings(a, b));
    expect(s.criticalCount).toBeGreaterThan(0);
    expect(s.hasBreakingChanges).toBe(true);
  });

  it('no changes → not breaking', () => {
    const s = summarize(diffDrawings(makeSnapshot('A'), makeSnapshot('B')));
    expect(s.hasBreakingChanges).toBe(false);
  });
});
