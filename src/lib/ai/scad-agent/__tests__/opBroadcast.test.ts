/**
 * S — Op broadcast / pollOps / subscribeOps tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  serverCollabAdapter,
  pollOps,
  subscribeOps,
  _resetCollabState,
} from '../serverCollab';
import type { AgentSession } from '../types';
import type { AgentOp } from '../collab';

beforeEach(() => _resetCollabState());

function s(id: string): AgentSession {
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

describe('serverCollabAdapter — applyOp + pollOps', () => {
  it('applyOp appends to per-session log', async () => {
    const session = s('p1');
    await serverCollabAdapter.applyOp(session, { type: 'brep_added', handle: 'h1', kind: 'box' });
    await serverCollabAdapter.applyOp(session, { type: 'brep_added', handle: 'h2', kind: 'cyl' });
    const ops = pollOps('p1');
    expect(ops.length).toBe(2);
    expect(ops[0].op).toEqual({ type: 'brep_added', handle: 'h1', kind: 'box' });
  });

  it('pollOps with afterMs filters older ops', async () => {
    const session = s('p1');
    await serverCollabAdapter.applyOp(session, { type: 'brep_added', handle: 'h1', kind: 'box' });
    const t0 = Date.now();
    await new Promise(r => setTimeout(r, 5));
    await serverCollabAdapter.applyOp(session, { type: 'brep_added', handle: 'h2', kind: 'cyl' });
    const recent = pollOps('p1', t0);
    expect(recent.length).toBe(1);
    expect(recent[0].op).toMatchObject({ handle: 'h2' });
  });

  it('different sessions have isolated logs', async () => {
    await serverCollabAdapter.applyOp(s('a'), { type: 'brep_added', handle: 'h1', kind: 'box' });
    await serverCollabAdapter.applyOp(s('b'), { type: 'brep_added', handle: 'h2', kind: 'cyl' });
    expect(pollOps('a').length).toBe(1);
    expect(pollOps('b').length).toBe(1);
    expect(pollOps('c').length).toBe(0);
  });

  it('caps at 1000 ops with FIFO eviction', async () => {
    const session = s('big');
    for (let i = 0; i < 1100; i++) {
      await serverCollabAdapter.applyOp(session, { type: 'brep_added', handle: `h${i}`, kind: 'k' });
    }
    const ops = pollOps('big');
    expect(ops.length).toBe(1000);
    // First entry should be h100 (oldest 100 evicted).
    expect((ops[0].op as AgentOp & { handle: string }).handle).toBe('h100');
  });
});

describe('subscribeOps', () => {
  it('subscriber receives every published op', async () => {
    const received: AgentOp[] = [];
    const unsub = subscribeOps('p1', ev => received.push(ev.op));
    await serverCollabAdapter.applyOp(s('p1'), { type: 'brep_added', handle: 'a', kind: 'box' });
    await serverCollabAdapter.applyOp(s('p1'), { type: 'render_completed', ok: true, triangleCount: 12 });
    expect(received.length).toBe(2);
    unsub();
  });

  it('unsubscribe stops further deliveries', async () => {
    const received: AgentOp[] = [];
    const unsub = subscribeOps('p1', ev => received.push(ev.op));
    await serverCollabAdapter.applyOp(s('p1'), { type: 'brep_added', handle: 'a', kind: 'box' });
    unsub();
    await serverCollabAdapter.applyOp(s('p1'), { type: 'brep_added', handle: 'b', kind: 'box' });
    expect(received.length).toBe(1);
  });

  it('subscriber exception does not break other subscribers or applyOp', async () => {
    const ok: AgentOp[] = [];
    subscribeOps('p1', () => { throw new Error('boom'); });
    subscribeOps('p1', ev => ok.push(ev.op));
    await expect(serverCollabAdapter.applyOp(s('p1'), { type: 'brep_added', handle: 'a', kind: 'k' }))
      .resolves.toBeUndefined();
    expect(ok.length).toBe(1);
  });

  it('two subscribers on same project both receive', async () => {
    const a: AgentOp[] = [];
    const b: AgentOp[] = [];
    subscribeOps('p1', ev => a.push(ev.op));
    subscribeOps('p1', ev => b.push(ev.op));
    await serverCollabAdapter.applyOp(s('p1'), { type: 'brep_added', handle: 'h', kind: 'k' });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });
});
