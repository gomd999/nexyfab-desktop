/**
 * FeatureTreeStore.ts — Wave 2 Phase 3 Week 3 Track Z3.
 *
 * Adapter that gives ONE API for both:
 *
 *   - **local mode** — `FeatureTreeStore.local(initial?)` wraps a plain
 *     in-memory snapshot. Mutations mutate the snapshot and fire
 *     `subscribe()` listeners. This is the legacy `useFeatureStack`
 *     equivalent: when `?crdt=v2` is OFF the host stays on `useFeatureStack`
 *     directly and this store is unused.
 *
 *   - **Yjs mode** — `FeatureTreeStore.fromYDoc(doc)` wraps a `Y.Doc` whose
 *     `tree` Y.Array + `sketches` Y.Map + `treeMeta` Y.Map structure is the
 *     one defined in `collab/featureTreeYjs.ts`. Every mutation routes
 *     through `applyFeatureOp` so all writes land inside `doc.transact()`.
 *     Reads call `yDocToFeatureTree()` and reproject into the
 *     `FeatureTreeSnapshot` shape the host consumes.
 *
 * Both modes implement the same `FeatureTreeStore` interface. The host hook
 * (`useFeatureTreeStore.ts`) picks one based on the `?crdt=v2` flag.
 *
 * **Why an adapter and not edits to featureTreeYjs.ts?**
 *   - featureTreeYjs.ts is Phase 1 Week 2 frozen — 22 collab tests + the
 *     two-level shape (`tree` Y.Array + `sketches` Y.Map keyed by id) are
 *     the long-term wire format. Touching it risks the Wave 2 burn-in
 *     baseline.
 *   - The host UI today uses `useFeatureStack`'s reducer (Map-of-id +
 *     `rootId` / `activeNodeId` / `editingNodeId`). One seam between that
 *     and the Y representation is exactly what we need.
 *
 * **editingNodeId stays LOCAL.** The spec ambiguity in the brief asks
 * "kept local or shared?" — the answer is **local per peer**. Two users
 * editing two different feature panels at the same time is the desired
 * UX (Z5 multi-cursor); broadcasting `editingNodeId` would force a
 * single-editor lock. The local store does carry it for compatibility,
 * but in Yjs mode `getEditingNodeId()` returns the per-store local
 * field, NOT the doc-level meta. (`treeMeta.editingNodeId` exists in the
 * doc but is treated as a "last-known broadcast" snapshot only, not as
 * authoritative state.)
 *
 * **activeNodeId IS shared.** The doc's `treeMeta.activeNodeId` is the
 * canonical "rollback head" — every peer sees the same active feature
 * (it determines the OCCT pipeline result). `setActive(id)` writes to
 * the doc; reads come from the doc.
 *
 * **rootId IS shared.** Set once on doc bootstrap from local snapshot;
 * never reassigned after.
 */

import * as Y from 'yjs';
import {
  applyFeatureOp,
  yDocToFeatureTree,
  getSharedTree,
  getSharedSketches,
  getSharedMeta,
  type FeatureTreeSnapshot,
} from '../collab/featureTreeYjs';
import type {
  FeatureHistory,
  HistoryNode,
  SketchNodeData,
} from '../useFeatureStack';

// ─── Public interface ──────────────────────────────────────────────────────

/** The minimum API a Z3 host needs from a feature-tree store.
 *
 *  This is a strict subset of `useFeatureStack`'s surface:
 *    - addNode / removeNode / reorder / updateParams / updateLabel /
 *      setEnabled — the CRDT-friendly mutations
 *    - setActive — `treeMeta` write
 *    - updateSketch — patches into the shared sketches map
 *
 *  Selection arrays + per-peer hover state are NOT here — they're per-user
 *  and stay in React state at the panel layer (mirrors Z2). */
export interface FeatureTreeStore {
  readonly mode: 'local' | 'yjs';

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Full snapshot — flat node array (DFS order), rootId, activeNodeId,
   *  editingNodeId, plus sketches keyed by sketch id. */
  getSnapshot(): FeatureTreeSnapshot;

  /** DFS-ordered nodes (matches `useFeatureStack.getOrderedNodes()`). */
  getNodes(): HistoryNode[];
  getRootId(): string;
  getActiveNodeId(): string;
  getEditingNodeId(): string | null;
  getSketches(): Record<string, SketchNodeData>;

  // ── Mutations — tree ────────────────────────────────────────────────────

  /** Add a node. `afterId` is OPTIONAL — when present, the node is inserted
   *  immediately after that id in the tree array (mirrors `applyFeatureOp`'s
   *  contract). When omitted, the node lands at the array tail. */
  addNode(node: HistoryNode, sketchData?: SketchNodeData, afterId?: string | null): void;
  removeNode(id: string): void;
  reorder(id: string, toIndex: number): void;
  updateParams(id: string, params: Record<string, number>): void;
  updateLabel(id: string, label: string): void;
  setEnabled(id: string, enabled: boolean): void;
  setActive(activeNodeId: string): void;

  // ── Mutations — sketch payload ──────────────────────────────────────────

  updateSketch(sketchId: string, patch: Partial<SketchNodeData>): void;

  // ── Per-peer state (NOT shared in Yjs mode) ─────────────────────────────

  /** Set the local "currently editing" node id. NOT propagated through Y.Doc;
   *  each peer owns its own editing state. */
  setEditingNodeId(id: string | null): void;

  // ── Subscription ────────────────────────────────────────────────────────

  subscribe(listener: () => void): () => void;

  /** Release resources (Yjs observer, listener set). Idempotent. */
  destroy(): void;

  /** Yjs-mode only: the underlying doc. Exposed for tests and for the host's
   *  LWW-collision toast wiring at the integration layer. */
  getDoc?(): Y.Doc;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function emptyHistory(rootId: string): FeatureHistory {
  return {
    nodes: [
      {
        id: rootId,
        type: 'baseShape',
        label: 'Base Shape',
        icon: '📦',
        params: {},
        enabled: true,
        expanded: true,
        parentId: null,
        children: [],
        editingActive: false,
        timestamp: Date.now(),
      },
    ],
    rootId,
    activeNodeId: rootId,
    editingNodeId: null,
  };
}

function genRootId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `root-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Local mode ────────────────────────────────────────────────────────────

class LocalFeatureTreeStore implements FeatureTreeStore {
  readonly mode = 'local' as const;
  private nodes: Map<string, HistoryNode>;
  private rootId: string;
  private activeNodeId: string;
  private editingNodeId: string | null;
  private sketches: Map<string, SketchNodeData>;
  private listeners = new Set<() => void>();

  constructor(initial?: FeatureTreeSnapshot) {
    if (initial) {
      this.nodes = new Map();
      for (const n of initial.tree.nodes) {
        this.nodes.set(n.id, this.cloneNode(n));
      }
      this.rootId = initial.tree.rootId;
      this.activeNodeId = initial.tree.activeNodeId;
      this.editingNodeId = initial.tree.editingNodeId;
      this.sketches = new Map(
        Object.entries(initial.sketches ?? {}).map(([k, v]) => [k, { ...v }]),
      );
    } else {
      const rootId = genRootId();
      const seed = emptyHistory(rootId);
      this.nodes = new Map();
      for (const n of seed.nodes) this.nodes.set(n.id, this.cloneNode(n));
      this.rootId = rootId;
      this.activeNodeId = rootId;
      this.editingNodeId = null;
      this.sketches = new Map();
    }
  }

  private cloneNode(n: HistoryNode): HistoryNode {
    return {
      ...n,
      params: { ...n.params },
      children: [...n.children],
      dependsOn: n.dependsOn ? [...n.dependsOn] : undefined,
      sketchData: n.sketchData ? { ...n.sketchData } : undefined,
      edgeSelections: n.edgeSelections ? [...n.edgeSelections] : undefined,
      faceSelections: n.faceSelections ? [...n.faceSelections] : undefined,
    };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  private orderedNodes(): HistoryNode[] {
    const out: HistoryNode[] = [];
    const seen = new Set<string>();
    const dfs = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const n = this.nodes.get(id);
      if (!n) return;
      out.push(this.cloneNode(n));
      for (const c of n.children) dfs(c);
    };
    if (this.nodes.has(this.rootId)) dfs(this.rootId);
    // Append any orphan nodes (parentId pointing nowhere) — defensive vs.
    // ill-formed snapshots. They follow rootId DFS in insertion order.
    for (const id of this.nodes.keys()) {
      if (!seen.has(id)) {
        const n = this.nodes.get(id)!;
        out.push(this.cloneNode(n));
      }
    }
    return out;
  }

  getSnapshot(): FeatureTreeSnapshot {
    const nodes = this.orderedNodes();
    const sketches: Record<string, SketchNodeData> = {};
    for (const [k, v] of this.sketches) sketches[k] = { ...v };
    return {
      tree: {
        nodes,
        rootId: this.rootId,
        activeNodeId: this.activeNodeId,
        editingNodeId: this.editingNodeId,
      },
      sketches,
    };
  }

  getNodes(): HistoryNode[] { return this.orderedNodes(); }
  getRootId(): string { return this.rootId; }
  getActiveNodeId(): string { return this.activeNodeId; }
  getEditingNodeId(): string | null { return this.editingNodeId; }
  getSketches(): Record<string, SketchNodeData> {
    const out: Record<string, SketchNodeData> = {};
    for (const [k, v] of this.sketches) out[k] = { ...v };
    return out;
  }

  // ── Mutations ───────────────────────────────────────────────────────────

  addNode(node: HistoryNode, sketchData?: SketchNodeData, afterId?: string | null): void {
    if (!node.id) throw new Error('[FeatureTreeStore] addNode requires node.id');
    // LWW on same id: replace.
    const cloned = this.cloneNode(node);
    if (sketchData) this.sketches.set(node.id, { ...sketchData });
    this.nodes.set(node.id, cloned);

    // Wire parent → children. If parent already has the id (idempotent add),
    // we leave it; otherwise we splice after `afterId` when present.
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent && !parent.children.includes(node.id)) {
        const newChildren = [...parent.children];
        let insertAt = newChildren.length;
        if (afterId) {
          const idx = newChildren.indexOf(afterId);
          if (idx !== -1) insertAt = idx + 1;
        }
        newChildren.splice(insertAt, 0, node.id);
        this.nodes.set(node.parentId, { ...parent, children: newChildren });
      }
    }
    this.notify();
  }

  removeNode(id: string): void {
    if (id === this.rootId) return; // root not removable
    if (!this.nodes.has(id)) return;

    // Collect subtree
    const toRemove = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (toRemove.has(cur)) continue;
      toRemove.add(cur);
      const node = this.nodes.get(cur);
      if (node) for (const c of node.children) stack.push(c);
    }

    // Detach from parent
    const removed = this.nodes.get(id)!;
    if (removed.parentId) {
      const parent = this.nodes.get(removed.parentId);
      if (parent) {
        this.nodes.set(removed.parentId, {
          ...parent,
          children: parent.children.filter(c => c !== id),
        });
      }
    }

    for (const rid of toRemove) {
      this.nodes.delete(rid);
      this.sketches.delete(rid);
    }

    // Roll back active / editing pointers if they were inside the removed subtree.
    if (toRemove.has(this.activeNodeId)) {
      this.activeNodeId = removed.parentId ?? this.rootId;
    }
    if (this.editingNodeId && toRemove.has(this.editingNodeId)) {
      this.editingNodeId = null;
    }
    this.notify();
  }

  reorder(id: string, toIndex: number): void {
    const node = this.nodes.get(id);
    if (!node || !node.parentId) return;
    const parent = this.nodes.get(node.parentId);
    if (!parent) return;
    const idx = parent.children.indexOf(id);
    if (idx === -1) return;
    const clamped = Math.max(0, Math.min(toIndex, parent.children.length - 1));
    if (clamped === idx) return;
    const newChildren = [...parent.children];
    newChildren.splice(idx, 1);
    newChildren.splice(clamped, 0, id);
    this.nodes.set(node.parentId, { ...parent, children: newChildren });
    this.notify();
  }

  updateParams(id: string, params: Record<string, number>): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.set(id, { ...node, params: { ...node.params, ...params }, error: undefined });
    this.notify();
  }

  updateLabel(id: string, label: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.set(id, { ...node, label });
    this.notify();
  }

  setEnabled(id: string, enabled: boolean): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.set(id, { ...node, enabled });
    this.notify();
  }

  setActive(activeNodeId: string): void {
    if (!this.nodes.has(activeNodeId)) return;
    this.activeNodeId = activeNodeId;
    this.notify();
  }

  updateSketch(sketchId: string, patch: Partial<SketchNodeData>): void {
    const existing = this.sketches.get(sketchId);
    if (!existing) return;
    this.sketches.set(sketchId, { ...existing, ...patch });
    // Also update the embedded `sketchData` on the node (back-compat with
    // legacy useFeatureStack consumers that read `node.sketchData`).
    const node = this.nodes.get(sketchId);
    if (node && node.sketchData) {
      this.nodes.set(sketchId, { ...node, sketchData: { ...node.sketchData, ...patch } });
    }
    this.notify();
  }

  setEditingNodeId(id: string | null): void {
    if (id !== null && !this.nodes.has(id)) return;
    if (this.editingNodeId === id) return;
    this.editingNodeId = id;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  destroy(): void {
    this.listeners.clear();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

// ─── Yjs mode ──────────────────────────────────────────────────────────────

class YjsFeatureTreeStore implements FeatureTreeStore {
  readonly mode = 'yjs' as const;
  private doc: Y.Doc;
  private listeners = new Set<() => void>();
  private detach: (() => void) | null = null;
  /** Local per-peer editing-node id. Intentionally NOT in the doc. */
  private editingLocal: string | null = null;

  constructor(doc: Y.Doc) {
    this.doc = doc;

    // Bootstrap if empty — the doc must always have at least a root node
    // before the host can read a coherent snapshot. We only bootstrap
    // when nothing is there to avoid clobbering an existing peer's state.
    // (Matches Z2 SketchStore's "create empty sketch on first construct".)
    const tree = getSharedTree(doc);
    if (tree.length === 0) {
      const rootId = genRootId();
      const meta = getSharedMeta(doc);
      doc.transact(() => {
        applyFeatureOp(doc, {
          kind: 'addNode',
          node: {
            id: rootId,
            type: 'baseShape',
            label: 'Base Shape',
            icon: '📦',
            params: {},
            enabled: true,
            expanded: true,
            parentId: null,
            children: [],
            editingActive: false,
            timestamp: Date.now(),
          },
        });
        meta.set('rootId', rootId);
        meta.set('activeNodeId', rootId);
        meta.set('editingNodeId', null);
      });
    }

    const handler = () => this.notify();
    doc.on('update', handler);
    this.detach = () => doc.off('update', handler);
  }

  // ── Reads — rebuild from the doc on every call ──────────────────────────

  getSnapshot(): FeatureTreeSnapshot {
    return yDocToFeatureTree(this.doc);
  }

  getNodes(): HistoryNode[] { return this.getSnapshot().tree.nodes; }
  getRootId(): string {
    const meta = getSharedMeta(this.doc);
    return (meta.get('rootId') as string) ?? this.getSnapshot().tree.rootId;
  }
  getActiveNodeId(): string {
    const meta = getSharedMeta(this.doc);
    return (meta.get('activeNodeId') as string) ?? this.getRootId();
  }
  /** Yjs mode: returns the per-peer LOCAL editing id (intentionally NOT
   *  shared via the doc). See file header. */
  getEditingNodeId(): string | null { return this.editingLocal; }
  getSketches(): Record<string, SketchNodeData> { return this.getSnapshot().sketches; }

  // ── Mutations ───────────────────────────────────────────────────────────

  addNode(node: HistoryNode, sketchData?: SketchNodeData, afterId?: string | null): void {
    if (!node.id) throw new Error('[FeatureTreeStore] addNode requires node.id');
    applyFeatureOp(this.doc, {
      kind: 'addNode',
      node,
      ...(sketchData !== undefined ? { sketchData } : {}),
      ...(afterId !== undefined ? { afterId } : {}),
    });
  }

  removeNode(id: string): void {
    if (id === this.getRootId()) return; // root not removable
    applyFeatureOp(this.doc, { kind: 'removeNode', id });
    // Local editing pointer cleanup
    if (this.editingLocal === id) {
      this.editingLocal = null;
      this.notify();
    }
  }

  reorder(id: string, toIndex: number): void {
    applyFeatureOp(this.doc, { kind: 'reorder', id, toIndex });
  }

  updateParams(id: string, params: Record<string, number>): void {
    applyFeatureOp(this.doc, { kind: 'updateParams', id, params });
  }

  updateLabel(id: string, label: string): void {
    applyFeatureOp(this.doc, { kind: 'updateLabel', id, label });
  }

  setEnabled(id: string, enabled: boolean): void {
    applyFeatureOp(this.doc, { kind: 'setEnabled', id, enabled });
  }

  setActive(activeNodeId: string): void {
    applyFeatureOp(this.doc, { kind: 'setActive', activeNodeId });
  }

  updateSketch(sketchId: string, patch: Partial<SketchNodeData>): void {
    applyFeatureOp(this.doc, { kind: 'updateSketch', sketchId, patch });
  }

  setEditingNodeId(id: string | null): void {
    // Per-peer local state — does NOT touch the Y.Doc.
    if (this.editingLocal === id) return;
    this.editingLocal = id;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getDoc(): Y.Doc { return this.doc; }

  destroy(): void {
    if (this.detach) this.detach();
    this.detach = null;
    this.listeners.clear();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

// ─── Factory + migration ───────────────────────────────────────────────────

/** Constructor namespace mirrors Z2's `SketchStore.local / SketchStore.fromYDoc`. */
export const FeatureTreeStore = {
  local(initial?: FeatureTreeSnapshot): FeatureTreeStore {
    return new LocalFeatureTreeStore(initial);
  },

  /** Wrap an existing Y.Doc. If the doc has no tree yet, an empty one is
   *  bootstrapped (mirrors Z2's `fromYDoc` first-call behaviour). */
  fromYDoc(doc: Y.Doc): FeatureTreeStore {
    return new YjsFeatureTreeStore(doc);
  },
};

/** Hot-swap from local mode to Yjs mode without losing state. Writes the
 *  full local snapshot into the provided doc in one transact and returns
 *  a fresh Yjs-mode store. The previous local store is destroyed.
 *
 *  Used on the local→collab transition (e.g. user opens a single-tab
 *  session, then a CollabProvider wraps the subtree — the host hot-swaps
 *  the store underneath without losing the user's work). */
export function migrateToYjs(local: FeatureTreeStore, doc: Y.Doc): FeatureTreeStore {
  if (local.mode !== 'local') {
    throw new Error('[FeatureTreeStore] migrateToYjs: source store must be in local mode');
  }
  const snap = local.getSnapshot();

  // Wipe any pre-existing state in the target doc (intentional — caller
  // promised this is a fresh doc, or one that should adopt local's truth).
  doc.transact(() => {
    const tree = getSharedTree(doc);
    const sketches = getSharedSketches(doc);
    const meta = getSharedMeta(doc);
    if (tree.length > 0) tree.delete(0, tree.length);
    // Y.Map has no .clear(); iterate keys and delete.
    const skeys: string[] = [];
    sketches.forEach((_v, k) => skeys.push(k));
    for (const k of skeys) sketches.delete(k);
    const mkeys: string[] = [];
    meta.forEach((_v, k) => mkeys.push(k));
    for (const k of mkeys) meta.delete(k);

    // Re-populate from local snapshot. We append-order; parent.children is
    // already correct in the local snapshot.
    for (const node of snap.tree.nodes) {
      const sketchData = snap.sketches[node.id];
      applyFeatureOp(doc, {
        kind: 'addNode',
        node,
        ...(sketchData !== undefined ? { sketchData } : {}),
      });
    }
    meta.set('rootId', snap.tree.rootId);
    meta.set('activeNodeId', snap.tree.activeNodeId);
    meta.set('editingNodeId', null); // local-only field; never persist
  });

  local.destroy();
  return FeatureTreeStore.fromYDoc(doc);
}
