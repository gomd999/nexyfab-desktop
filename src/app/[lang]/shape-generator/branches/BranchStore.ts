/**
 * BranchStore.ts — Wave 2 Phase 3 Week 6 Track Z6.
 *
 * Adapter giving one API for both "in-memory branch registry" and
 * "Y.Doc-backed branch registry". Mirrors RefGeomStore / SketchStore /
 * ConfigStore patterns.
 *
 *   - **local mode** — `BranchStore.local(initial?)` wraps a plain
 *     `BranchRegistry` value. Mutations apply in-memory and fire
 *     subscribers. Default path; `?crdt=v2` OFF leaves us here.
 *
 *   - **Yjs mode** — `BranchStore.fromYDoc(workspaceDoc)` wraps a
 *     workspace-scoped Y.Doc. Mutations route through `applyBranchOp`.
 *
 * Both modes expose the same `BranchStore` interface. Reads are O(N)
 * in Yjs mode (rebuild the array on every `getBranches` call); branches
 * are workspace-scale (tens, not millions) so this is fine.
 *
 * **What this layer does NOT do**:
 *
 *   - Open/close per-branch Y.Docs. That's the host's job; the store
 *     just keeps the metadata. Switching branches is a `setActiveBranch`
 *     call here PLUS an event-handler in the host that re-loads the doc
 *     bound to the new branchId.
 *
 *   - Fork. The actual `forkDoc(...)` call is the host's job — the host
 *     has access to the source per-branch doc; the store just records
 *     the resulting `BranchRef` (with its `forkedFromBranchHead` hash).
 *     `createBranch` here is "register the metadata"; the host calls
 *     `forkDoc` and `createBranch` together.
 */

import * as Y from 'yjs';
import {
  applyBranchOp,
  getBranchesRoot,
  getActiveBranchByDocRoot,
  readAllBranches,
  readActiveBranchId,
  readAllActiveBranches,
  type BranchOpOrigin,
  ORIGIN_LOCAL_UI,
} from './branchRegistryYjs';
import {
  EMPTY_BRANCH_REGISTRY,
  type BranchRef,
  type BranchRegistry,
} from './branchTypes';

// ─── Public interface ──────────────────────────────────────────────────────

export type CreateBranchResult =
  | { ok: true; branchId: string }
  | { ok: false; reason: 'name_collision' };

export type RemoveBranchResult =
  | { ok: true }
  | { ok: false; reason: 'has_children' | 'not_found' };

export type RenameBranchResult =
  | { ok: true }
  | { ok: false; reason: 'name_collision' | 'not_found' };

export interface BranchStore {
  readonly mode: 'local' | 'yjs';

  // ── Reads ───────────────────────────────────────────────────────────────

  /** Snapshot every branch. O(N) rebuild in both modes (cheap — workspace
   *  scale). */
  getBranches(): BranchRef[];

  /** Look up one branch by id. */
  getBranch(branchId: string): BranchRef | null;

  /** Active branch for a given doc, or null when none set. */
  getActiveBranchId(docId: string): string | null;

  /** Active-branch map across all docs. */
  getActiveBranches(): Record<string, string>;

  /** Children of a given branch (immediate descendants only). */
  getChildren(branchId: string): BranchRef[];

  // ── Mutations ───────────────────────────────────────────────────────────

  /** Register a new branch. Returns `{ ok: false, reason: 'name_collision' }`
   *  when a sibling under the same parent already has this name.
   *
   *  IMPORTANT: this only writes the registry entry — the host is
   *  responsible for actually forking the per-branch Y.Doc via
   *  `forkDoc(sourceDoc, newBranchId)`. The two-step shape is so the
   *  store stays Y.Doc-agnostic (the registry doc isn't the same Doc
   *  the per-branch state lives on).
   *
   *  `forkedFromBranchHead` is left empty by this overload; callers that
   *  want to pin the audit hash should use `createBranchWithHash`. */
  createBranch(
    name: string,
    parentDocId: string,
    parentBranchId: string | null,
    createdBy: string,
    description?: string,
  ): CreateBranchResult;

  /** Same as `createBranch` but pins the fork-point hash. Used by the
   *  host immediately after `forkDoc` so the audit trail records the
   *  exact state the new branch started from. */
  createBranchWithHash(
    name: string,
    parentDocId: string,
    parentBranchId: string | null,
    forkedFromBranchHead: string,
    createdBy: string,
    description?: string,
  ): CreateBranchResult;

  /** Remove a branch. Refuses if it has children (protect, not cascade).
   *  See branchTypes.ts file header §2. */
  removeBranch(branchId: string): RemoveBranchResult;

  /** Rename a branch. Refuses on sibling name collision. */
  renameBranch(branchId: string, name: string): RenameBranchResult;

  /** Set the active branch for a doc. No validation — the branchId may
   *  legitimately refer to a branch that's about to land on this peer. */
  setActiveBranch(docId: string, branchId: string): void;

  // ── Subscription ────────────────────────────────────────────────────────

  /** Listen for any mutation (local or remote). Returns unsubscribe. */
  subscribe(listener: () => void): () => void;

  /** Release resources. Idempotent. */
  destroy(): void;

  /** Yjs-mode only: the underlying registry doc. Exposed for tests. */
  getDoc?(): Y.Doc;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function newBranchId(): string {
  if (typeof globalThis !== 'undefined' &&
      typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto.randomUUID === 'function') {
    return `branch_${globalThis.crypto.randomUUID()}`;
  }
  return `branch_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function nameCollidesInList(
  list: readonly BranchRef[],
  name: string,
  parentBranchId: string | null,
  excludeId: string | null,
): boolean {
  return list.some(
    (b) =>
      b.id !== excludeId &&
      b.parentBranchId === parentBranchId &&
      b.name === name,
  );
}

function listChildren(list: readonly BranchRef[], parentId: string): BranchRef[] {
  return list.filter((b) => b.parentBranchId === parentId);
}

// ─── Local mode ────────────────────────────────────────────────────────────

class LocalBranchStore implements BranchStore {
  readonly mode = 'local' as const;
  private registry: { branches: Record<string, BranchRef>; activeBranchByDoc: Record<string, string> };
  private listeners = new Set<() => void>();

  constructor(initial?: BranchRegistry) {
    const src = initial ?? EMPTY_BRANCH_REGISTRY;
    this.registry = {
      branches: { ...src.branches },
      activeBranchByDoc: { ...src.activeBranchByDoc },
    };
  }

  getBranches(): BranchRef[] {
    return Object.values(this.registry.branches);
  }

  getBranch(branchId: string): BranchRef | null {
    return this.registry.branches[branchId] ?? null;
  }

  getActiveBranchId(docId: string): string | null {
    return this.registry.activeBranchByDoc[docId] ?? null;
  }

  getActiveBranches(): Record<string, string> {
    return { ...this.registry.activeBranchByDoc };
  }

  getChildren(branchId: string): BranchRef[] {
    return listChildren(this.getBranches(), branchId);
  }

  createBranch(
    name: string,
    parentDocId: string,
    parentBranchId: string | null,
    createdBy: string,
    description?: string,
  ): CreateBranchResult {
    return this.createBranchWithHash(name, parentDocId, parentBranchId, '', createdBy, description);
  }

  createBranchWithHash(
    name: string,
    parentDocId: string,
    parentBranchId: string | null,
    forkedFromBranchHead: string,
    createdBy: string,
    description?: string,
  ): CreateBranchResult {
    if (nameCollidesInList(this.getBranches(), name, parentBranchId, null)) {
      return { ok: false, reason: 'name_collision' };
    }
    const id = newBranchId();
    const ref: BranchRef = {
      id,
      name,
      parentDocId,
      parentBranchId,
      forkedFromBranchHead,
      createdAt: Date.now(),
      createdBy,
      ...(description !== undefined ? { description } : {}),
    };
    this.registry = {
      ...this.registry,
      branches: { ...this.registry.branches, [id]: ref },
    };
    this.notify();
    return { ok: true, branchId: id };
  }

  removeBranch(branchId: string): RemoveBranchResult {
    if (!this.registry.branches[branchId]) {
      return { ok: false, reason: 'not_found' };
    }
    const all = this.getBranches();
    if (listChildren(all, branchId).length > 0) {
      return { ok: false, reason: 'has_children' };
    }
    const nextBranches = { ...this.registry.branches };
    delete nextBranches[branchId];
    const nextActives = { ...this.registry.activeBranchByDoc };
    for (const [docId, bid] of Object.entries(nextActives)) {
      if (bid === branchId) delete nextActives[docId];
    }
    this.registry = { branches: nextBranches, activeBranchByDoc: nextActives };
    this.notify();
    return { ok: true };
  }

  renameBranch(branchId: string, name: string): RenameBranchResult {
    const existing = this.registry.branches[branchId];
    if (!existing) return { ok: false, reason: 'not_found' };
    if (nameCollidesInList(this.getBranches(), name, existing.parentBranchId, branchId)) {
      return { ok: false, reason: 'name_collision' };
    }
    this.registry = {
      ...this.registry,
      branches: {
        ...this.registry.branches,
        [branchId]: { ...existing, name },
      },
    };
    this.notify();
    return { ok: true };
  }

  setActiveBranch(docId: string, branchId: string): void {
    if (this.registry.activeBranchByDoc[docId] === branchId) return;
    this.registry = {
      ...this.registry,
      activeBranchByDoc: { ...this.registry.activeBranchByDoc, [docId]: branchId },
    };
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

class YjsBranchStore implements BranchStore {
  readonly mode = 'yjs' as const;
  private doc: Y.Doc;
  private listeners = new Set<() => void>();
  private detach: (() => void) | null = null;
  private origin: BranchOpOrigin;

  constructor(doc: Y.Doc, origin: BranchOpOrigin = ORIGIN_LOCAL_UI) {
    this.doc = doc;
    this.origin = origin;
    const handler = (): void => this.notify();
    doc.on('update', handler);
    this.detach = (): void => doc.off('update', handler);
  }

  getBranches(): BranchRef[] {
    return readAllBranches(this.doc);
  }

  getBranch(branchId: string): BranchRef | null {
    return readAllBranches(this.doc).find((b) => b.id === branchId) ?? null;
  }

  getActiveBranchId(docId: string): string | null {
    return readActiveBranchId(this.doc, docId);
  }

  getActiveBranches(): Record<string, string> {
    return readAllActiveBranches(this.doc);
  }

  getChildren(branchId: string): BranchRef[] {
    return listChildren(this.getBranches(), branchId);
  }

  createBranch(
    name: string,
    parentDocId: string,
    parentBranchId: string | null,
    createdBy: string,
    description?: string,
  ): CreateBranchResult {
    return this.createBranchWithHash(name, parentDocId, parentBranchId, '', createdBy, description);
  }

  createBranchWithHash(
    name: string,
    parentDocId: string,
    parentBranchId: string | null,
    forkedFromBranchHead: string,
    createdBy: string,
    description?: string,
  ): CreateBranchResult {
    const id = newBranchId();
    const ref: BranchRef = {
      id,
      name,
      parentDocId,
      parentBranchId,
      forkedFromBranchHead,
      createdAt: Date.now(),
      createdBy,
      ...(description !== undefined ? { description } : {}),
    };
    const res = applyBranchOp(this.doc, { kind: 'addBranch', ref }, this.origin);
    if (!res.ok) {
      return { ok: false, reason: 'name_collision' };
    }
    return { ok: true, branchId: id };
  }

  removeBranch(branchId: string): RemoveBranchResult {
    const res = applyBranchOp(this.doc, { kind: 'removeBranch', branchId }, this.origin);
    if (!res.ok) {
      // The op layer returns 'not_found' or 'has_children' — both flow through.
      return { ok: false, reason: res.reason as 'has_children' | 'not_found' };
    }
    return { ok: true };
  }

  renameBranch(branchId: string, name: string): RenameBranchResult {
    const res = applyBranchOp(this.doc, { kind: 'renameBranch', branchId, name }, this.origin);
    if (!res.ok) {
      return { ok: false, reason: res.reason as 'name_collision' | 'not_found' };
    }
    return { ok: true };
  }

  setActiveBranch(docId: string, branchId: string): void {
    applyBranchOp(this.doc, { kind: 'setActiveBranch', docId, branchId }, this.origin);
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

export const BranchStore = {
  /** Construct a local-mode store wrapping a plain registry value. */
  local(initial?: BranchRegistry): BranchStore {
    return new LocalBranchStore(initial);
  },

  /** Construct a Yjs-mode store backed by the workspace-scoped registry doc. */
  fromYDoc(doc: Y.Doc, origin?: BranchOpOrigin): BranchStore {
    return new YjsBranchStore(doc, origin);
  },
};

/** Hot-swap from local mode to Yjs mode without losing state. Writes the
 *  whole local snapshot into the provided doc in one transact and returns
 *  a fresh Yjs-mode store. The previous local store is destroyed. */
export function migrateToYjs(local: BranchStore, doc: Y.Doc): BranchStore {
  if (local.mode !== 'local') {
    throw new Error('[BranchStore] migrateToYjs: source store must be in local mode');
  }
  const branches = local.getBranches();
  const actives = local.getActiveBranches();
  doc.transact(() => {
    const root = getBranchesRoot(doc);
    const activeRoot = getActiveBranchByDocRoot(doc);
    for (const b of branches) {
      const inner = new Y.Map<unknown>();
      inner.set('id', b.id);
      inner.set('name', b.name);
      inner.set('parentDocId', b.parentDocId);
      inner.set('parentBranchId', b.parentBranchId);
      inner.set('forkedFromBranchHead', b.forkedFromBranchHead);
      inner.set('createdAt', b.createdAt);
      inner.set('createdBy', b.createdBy);
      if (b.description !== undefined) inner.set('description', b.description);
      root.set(b.id, inner);
    }
    for (const [docId, branchId] of Object.entries(actives)) {
      activeRoot.set(docId, branchId);
    }
  }, ORIGIN_LOCAL_UI);
  local.destroy();
  return BranchStore.fromYDoc(doc);
}
