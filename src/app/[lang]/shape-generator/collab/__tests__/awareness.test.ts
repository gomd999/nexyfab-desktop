/**
 * awareness.test.ts — Wave 2 Phase 3 W1 Track Z1.
 *
 * Pure unit tests for the awareness helpers. No DOM, no IDB, no WebSocket
 * — just Y.Doc + Awareness in-memory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

import {
  encodeLocalPresence,
  decodeRemotePresence,
  readLocalPresence,
  peerColorFromId,
  generatePeerId,
  defaultPeerName,
  type PeerInfo,
} from '../awareness';

// ─── peerColorFromId ─────────────────────────────────────────────────────────

describe('awareness · peerColorFromId', () => {
  it('returns an HSL string for any non-empty id', () => {
    expect(peerColorFromId('alice')).toMatch(/^hsl\(\d+, 65%, 58%\)$/);
  });

  it('is deterministic — same id always lands on the same color', () => {
    const a1 = peerColorFromId('user-42');
    const a2 = peerColorFromId('user-42');
    expect(a1).toBe(a2);
  });

  it('distributes different ids to different hues (low collision)', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 50; i++) {
      colors.add(peerColorFromId(`peer-${i}`));
    }
    // At least 30 unique colors out of 50 — generous slack for hash collisions.
    expect(colors.size).toBeGreaterThanOrEqual(30);
  });

  it('handles empty string by returning a stable fallback', () => {
    expect(peerColorFromId('')).toBe('hsl(0, 0%, 60%)');
  });
});

// ─── generatePeerId ──────────────────────────────────────────────────────────

describe('awareness · generatePeerId', () => {
  it('returns a non-empty string', () => {
    expect(generatePeerId().length).toBeGreaterThan(0);
  });

  it('is unique across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generatePeerId());
    expect(ids.size).toBe(100);
  });
});

// ─── defaultPeerName ─────────────────────────────────────────────────────────

describe('awareness · defaultPeerName', () => {
  it('formats a short, identifiable label', () => {
    expect(defaultPeerName('abcdef01-1234-5678-9abc-def012345678')).toBe('User abcd');
  });

  it('handles very short ids', () => {
    expect(defaultPeerName('xy')).toBe('User xy');
  });
});

// ─── encodeLocalPresence + readLocalPresence round-trip ─────────────────────

describe('awareness · encode/read local round-trip', () => {
  let doc: Y.Doc;
  let aw: Awareness;
  const peer: PeerInfo = {
    id: 'p-1',
    name: 'Alice',
    color: 'hsl(200, 65%, 58%)',
    cursor: null,
    selection: [],
    activeNodeId: null,
  };

  beforeEach(() => {
    doc = new Y.Doc();
    aw = new Awareness(doc);
  });

  afterEach(() => {
    aw.destroy();
    doc.destroy();
  });

  it('write+read returns the same fields', () => {
    encodeLocalPresence(aw, peer);
    const got = readLocalPresence(aw);
    expect(got?.id).toBe('p-1');
    expect(got?.name).toBe('Alice');
    expect(got?.color).toBe('hsl(200, 65%, 58%)');
  });

  it('returns null when local state is missing required fields', () => {
    aw.setLocalState({});
    expect(readLocalPresence(aw)).toBeNull();
  });

  it('partial patch merges into existing state', () => {
    encodeLocalPresence(aw, peer);
    encodeLocalPresence(aw, { name: 'Bob' });
    const got = readLocalPresence(aw);
    expect(got?.name).toBe('Bob');
    expect(got?.id).toBe('p-1'); // id preserved
    expect(got?.color).toBe('hsl(200, 65%, 58%)'); // color preserved
  });

  it('stamps ts on every write', () => {
    const t0 = Date.now();
    encodeLocalPresence(aw, peer);
    const got = readLocalPresence(aw);
    expect(got?.ts).toBeGreaterThanOrEqual(t0);
  });

  it('cursor field round-trips', () => {
    encodeLocalPresence(aw, { ...peer, cursor: { x: 1, y: 2, viewport: 'sketch' } });
    const got = readLocalPresence(aw);
    expect(got?.cursor).toEqual({ x: 1, y: 2, viewport: 'sketch' });
  });

  it('selection array round-trips', () => {
    encodeLocalPresence(aw, { ...peer, selection: ['feat-1', 'feat-2'] });
    const got = readLocalPresence(aw);
    expect(got?.selection).toEqual(['feat-1', 'feat-2']);
  });

  it('activeNodeId round-trips', () => {
    encodeLocalPresence(aw, { ...peer, activeNodeId: 'node-99' });
    const got = readLocalPresence(aw);
    expect(got?.activeNodeId).toBe('node-99');
  });
});

// ─── decodeRemotePresence — multi-peer view ─────────────────────────────────

describe('awareness · decodeRemotePresence', () => {
  let docA: Y.Doc;
  let awA: Awareness;
  let docB: Y.Doc;
  let awB: Awareness;

  beforeEach(() => {
    docA = new Y.Doc();
    awA = new Awareness(docA);
    docB = new Y.Doc();
    awB = new Awareness(docB);
  });

  afterEach(() => {
    awA.destroy();
    awB.destroy();
    docA.destroy();
    docB.destroy();
  });

  it('returns empty record when no remote peers', () => {
    encodeLocalPresence(awA, {
      id: 'a',
      name: 'A',
      color: 'hsl(0, 65%, 58%)',
    });
    expect(decodeRemotePresence(awA)).toEqual({});
  });

  it('excludes self from the result', () => {
    encodeLocalPresence(awA, {
      id: 'self-a',
      name: 'Alice',
      color: 'hsl(0, 65%, 58%)',
    });
    const remote = decodeRemotePresence(awA);
    expect(remote['self-a']).toBeUndefined();
  });

  it('keys remote peers by their logical id', async () => {
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = await import('y-protocols/awareness');
    // B publishes itself
    encodeLocalPresence(awB, {
      id: 'remote-b',
      name: 'Bob',
      color: 'hsl(120, 65%, 58%)',
      selection: ['feat-x'],
    });
    // Pipe B's awareness state to A
    const update = encodeAwarenessUpdate(awB, [awB.clientID]);
    applyAwarenessUpdate(awA, update, 'remote');

    const remote = decodeRemotePresence(awA);
    expect(remote['remote-b']).toBeDefined();
    expect(remote['remote-b'].name).toBe('Bob');
    expect(remote['remote-b'].selection).toEqual(['feat-x']);
  });

  it('skips peers with missing required fields', async () => {
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = await import('y-protocols/awareness');
    // B publishes partial state (no id)
    awB.setLocalState({ name: 'Half-baked', color: 'hsl(50, 65%, 58%)' });
    const update = encodeAwarenessUpdate(awB, [awB.clientID]);
    applyAwarenessUpdate(awA, update, 'remote');

    expect(Object.keys(decodeRemotePresence(awA))).toHaveLength(0);
  });
});
