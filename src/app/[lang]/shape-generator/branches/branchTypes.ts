/**
 * branchTypes.ts — Wave 2 Phase 3 Week 6 Track Z6.
 *
 * Document-level branching primitive types. Each branch is a separate
 * Y.Doc with its own history; "create branch" clones the source doc's
 * state into a fresh doc id (see `forkDoc.ts`). Branch metadata
 * (name + parent + created-at + creator) lives in a workspace-scoped
 * registry — see `branchRegistryYjs.ts`.
 *
 * ADR-012 §4 lock-in: per-doc, named, fork-on-write Y.Doc clone; manual
 * merge only. Z6 ships fork + switch + delete + list only — merge UI is
 * explicitly deferred to Wave 3.
 *
 * Spec ambiguities resolved here:
 *
 * 1. **Name uniqueness scope** — branch `name` is unique per
 *    `parentBranchId` (siblings under the same parent). Two branches at
 *    different points in the tree may share a name. Rationale: matches
 *    Onshape's "main", "feature-x", and lets users have parallel "draft"
 *    branches off different parents without surprise rejections. The
 *    `addBranch` op enforces this; see `branchRegistryYjs.ts`.
 *
 * 2. **Cascade vs protect on parent delete** — Z6 PROTECTS. Removing a
 *    branch that has any children returns `{ ok: false, reason: 'has_children' }`.
 *    Rationale: data-loss prevention. Cascade-delete would orphan children's
 *    history; the user must first delete the children (or re-parent — out of
 *    scope for Z6). See `removeBranch` in `branchRegistryYjs.ts`.
 *
 * 3. **The "main" branch** — there is no implicit "main" branch managed by
 *    this module. The host bootstraps a branch named "main" (or whatever)
 *    via `createBranch(...)` with `parentBranchId = null`. The
 *    `parentBranchId: null` is the signal "this branch is a root". Multiple
 *    roots are allowed (e.g. one per imported `.nfab`) but the typical
 *    workspace has exactly one.
 */

/** A single branch reference — metadata only. The branch's actual Y.Doc
 *  lives elsewhere (the host is responsible for opening / closing per-
 *  branch docs, e.g. via Z1's CollabProvider with the branchId mixed into
 *  the docId). */
export interface BranchRef {
  /** Stable uuid. Set on create; never mutates. */
  readonly id: string;
  /** User-facing name; unique per parent branch (see file header §1). */
  readonly name: string;
  /** Origin doc id — the doc this branch was forked from. Identifies the
   *  workspace "family" of branches. */
  readonly parentDocId: string;
  /** Parent branch id, or null for a root branch (typically "main"). */
  readonly parentBranchId: string | null;
  /** Snapshot hash at the moment of fork. Computed by `computeForkSnapshotHash`
   *  on the source doc; stored for audit ("this branch was forked from this
   *  exact state"). Empty string for root branches that weren't forked. */
  readonly forkedFromBranchHead: string;
  /** Creation timestamp (ms since epoch). */
  readonly createdAt: number;
  /** Awareness peer id of the user who created this branch. */
  readonly createdBy: string;
  /** Optional free-text description. */
  readonly description?: string;
}

/** Workspace-scoped branch registry shape. All branches across all docs in
 *  a workspace live in one registry so the UI can list "all my branches"
 *  and so cross-doc lineage is queryable. */
export interface BranchRegistry {
  /** All branches in this workspace, keyed by branch id. */
  readonly branches: Readonly<Record<string, BranchRef>>;
  /** Active branch per doc — which branch the local session is currently
   *  viewing for each doc. Local-only intent broadcast; remote peers see
   *  it via awareness but it does not force their view to change. */
  readonly activeBranchByDoc: Readonly<Record<string, string>>;
}

/** Empty registry — the bootstrap state for a fresh workspace. */
export const EMPTY_BRANCH_REGISTRY: BranchRegistry = Object.freeze({
  branches: Object.freeze({}),
  activeBranchByDoc: Object.freeze({}),
});

/** Reason an `addBranch` may fail at the registry layer. Matches the
 *  result shape used by `BranchStore.createBranch`. */
export type AddBranchFailReason = 'name_collision';

/** Reason a `removeBranch` may fail. */
export type RemoveBranchFailReason = 'has_children' | 'not_found';

/** Reason a `renameBranch` may fail. */
export type RenameBranchFailReason = 'name_collision' | 'not_found';

/** Convenience predicate: is this a root branch (no parent)? */
export function isRootBranch(ref: BranchRef): boolean {
  return ref.parentBranchId === null;
}

/** Convenience predicate: do two branches share the same parent? */
export function sameParent(a: BranchRef, b: BranchRef): boolean {
  return a.parentBranchId === b.parentBranchId;
}
