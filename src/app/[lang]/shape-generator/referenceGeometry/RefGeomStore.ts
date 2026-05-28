/**
 * RefGeomStore.ts — Wave 2 Phase 3 Week 4 Track Z4.
 *
 * Adapter that gives one API for both "local in-memory ref-geom state"
 * and "Y.Doc-backed ref-geom state". Mirrors `sketch/SketchStore.ts`
 * (Z2) which mirrors `configurations/ConfigStore.ts` (A5):
 *
 *   - **local mode** — `RefGeomStore.local(initialNodes?)` wraps a plain
 *     array. Mutations apply in-memory and fire `subscribe()` listeners.
 *     Default path; `?crdt=v2` OFF leaves us here.
 *
 *   - **Yjs mode** — `RefGeomStore.fromYDoc(doc)` wraps a `Y.Doc`. Every
 *     mutation routes through `applyRefGeomOp` from refGeomYjs.ts so it
 *     lands inside one `doc.transact()` block. Reads come from
 *     `readAllReferenceNodesArray(doc)`.
 *
 * Both modes expose the same `RefGeomStore` interface. The host UI today
 * uses the Zustand `useReferenceGeometryStore` directly — Z4 is purely
 * additive (the Zustand path is unchanged; this adapter is the new
 * collab seam).
 *
 * **Cycle prevention** (local mode): enforced via the depSolver's
 * `wouldCreateCycle` — matches the existing Zustand store. Yjs mode does
 * NOT enforce here because the cycle may emerge on merge (Z4 §6); the
 * integration layer surfaces a banner via `useRefGeomCycleWarning`.
 *
 * **Yjs read strategy**: on every Y.Doc update we rebuild the snapshot.
 * This is O(N) per notify; ref-geom is 100-ref-target (spec §17 perf)
 * so well below the OCCT tick budget.
 *
 * **Migrate path**: `migrateToYjs(local, doc)` writes the whole local
 * snapshot into the doc in one transact, then returns a fresh Yjs-mode
 * store. This is the local-→-collab path when a user opens a single-tab
 * session and a second tab joins.
 */

import * as Y from 'yjs';
import {
  applyRefGeomOp,
  getRefGeomRoot,
  readAllReferenceNodesArray,
  populateRefGeomDoc,
  type RefGeomOpOrigin,
  ORIGIN_LOCAL_UI,
} from './refGeomYjs';
import {
  buildGraph,
  wouldCreateCycle,
} from './depSolver';
import {
  computeDependsOn,
  type ReferenceNode,
} from './types';

// ─── Public interface ──────────────────────────────────────────────────────

export type AddNodeFailure = 'cycle' | 'duplicate_id';

export type AddNodeResult = { ok: true } | { ok: false; reason: AddNodeFailure };

export interface RefGeomStore {
  /** Is this store backed by a Y.Doc (collab) or just in-memory (offline)? */
  readonly mode: 'local' | 'yjs';

  // ── Reads ───────────────────────────────────────────────────────────────

  /** Snapshot every node. Cheap in local mode (returns a defensive copy),
   *  O(N) in Yjs mode (rebuild). */
  getNodes(): ReferenceNode[];

  /** Look up one node by id. Returns null when absent. */
  getNode(nodeId: string): ReferenceNode | null;

  // ── Mutations ───────────────────────────────────────────────────────────

  /** Insert. Returns { ok: false, reason: 'duplicate_id' | 'cycle' } on
   *  rejection in local mode. In Yjs mode the cycle check is best-effort
   *  (the live graph at this peer may not include in-flight peer ops);
   *  the integration layer's banner is the authoritative cycle surface. */
  addNode(node: ReferenceNode): AddNodeResult;

  removeNode(nodeId: string): void;

  /** Patch a node. When `params` changes, `dependsOn` is recomputed.
   *  Local mode rejects cycle-introducing patches; Yjs mode lets them
   *  land and surfaces on the banner. */
  updateNode(nodeId: string, patch: Partial<ReferenceNode>): void;

  /** Rename the user-visible label. */
  renameNode(nodeId: string, name: string): void;

  /** Drop every node. */
  clear(): void;

  /** Bulk replace. Skips per-node cycle gate (assumes file was validated).
   *  Equivalent to `clear()` + `addNode()` per entry in one transact in
   *  Yjs mode. */
  replaceAll(nodes: readonly ReferenceNode[]): void;

  // ── Subscription ────────────────────────────────────────────────────────

  /** Listen for any mutation (local or remote). Returns unsubscribe.
   *  React hosts increment a reducer counter to trigger re-render. */
  subscribe(listener: () => void): () => void;

  /** Release resources (Yjs observer, listener set). Idempotent. */
  destroy(): void;

  /** Yjs-mode only: the underlying doc. Exposed for tests and for the
   *  integration layer's awareness lookup when surfacing collision toasts. */
  getDoc?(): Y.Doc;
}

// ─── Helpers (shared by local + Yjs modes) ─────────────────────────────────

/** Apply a partial patch to a `ReferenceNode`, narrowing the discriminated
 *  union safely. When `params` is patched, recompute `dependsOn[]` so the
 *  solver stays in sync. Mirror of `store.ts:applyPatch`. */
function applyPatch(node: ReferenceNode, patch: Partial<ReferenceNode>): ReferenceNode {
  const merged = { ...node, ...patch } as ReferenceNode;
  const paramsChanged = 'params' in patch && patch.params !== undefined;
  if (paramsChanged) {
    const deps = computeDependsOn(merged);
    return { ...merged, dependsOn: deps } as ReferenceNode;
  }
  return merged;
}

// ─── Local mode ────────────────────────────────────────────────────────────

class LocalRefGeomStore implements RefGeomStore {
  readonly mode = 'local' as const;
  private nodes: ReferenceNode[];
  private listeners = new Set<() => void>();

  constructor(initial?: readonly ReferenceNode[]) {
    this.nodes = initial ? [...initial] : [];
  }

  getNodes(): ReferenceNode[] {
    return [...this.nodes];
  }

  getNode(nodeId: string): ReferenceNode | null {
    return this.nodes.find((n) => n.id === nodeId) ?? null;
  }

  addNode(node: ReferenceNode): AddNodeResult {
    if (this.nodes.some((n) => n.id === node.id)) {
      return { ok: false, reason: 'duplicate_id' };
    }
    const graph = buildGraph(this.nodes);
    if (wouldCreateCycle(graph, node.id, node.dependsOn)) {
      return { ok: false, reason: 'cycle' };
    }
    this.nodes = [...this.nodes, node];
    this.notify();
    return { ok: true };
  }

  removeNode(nodeId: string): void {
    const next = this.nodes.filter((n) => n.id !== nodeId);
    if (next.length === this.nodes.length) return;
    this.nodes = next;
    this.notify();
  }

  updateNode(nodeId: string, patch: Partial<ReferenceNode>): void {
    const idx = this.nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return;
    const existing = this.nodes[idx]!;
    // Match Zustand store invariants: reject kind / id changes silently.
    if (patch.kind !== undefined && patch.kind !== existing.kind) return;
    if (patch.id !== undefined && patch.id !== nodeId) return;

    const next = applyPatch(existing, patch);
    // Cycle gate on new dependsOn against the rest of the graph.
    const rest = this.nodes.filter((_, i) => i !== idx);
    const graph = buildGraph(rest);
    if (wouldCreateCycle(graph, nodeId, next.dependsOn)) return;
    const out = this.nodes.slice();
    out[idx] = next;
    this.nodes = out;
    this.notify();
  }

  renameNode(nodeId: string, name: string): void {
    this.updateNode(nodeId, { label: name });
  }

  clear(): void {
    if (this.nodes.length === 0) return;
    this.nodes = [];
    this.notify();
  }

  replaceAll(nodes: readonly ReferenceNode[]): void {
    this.nodes = [...nodes];
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.listeners.clear();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

// ─── Yjs mode ──────────────────────────────────────────────────────────────

class YjsRefGeomStore implements RefGeomStore {
  readonly mode = 'yjs' as const;
  private doc: Y.Doc;
  private listeners = new Set<() => void>();
  private detach: (() => void) | null = null;
  private origin: RefGeomOpOrigin;

  constructor(doc: Y.Doc, origin: RefGeomOpOrigin = ORIGIN_LOCAL_UI) {
    this.doc = doc;
    this.origin = origin;

    // Subscribe to any change on the doc. Filter would need cross-tree
    // awareness; observing the whole doc is what the smoke harness already
    // does (and ref-geom edits are infrequent vs sketch edits).
    const handler = (): void => this.notify();
    doc.on('update', handler);
    this.detach = (): void => doc.off('update', handler);
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  getNodes(): ReferenceNode[] {
    return readAllReferenceNodesArray(this.doc);
  }

  getNode(nodeId: string): ReferenceNode | null {
    const all = readAllReferenceNodesArray(this.doc);
    return all.find((n) => n.id === nodeId) ?? null;
  }

  // ── Mutations ───────────────────────────────────────────────────────────

  addNode(node: ReferenceNode): AddNodeResult {
    // Local best-effort cycle check — matches Zustand semantics so callers
    // get a consistent rejection signal. The merged-graph cycle case
    // (Z4 §6) is surfaced by `useRefGeomCycleWarning` post-merge, not here.
    const current = this.getNodes();
    if (current.some((n) => n.id === node.id)) {
      return { ok: false, reason: 'duplicate_id' };
    }
    const graph = buildGraph(current);
    if (wouldCreateCycle(graph, node.id, node.dependsOn)) {
      return { ok: false, reason: 'cycle' };
    }
    applyRefGeomOp(this.doc, { kind: 'addNode', node }, this.origin);
    return { ok: true };
  }

  removeNode(nodeId: string): void {
    applyRefGeomOp(this.doc, { kind: 'removeNode', nodeId }, this.origin);
  }

  updateNode(nodeId: string, patch: Partial<ReferenceNode>): void {
    // Recompute dependsOn locally when params changes — refGeomYjs.ts's
    // applyOp doesn't store dependsOn (it's derived on read), but the
    // patch propagated to other consumers (banners) needs the up-to-date
    // shape locally too.
    const current = this.getNode(nodeId);
    if (!current) return;
    if (patch.kind !== undefined && patch.kind !== current.kind) return;
    if (patch.id !== undefined && patch.id !== nodeId) return;

    const next = applyPatch(current, patch);
    // Best-effort local cycle gate (mirrors Zustand). In Yjs mode the
    // canonical check is the merged-graph banner; this gate just keeps
    // single-peer UX consistent with the !v2 path.
    const rest = this.getNodes().filter((n) => n.id !== nodeId);
    const graph = buildGraph(rest);
    if (wouldCreateCycle(graph, nodeId, next.dependsOn)) return;

    // Send the patch including the derived params (the encoder discards
    // dependsOn — refGeomYjs re-derives on read).
    applyRefGeomOp(
      this.doc,
      { kind: 'updateNode', nodeId, patch },
      this.origin,
    );
  }

  renameNode(nodeId: string, name: string): void {
    applyRefGeomOp(this.doc, { kind: 'renameNode', nodeId, name }, this.origin);
  }

  clear(): void {
    const current = this.getNodes();
    if (current.length === 0) return;
    this.doc.transact(() => {
      const root = getRefGeomRoot(this.doc);
      for (const n of current) root.delete(n.id);
    }, this.origin);
  }

  replaceAll(nodes: readonly ReferenceNode[]): void {
    // Diff against current to keep per-id CRDT history meaningful (mirror
    // of SketchStore.setSegments). Removes anything no longer present;
    // upserts everything else.
    const current = this.getNodes();
    const nextIds = new Set(nodes.map((n) => n.id));
    this.doc.transact(() => {
      const root = getRefGeomRoot(this.doc);
      for (const c of current) {
        if (!nextIds.has(c.id)) {
          root.delete(c.id);
        }
      }
      for (const n of nodes) {
        applyRefGeomOp(this.doc, { kind: 'addNode', node: n }, this.origin);
      }
    }, this.origin);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

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

export const RefGeomStore = {
  /** Construct a local-mode store wrapping a plain array. */
  local(initialNodes?: readonly ReferenceNode[]): RefGeomStore {
    return new LocalRefGeomStore(initialNodes);
  },

  /** Construct a Yjs-mode store backed by the given doc. The doc's
   *  `referenceGeometry` sub-tree is read-on-demand; bootstrap (empty or
   *  populated) happens via `populateRefGeomDoc` from refGeomYjs. */
  fromYDoc(doc: Y.Doc, origin?: RefGeomOpOrigin): RefGeomStore {
    return new YjsRefGeomStore(doc, origin);
  },
};

/** Hot-swap from local mode to Yjs mode without losing state. Writes the
 *  whole local snapshot into the provided doc in one transact and returns
 *  a fresh Yjs-mode store. The previous local store is destroyed.
 *
 *  Used by the host hook on the local→collab transition. */
export function migrateToYjs(local: RefGeomStore, doc: Y.Doc): RefGeomStore {
  if (local.mode !== 'local') {
    throw new Error('[RefGeomStore] migrateToYjs: source store must be in local mode');
  }
  const snap = local.getNodes();
  populateRefGeomDoc(doc, snap, ORIGIN_LOCAL_UI);
  local.destroy();
  return RefGeomStore.fromYDoc(doc);
}
