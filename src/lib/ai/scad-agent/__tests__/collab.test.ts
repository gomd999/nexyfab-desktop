/**
 * K (Stage 4) — collab adapter tests.
 */
import { describe, it, expect } from 'vitest';
import { SOLO_COLLAB_ADAPTER, type CollabAdapter } from '../collab';
import { makeTools } from '../tools';
import type { AgentSession } from '../types';

function blankSession(): AgentSession {
  return {
    id: 'sess1',
    scadSource: '',
    modules: {},
    composition: null,
    designPlan: null,
    checkpoints: [],
    brepEntries: [],
    sketches: {},
    mates: [],
    gdtFrames: [],
    docRefs: [],
    history: [],
    render: { ok: null, errors: [] },
    geometry: {},
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

function host(collab?: CollabAdapter) {
  return {
    render: async () => ({ ok: true as const, errors: [], stlBytes: 0, triangles: 0, ts: 0 }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
    collab,
  };
}

describe('SOLO_COLLAB_ADAPTER', () => {
  it('reports solo participant only', async () => {
    const session = blankSession();
    expect(SOLO_COLLAB_ADAPTER.isCollaborative(session)).toBe(false);
    const peers = await SOLO_COLLAB_ADAPTER.presence(session);
    expect(peers.length).toBe(1);
    expect(peers[0].self).toBe(true);
  });

  it('always grants locks', async () => {
    const r = await SOLO_COLLAB_ADAPTER.acquireLock(blankSession(), 'mock:1');
    expect(r.acquired).toBe(true);
  });
});

describe('collab tools (solo default)', () => {
  it('collab_presence reports solo when no adapter', async () => {
    const tools = makeTools(host());
    const r = await tools.collab_presence!({}, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toMatch(/Solo/i);
  });

  it('collab_lock acquires immediately in solo mode', async () => {
    const tools = makeTools(host());
    const r = await tools.collab_lock!({ resource: 'mock:1' }, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('Lock acquired');
  });

  it('collab_lock surfaces LOCK_HELD when adapter denies', async () => {
    const denying: CollabAdapter = {
      ...SOLO_COLLAB_ADAPTER,
      isCollaborative: () => true,
      async acquireLock(_s, resource) {
        return { resource, acquired: false, holder: 'alice' };
      },
    };
    const tools = makeTools(host(denying));
    const r = await tools.collab_lock!({ resource: 'mock:1' }, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('LOCK_HELD');
      expect(r.error).toContain('alice');
    }
  });

  it('collab_presence reports peers when adapter says so', async () => {
    const adapter: CollabAdapter = {
      ...SOLO_COLLAB_ADAPTER,
      isCollaborative: () => true,
      async presence() {
        return [
          { id: 'sess1', label: 'You', self: true },
          { id: 'alice', label: 'Alice', self: false },
        ];
      },
    };
    const tools = makeTools(host(adapter));
    const r = await tools.collab_presence!({}, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('Alice');
      expect(r.output).toContain('2 participant(s)');
    }
  });
});
