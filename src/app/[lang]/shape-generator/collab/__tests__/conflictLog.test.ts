import { describe, it, expect, vi } from 'vitest';
import { ConflictDetector } from '../conflictLog';

describe('ConflictDetector · basic flow', () => {
  it('emits a conflict when a different user overwrites our intent', () => {
    const det = new ConflictDetector();
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'mate.m1.distance', value: 25, timestamp: 1000 });
    det.observeChange('mate.m1.distance', 50, 'bob', 1500);
    expect(events).toHaveLength(1);
  });

  it('does not emit when our own intent is observed back (echo)', () => {
    const det = new ConflictDetector();
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'mate.m1.distance', value: 25, timestamp: 1000 });
    det.observeChange('mate.m1.distance', 25, 'alice', 1100);
    expect(events).toHaveLength(0);
  });

  it('does not emit when observed value matches our intent (already converged)', () => {
    const det = new ConflictDetector();
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'f', value: 50, timestamp: 1000 });
    det.observeChange('f', 50, 'bob', 1500);
    expect(events).toHaveLength(0);
  });

  it('does not emit outside the conflict window', () => {
    const det = new ConflictDetector();
    det.conflictWindowMs = 1000;
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'f', value: 50, timestamp: 1000 });
    det.observeChange('f', 100, 'bob', 5000); // 4s later
    expect(events).toHaveLength(0);
  });

  it('reports winner = null when the change origin is unknown', () => {
    const det = new ConflictDetector();
    let event: unknown = null;
    det.onConflict(e => { event = e; });
    det.recordIntent({ userId: 'alice', field: 'f', value: 1, timestamp: 1000 });
    det.observeChange('f', 2, null, 1500);
    expect((event as { winnerUserId: string | null }).winnerUserId).toBeNull();
  });
});

describe('ConflictDetector · idempotency', () => {
  it('clears intent after firing, so a second observation does not double-fire', () => {
    const det = new ConflictDetector();
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'f', value: 1, timestamp: 1000 });
    det.observeChange('f', 2, 'bob', 1500);
    det.observeChange('f', 3, 'bob', 1600);
    expect(events).toHaveLength(1);
  });

  it('clearIntent removes a pending intent without firing', () => {
    const det = new ConflictDetector();
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'f', value: 1, timestamp: 1000 });
    det.clearIntent('f');
    det.observeChange('f', 2, 'bob', 1500);
    expect(events).toHaveLength(0);
  });

  it('reset drops every pending intent', () => {
    const det = new ConflictDetector();
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'a', value: 1, timestamp: 1000 });
    det.recordIntent({ userId: 'alice', field: 'b', value: 2, timestamp: 1000 });
    det.reset();
    det.observeChange('a', 99, 'bob', 1500);
    det.observeChange('b', 99, 'bob', 1500);
    expect(events).toHaveLength(0);
  });
});

describe('ConflictDetector · listeners', () => {
  it('onConflict returns an unsubscribe function', () => {
    const det = new ConflictDetector();
    const fn = vi.fn();
    const off = det.onConflict(fn);
    off();
    det.recordIntent({ userId: 'alice', field: 'f', value: 1, timestamp: 1000 });
    det.observeChange('f', 2, 'bob', 1500);
    expect(fn).not.toHaveBeenCalled();
  });

  it('supports multiple listeners simultaneously', () => {
    const det = new ConflictDetector();
    const a = vi.fn();
    const b = vi.fn();
    det.onConflict(a);
    det.onConflict(b);
    det.recordIntent({ userId: 'alice', field: 'f', value: 1, timestamp: 1000 });
    det.observeChange('f', 2, 'bob', 1500);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('ConflictDetector · deep-equality', () => {
  it('treats deeply-equal object values as echoes (no conflict)', () => {
    const det = new ConflictDetector();
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'pose', value: { x: 1, y: 2 }, timestamp: 1000 });
    det.observeChange('pose', { x: 1, y: 2 }, 'bob', 1500);
    expect(events).toHaveLength(0);
  });

  it('treats NaN === NaN as equal (no conflict)', () => {
    const det = new ConflictDetector();
    const events: unknown[] = [];
    det.onConflict(e => events.push(e));
    det.recordIntent({ userId: 'alice', field: 'x', value: NaN, timestamp: 1000 });
    det.observeChange('x', NaN, 'bob', 1500);
    expect(events).toHaveLength(0);
  });
});
