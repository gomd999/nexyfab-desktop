import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  setPresencePatch,
  readRemotePresences,
  activePresences,
  findEditingPeer,
  clearPresenceField,
  type EnrichedPresence,
} from '../presenceEnriched';

function makeAwareness(): Awareness {
  const doc = new Y.Doc();
  return new Awareness(doc);
}

function makePeerAwareness(other: Awareness, state: EnrichedPresence): Awareness {
  // Build a second awareness instance and copy `state` into the
  // PARENT awareness's state-map keyed by a fake remote clientId so
  // `getStates()` reports it as a peer.
  const peer = makeAwareness();
  peer.setLocalState(state);
  // Wire up the state via direct manipulation — y-protocols accepts
  // multi-client states through the encoded-update path normally.
  // For unit tests we cheat by inserting directly.
  (other.states as Map<number, EnrichedPresence>).set(peer.clientID, state);
  return peer;
}

describe('setPresencePatch · merge semantics', () => {
  it('merges patch into existing state (does not clobber other fields)', () => {
    const aw = makeAwareness();
    setPresencePatch(aw, { name: 'Alice', color: '#f00' });
    setPresencePatch(aw, { tool: 'sketch.line' });
    const state = aw.getLocalState() as EnrichedPresence;
    expect(state.name).toBe('Alice');
    expect(state.color).toBe('#f00');
    expect(state.tool).toBe('sketch.line');
  });

  it('always bumps lastActivity timestamp', () => {
    const aw = makeAwareness();
    setPresencePatch(aw, { name: 'Alice' });
    const t1 = (aw.getLocalState() as EnrichedPresence).lastActivity;
    // Wait so Date.now() advances at least 1 ms.
    const after = Date.now() + 1;
    while (Date.now() < after) { /* spin */ }
    setPresencePatch(aw, { tool: 'sketch.line' });
    const t2 = (aw.getLocalState() as EnrichedPresence).lastActivity;
    expect(t2!).toBeGreaterThan(t1!);
  });
});

describe('clearPresenceField', () => {
  it('removes a single field while keeping the rest', () => {
    const aw = makeAwareness();
    setPresencePatch(aw, { name: 'Alice', tool: 'sketch.line', selectionId: 'f1' });
    clearPresenceField(aw, 'tool');
    const state = aw.getLocalState() as EnrichedPresence;
    expect(state.tool).toBeUndefined();
    expect(state.name).toBe('Alice');
    expect(state.selectionId).toBe('f1');
  });
});

describe('readRemotePresences', () => {
  it('excludes the local presence', () => {
    const aw = makeAwareness();
    setPresencePatch(aw, { name: 'Me' });
    expect(readRemotePresences(aw)).toHaveLength(0);
  });

  it('returns peer states sorted by name', () => {
    const aw = makeAwareness();
    setPresencePatch(aw, { name: 'Me' });
    makePeerAwareness(aw, { name: 'Charlie' });
    makePeerAwareness(aw, { name: 'Alice' });
    const peers = readRemotePresences(aw);
    expect(peers.map(p => p.state.name)).toEqual(['Alice', 'Charlie']);
  });
});

describe('activePresences', () => {
  it('filters out idle users', () => {
    const now = Date.now();
    const peers = [
      { clientId: 1, state: { name: 'Active', lastActivity: now - 1000 } },
      { clientId: 2, state: { name: 'Idle',   lastActivity: now - 60_000 } },
    ];
    const active = activePresences(peers, 30_000, now);
    expect(active.map(p => p.state.name)).toEqual(['Active']);
  });

  it('filters out presences with no lastActivity', () => {
    const peers = [
      { clientId: 1, state: { name: 'No timestamp' } },
    ];
    expect(activePresences(peers)).toHaveLength(0);
  });
});

describe('findEditingPeer', () => {
  it('returns null when nobody else is editing the element', () => {
    const aw = makeAwareness();
    setPresencePatch(aw, { name: 'Me', editingId: 'f1' });
    expect(findEditingPeer(aw, 'f1')).toBeNull(); // would be us
  });

  it('returns the peer editing the same element', () => {
    const aw = makeAwareness();
    setPresencePatch(aw, { name: 'Me' });
    makePeerAwareness(aw, { name: 'Bob', editingId: 'f1' });
    const peer = findEditingPeer(aw, 'f1');
    expect(peer?.state.name).toBe('Bob');
  });

  it('returns null when peers exist but none edit the target', () => {
    const aw = makeAwareness();
    setPresencePatch(aw, { name: 'Me' });
    makePeerAwareness(aw, { name: 'Bob', editingId: 'f2' });
    expect(findEditingPeer(aw, 'f1')).toBeNull();
  });
});
