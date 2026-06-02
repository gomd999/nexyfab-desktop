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
 *   - Awareness piggybacks on the Y.Doc — its own Y.Map keyed by user id —
 *     so we don't pull in y-protocols just for cursor sharing in Phase 1.
 *
 * Transports:
 *   - 'memory': single process. The Y.Doc is local-only; updates produced by
 *     this doc are broadcast to every other in-process doc that joined the
 *     same docId via the shared MemoryHub. Test/SSR friendly.
 *   - 'websocket': stub. We retain the wsUrl on the config so the caller can
 *     verify their wiring, but the actual y-websocket provider is not bound
 *     until Phase 2 (needs a server — see report).
 *
 * Out of scope (Phase 2+):
 *   - Real websocket provider (y-websocket → /api/collab/ws)
 *   - Persistence provider (y-indexeddb on the client, IndexedDb shim for SSR)
 *   - Auth / room ACLs (must reuse nfProjectAccess)
 *   - Conflict resolution beyond JSON snapshot replace (Y.Array / Y.Map nodes
 *     for fine-grained merges)
 */

import * as Y from 'yjs';
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
  /** Tear down. Unsubscribes all listeners, detaches from the hub, frees the
   *  Y.Doc. Calling this twice is a no-op. */
  destroy(): void;
}

export type CrdtTransport = 'memory' | 'websocket';

export interface CrdtConfig<T> {
  docId: string;
  initialState: T;
  transport: CrdtTransport;
  /** WebSocket endpoint. Required when transport === 'websocket'. Stored
   *  but not yet connected (Phase 2). */
  wsUrl?: string;
  /** Client identifier for awareness (cursor ownership). Defaults to a random
   *  string so unit tests don't have to plumb it through. */
  userId?: UserId;
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
  private readonly transport: CrdtTransport;
  private readonly wsUrl: string | undefined;
  private readonly userId: UserId;
  private readonly awarenessImpl: AwarenessImpl;
  private destroyed = false;
  private readonly memorySub: MemorySubscriberInternal | null;
  private readonly observer: (event: Y.YMapEvent<string>) => void;

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
    // Seed the snapshot — but ONLY if we're either (a) on the websocket stub
    // transport (no peers to inherit from) or (b) the first peer in a memory
    // room. If we'd join an existing memory room, defer seeding so the
    // handshake's peer-state-update is the source of truth (avoids
    // last-write-wins racing between two clients' identical seeds).
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

    this.awarenessImpl = new AwarenessImpl(this.id, this.userId, this.transport);

    if (this.transport === 'memory') {
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
          this.awarenessImpl._receiveRemote(userId, state);
        },
        encodeState: () => Y.encodeStateVector(this.ydoc),
        encodeDiff: (sv) => Y.encodeStateAsUpdate(this.ydoc, sv),
        getAwarenessState: () => {
          const keys = Object.keys(this.awarenessImpl.localState);
          if (keys.length === 0) return null;
          return { userId: this.userId, state: { ...this.awarenessImpl.localState } };
        },
      };
      this.awarenessImpl._bindMemoryBroadcast((userId, state) => {
        memoryHub.broadcastAwareness(this.id, userId, state, this.ydoc.clientID);
      });
      memoryHub.join(this.id, this.memorySub);
    } else {
      // 'websocket' — Phase 2 stub. We deliberately do NOT connect; callers
      // get the same API and can exercise local update/subscribe flows. The
      // wsUrl is retained for diagnostics & future provider wiring.
      this.memorySub = null;
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ymap.unobserve(this.observer);
    this.listeners.clear();
    if (this.memorySub) {
      memoryHub.leave(this.id, this.memorySub);
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
  opts: { transport?: CrdtTransport; wsUrl?: string; userId?: UserId } = {},
): CrdtDoc<FeatureTree> {
  return createCrdtDoc<FeatureTree>({
    docId,
    initialState: initial,
    transport: opts.transport ?? 'memory',
    wsUrl: opts.wsUrl,
    userId: opts.userId,
  });
}

/**
 * Convenience factory for AssemblyState-backed CRDT docs. See
 * createFeatureTreeDoc.
 */
export function createAssemblyDoc(
  docId: string,
  initial: AssemblyState,
  opts: { transport?: CrdtTransport; wsUrl?: string; userId?: UserId } = {},
): CrdtDoc<AssemblyState> {
  return createCrdtDoc<AssemblyState>({
    docId,
    initialState: initial,
    transport: opts.transport ?? 'memory',
    wsUrl: opts.wsUrl,
    userId: opts.userId,
  });
}
