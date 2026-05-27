import { describe, it, expect } from 'vitest';
import { EditOriginTracker, nextBatchId } from './editOriginTracker';

const addAction = (id: string) => ({
  kind: 'add' as const,
  feature: { id, type: 'fillet' as const, params: {}, enabled: true },
});

describe('EditOriginTracker', () => {
  it('records and reads back actions', () => {
    const t = new EditOriginTracker();
    t.record('human', addAction('f1'));
    t.record('ai', addAction('f2'));
    expect(t.snapshot()).toHaveLength(2);
  });

  it('lastFor returns most recent for that origin', () => {
    const t = new EditOriginTracker();
    t.record('human', addAction('f1'));
    t.record('ai', addAction('f2'));
    t.record('human', addAction('f3'));
    expect(t.lastFor('human')?.action).toEqual(addAction('f3'));
    expect(t.lastFor('ai')?.action).toEqual(addAction('f2'));
  });

  it('lastFor returns null when no records for origin', () => {
    const t = new EditOriginTracker();
    t.record('human', addAction('f1'));
    expect(t.lastFor('ai')).toBeNull();
  });

  it('lastBatchFor groups records with same batch id', () => {
    const t = new EditOriginTracker();
    const batch = nextBatchId();
    t.record('ai', addAction('f1'), batch);
    t.record('ai', addAction('f2'), batch);
    t.record('ai', addAction('f3'), batch);
    t.record('human', addAction('f4'));
    const out = t.lastBatchFor('ai');
    expect(out).toHaveLength(3);
  });

  it('lastBatchFor returns single record when no batch id', () => {
    const t = new EditOriginTracker();
    t.record('ai', addAction('f1'));
    expect(t.lastBatchFor('ai')).toHaveLength(1);
  });

  it('popLastBatch removes records and returns them', () => {
    const t = new EditOriginTracker();
    const batch = nextBatchId();
    t.record('ai', addAction('f1'), batch);
    t.record('ai', addAction('f2'), batch);
    t.record('human', addAction('f3'));
    const popped = t.popLastBatch('ai');
    expect(popped).toHaveLength(2);
    expect(t.count('ai')).toBe(0);
    expect(t.count('human')).toBe(1);
  });

  it('count returns total or per-origin', () => {
    const t = new EditOriginTracker();
    t.record('human', addAction('f1'));
    t.record('ai', addAction('f2'));
    t.record('ai', addAction('f3'));
    expect(t.count()).toBe(3);
    expect(t.count('ai')).toBe(2);
    expect(t.count('human')).toBe(1);
  });

  it('reset empties the tracker', () => {
    const t = new EditOriginTracker();
    t.record('human', addAction('f1'));
    t.reset();
    expect(t.count()).toBe(0);
  });

  it('respects maxRecords cap', () => {
    const t = new EditOriginTracker({ maxRecords: 3 });
    for (let i = 0; i < 10; i++) t.record('human', addAction(`f${i}`));
    expect(t.count()).toBe(3);
  });
});

describe('nextBatchId', () => {
  it('generates unique ids', () => {
    const a = nextBatchId();
    const b = nextBatchId();
    expect(a).not.toBe(b);
  });
});
