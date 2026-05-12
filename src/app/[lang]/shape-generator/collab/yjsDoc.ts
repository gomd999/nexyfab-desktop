/**
 * Y.Doc wrapper for shape-generator real-time collaboration.
 *
 * The existing SSE transport (useCollab) is preserved as the broadcast channel.
 * This module layers Yjs on top so concurrent edits to the *same* fields no
 * longer last-write-wins each other — the CRDT merges them deterministically.
 *
 * Shared state:
 *   - `params` (Y.Map<number>) — float values from sliders
 *   - `selectedId` (Y.Map<string> single-key) — current shape
 *   - `featureOrder` (Y.Array<string>) — feature-tree node order
 *   - `featureTree` (Y.Map<unknown>) — node id → serialized HistoryNode (round-tripped JSON)
 *
 * `featureTree` stores nodes as plain JSON values keyed by node id. Yjs merges
 * concurrent set/delete on different keys without conflict; same-key writes
 * deterministically choose one side (last-writer-wins on the key).
 */

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';

const PARAMS_KEY = 'params';
const SELECTED_KEY = 'selected';
const FEATURE_ORDER_KEY = 'featureOrder';
const FEATURE_TREE_KEY = 'featureTree';

export interface SharedParamsListener {
  (params: Record<string, number>): void;
}

export interface SharedShapeListener {
  (shapeId: string | null): void;
}

export interface SharedFeatureOrderListener {
  (order: string[]): void;
}

export interface SharedFeatureTreeListener {
  (tree: Record<string, unknown>): void;
}

/**
 * Ephemeral per-user state — cursor position, selected element, currently-
 * editing feature, etc. NOT persisted with the document; lives only in the
 * Yjs Awareness layer and is broadcast on every change.
 */
export interface PresenceState {
  /** Display name for cursor labels. */
  name?: string;
  /** Hex color, e.g. "#f97316" — assigned per session. */
  color?: string;
  /** Last known cursor in viewport coords, mm-scale. */
  cursor?: { x: number; y: number; z?: number };
  /** Feature node id the user is currently editing, if any. */
  editingNodeId?: string;
  /** Feature node id the user is currently focused on (selected, but not
   *  necessarily editing). Drives "X is looking at this feature" hints. */
  selectedFeatureId?: string;
  /** Which workspace mode the peer is in: '3d' (default), 'sketch' (2D
   *  drawing), 'drawing' (technical drawing view). Lets peers see "Bob
   *  switched to sketch mode" in the presence panel. */
  viewportMode?: '3d' | 'sketch' | 'drawing';
  /** Coarse activity status — 'active' (cursor moved or input within last
   *  ~15s) vs 'idle' (no recent activity). Distinct from staleness GC which
   *  only fires after 30s of NO updates at all. */
  activity?: 'active' | 'idle';
  /** Last activity timestamp for stale-presence cleanup. */
  ts?: number;
}

export interface PresenceListener {
  (presences: Map<number, PresenceState>): void;
}

export class CollabDoc {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly params: Y.Map<number>;
  private readonly selected: Y.Map<string>;
  private readonly featureOrder: Y.Array<string>;
  private readonly featureTree: Y.Map<unknown>;

  constructor() {
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.params = this.doc.getMap<number>(PARAMS_KEY);
    this.selected = this.doc.getMap<string>(SELECTED_KEY);
    this.featureOrder = this.doc.getArray<string>(FEATURE_ORDER_KEY);
    this.featureTree = this.doc.getMap<unknown>(FEATURE_TREE_KEY);
  }

  // ─── Awareness (presence) — ephemeral cursor / selection / identity ───────

  /** Get the local client's presence state. */
  getLocalPresence(): PresenceState {
    return (this.awareness.getLocalState() ?? {}) as PresenceState;
  }

  /** Merge fields into the local presence state. Broadcast happens automatically. */
  setLocalPresence(patch: Partial<PresenceState>): void {
    const current = this.getLocalPresence();
    this.awareness.setLocalState({ ...current, ...patch, ts: Date.now() });
  }

  /** Snapshot all peers' presence keyed by Yjs client id. */
  getPresences(): Map<number, PresenceState> {
    const out = new Map<number, PresenceState>();
    this.awareness.getStates().forEach((s, clientId) => {
      out.set(clientId, (s ?? {}) as PresenceState);
    });
    return out;
  }

  onPresenceChange(cb: PresenceListener): () => void {
    const handler = () => cb(this.getPresences());
    this.awareness.on('change', handler);
    return () => this.awareness.off('change', handler);
  }

  /**
   * Encode an awareness update to push to peers. Pass undefined to broadcast
   * the full local state. The result is base64 so it survives JSON transport.
   */
  encodeAwarenessUpdate(): string {
    const update = encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]);
    return base64FromBytes(update);
  }

  /** Apply a peer's awareness update (binary, base64-encoded). */
  applyAwarenessUpdate(b64: string): boolean {
    if (typeof b64 !== 'string' || b64.length === 0) return false;
    try {
      applyAwarenessUpdate(this.awareness, base64ToBytes(b64), 'remote');
      return true;
    } catch (e) {
      console.warn('[yjsDoc] applyAwarenessUpdate failed:', e);
      return false;
    }
  }

  /** Listen for local-only awareness changes (your own cursor moves, etc). */
  onLocalAwarenessUpdate(cb: (b64: string) => void): () => void {
    const handler = (_changed: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'remote') return;
      cb(this.encodeAwarenessUpdate());
    };
    this.awareness.on('update', handler);
    return () => this.awareness.off('update', handler);
  }

  /**
   * Garbage-collect stale presences (no `ts` update in `staleAfterMs`). Y.js
   * Awareness has a built-in timeout meant for connected protocols, but our
   * SSE transport is one-way: a peer that closes their tab never sends a
   * `removeStates` message. We sweep manually so cursors don't linger forever.
   *
   * Returns the number of presences removed.
   */
  gcStaleAwareness(staleAfterMs = 30_000): number {
    const now = Date.now();
    const stale: number[] = [];
    this.awareness.getStates().forEach((s, clientId) => {
      if (clientId === this.awareness.clientID) return;
      const ts = (s as PresenceState | undefined)?.ts;
      if (typeof ts !== 'number' || now - ts >= staleAfterMs) {
        stale.push(clientId);
      }
    });
    if (stale.length === 0) return 0;
    // Removing emits an awareness 'change' event so listeners see the trim.
    // Tag with a dedicated origin so onLocalAwarenessUpdate doesn't broadcast it.
    // (broadcasting a "they disappeared" notice is fine but redundant — peers
    //  will GC the same way independently.)
    this.awareness.doc.transact(() => {
      // No-op transact to batch the next removal.
    });
    // Awareness API: `removeAwarenessStates(awareness, clients, origin)` is in
    // y-protocols/awareness, but we can equivalently delete from `_meta` and
    // emit. The simplest correct approach is the public helper:
    type AwarenessAny = typeof this.awareness & {
      _checkInterval?: unknown;
      states: Map<number, unknown>;
      meta: Map<number, { clock: number; lastUpdated: number }>;
    };
    const aw = this.awareness as AwarenessAny;
    for (const id of stale) {
      aw.states.delete(id);
      aw.meta.delete(id);
    }
    aw.emit('change', [{ added: [], updated: [], removed: stale }, 'gc']);
    aw.emit('update', [{ added: [], updated: [], removed: stale }, 'gc']);
    return stale.length;
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  getParams(): Record<string, number> {
    const out: Record<string, number> = {};
    this.params.forEach((v, k) => { out[k] = v; });
    return out;
  }

  getSelectedId(): string | null {
    return this.selected.get('id') ?? null;
  }

  getFeatureOrder(): string[] {
    return this.featureOrder.toArray();
  }

  /** Snapshot the feature tree as a plain object (id → node). */
  getFeatureTree(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.featureTree.forEach((v, k) => { out[k] = v; });
    return out;
  }

  getFeatureNode(id: string): unknown {
    return this.featureTree.get(id);
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /** Replace all params with the given map. Keys removed from `next` are deleted. */
  setParams(next: Record<string, number>): void {
    this.doc.transact(() => {
      const seen = new Set(Object.keys(next));
      for (const [k, v] of Object.entries(next)) {
        if (typeof v === 'number' && Number.isFinite(v)) this.params.set(k, v);
      }
      this.params.forEach((_, k) => {
        if (!seen.has(k)) this.params.delete(k);
      });
    });
  }

  setSelectedId(id: string | null): void {
    this.doc.transact(() => {
      if (id === null) this.selected.delete('id');
      else this.selected.set('id', id);
    });
  }

  setFeatureOrder(order: string[]): void {
    this.doc.transact(() => {
      const current = this.featureOrder.toArray();
      // Cheapest correct update: clear and re-insert. For long lists, callers
      // can use applyOrderDiff() for finer-grained CRDT moves.
      if (current.length > 0) this.featureOrder.delete(0, current.length);
      if (order.length > 0) this.featureOrder.insert(0, order);
    });
  }

  /** Insert or update a single feature node. */
  setFeatureNode(id: string, node: unknown): void {
    this.doc.transact(() => {
      this.featureTree.set(id, node);
    });
  }

  deleteFeatureNode(id: string): void {
    this.doc.transact(() => {
      this.featureTree.delete(id);
    });
  }

  /**
   * Replace the entire tree. Used when a local snapshot needs to overwrite
   * the shared state (e.g., right after a destructive undo). Per-key writes
   * still merge cleanly on the wire because `featureTree` is a Y.Map.
   */
  setFeatureTree(tree: Record<string, unknown>): void {
    this.doc.transact(() => {
      const seen = new Set(Object.keys(tree));
      for (const [id, node] of Object.entries(tree)) {
        this.featureTree.set(id, node);
      }
      this.featureTree.forEach((_, k) => {
        if (!seen.has(k)) this.featureTree.delete(k);
      });
    });
  }

  // ─── Subscriptions ───────────────────────────────────────────────────────

  onParamsChanged(cb: SharedParamsListener): () => void {
    const handler = () => cb(this.getParams());
    this.params.observe(handler);
    return () => this.params.unobserve(handler);
  }

  onSelectedChanged(cb: SharedShapeListener): () => void {
    const handler = () => cb(this.getSelectedId());
    this.selected.observe(handler);
    return () => this.selected.unobserve(handler);
  }

  onFeatureOrderChanged(cb: SharedFeatureOrderListener): () => void {
    const handler = () => cb(this.getFeatureOrder());
    this.featureOrder.observe(handler);
    return () => this.featureOrder.unobserve(handler);
  }

  onFeatureTreeChanged(cb: SharedFeatureTreeListener): () => void {
    const handler = () => cb(this.getFeatureTree());
    this.featureTree.observe(handler);
    return () => this.featureTree.unobserve(handler);
  }

  // ─── Transport-friendly state encoding ──────────────────────────────────
  // Both directions go through base64 because the SSE/POST channel is JSON.

  /**
   * Encode a delta of local changes since `since` to broadcast to peers.
   * If `since` is undefined, encodes the full doc state — used on first join.
   */
  encodeUpdate(since?: Uint8Array): string {
    const update = since ? Y.encodeStateAsUpdate(this.doc, since) : Y.encodeStateAsUpdate(this.doc);
    return base64FromBytes(update);
  }

  /** Apply a remote peer's update (binary, base64-encoded). */
  applyUpdate(base64: string): void {
    if (typeof base64 !== 'string' || base64.length === 0) return;
    try {
      Y.applyUpdate(this.doc, base64ToBytes(base64));
    } catch (e) {
      console.warn('[yjsDoc] applyUpdate failed:', e);
    }
  }

  /** Snapshot the current state vector — used by peers to compute deltas. */
  encodeStateVector(): string {
    return base64FromBytes(Y.encodeStateVector(this.doc));
  }

  /** Listen for any change and emit a base64-encoded update to a transport. */
  onLocalUpdate(cb: (base64: string) => void): () => void {
    const handler = (update: Uint8Array, origin: unknown) => {
      // Skip updates that arrived from a remote (origin === 'remote') so we
      // don't echo them back into the broadcast channel.
      if (origin === 'remote') return;
      cb(base64FromBytes(update));
    };
    this.doc.on('update', handler);
    return () => this.doc.off('update', handler);
  }

  /** Apply a remote update with the 'remote' origin tag so onLocalUpdate skips it. */
  applyRemoteUpdate(base64: string): boolean {
    if (typeof base64 !== 'string' || base64.length === 0) return false;
    try {
      this.doc.transact(() => {
        Y.applyUpdate(this.doc, base64ToBytes(base64));
      }, 'remote');
      return true;
    } catch (e) {
      console.warn('[yjsDoc] applyRemoteUpdate failed:', e);
      return false;
    }
  }

  destroy(): void {
    this.awareness.destroy();
    this.doc.destroy();
  }
}

// ─── Base64 helpers (browser + Node compatible) ─────────────────────────────

function base64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
   
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
   
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
