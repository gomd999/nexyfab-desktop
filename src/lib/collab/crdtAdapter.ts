/**
 * crdtAdapter — Phase 1 of NexyFab collaborative editing (ADR-013 follow-up).
 *
 * Thin wrapper around Y.js that exposes a small, opinionated CRDT surface for
 * the rest of the codebase. The goal is to keep callers (FeatureTree editor,
 * Assembly editor, drawing annotations, …) ignorant of Y.js internals so we
 * can swap the underlying provider (memory ↔ websocket ↔ webrtc ↔ …) without
 * touching domain code.
 *
 * State model:
 *   - Each CrdtDoc<T> owns one Y.Doc and one root Y.Map named 'state'.
 *   - Domain state T is serialised into that map as a single JSON blob under
 *     the key 'snapshot'. Coarse-grained on purpose: domain mutators run
 *     locally on a structural-clone draft, then we diff via JSON.stringify
 *     and atomically replace the snapshot in a Y.transact. This sacrifices
 *     character-level merges (CRDT-style line edits, etc.) but gives us
 *     guaranteed structural integrity for typed IRs like FeatureTree /
 *     AssemblyState whose invariants are not field-local.
 *   - Awareness piggybacks on the Y.Doc.
 *     - 'memory' transport: a private in-process broadcast keyed by user id
 *       (no y-protocols dependency on the local hub path).
 *     - 'websocket' transport: y-protocols/awareness, wired into the
 *       y-websocket provider so cursors flow over the same socket as edits.
 *
 * Transports:
 *   - 'memory': single process. The Y.Doc is local-only; updates produced by
 *     this doc are broadcast to every other in-process doc that joined the
 *     same docId via the shared MemoryHub. Test/SSR friendly.
 *   - 'websocket': real provider via y-websocket. Constructs a
 *     WebsocketProvider against `wsUrl` + `docId`, attaches a
 *     y-protocols/awareness instance, and surfaces `isConnected` via the
 *     provider's `wsconnected` flag (+ 'status' / 'sync' events). Tests can
 *     inject a fake provider through the internal `_websocketProviderFactory`
 *     option — keeps unit tests offline while exercising real wiring.
 *
 * Out of scope (Phase 2+):
 *   - Server impl + auth: WebsocketProvider opens against `wsUrl` but we
 *     don't ship a hosted endpoint yet (see report).
 *   - Persistence provider (y-indexeddb on the client, IndexedDb shim for SSR)
 *   - Auth / room ACLs (must reuse nfProjectAccess)
 *   - Conflict resolution beyond JSON snapshot replace (Y.Array / Y.Map nodes
 *     for fine-grained merges)
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { FeatureTree } from '../cad/featureTree';
import type { AssemblyState } from '../assembly/assemblyState';

// ─── Awareness ────────────────────────────────────────────────────────────

export type UserId = string;

export interface AwarenessSnapshot {
  /** This client's published state (cursor, selection, presence, …). */
  localState: Record<string, unknown>;
  /** Other clients' last-known states keyed by user id. */
  remoteStates: Record<UserId, Record<string, unknown>>;
}

export interface Awareness {
  /** Mutate the local awareness state under `key`. Triggers onUpdate listeners
   *  for every joined doc on the same channel. */
  setLocal(key: string, value: unknown): void;
  /** Subscribe to combined awareness changes (local + remote). The callback
   *  receives the *full* remote-states map, not a diff — keeps the API simple
   *  for React consumers that just memoize on the whole object. Returns an
   *  unsubscribe handle. */
  onUpdate(cb: (snapshot: AwarenessSnapshot) => void): () => void;
  /** Read-only snapshot — handy for tests and one-shot reads. */
  readonly localState: Record<string, unknown>;
  readonly remoteStates: Record<UserId, Record<string, unknown>>;
}

// ─── CrdtDoc public API ───────────────────────────────────────────────────

export interface CrdtDoc<T> {
  /** Logical document id (room name). Two docs sharing this id on the same
   *  transport stay in sync. */
  readonly id: string;
  /** Current materialised state. Read-only — call `update` to mutate. */
  readonly state: T;
  /** Subscribe to state changes (local OR remote). Returns unsubscribe fn. */
  subscribe(cb: (state: T) => void): () => void;
  /** Apply a mutation. The mutator receives a *draft* (deep clone of current
   *  state) which it can freely mutate; the result is committed atomically in
   *  a Y.transact. Throwing inside the mutator aborts the transaction. */
  update(mutator: (draft: T) => void): void;
  /** Awareness sub-document for presence / cursors. */
  readonly awareness: Awareness;
  /** Transport-aware liveness flag.
   *  - 'memory'   → always true while the doc is alive.
   *  - 'websocket'→ mirrors the WebsocketProvider's wsconnected. False until
   *    the first 'connected' status event, true after, and back to false on
   *    'disconnected'. */
  readonly isConnected: boolean;
  /** Subscribe to transport connection changes. Memory: only ever fires
   *  `false` on destroy (true is implicit on construction). Websocket: fires
   *  on every 'connected'/'disconnected' status event from the provider.
   *  Returns unsubscribe fn. */
  onConnectionChange(cb: (connected: boolean) => void): () => void;
  /** Tear down. Unsubscribes all listeners, detaches from the hub, destroys
   *  the WebsocketProvider (if any), frees the Y.Doc. Calling this twice is a
   *  no-op. */
  destroy(): void;
}

export type CrdtTransport = 'memory' | 'websocket';

/** Test/extension hook: injectable provider factory. Production callers leave
 *  this undefined; the adapter then instantiates a real WebsocketProvider.
 *  Mock providers must satisfy a tiny subset of the WebsocketProvider surface
 *  (wsconnected, awareness, on/off, destroy). Underscored to discourage
 *  domain callers from depending on it. */
export type WebsocketProviderFactory = (args: {
  wsUrl: string;
  docId: string;
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
}) => WebsocketProviderLike;

/** Minimal contract the adapter relies on from a websocket provider. Matches
 *  the production `WebsocketProvider` from y-websocket and lets us mock with
 *  a few-line stub in tests. */
export interface WebsocketProviderLike {
  wsconnected: boolean;
  awareness: awarenessProtocol.Awareness;
  on(event: 'status', cb: (e: { status: 'connected' | 'disconnected' | 'connecting' }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
  on(event: 'connection-close', cb: (e: unknown) => void): void;
  off(event: 'status', cb: (e: { status: 'connected' | 'disconnected' | 'connecting' }) => void): void;
  off(event: 'sync', cb: (synced: boolean) => void): void;
  off(event: 'connection-close', cb: (e: unknown) => void): void;
  destroy(): void;
}

export interface CrdtConfig<T> {
  docId: string;
  initialState: T;
  transport: CrdtTransport;
  /** WebSocket endpoint. Required when transport === 'websocket'. Passed to
   *  the WebsocketProvider (or to the injected factory). */
  wsUrl?: string;
  /** Client identifier for awareness (cursor ownership). Defaults to a random
   *  string so unit tests don't have to plumb it through. */
  userId?: UserId;
  /** Test-only: inject a fake WebsocketProvider factory. When omitted, the
   *  adapter instantiates the real `WebsocketProvider` from y-websocket. */
  _websocketProviderFactory?: WebsocketProviderFactory;
}

// ─── MemoryHub: in-process broadcast for 'memory' transport ──────────────

interface MemorySubscriber {
  docClientId: number;
  onUpdate: (update: Uint8Array, originClientId: number) => void;
  onAwareness: (userId: UserId, state: Record<string, unknown> | null) => void;
}

interface MemorySubscriberInternal extends MemorySubscriber {
  /** Encoded state vector of this doc, for sync handshakes. */
  encodeState(): Uint8Array;
  /** Encoded diff against a peer's state vector, for sync handshakes. */
  encodeDiff(stateVector: Uint8Array): Uint8Array;
  /** Current awareness state for snapshot replay on new joins. */
  getAwarenessState(): { userId: UserId; state: Record<string, unknown> } | null;
}

class MemoryHub {
  private rooms = new Map<string, Set<MemorySubscriberInternal>>();

  join(docId: string, sub: MemorySubscriberInternal): void {
    let room = this.rooms.get(docId);
    if (!room) {
      room = new Set();
      this.rooms.set(docId, room);
    }
    // Sync handshake with existing peers BEFORE adding ourselves: every
    // existing peer ships their current state to us, and we ship ours back.
    // This is the CRDT-correct equivalent of "I just joined, please catch
    // me up + you should catch up too in case I have changes you don't."
    for (const existing of room) {
      const myStateVector = sub.encodeState();
      const peerStateVector = existing.encodeState();
      // peer -> me
      const peerDiff = existing.encodeDiff(myStateVector);
      sub.onUpdate(peerDiff, existing.docClientId);
      // me -> peer
      const myDiff = sub.encodeDiff(peerStateVector);
      existing.onUpdate(myDiff, sub.docClientId);
      // peer awareness -> me
      const peerAw = existing.getAwarenessState();
      if (peerAw) sub.onAwareness(peerAw.userId, peerAw.state);
      // me awareness -> peer
      const myAw = sub.getAwarenessState();
      if (myAw) existing.onAwareness(myAw.userId, myAw.state);
    }
    room.add(sub);
  }

  leave(docId: string, sub: MemorySubscriberInternal): void {
    const room = this.rooms.get(docId);
    if (!room) return;
    room.delete(sub);
    if (room.size === 0) this.rooms.delete(docId);
  }

  broadcastUpdate(docId: string, update: Uint8Array, originClientId: number): void {
    const room = this.rooms.get(docId);
    if (!room) return;
    for (const sub of room) {
      if (sub.docClientId === originClientId) continue;
      sub.onUpdate(update, originClientId);
    }
  }

  broadcastAwareness(
    docId: string,
    userId: UserId,
    state: Record<string, unknown> | null,
    originClientId: number,
  ): void {
    const room = this.rooms.get(docId);
    if (!room) return;
    for (const sub of room) {
      if (sub.docClientId === originClientId) continue;
      sub.onAwareness(userId, state);
    }
  }

  /** Test-only: drop every room. */
  _reset(): void {
    this.rooms.clear();
  }

  /** Test-only: room size for assertions. */
  _roomSize(docId: string): number {
    return this.rooms.get(docId)?.size ?? 0;
  }
}

const memoryHub = new MemoryHub();

/** Test helper — wipes the in-process hub so cross-test state can't leak. */
export function _resetMemoryHub(): void {
  memoryHub._reset();
}

/** Test helper — current participant count in a memory room. */
export function _memoryRoomSize(docId: string): number {
  return memoryHub._roomSize(docId);
}

// ─── Internal: snapshot-coded CRDT impl ──────────────────────────────────

const STATE_KEY = 'snapshot';
const STATE_MAP_NAME = 'state';

function structuralClone<T>(value: T): T {
  // Yjs is JSON-ish in scope (no Maps/Sets in domain IRs we care about),
  // so JSON round-trip is the right fidelity bar — anything richer must be
  // refactored into our IRs explicitly.
  return JSON.parse(JSON.stringify(value)) as T;
}

function randomUserId(): UserId {
  return 'u-' + Math.random().toString(36).slice(2, 10);
}

class CrdtDocImpl<T> implements CrdtDoc<T> {
  readonly id: string;
  private readonly ydoc: Y.Doc;
  private readonly ymap: Y.Map<string>;
  private cached: T;
  private readonly listeners = new Set<(state: T) => void>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private readonly transport: CrdtTransport;
  private readonly wsUrl: string | undefined;
  private readonly userId: UserId;
  // Memory-transport awareness uses our own in-process broadcaster. Websocket
  // awareness delegates to y-protocols/awareness wired into the provider.
  // The CrdtDoc surface is `Awareness` for both — callers see one API.
  private readonly awarenessImpl: Awareness & {
    _destroy(): void;
    _receiveRemote?(userId: UserId, state: Record<string, unknown> | null): void;
    _bindMemoryBroadcast?(
      fn: (userId: UserId, state: Record<string, unknown> | null) => void,
    ): void;
    localState: Record<string, unknown>;
    remoteStates: Record<UserId, Record<string, unknown>>;
  };
  private destroyed = false;
  private readonly memorySub: MemorySubscriberInternal | null;
  private readonly observer: (event: Y.YMapEvent<string>) => void;
  // Websocket-only state.
  private wsProvider: WebsocketProviderLike | null = null;
  private wsStatusHandler: ((e: { status: 'connected' | 'disconnected' | 'connecting' }) => void) | null = null;
  private wsConnected = false;

  constructor(config: CrdtConfig<T>) {
    this.id = config.docId;
    this.transport = config.transport;
    this.wsUrl = config.wsUrl;
    this.userId = config.userId ?? randomUserId();
    if (this.transport === 'websocket' && !this.wsUrl) {
      throw new Error('crdtAdapter: wsUrl is required when transport is "websocket"');
    }

    this.ydoc = new Y.Doc();
    this.ymap = this.ydoc.getMap<string>(STATE_MAP_NAME);
    // Seed the snapshot — but ONLY if we're either (a) on the websocket
    // transport (server handshake will replace it if a peer already has
    // state) or (b) the first peer in a memory room. If we'd join an
    // existing memory room, defer seeding so the handshake's
    // peer-state-update is the source of truth (avoids last-write-wins
    // racing between two clients' identical seeds).
    const shouldSeed =
      this.transport === 'websocket' || memoryHub._roomSize(this.id) === 0;
    if (shouldSeed) {
      this.ydoc.transact(() => {
        this.ymap.set(STATE_KEY, JSON.stringify(config.initialState));
      });
    }
    this.cached = structuralClone(config.initialState);

    this.observer = (event) => {
      if (this.destroyed) return;
      if (!event.keysChanged.has(STATE_KEY)) return;
      const raw = this.ymap.get(STATE_KEY);
      if (typeof raw !== 'string') return;
      try {
        this.cached = JSON.parse(raw) as T;
      } catch {
        // Bad payload — drop, keep previous state. Indicates a peer with
        // mismatched schema; logging belongs in a higher layer.
        return;
      }
      for (const cb of this.listeners) {
        try {
          cb(this.cached);
        } catch {
          // listener errors must not bring down the doc
        }
      }
    };
    this.ymap.observe(this.observer);

    if (this.transport === 'memory') {
      const mem = new AwarenessImpl(this.id, this.userId, this.transport);
      this.awarenessImpl = mem;
      // Wire the update emitter BEFORE join() so that sync-handshake replies
      // we produce inside join() are NOT echoed back to ourselves (the
      // update events we listen for fire on local Y.applyUpdate too).
      this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === 'memory-hub') return;
        if (this.destroyed) return;
        memoryHub.broadcastUpdate(this.id, update, this.ydoc.clientID);
      });
      this.memorySub = {
        docClientId: this.ydoc.clientID,
        onUpdate: (update) => {
          if (this.destroyed) return;
          Y.applyUpdate(this.ydoc, update, 'memory-hub');
        },
        onAwareness: (userId, state) => {
          if (this.destroyed) return;
          mem._receiveRemote(userId, state);
        },
        encodeState: () => Y.encodeStateVector(this.ydoc),
        encodeDiff: (sv) => Y.encodeStateAsUpdate(this.ydoc, sv),
        getAwarenessState: () => {
          const keys = Object.keys(mem.localState);
          if (keys.length === 0) return null;
          return { userId: this.userId, state: { ...mem.localState } };
        },
      };
      mem._bindMemoryBroadcast((userId, state) => {
        memoryHub.broadcastAwareness(this.id, userId, state, this.ydoc.clientID);
      });
      memoryHub.join(this.id, this.memorySub);
      // Memory transport is always "connected" — no socket. wsConnected stays
      // false but the getter short-circuits on transport === 'memory'.
    } else {
      // 'websocket' — instantiate a real WebsocketProvider (or the injected
      // test factory). Wire awareness through y-protocols so cursors flow
      // over the same socket.
      this.memorySub = null;
      const awarenessYjs = new awarenessProtocol.Awareness(this.ydoc);
      const factory: WebsocketProviderFactory =
        config._websocketProviderFactory ??
        (({ wsUrl, docId, ydoc, awareness }) =>
          // The y-websocket types accept `awareness` in opts; cast keeps the
          // narrow `WebsocketProviderLike` interface honest without leaking
          // the full ObservableV2 typing through our facade.
          new WebsocketProvider(wsUrl, docId, ydoc, {
            connect: true,
            awareness,
          }) as unknown as WebsocketProviderLike);
      this.wsProvider = factory({
        wsUrl: this.wsUrl as string,
        docId: this.id,
        ydoc: this.ydoc,
        awareness: awarenessYjs,
      });
      // Seed wsConnected from provider in case the factory pre-connected
      // synchronously (mock case).
      this.wsConnected = !!this.wsProvider.wsconnected;
      this.wsStatusHandler = (e) => {
        if (this.destroyed) return;
        const next = e.status === 'connected';
        if (next === this.wsConnected) return;
        this.wsConnected = next;
        for (const cb of this.connectionListeners) {
          try { cb(next); } catch { /* listener crash isolated */ }
        }
      };
      this.wsProvider.on('status', this.wsStatusHandler);
      this.awarenessImpl = new WsAwarenessImpl(awarenessYjs, this.userId);
    }
  }

  get state(): T {
    return this.cached;
  }

  subscribe(cb: (state: T) => void): () => void {
    if (this.destroyed) {
      // Match Node EventEmitter semantics: late subscribers on dead objects
      // get a no-op unsubscribe rather than an exception.
      return () => {};
    }
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  update(mutator: (draft: T) => void): void {
    if (this.destroyed) {
      throw new Error('crdtAdapter: cannot update a destroyed doc');
    }
    const draft = structuralClone(this.cached);
    mutator(draft); // mutator throw aborts before we touch the Y.Doc
    const next = JSON.stringify(draft);
    const current = this.ymap.get(STATE_KEY);
    if (next === current) return; // no-op mutation — don't churn observers
    this.ydoc.transact(() => {
      this.ymap.set(STATE_KEY, next);
    });
  }

  get awareness(): Awareness {
    return this.awarenessImpl;
  }

  get isConnected(): boolean {
    if (this.destroyed) return false;
    if (this.transport === 'memory') return true;
    return this.wsConnected;
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    if (this.destroyed) return () => {};
    this.connectionListeners.add(cb);
    return () => {
      this.connectionListeners.delete(cb);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ymap.unobserve(this.observer);
    this.listeners.clear();
    this.connectionListeners.clear();
    if (this.memorySub) {
      memoryHub.leave(this.id, this.memorySub);
    }
    if (this.wsProvider) {
      try {
        if (this.wsStatusHandler) {
          this.wsProvider.off('status', this.wsStatusHandler);
        }
        this.wsProvider.destroy();
      } catch {
        // provider teardown crashes must not leak — Y.Doc still needs to die.
      }
      this.wsProvider = null;
      this.wsStatusHandler = null;
    }
    this.awarenessImpl._destroy();
    this.ydoc.destroy();
  }
}

// ─── Awareness impl ───────────────────────────────────────────────────────

class AwarenessImpl implements Awareness {
  readonly localState: Record<string, unknown> = {};
  readonly remoteStates: Record<UserId, Record<string, unknown>> = {};
  private readonly listeners = new Set<(snap: AwarenessSnapshot) => void>();
  private broadcast: ((userId: UserId, state: Record<string, unknown> | null) => void) | null =
    null;
  private destroyed = false;
  // userId is published in _destroy() so peers can clear our awareness slot.
  // docId / transport are kept for future websocket-provider wiring (Phase 2)
  // but unused in pure-memory operation; prefix with _ so lint stays quiet
  // without an inline disable directive.
  constructor(
    private readonly _docId: string,
    private readonly userId: UserId,
    private readonly _transport: CrdtTransport,
  ) {}

  setLocal(key: string, value: unknown): void {
    if (this.destroyed) return;
    if (value === undefined) {
      delete this.localState[key];
    } else {
      this.localState[key] = value;
    }
    this._broadcastLocal();
    this._notify();
  }

  onUpdate(cb: (snapshot: AwarenessSnapshot) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ── internal hooks for CrdtDocImpl ──

  _bindMemoryBroadcast(
    fn: (userId: UserId, state: Record<string, unknown> | null) => void,
  ): void {
    this.broadcast = fn;
  }

  _receiveRemote(userId: UserId, state: Record<string, unknown> | null): void {
    if (this.destroyed) return;
    if (state === null) {
      delete this.remoteStates[userId];
    } else {
      this.remoteStates[userId] = state;
    }
    this._notify();
  }

  _destroy(): void {
    if (this.destroyed) return;
    // Signal departure to peers so their UIs can drop our cursor.
    if (this.broadcast) {
      try {
        this.broadcast(this.userId, null);
      } catch {
        // ignore — destroy must not throw
      }
    }
    this.destroyed = true;
    this.listeners.clear();
    this.broadcast = null;
  }

  private _broadcastLocal(): void {
    if (!this.broadcast) return;
    this.broadcast(this.userId, { ...this.localState });
  }

  private _notify(): void {
    const snap: AwarenessSnapshot = {
      localState: { ...this.localState },
      remoteStates: { ...this.remoteStates },
    };
    for (const cb of this.listeners) {
      try {
        cb(snap);
      } catch {
        // listener errors must not crash awareness propagation
      }
    }
  }
}

// ─── Websocket-backed awareness adapter ──────────────────────────────────
// Wraps y-protocols/awareness so the WsAwarenessImpl conforms to our
// Awareness interface. Awareness states arrive keyed by Yjs clientID
// (number); we expose them keyed by UserId (string) by stashing the user id
// inside every published state under the reserved `__userId` field. That
// stays consistent with how the memory transport identifies peers.

const USER_ID_FIELD = '__userId';

class WsAwarenessImpl implements Awareness {
  // localState / remoteStates are recomputed lazily off the underlying
  // y-protocols awareness map. Exposed as getter-backed records so existing
  // callers that read `awareness.localState` keep working without an extra
  // build step.
  private readonly listeners = new Set<(snap: AwarenessSnapshot) => void>();
  private destroyed = false;
  private readonly handler: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;

  constructor(
    private readonly yAwareness: awarenessProtocol.Awareness,
    private readonly userId: UserId,
  ) {
    // Seed the local state with the user id so peers can identify us in
    // their remoteStates map.
    this.yAwareness.setLocalStateField(USER_ID_FIELD, this.userId);
    this.handler = () => {
      if (this.destroyed) return;
      const snap: AwarenessSnapshot = {
        localState: this.localState,
        remoteStates: this.remoteStates,
      };
      for (const cb of this.listeners) {
        try { cb(snap); } catch { /* listener crash isolated */ }
      }
    };
    this.yAwareness.on('change', this.handler);
  }

  get localState(): Record<string, unknown> {
    const raw = this.yAwareness.getLocalState() ?? {};
    // Hide the internal user-id field from callers — it's plumbing.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === USER_ID_FIELD) continue;
      out[k] = v;
    }
    return out;
  }

  get remoteStates(): Record<UserId, Record<string, unknown>> {
    const out: Record<UserId, Record<string, unknown>> = {};
    const states = this.yAwareness.getStates();
    for (const [clientId, raw] of states) {
      if (clientId === this.yAwareness.clientID) continue;
      const obj = raw as Record<string, unknown>;
      const uid = obj?.[USER_ID_FIELD];
      // Skip peers that haven't announced a user id yet — they're in the
      // first-handshake window and we'd otherwise key them by ''.
      if (typeof uid !== 'string' || uid.length === 0) continue;
      // Strip the plumbing field from what callers see.
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === USER_ID_FIELD) continue;
        copy[k] = v;
      }
      out[uid] = copy;
    }
    return out;
  }

  setLocal(key: string, value: unknown): void {
    if (this.destroyed) return;
    if (key === USER_ID_FIELD) {
      // Defend the plumbing field — callers must not clobber it.
      return;
    }
    if (value === undefined) {
      // y-protocols has no "delete one field" API — round-trip via the full
      // local state. setLocalState with the user-id field preserved.
      const current = this.yAwareness.getLocalState() ?? {};
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(current)) {
        if (k === key) continue;
        next[k] = v;
      }
      next[USER_ID_FIELD] = this.userId;
      this.yAwareness.setLocalState(next);
    } else {
      this.yAwareness.setLocalStateField(key, value);
    }
  }

  onUpdate(cb: (snapshot: AwarenessSnapshot) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  _destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.yAwareness.off('change', this.handler);
    } catch {
      // ignore
    }
    // Publish a null local state so peers drop our cursor immediately. This
    // is the y-protocols "I'm leaving" handshake — equivalent to the memory
    // hub's broadcast(userId, null) we use elsewhere.
    try {
      awarenessProtocol.removeAwarenessStates(
        this.yAwareness,
        [this.yAwareness.clientID],
        'local',
      );
    } catch {
      // ignore — awareness may already be torn down
    }
    this.listeners.clear();
  }
}

// ─── public factory ───────────────────────────────────────────────────────

export function createCrdtDoc<T>(config: CrdtConfig<T>): CrdtDoc<T> {
  if (!config.docId) {
    throw new Error('crdtAdapter: docId is required');
  }
  if (config.transport !== 'memory' && config.transport !== 'websocket') {
    throw new Error(`crdtAdapter: unknown transport "${String(config.transport)}"`);
  }
  return new CrdtDocImpl<T>(config);
}

// ─── domain helpers ───────────────────────────────────────────────────────

/**
 * Convenience factory for FeatureTree-backed CRDT docs. Wraps createCrdtDoc
 * so call sites don't have to repeat the generic + transport defaults.
 */
export function createFeatureTreeDoc(
  docId: string,
  initial: FeatureTree,
  opts: {
    transport?: CrdtTransport;
    wsUrl?: string;
    userId?: UserId;
    _websocketProviderFactory?: WebsocketProviderFactory;
  } = {},
): CrdtDoc<FeatureTree> {
  return createCrdtDoc<FeatureTree>({
    docId,
    initialState: initial,
    transport: opts.transport ?? 'memory',
    wsUrl: opts.wsUrl,
    userId: opts.userId,
    _websocketProviderFactory: opts._websocketProviderFactory,
  });
}

/**
 * Convenience factory for AssemblyState-backed CRDT docs. See
 * createFeatureTreeDoc.
 */
export function createAssemblyDoc(
  docId: string,
  initial: AssemblyState,
  opts: {
    transport?: CrdtTransport;
    wsUrl?: string;
    userId?: UserId;
    _websocketProviderFactory?: WebsocketProviderFactory;
  } = {},
): CrdtDoc<AssemblyState> {
  return createCrdtDoc<AssemblyState>({
    docId,
    initialState: initial,
    transport: opts.transport ?? 'memory',
    wsUrl: opts.wsUrl,
    userId: opts.userId,
    _websocketProviderFactory: opts._websocketProviderFactory,
  });
}
