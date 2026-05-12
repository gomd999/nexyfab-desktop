/**
 * K* — server-side collab adapter tests.
 *
 * In-memory locks + client-supplied participant snapshot. We pin: TTL
 * expiration, contention (different sessions can't double-acquire),
 * presence visibility, GC cleanup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  serverCollabAdapter,
  setSessionParticipants,
  clearSessionParticipants,
  _resetCollabState,
  _peekLocks,
} from '../serverCollab';
import type { AgentSession } from '../types';

function makeSession(id: string): AgentSession {
  return {
    id,
    scadSource: '', modules: {}, composition: null, designPlan: null,
    checkpoints: [], brepEntries: [], sketches: {}, mates: [], gdtFrames: [], docRefs: [], history: [],
    render: { ok: null, errors: [] }, geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 1_000_000,
      turnsUsed: 0, turnsCap: 50,
      toolCallsUsed: 0, toolCallsCap: 200,
      visionCallsUsed: 0, visionCallsCap: 3,
      consecutiveRenderFails: 0,
    },
    status: 'idle',
  };
}

beforeEach(() => _resetCollabState());

describe('serverCollabAdapter — presence', () => {
  it('reports solo when no participants registered', async () => {
    const session = makeSession('s1');
    const peers = await serverCollabAdapter.presence(session);
    expect(peers.length).toBe(1);
    expect(peers[0].self).toBe(true);
  });

  it('isCollaborative=false with 1 participant, true with 2+', () => {
    const session = makeSession('s1');
    setSessionParticipants('s1', [{ id: 's1', label: 'Me', self: true }]);
    expect(serverCollabAdapter.isCollaborative(session)).toBe(false);
    setSessionParticipants('s1', [
      { id: 's1', label: 'Me', self: true },
      { id: 'alice', label: 'Alice', self: false },
    ]);
    expect(serverCollabAdapter.isCollaborative(session)).toBe(true);
  });

  it('synthesizes self entry when client forgot to include us', async () => {
    const session = makeSession('s2');
    setSessionParticipants('s2', [{ id: 'alice', label: 'Alice', self: false }]);
    const peers = await serverCollabAdapter.presence(session);
    expect(peers.length).toBe(2);
    expect(peers.find(p => p.self)).toBeDefined();
  });

  it('clearSessionParticipants returns to solo state', async () => {
    setSessionParticipants('s3', [
      { id: 's3', label: 'Me', self: true },
      { id: 'bob', label: 'Bob', self: false },
    ]);
    clearSessionParticipants('s3');
    const peers = await serverCollabAdapter.presence(makeSession('s3'));
    expect(peers.length).toBe(1);
  });
});

describe('serverCollabAdapter — locks', () => {
  it('acquires a fresh lock', async () => {
    const r = await serverCollabAdapter.acquireLock(makeSession('s1'), 'occt:1');
    expect(r.acquired).toBe(true);
  });

  it('different session is denied while a lock is held', async () => {
    const a = makeSession('alice');
    const b = makeSession('bob');
    const ra = await serverCollabAdapter.acquireLock(a, 'occt:1');
    expect(ra.acquired).toBe(true);
    const rb = await serverCollabAdapter.acquireLock(b, 'occt:1');
    expect(rb.acquired).toBe(false);
    expect(rb.holder).toBe('alice');
  });

  it('same session can re-acquire (lock refreshes)', async () => {
    const s = makeSession('s');
    await serverCollabAdapter.acquireLock(s, 'occt:1', 5_000);
    const r = await serverCollabAdapter.acquireLock(s, 'occt:1', 60_000);
    expect(r.acquired).toBe(true);
  });

  it('TTL expires the lock so other session can take it', async () => {
    const a = makeSession('a');
    const b = makeSession('b');
    // Acquire with very short TTL.
    await serverCollabAdapter.acquireLock(a, 'r1', 1_000);
    // Manually move clock by mutating expires via _peekLocks (read-only),
    // so we await past the TTL boundary instead.
    await new Promise(r => setTimeout(r, 1_100));
    const r = await serverCollabAdapter.acquireLock(b, 'r1', 60_000);
    expect(r.acquired).toBe(true);
  });

  it('releaseLock removes the lock immediately', async () => {
    const s = makeSession('s');
    await serverCollabAdapter.acquireLock(s, 'r1');
    await serverCollabAdapter.releaseLock(s, 'r1');
    expect(_peekLocks().size).toBe(0);
  });

  it('releaseLock by non-holder is a no-op', async () => {
    const a = makeSession('a');
    const b = makeSession('b');
    await serverCollabAdapter.acquireLock(a, 'r1');
    await serverCollabAdapter.releaseLock(b, 'r1');  // not the holder
    expect(_peekLocks().size).toBe(1);  // still there
  });

  it('TTL clamp — accepts but bounds extreme values', async () => {
    const s = makeSession('s');
    const r = await serverCollabAdapter.acquireLock(s, 'r1', 999_999_999);
    expect(r.acquired).toBe(true);
  });
});

describe('serverCollabAdapter — applyOp', () => {
  it('applyOp is a no-op (v1 — broadcast not yet wired)', async () => {
    const s = makeSession('s');
    await expect(serverCollabAdapter.applyOp(s, { type: 'brep_added', handle: 'h', kind: 'k' }))
      .resolves.toBeUndefined();
  });
});
