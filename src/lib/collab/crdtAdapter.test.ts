/**
 * crdtAdapter — unit + multi-doc behaviour tests.
 *
 * Covers:
 *   - construction (memory + websocket-stub) & guards
 *   - local update -> state mutation & subscriber notification
 *   - cross-doc sync over the in-process MemoryHub (the heart of CRDT
 *     correctness for our Phase 1 transport)
 *   - awareness setLocal / onUpdate / disconnect signalling
 *   - destroy semantics (no leaks, idempotent, post-destroy guards)
 *   - JSON snapshot fidelity (nested objects, arrays, null)
 *   - domain helpers for FeatureTree & AssemblyState
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCrdtDoc,
  createFeatureTreeDoc,
  createAssemblyDoc,
  _resetMemoryHub,
  _memoryRoomSize,
  type CrdtDoc,
} from './crdtAdapter';
import type { FeatureTree } from '../cad/featureTree';
import type { AssemblyState } from '../assembly/assemblyState';

interface Counter {
  n: number;
  notes: string[];
}

function counter(initial: Partial<Counter> = {}): Counter {
  return { n: 0, notes: [], ...initial };
}

beforeEach(() => {
  _resetMemoryHub();
});

// ─── construction ─────────────────────────────────────────────────────────

describe('createCrdtDoc — construction', () => {
  it('returns a doc with the configured id + materialised initial state', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'doc-1',
      initialState: counter({ n: 3 }),
      transport: 'memory',
    });
    expect(doc.id).toBe('doc-1');
    expect(doc.state).toEqual({ n: 3, notes: [] });
    doc.destroy();
  });

  it('rejects empty docId', () => {
    expect(() =>
      createCrdtDoc<Counter>({ docId: '', initialState: counter(), transport: 'memory' }),
    ).toThrow(/docId/);
  });

  it('rejects unknown transport', () => {
    expect(() =>
      createCrdtDoc<Counter>({
        docId: 'x',
        initialState: counter(),
        // @ts-expect-error — exercising the runtime guard
        transport: 'rtc',
      }),
    ).toThrow(/transport/);
  });

  it('rejects websocket transport without wsUrl', () => {
    expect(() =>
      createCrdtDoc<Counter>({
        docId: 'ws-no-url',
        initialState: counter(),
        transport: 'websocket',
      }),
    ).toThrow(/wsUrl/);
  });

  it('clones initial state — caller mutations after construction do not leak in', () => {
    const init = counter({ n: 1 });
    const doc = createCrdtDoc<Counter>({
      docId: 'clone',
      initialState: init,
      transport: 'memory',
    });
    init.n = 999;
    expect(doc.state.n).toBe(1);
    doc.destroy();
  });
});

// ─── update / subscribe ───────────────────────────────────────────────────

describe('CrdtDoc.update + subscribe', () => {
  it('local update changes state and fires subscribers', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'd',
      initialState: counter(),
      transport: 'memory',
    });
    const seen: Counter[] = [];
    doc.subscribe((s) => seen.push(s));
    doc.update((d) => {
      d.n = 5;
      d.notes.push('hi');
    });
    expect(doc.state).toEqual({ n: 5, notes: ['hi'] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ n: 5, notes: ['hi'] });
    doc.destroy();
  });

  it('does not fire subscribers when mutator produces an identical snapshot', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'noop',
      initialState: counter({ n: 4 }),
      transport: 'memory',
    });
    let calls = 0;
    doc.subscribe(() => {
      calls += 1;
    });
    doc.update((d) => {
      d.n = 4; // unchanged
    });
    expect(calls).toBe(0);
    doc.destroy();
  });

  it('unsubscribe stops further notifications', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'unsub',
      initialState: counter(),
      transport: 'memory',
    });
    let calls = 0;
    const off = doc.subscribe(() => {
      calls += 1;
    });
    doc.update((d) => {
      d.n = 1;
    });
    off();
    doc.update((d) => {
      d.n = 2;
    });
    expect(calls).toBe(1);
    doc.destroy();
  });

  it('mutator throw aborts the transaction (state stays the same)', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'throw',
      initialState: counter({ n: 7 }),
      transport: 'memory',
    });
    expect(() =>
      doc.update(() => {
        throw new Error('nope');
      }),
    ).toThrow(/nope/);
    expect(doc.state.n).toBe(7);
    doc.destroy();
  });

  it('mutating the draft does not mutate the live state until commit', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'iso',
      initialState: counter(),
      transport: 'memory',
    });
    const ref = doc.state;
    doc.update((d) => {
      d.notes.push('x');
    });
    // Old reference must not have been mutated in place
    expect(ref.notes).toEqual([]);
    expect(doc.state.notes).toEqual(['x']);
    doc.destroy();
  });

  it('subscriber errors do not crash the doc', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'crash-sub',
      initialState: counter(),
      transport: 'memory',
    });
    doc.subscribe(() => {
      throw new Error('boom');
    });
    let ok = 0;
    doc.subscribe(() => {
      ok += 1;
    });
    doc.update((d) => {
      d.n = 1;
    });
    expect(ok).toBe(1);
    expect(doc.state.n).toBe(1);
    doc.destroy();
  });

  it('supports nested objects, arrays, and null in the JSON snapshot', () => {
    interface Nested {
      meta: { author: string | null; tags: string[] };
      items: Array<{ id: number; data: Record<string, number> }>;
    }
    const doc = createCrdtDoc<Nested>({
      docId: 'nest',
      initialState: {
        meta: { author: null, tags: [] },
        items: [],
      },
      transport: 'memory',
    });
    doc.update((d) => {
      d.meta.author = 'alice';
      d.meta.tags.push('cad', 'wip');
      d.items.push({ id: 1, data: { width: 10, height: 5 } });
    });
    expect(doc.state.meta.author).toBe('alice');
    expect(doc.state.meta.tags).toEqual(['cad', 'wip']);
    expect(doc.state.items[0].data.width).toBe(10);
    doc.destroy();
  });
});

// ─── multi-doc isolation + sync ───────────────────────────────────────────

describe('memory transport — multi-doc behaviour', () => {
  it('two docs with different ids are completely independent', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'room-a',
      initialState: counter(),
      transport: 'memory',
    });
    const b = createCrdtDoc<Counter>({
      docId: 'room-b',
      initialState: counter(),
      transport: 'memory',
    });
    let bUpdates = 0;
    b.subscribe(() => {
      bUpdates += 1;
    });
    a.update((d) => {
      d.n = 99;
    });
    expect(a.state.n).toBe(99);
    expect(b.state.n).toBe(0);
    expect(bUpdates).toBe(0);
    a.destroy();
    b.destroy();
  });

  it('two docs in the same room sync local updates to peers', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'sync-room',
      initialState: counter(),
      transport: 'memory',
    });
    const b = createCrdtDoc<Counter>({
      docId: 'sync-room',
      initialState: counter(),
      transport: 'memory',
    });
    const bSnapshots: Counter[] = [];
    b.subscribe((s) => bSnapshots.push(s));
    a.update((d) => {
      d.n = 42;
      d.notes.push('hello');
    });
    expect(b.state).toEqual({ n: 42, notes: ['hello'] });
    expect(bSnapshots.at(-1)).toEqual({ n: 42, notes: ['hello'] });
    a.destroy();
    b.destroy();
  });

  it('three docs in the same room — broadcast reaches every peer except origin', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'tri',
      initialState: counter(),
      transport: 'memory',
    });
    const b = createCrdtDoc<Counter>({
      docId: 'tri',
      initialState: counter(),
      transport: 'memory',
    });
    const c = createCrdtDoc<Counter>({
      docId: 'tri',
      initialState: counter(),
      transport: 'memory',
    });
    expect(_memoryRoomSize('tri')).toBe(3);
    a.update((d) => {
      d.n = 7;
    });
    expect(b.state.n).toBe(7);
    expect(c.state.n).toBe(7);
    a.destroy();
    b.destroy();
    c.destroy();
    expect(_memoryRoomSize('tri')).toBe(0);
  });

  it('joining mid-stream syncs prior state from existing peer (CRDT handshake)', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'mid',
      initialState: counter(),
      transport: 'memory',
    });
    a.update((d) => {
      d.n = 1;
    });
    const b = createCrdtDoc<Counter>({
      docId: 'mid',
      initialState: counter(),
      transport: 'memory',
    });
    // Late joiner catches up via the sync handshake
    expect(b.state.n).toBe(1);
    a.update((d) => {
      d.n = 2;
    });
    expect(b.state.n).toBe(2);
    a.destroy();
    b.destroy();
  });
});

// ─── awareness ────────────────────────────────────────────────────────────

describe('awareness', () => {
  it('setLocal updates localState and triggers onUpdate', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'aw',
      initialState: counter(),
      transport: 'memory',
      userId: 'alice',
    });
    const snaps: Array<Record<string, unknown>> = [];
    doc.awareness.onUpdate((s) => snaps.push(s.localState));
    doc.awareness.setLocal('cursor', { x: 10, y: 20 });
    expect(doc.awareness.localState.cursor).toEqual({ x: 10, y: 20 });
    expect(snaps).toHaveLength(1);
    expect(snaps[0].cursor).toEqual({ x: 10, y: 20 });
    doc.destroy();
  });

  it('setLocal with undefined removes the key', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'aw-del',
      initialState: counter(),
      transport: 'memory',
    });
    doc.awareness.setLocal('selection', 'nodeA');
    doc.awareness.setLocal('selection', undefined);
    expect('selection' in doc.awareness.localState).toBe(false);
    doc.destroy();
  });

  it('remote awareness propagates between same-room docs', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'aw-room',
      initialState: counter(),
      transport: 'memory',
      userId: 'alice',
    });
    const b = createCrdtDoc<Counter>({
      docId: 'aw-room',
      initialState: counter(),
      transport: 'memory',
      userId: 'bob',
    });
    a.awareness.setLocal('cursor', { x: 5, y: 5 });
    expect(b.awareness.remoteStates.alice).toEqual({ cursor: { x: 5, y: 5 } });
    b.awareness.setLocal('cursor', { x: 1, y: 2 });
    expect(a.awareness.remoteStates.bob).toEqual({ cursor: { x: 1, y: 2 } });
    a.destroy();
    b.destroy();
  });

  it('destroying a peer clears its remote awareness on the other side', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'aw-leave',
      initialState: counter(),
      transport: 'memory',
      userId: 'alice',
    });
    const b = createCrdtDoc<Counter>({
      docId: 'aw-leave',
      initialState: counter(),
      transport: 'memory',
      userId: 'bob',
    });
    b.awareness.setLocal('cursor', { x: 0, y: 0 });
    expect(a.awareness.remoteStates.bob).toBeDefined();
    b.destroy();
    expect(a.awareness.remoteStates.bob).toBeUndefined();
    a.destroy();
  });

  it('awareness onUpdate unsubscribe stops further notifications', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'aw-unsub',
      initialState: counter(),
      transport: 'memory',
    });
    let calls = 0;
    const off = doc.awareness.onUpdate(() => {
      calls += 1;
    });
    doc.awareness.setLocal('x', 1);
    off();
    doc.awareness.setLocal('x', 2);
    expect(calls).toBe(1);
    doc.destroy();
  });
});

// ─── destroy / lifecycle ──────────────────────────────────────────────────

describe('destroy + lifecycle', () => {
  it('destroy is idempotent', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'idem',
      initialState: counter(),
      transport: 'memory',
    });
    expect(() => {
      doc.destroy();
      doc.destroy();
    }).not.toThrow();
  });

  it('destroy removes the doc from the memory hub room', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'gone',
      initialState: counter(),
      transport: 'memory',
    });
    const b = createCrdtDoc<Counter>({
      docId: 'gone',
      initialState: counter(),
      transport: 'memory',
    });
    expect(_memoryRoomSize('gone')).toBe(2);
    a.destroy();
    expect(_memoryRoomSize('gone')).toBe(1);
    b.destroy();
    expect(_memoryRoomSize('gone')).toBe(0);
  });

  it('update on a destroyed doc throws', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'dead',
      initialState: counter(),
      transport: 'memory',
    });
    doc.destroy();
    expect(() => doc.update((d) => (d.n = 1))).toThrow(/destroyed/);
  });

  it('subscribe on a destroyed doc returns a no-op unsubscribe and never fires', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'dead-sub',
      initialState: counter(),
      transport: 'memory',
    });
    doc.destroy();
    let calls = 0;
    const off = doc.subscribe(() => {
      calls += 1;
    });
    expect(typeof off).toBe('function');
    off();
    expect(calls).toBe(0);
  });

  it('destroying one doc does not disturb other rooms', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'room-x',
      initialState: counter(),
      transport: 'memory',
    });
    const b = createCrdtDoc<Counter>({
      docId: 'room-y',
      initialState: counter(),
      transport: 'memory',
    });
    a.destroy();
    expect(() => b.update((d) => (d.n = 1))).not.toThrow();
    expect(b.state.n).toBe(1);
    b.destroy();
  });
});

// ─── websocket transport stub ─────────────────────────────────────────────

describe('websocket transport (stub)', () => {
  it('accepts wsUrl and behaves like a local doc until provider is bound', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'ws',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://collab.nexyfab.com/ws',
    });
    doc.update((d) => {
      d.n = 11;
    });
    expect(doc.state.n).toBe(11);
    // No memory hub participation
    expect(_memoryRoomSize('ws')).toBe(0);
    doc.destroy();
  });

  it('websocket-transport docs do NOT cross-sync via the memory hub', () => {
    const a = createCrdtDoc<Counter>({
      docId: 'ws-iso',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://example/ws',
    });
    const b = createCrdtDoc<Counter>({
      docId: 'ws-iso',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://example/ws',
    });
    a.update((d) => {
      d.n = 5;
    });
    // Stub: no provider, so b stays put
    expect(b.state.n).toBe(0);
    a.destroy();
    b.destroy();
  });
});

// ─── domain helpers ──────────────────────────────────────────────────────

describe('createFeatureTreeDoc', () => {
  it('returns a working CrdtDoc<FeatureTree>', () => {
    const tree: FeatureTree = { nodes: [] };
    const doc: CrdtDoc<FeatureTree> = createFeatureTreeDoc('ft-1', tree);
    expect(doc.id).toBe('ft-1');
    expect(doc.state.nodes).toEqual([]);
    doc.update((d) => {
      // FeatureTree is a typed IR — we just verify update plumbing works
      // (real FeatureNode shaping is exercised in featureTree.test.ts).
      (d.nodes as FeatureTree['nodes'][number][]).push({
        id: 'n1',
        name: 'sketch',
        dependencies: [],
        payload: {
          kind: 'extrude',
          loop: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
          depth: 2,
          direction: 'one_sided',
          mode: 'add',
        },
      });
    });
    expect(doc.state.nodes).toHaveLength(1);
    expect(doc.state.nodes[0].id).toBe('n1');
    doc.destroy();
  });

  it('syncs FeatureTree edits between same-room docs', () => {
    const tree: FeatureTree = { nodes: [] };
    const a = createFeatureTreeDoc('ft-sync', tree);
    const b = createFeatureTreeDoc('ft-sync', tree);
    a.update((d) => {
      (d.nodes as FeatureTree['nodes'][number][]).push({
        id: 'n1',
        name: 'box',
        dependencies: [],
        payload: {
          kind: 'extrude',
          loop: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          depth: 5,
          direction: 'one_sided',
          mode: 'add',
        },
      });
    });
    expect(b.state.nodes).toHaveLength(1);
    expect(b.state.nodes[0].name).toBe('box');
    a.destroy();
    b.destroy();
  });
});

describe('createAssemblyDoc', () => {
  it('returns a working CrdtDoc<AssemblyState>', () => {
    const initial: AssemblyState = { parts: [], mates: [] };
    const doc = createAssemblyDoc('asm-1', initial);
    expect(doc.id).toBe('asm-1');
    expect(doc.state.parts).toEqual([]);
    doc.update((d) => {
      (d.parts as AssemblyState['parts'][number][]).push({
        id: 'p1',
        name: 'base',
        partTemplateId: 'tpl-base',
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        fixed: true,
      });
    });
    expect(doc.state.parts).toHaveLength(1);
    expect(doc.state.parts[0].fixed).toBe(true);
    doc.destroy();
  });

  it('syncs AssemblyState edits between same-room docs', () => {
    const initial: AssemblyState = { parts: [], mates: [] };
    const a = createAssemblyDoc('asm-sync', initial);
    const b = createAssemblyDoc('asm-sync', initial);
    a.update((d) => {
      (d.parts as AssemblyState['parts'][number][]).push({
        id: 'p1',
        name: 'base',
        partTemplateId: 'tpl-base',
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        fixed: true,
      });
    });
    expect(b.state.parts).toHaveLength(1);
    expect(b.state.parts[0].id).toBe('p1');
    a.destroy();
    b.destroy();
  });
});
