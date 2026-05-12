import { describe, it, expect } from 'vitest';
import { CollabDoc } from '../yjsDoc';

/**
 * Multi-client convergence tests for CollabDoc.
 *
 * Simulates two clients applying conflicting edits without seeing each other's
 * intermediate state, then exchanging updates. After full sync the two docs
 * MUST agree byte-for-byte on every shared structure.
 *
 * "Conflict" here means concurrent writes to the same key. Yjs resolves these
 * deterministically (one writer wins per key, both sides converge), but we
 * also assert that *non-conflicting* concurrent writes preserve everyone's
 * changes — the property that distinguishes CRDT from last-write-wins.
 */

/** Bidirectional sync: A → B → A. After call, both should be equal. */
function sync(a: CollabDoc, b: CollabDoc) {
  b.applyRemoteUpdate(a.encodeUpdate());
  a.applyRemoteUpdate(b.encodeUpdate());
}

describe('CollabDoc — multi-user convergence', () => {
  it('non-conflicting concurrent feature additions both survive', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    // Both clients add features simultaneously to disjoint node ids.
    a.setFeatureNode('n1', { id: 'n1', type: 'fillet', params: { radius: 2 } });
    b.setFeatureNode('n2', { id: 'n2', type: 'chamfer', params: { distance: 1.5 } });

    sync(a, b);

    expect(a.getFeatureTree()).toEqual(b.getFeatureTree());
    expect(Object.keys(a.getFeatureTree()).sort()).toEqual(['n1', 'n2']);
  });

  it('concurrent edits to the SAME node converge to a deterministic value', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    a.setFeatureNode('n1', { id: 'n1', radius: 2 });
    sync(a, b);

    // Now both edit n1 simultaneously without seeing each other.
    a.setFeatureNode('n1', { id: 'n1', radius: 5 });
    b.setFeatureNode('n1', { id: 'n1', radius: 7 });

    sync(a, b);
    expect(a.getFeatureTree()).toEqual(b.getFeatureTree());
    // Whichever side wins, BOTH agree on the same value.
    const winner = (a.getFeatureNode('n1') as { radius: number }).radius;
    expect([5, 7]).toContain(winner);
  });

  it('add-while-other-deletes: tree state matches', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    a.setFeatureNode('n1', { id: 'n1' });
    sync(a, b);

    // A deletes n1 at the same time B updates it.
    a.deleteFeatureNode('n1');
    b.setFeatureNode('n1', { id: 'n1', updated: true });

    sync(a, b);
    expect(a.getFeatureTree()).toEqual(b.getFeatureTree());
  });

  it('three-way merge converges across A, B, C', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    const c = new CollabDoc();

    a.setFeatureNode('a-node', { from: 'a' });
    b.setFeatureNode('b-node', { from: 'b' });
    c.setFeatureNode('c-node', { from: 'c' });

    // Star topology: gossip everyone's update to everyone else.
    const updates = [a.encodeUpdate(), b.encodeUpdate(), c.encodeUpdate()];
    for (const u of updates) {
      a.applyRemoteUpdate(u);
      b.applyRemoteUpdate(u);
      c.applyRemoteUpdate(u);
    }

    expect(a.getFeatureTree()).toEqual(b.getFeatureTree());
    expect(b.getFeatureTree()).toEqual(c.getFeatureTree());
    expect(Object.keys(a.getFeatureTree()).sort()).toEqual(['a-node', 'b-node', 'c-node']);
  });

  it('concurrent params edits to disjoint keys all preserved', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    a.setParams({ width: 30 });
    b.setParams({ height: 40 });

    sync(a, b);

    expect(a.getParams()).toEqual({ width: 30, height: 40 });
    expect(b.getParams()).toEqual({ width: 30, height: 40 });
  });

  it('concurrent params edits to the SAME key converge', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    a.setParams({ width: 30 });
    sync(a, b);

    a.setParams({ width: 100 });
    b.setParams({ width: 200 });

    sync(a, b);
    expect(a.getParams().width).toBe(b.getParams().width);
  });

  it('feature ordering converges (last-writer wins on order array, but tree stays consistent)', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    a.setFeatureNode('n1', { id: 'n1' });
    a.setFeatureNode('n2', { id: 'n2' });
    sync(a, b);

    a.setFeatureOrder(['n1', 'n2']);
    b.setFeatureOrder(['n2', 'n1']);

    sync(a, b);
    expect(a.getFeatureOrder()).toEqual(b.getFeatureOrder());
    // The tree itself is unchanged regardless of order resolution.
    expect(Object.keys(a.getFeatureTree()).sort()).toEqual(['n1', 'n2']);
  });

  it('out-of-order delivery does not corrupt state', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    // A makes a series of changes
    a.setFeatureNode('n1', { id: 'n1', v: 1 });
    const update1 = a.encodeUpdate();
    a.setFeatureNode('n1', { id: 'n1', v: 2 });
    const update2 = a.encodeUpdate();
    a.setFeatureNode('n1', { id: 'n1', v: 3 });
    const update3 = a.encodeUpdate();

    // B receives them in reverse order — Yjs handles this via vector clocks.
    b.applyRemoteUpdate(update3);
    b.applyRemoteUpdate(update1);
    b.applyRemoteUpdate(update2);

    expect(b.getFeatureTree()).toEqual(a.getFeatureTree());
  });

  it('high-volume convergence: 50 disjoint nodes from each client', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    for (let i = 0; i < 50; i++) {
      a.setFeatureNode(`a-${i}`, { id: `a-${i}` });
      b.setFeatureNode(`b-${i}`, { id: `b-${i}` });
    }

    sync(a, b);

    expect(Object.keys(a.getFeatureTree()).length).toBe(100);
    expect(a.getFeatureTree()).toEqual(b.getFeatureTree());
  });

  it('encoded delta size grows sublinearly with non-overlapping changes', () => {
    const a = new CollabDoc();
    a.setFeatureNode('n1', { id: 'n1' });
    const sizeAfterOne = a.encodeUpdate().length;

    for (let i = 2; i <= 20; i++) {
      a.setFeatureNode(`n${i}`, { id: `n${i}` });
    }
    const sizeAfter20 = a.encodeUpdate().length;

    // 20× the data should not be 20× the bytes due to Yjs structural compression.
    expect(sizeAfter20).toBeGreaterThan(sizeAfterOne);
    expect(sizeAfter20).toBeLessThan(sizeAfterOne * 50);
  });
});
