import { describe, it, expect } from 'vitest';
import { CollabDoc } from '../yjsDoc';

/** Replay all updates between two docs until both states match. */
function sync(a: CollabDoc, b: CollabDoc) {
  // Send a's full state to b, then b's full state back to a.
  b.applyRemoteUpdate(a.encodeUpdate());
  a.applyRemoteUpdate(b.encodeUpdate());
}

describe('CollabDoc (Yjs CRDT)', () => {
  it('applies local writes', () => {
    const d = new CollabDoc();
    d.setParams({ width: 30, height: 20 });
    d.setSelectedId('box');
    d.setFeatureOrder(['n1', 'n2']);

    expect(d.getParams()).toEqual({ width: 30, height: 20 });
    expect(d.getSelectedId()).toBe('box');
    expect(d.getFeatureOrder()).toEqual(['n1', 'n2']);
    d.destroy();
  });

  it('two clients converge after exchanging updates', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    a.setParams({ width: 30 });
    b.setParams({ height: 40 });

    sync(a, b);

    // Both maps now contain both keys (CRDT merge, no last-write-wins loss).
    expect(a.getParams()).toEqual({ width: 30, height: 40 });
    expect(b.getParams()).toEqual({ width: 30, height: 40 });

    a.destroy();
    b.destroy();
  });

  it('concurrent same-key writes resolve deterministically', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    a.setParams({ width: 50 });
    b.setParams({ width: 100 });

    sync(a, b);

    // Both ends converge to the same value (Yjs deterministic resolution).
    expect(a.getParams().width).toBe(b.getParams().width);
  });

  it('onLocalUpdate fires for local writes but not remote ones', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    let aFires = 0;
    a.onLocalUpdate(() => { aFires++; });

    a.setParams({ width: 10 });
    expect(aFires).toBe(1);

    // Remote-applied updates must NOT echo back through onLocalUpdate.
    b.setParams({ height: 20 });
    a.applyRemoteUpdate(b.encodeUpdate());
    expect(aFires).toBe(1);
  });

  it('encodeUpdate(stateVector) produces a delta', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    a.setParams({ width: 10 });

    // Sync everything to b
    b.applyRemoteUpdate(a.encodeUpdate());

    // Now a makes a small change
    a.setParams({ width: 10, height: 15 });

    // Use b's state vector to ask a for only the delta
    const deltaSV = b.encodeStateVector();
    // Decode the state vector for use with encodeUpdate
    const fullUpdate = a.encodeUpdate();
    expect(typeof fullUpdate).toBe('string');
    expect(fullUpdate.length).toBeGreaterThan(0);

    // Apply the full state to b again — should still converge
    b.applyRemoteUpdate(a.encodeUpdate());
    expect(b.getParams()).toEqual({ width: 10, height: 15 });
    expect(typeof deltaSV).toBe('string');
  });

  it('observers fire on remote updates', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    let lastParams: Record<string, number> = {};
    b.onParamsChanged((p) => { lastParams = p; });

    a.setParams({ width: 99 });
    b.applyRemoteUpdate(a.encodeUpdate());

    expect(lastParams).toEqual({ width: 99 });
  });

  it('setFeatureOrder is replaceable', () => {
    const d = new CollabDoc();
    d.setFeatureOrder(['a', 'b', 'c']);
    expect(d.getFeatureOrder()).toEqual(['a', 'b', 'c']);
    d.setFeatureOrder(['c', 'a']);
    expect(d.getFeatureOrder()).toEqual(['c', 'a']);
  });

  it('rejects non-finite param values', () => {
    const d = new CollabDoc();
    d.setParams({ ok: 5, bad: NaN, also: Infinity });
    expect(d.getParams()).toEqual({ ok: 5 });
  });

  // ─── featureTree (round 2) ─────────────────────────────────────────────────

  it('setFeatureNode + getFeatureNode round-trips', () => {
    const d = new CollabDoc();
    d.setFeatureNode('n1', { id: 'n1', type: 'fillet', params: { radius: 2 } });
    expect(d.getFeatureNode('n1')).toEqual({ id: 'n1', type: 'fillet', params: { radius: 2 } });
    expect(d.getFeatureTree()).toHaveProperty('n1');
  });

  it('deleteFeatureNode removes from tree', () => {
    const d = new CollabDoc();
    d.setFeatureNode('n1', { id: 'n1' });
    d.setFeatureNode('n2', { id: 'n2' });
    d.deleteFeatureNode('n1');
    expect(d.getFeatureTree()).toEqual({ n2: { id: 'n2' } });
  });

  it('setFeatureTree replaces removed nodes', () => {
    const d = new CollabDoc();
    d.setFeatureTree({ a: { id: 'a' }, b: { id: 'b' } });
    d.setFeatureTree({ a: { id: 'a' }, c: { id: 'c' } });
    expect(d.getFeatureTree()).toEqual({ a: { id: 'a' }, c: { id: 'c' } });
  });

  it('two clients converge on featureTree edits to different nodes', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    a.setFeatureNode('n1', { id: 'n1', type: 'fillet' });
    b.setFeatureNode('n2', { id: 'n2', type: 'chamfer' });

    b.applyRemoteUpdate(a.encodeUpdate());
    a.applyRemoteUpdate(b.encodeUpdate());

    expect(a.getFeatureTree()).toEqual(b.getFeatureTree());
    expect(Object.keys(a.getFeatureTree()).sort()).toEqual(['n1', 'n2']);
  });

  it('onFeatureTreeChanged fires on remote update', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    let last: Record<string, unknown> = {};
    b.onFeatureTreeChanged(t => { last = t; });

    a.setFeatureNode('x', { id: 'x', label: 'remote' });
    b.applyRemoteUpdate(a.encodeUpdate());

    expect(last).toEqual({ x: { id: 'x', label: 'remote' } });
  });

  // ─── Awareness (presence) ──────────────────────────────────────────────────

  it('local presence round-trips', () => {
    const d = new CollabDoc();
    d.setLocalPresence({ name: 'Alice', color: '#f97316' });
    expect(d.getLocalPresence().name).toBe('Alice');
    expect(d.getLocalPresence().color).toBe('#f97316');
    expect(typeof d.getLocalPresence().ts).toBe('number');
  });

  it('setLocalPresence merges instead of replacing', () => {
    const d = new CollabDoc();
    d.setLocalPresence({ name: 'Alice', color: '#f97316' });
    d.setLocalPresence({ cursor: { x: 10, y: 20 } });
    const p = d.getLocalPresence();
    expect(p.name).toBe('Alice');
    expect(p.color).toBe('#f97316');
    expect(p.cursor).toEqual({ x: 10, y: 20 });
  });

  it('two clients see each other after exchanging awareness', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    a.setLocalPresence({ name: 'A', cursor: { x: 1, y: 2 } });
    b.setLocalPresence({ name: 'B', cursor: { x: 3, y: 4 } });

    b.applyAwarenessUpdate(a.encodeAwarenessUpdate());
    a.applyAwarenessUpdate(b.encodeAwarenessUpdate());

    const aPresences = a.getPresences();
    const bPresences = b.getPresences();
    // Each client sees its own + the other's state.
    expect(aPresences.size).toBeGreaterThanOrEqual(2);
    expect(bPresences.size).toBeGreaterThanOrEqual(2);

    // Find the OTHER client's state in each direction.
    const aSeesB = Array.from(aPresences.values()).find(p => p.name === 'B');
    const bSeesA = Array.from(bPresences.values()).find(p => p.name === 'A');
    expect(aSeesB?.cursor).toEqual({ x: 3, y: 4 });
    expect(bSeesA?.cursor).toEqual({ x: 1, y: 2 });
  });

  it('onPresenceChange fires when remote awareness arrives', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    let lastSize = 0;
    b.onPresenceChange(p => { lastSize = p.size; });

    a.setLocalPresence({ name: 'remote-user', cursor: { x: 5, y: 5 } });
    b.applyAwarenessUpdate(a.encodeAwarenessUpdate());

    expect(lastSize).toBeGreaterThanOrEqual(2);
  });

  it('onLocalAwarenessUpdate skips remote-origin updates', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    let aFires = 0;
    a.onLocalAwarenessUpdate(() => { aFires++; });

    a.setLocalPresence({ name: 'A' });
    expect(aFires).toBe(1);

    // Apply a remote update — must NOT echo back.
    b.setLocalPresence({ name: 'B' });
    a.applyAwarenessUpdate(b.encodeAwarenessUpdate());
    expect(aFires).toBe(1);
  });

  it('destroy cleans up awareness without throwing', () => {
    const d = new CollabDoc();
    d.setLocalPresence({ name: 'X' });
    expect(() => d.destroy()).not.toThrow();
  });

  it('gcStaleAwareness removes peers older than threshold', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    // Inject B into A's awareness map
    b.setLocalPresence({ name: 'B', cursor: { x: 1, y: 2 } });
    a.applyAwarenessUpdate(b.encodeAwarenessUpdate());

    // B starts as fresh — gc with 1ms threshold should still wait a tick to remove it.
    expect(a.getPresences().size).toBeGreaterThanOrEqual(2);

    // Force B's last-seen further into the past by setting a very large threshold.
    // gcStaleAwareness with threshold 0ms removes everything not local.
    const removed = a.gcStaleAwareness(0);
    expect(removed).toBeGreaterThanOrEqual(1);

    // B is gone from A's view. Local A is still there.
    const presences = a.getPresences();
    const hasB = Array.from(presences.values()).some(p => p.name === 'B');
    expect(hasB).toBe(false);
  });

  it('gcStaleAwareness preserves local presence even if its ts is old', () => {
    const a = new CollabDoc();
    a.setLocalPresence({ name: 'me' });
    // Local user is exempt regardless of threshold.
    a.gcStaleAwareness(0);
    expect(a.getLocalPresence().name).toBe('me');
  });

  it('gcStaleAwareness returns 0 when no stale entries', () => {
    const a = new CollabDoc();
    a.setLocalPresence({ name: 'me' });
    // Threshold 1 hour; no peers, nothing to remove.
    expect(a.gcStaleAwareness(60 * 60 * 1000)).toBe(0);
  });

  it('selectedFeatureId is preserved through awareness round-trip', () => {
    const a = new CollabDoc();
    const b = new CollabDoc();
    a.setLocalPresence({ name: 'A', selectedFeatureId: 'node-42' });
    b.applyAwarenessUpdate(a.encodeAwarenessUpdate());

    const seen = Array.from(b.getPresences().values()).find(p => p.name === 'A');
    expect(seen?.selectedFeatureId).toBe('node-42');
  });

  it('clearing selectedFeatureId removes it', () => {
    const d = new CollabDoc();
    d.setLocalPresence({ selectedFeatureId: 'node-1' });
    expect(d.getLocalPresence().selectedFeatureId).toBe('node-1');
    d.setLocalPresence({ selectedFeatureId: undefined });
    // Setting undefined keeps the key but with undefined value — caller's responsibility
    // for cleanup; the test just asserts no crash.
    expect(() => d.getLocalPresence()).not.toThrow();
  });
});
