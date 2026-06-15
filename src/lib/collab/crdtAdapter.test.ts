/**
 * crdtAdapter — unit + multi-doc behaviour tests.
 *
 * Covers:
 *   - construction (memory + websocket via injected mock provider) & guards
 *   - local update -> state mutation & subscriber notification
 *   - cross-doc sync over the in-process MemoryHub (the heart of CRDT
 *     correctness for our Phase 1 transport)
 *   - awareness setLocal / onUpdate / disconnect signalling (memory + ws)
 *   - destroy semantics (no leaks, idempotent, post-destroy guards)
 *   - JSON snapshot fidelity (nested objects, arrays, null)
 *   - domain helpers for FeatureTree & AssemblyState
 *   - websocket transport via `_websocketProviderFactory` mock:
 *     - isConnected: false at construct, true after 'connected' status,
 *       false after 'disconnected'
 *     - awareness.setLocal round-trips through the underlying
 *       y-protocols/awareness instance
 *     - peer awareness arrives via the same y-protocols backend
 *     - dispose calls provider.destroy() + ydoc.destroy()
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  createCrdtDoc,
  createFeatureTreeDoc,
  createAssemblyDoc,
  _resetMemoryHub,
  _memoryRoomSize,
  type CrdtDoc,
  type WebsocketProviderFactory,
  type WebsocketProviderLike,
} from './crdtAdapter';
import type { FeatureTree } from '../cad/featureTree';
import type { AssemblyState } from '../assembly/assemblyState';

// ─── Mock WebsocketProvider helpers ───────────────────────────────────────
// We deliberately do NOT spin up a y-websocket server in unit tests — that's
// integration territory. Instead, a lightweight mock provider exposes the
// same surface (wsconnected, awareness, on/off, destroy) and lets us drive
// status events synchronously. Real-server coverage belongs in e2e (TODO
// Phase 2 once the worker ships).

interface MockProvider extends WebsocketProviderLike {
  /** Push a connected/disconnected/connecting status event to the doc. */
  fireStatus(status: 'connected' | 'disconnected' | 'connecting'): void;
  destroyed: boolean;
  factoryArgs: {
    wsUrl: string;
    docId: string;
    ydoc: Y.Doc;
    awareness: awarenessProtocol.Awareness;
  };
}

function makeMockFactory(opts: {
  initiallyConnected?: boolean;
  /** Capture the produced provider for the test to drive. */
  capture?: (p: MockProvider) => void;
} = {}): WebsocketProviderFactory {
  return (args) => {
    type Listener = (...a: unknown[]) => void;
    const handlers: Record<string, Set<Listener>> = {};
    const on = (event: string, cb: Listener): void => {
      if (!handlers[event]) handlers[event] = new Set();
      handlers[event].add(cb);
    };
    const off = (event: string, cb: Listener): void => {
      handlers[event]?.delete(cb);
    };
    const provider: MockProvider = {
      wsconnected: opts.initiallyConnected ?? false,
      awareness: args.awareness,
      on: on as MockProvider['on'],
      off: off as MockProvider['off'],
      destroy: () => {
        provider.destroyed = true;
        // Don't tear down the awareness — the doc's awarenessImpl owns it
        // and will be _destroy'd separately. Mirrors how the real provider
        // calls awareness.destroy() but here we keep it simple.
      },
      destroyed: false,
      factoryArgs: args,
      fireStatus: (status) => {
        provider.wsconnected = status === 'connected';
        const set = handlers['status'];
        if (!set) return;
        for (const cb of set) cb({ status });
      },
    };
    opts.capture?.(provider);
    return provider;
  };
}

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

// ─── websocket transport (real provider via injected mock) ───────────────
// These tests drive the WebsocketProvider integration. We inject a mock
// provider via `_websocketProviderFactory` rather than spinning up a real
// y-websocket server — that's e2e territory. The mock satisfies the same
// `WebsocketProviderLike` contract the production provider implements, so
// the adapter exercises the same wiring (event subscriptions, awareness
// hand-off, dispose order) as it would in prod.

describe('websocket transport — provider integration', () => {
  it('constructs a CrdtDoc and instantiates the provider with the right args', () => {
    let captured: MockProvider | null = null;
    const factory = makeMockFactory({ capture: (p) => { captured = p; } });
    const doc = createCrdtDoc<Counter>({
      docId: 'ws-ctor',
      initialState: counter({ n: 7 }),
      transport: 'websocket',
      wsUrl: 'wss://collab.example/ws',
      _websocketProviderFactory: factory,
    });
    expect(doc).toBeDefined();
    expect(captured).not.toBeNull();
    const cap = captured as unknown as MockProvider;
    expect(cap.factoryArgs.wsUrl).toBe('wss://collab.example/ws');
    expect(cap.factoryArgs.docId).toBe('ws-ctor');
    expect(cap.factoryArgs.ydoc).toBeInstanceOf(Y.Doc);
    expect(cap.factoryArgs.awareness).toBeInstanceOf(awarenessProtocol.Awareness);
    expect(doc.state).toEqual({ n: 7, notes: [] });
    // No memory hub participation
    expect(_memoryRoomSize('ws-ctor')).toBe(0);
    doc.destroy();
  });

  it('isConnected: memory transport is always true', () => {
    const doc = createCrdtDoc<Counter>({
      docId: 'conn-mem',
      initialState: counter(),
      transport: 'memory',
    });
    expect(doc.isConnected).toBe(true);
    doc.destroy();
    expect(doc.isConnected).toBe(false);
  });

  it('isConnected: websocket starts false, flips true on connected status', () => {
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'conn-ws-up',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { captured = p; } }),
    });
    expect(doc.isConnected).toBe(false);
    const cap = captured as unknown as MockProvider;
    cap.fireStatus('connected');
    expect(doc.isConnected).toBe(true);
    doc.destroy();
  });

  it('isConnected: flips back to false on disconnected status', () => {
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'conn-ws-down',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: makeMockFactory({
        initiallyConnected: true,
        capture: (p) => { captured = p; },
      }),
    });
    expect(doc.isConnected).toBe(true);
    const cap = captured as unknown as MockProvider;
    cap.fireStatus('disconnected');
    expect(doc.isConnected).toBe(false);
    doc.destroy();
  });

  it('onConnectionChange fires on every status transition (not on duplicates)', () => {
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'conn-evt',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { captured = p; } }),
    });
    const calls: boolean[] = [];
    doc.onConnectionChange((c) => calls.push(c));
    const cap = captured as unknown as MockProvider;
    cap.fireStatus('connected');
    cap.fireStatus('connected'); // duplicate — no-op
    cap.fireStatus('connecting'); // not connected → false transition
    cap.fireStatus('connected');
    cap.fireStatus('disconnected');
    expect(calls).toEqual([true, false, true, false]);
    doc.destroy();
  });

  it('onConnectionChange unsubscribe stops further notifications', () => {
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'conn-unsub',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { captured = p; } }),
    });
    let calls = 0;
    const off = doc.onConnectionChange(() => { calls += 1; });
    const cap = captured as unknown as MockProvider;
    cap.fireStatus('connected');
    off();
    cap.fireStatus('disconnected');
    expect(calls).toBe(1);
    doc.destroy();
  });

  it('awareness.setLocal round-trips through the y-protocols awareness instance', () => {
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'ws-aw-rt',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      userId: 'alice',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { captured = p; } }),
    });
    doc.awareness.setLocal('cursor', { x: 4, y: 5 });
    expect(doc.awareness.localState.cursor).toEqual({ x: 4, y: 5 });
    // The same value is visible on the underlying y-protocols awareness.
    const cap = captured as unknown as MockProvider;
    const raw = cap.awareness.getLocalState();
    expect(raw?.cursor).toEqual({ x: 4, y: 5 });
    doc.destroy();
  });

  it('awareness.setLocal(undefined) removes the key on the y-protocols side too', () => {
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'ws-aw-del',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      userId: 'alice',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { captured = p; } }),
    });
    doc.awareness.setLocal('cursor', { x: 1, y: 1 });
    doc.awareness.setLocal('cursor', undefined);
    expect('cursor' in doc.awareness.localState).toBe(false);
    const cap = captured as unknown as MockProvider;
    expect((cap.awareness.getLocalState() ?? {}).cursor).toBeUndefined();
    doc.destroy();
  });

  it('remote awareness state surfaces under the peer user id, not the clientID', () => {
    // Stand up two docs with two independent provider mocks but a shared
    // awarenessProtocol instance to simulate the same room (the real wire
    // would replicate states between providers; we shortcut by sharing).
    let aProvider: MockProvider | null = null;
    let bProvider: MockProvider | null = null;
    const a = createCrdtDoc<Counter>({
      docId: 'ws-aw-room',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      userId: 'alice',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { aProvider = p; } }),
    });
    const b = createCrdtDoc<Counter>({
      docId: 'ws-aw-room',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      userId: 'bob',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { bProvider = p; } }),
    });
    // Hand-relay an awareness encode/apply pair to simulate the server.
    const aAw = (aProvider as unknown as MockProvider).awareness;
    const bAw = (bProvider as unknown as MockProvider).awareness;
    a.awareness.setLocal('cursor', { x: 9, y: 9 });
    const update = awarenessProtocol.encodeAwarenessUpdate(aAw, [aAw.clientID]);
    awarenessProtocol.applyAwarenessUpdate(bAw, update, 'server');
    expect(b.awareness.remoteStates.alice).toEqual({ cursor: { x: 9, y: 9 } });
    // The user id is keyed by the user-id field, not the Yjs clientID.
    expect(Object.keys(b.awareness.remoteStates)).toEqual(['alice']);
    a.destroy();
    b.destroy();
  });

  it('awareness onUpdate fires for both local and remote changes', () => {
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'ws-aw-evt',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      userId: 'alice',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { captured = p; } }),
    });
    const cb = vi.fn();
    doc.awareness.onUpdate(cb);
    doc.awareness.setLocal('cursor', { x: 1, y: 1 });
    expect(cb).toHaveBeenCalled();
    // Simulate a remote update by mutating the shared y-protocols awareness
    // directly through a peer encode/apply.
    const peerDoc = new Y.Doc();
    const peerAw = new awarenessProtocol.Awareness(peerDoc);
    peerAw.setLocalState({ cursor: { x: 9, y: 9 }, __userId: 'bob' });
    const cap = captured as unknown as MockProvider;
    const update = awarenessProtocol.encodeAwarenessUpdate(peerAw, [peerAw.clientID]);
    cb.mockClear();
    awarenessProtocol.applyAwarenessUpdate(cap.awareness, update, 'server');
    expect(cb).toHaveBeenCalled();
    expect(doc.awareness.remoteStates.bob).toEqual({ cursor: { x: 9, y: 9 } });
    peerDoc.destroy();
    doc.destroy();
  });

  it('destroy calls provider.destroy() and tears down the y-doc', () => {
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'ws-dispose',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { captured = p; } }),
    });
    const cap = captured as unknown as MockProvider;
    expect(cap.destroyed).toBe(false);
    doc.destroy();
    expect(cap.destroyed).toBe(true);
    expect(doc.isConnected).toBe(false);
    // Double-destroy is idempotent.
    expect(() => doc.destroy()).not.toThrow();
  });

  it('destroy unsubscribes the status handler before destroying the provider', () => {
    // Status events fired AFTER destroy must not flip wsConnected back true
    // or re-invoke connection listeners — the off() call guards us.
    let captured: MockProvider | null = null;
    const doc = createCrdtDoc<Counter>({
      docId: 'ws-late-status',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: makeMockFactory({ capture: (p) => { captured = p; } }),
    });
    let calls = 0;
    doc.onConnectionChange(() => { calls += 1; });
    const cap = captured as unknown as MockProvider;
    doc.destroy();
    cap.fireStatus('connected'); // no-op — handler was off()'d
    expect(calls).toBe(0);
    expect(doc.isConnected).toBe(false);
  });

  it('provider.destroy() throwing does not prevent ydoc teardown', () => {
    // Resilience: if the provider throws inside destroy(), the doc must
    // still mark itself destroyed and release the Y.Doc. Without the catch
    // we'd leak a live awareness instance + a half-destroyed doc.
    const factory: WebsocketProviderFactory = (args) => {
      type Listener = (...a: unknown[]) => void;
      const handlers: Record<string, Set<Listener>> = {};
      return {
        wsconnected: false,
        awareness: args.awareness,
        on: ((event: string, cb: Listener): void => {
          (handlers[event] ??= new Set()).add(cb);
        }) as WebsocketProviderLike['on'],
        off: ((event: string, cb: Listener): void => {
          handlers[event]?.delete(cb);
        }) as WebsocketProviderLike['off'],
        destroy: () => { throw new Error('provider boom'); },
      };
    };
    const doc = createCrdtDoc<Counter>({
      docId: 'ws-boom',
      initialState: counter(),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: factory,
    });
    expect(() => doc.destroy()).not.toThrow();
    expect(doc.isConnected).toBe(false);
    expect(() => doc.update((d) => (d.n = 1))).toThrow(/destroyed/);
  });

  it('seeds initial state on the Y.Doc regardless of room peers (websocket has no local hub)', () => {
    // Memory transport defers seeding when a peer already exists; websocket
    // can't peek at peers synchronously, so it always seeds. Verify two
    // websocket docs in the "same" room each get their own seed (their
    // sync convergence happens via the real wire, not via crdtAdapter).
    const a = createCrdtDoc<Counter>({
      docId: 'ws-seed',
      initialState: counter({ n: 1 }),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: makeMockFactory(),
    });
    const b = createCrdtDoc<Counter>({
      docId: 'ws-seed',
      initialState: counter({ n: 2 }),
      transport: 'websocket',
      wsUrl: 'wss://ex/ws',
      _websocketProviderFactory: makeMockFactory(),
    });
    expect(a.state.n).toBe(1);
    expect(b.state.n).toBe(2);
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
