/**
 * branchRegistryYjs.ts — Wave 2 Phase 3 Week 6 Track Z6.
 *
 * Y.Map-based branch registry. Mirrors the sketchYjs / refGeomYjs /
 * configStoreYjs patterns so all four CRDT sub-trees feel identical.
 *
 * The registry is **workspace-scoped** (not per-doc) — it lives on a
 * separate Y.Doc shared across all branches in the workspace. This is
 * the doc the `<CollabProvider docId="workspace">` would wrap; per-branch
 * docs are separate Y.Docs (one per branch).
 *
 *   Y.Doc (workspace-scoped, NOT per-doc)
 *   └── branches: Y.Map<branchId, Y.Map>
 *         └── { id, name, parentDocId, parentBranchId,
 *               forkedFromBranchHead, createdAt, createdBy, description? }
 *   └── activeBranchByDoc: Y.Map<docId, branchId>
 *
 * Why this shape:
 *   - `branches` keyed by branchId — same reasoning as sketchYjs:18-26.
 *     No inherent ordering; per-id LWW on the same branch; concurrent
 *     adds with different ids both land.
 *   - `activeBranchByDoc` keyed by docId — last-write-wins on "what
 *     branch is this doc on". Two peers switching the same doc to
 *     different branches converge on the later write. This matches
 *     "active branch" being a local-intent broadcast: each peer may
 *     view a different branch independently (the UI shows local
 *     selection, the registry just records the last-known intent).
 *
 * All mutating ops route through `applyBranchOp`, wrapping each in one
 * `doc.transact()` block. Origins follow the project convention
 * (`local-ui` / `remote-update` / `import-nfab`).
 */

import * as Y from 'yjs';
import type {
  BranchRef,
  AddBranchFailReason,
  RemoveBranchFailReason,
  RenameBranchFailReason,
} from './branchTypes';

// ─── Shared keys ───────────────────────────────────────────────────────────

const BRANCHES_ROOT_KEY = 'branches';
const ACTIVE_BRANCH_BY_DOC_KEY = 'activeBranchByDoc';

const BRANCH_FIELDS = {
  id: 'id',
  name: 'name',
  parentDocId: 'parentDocId',
  parentBranchId: 'parentBranchId',
  forkedFromBranchHead: 'forkedFromBranchHead',
  createdAt: 'createdAt',
  createdBy: 'createdBy',
  description: 'description',
} as const;

// ─── Origins ───────────────────────────────────────────────────────────────

export const ORIGIN_LOCAL_UI = 'local-ui';
export const ORIGIN_REMOTE_UPDATE = 'remote-update';
export const ORIGIN_IMPORT_NFAB = 'import-nfab';

export type BranchOpOrigin =
  | typeof ORIGIN_LOCAL_UI
  | typeof ORIGIN_REMOTE_UPDATE
  | typeof ORIGIN_IMPORT_NFAB;

// ─── Op union ──────────────────────────────────────────────────────────────

export type BranchOp =
  | { kind: 'addBranch'; ref: BranchRef }
  | { kind: 'removeBranch'; branchId: string }
  | { kind: 'renameBranch'; branchId: string; name: string }
  | { kind: 'setActiveBranch'; docId: string; branchId: string };

// ─── Encoders / decoders ───────────────────────────────────────────────────

function branchRefToYMap(ref: BranchRef): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(BRANCH_FIELDS.id, ref.id);
  m.set(BRANCH_FIELDS.name, ref.name);
  m.set(BRANCH_FIELDS.parentDocId, ref.parentDocId);
  // null is allowed for root branches; Y.Map can store null directly.
  m.set(BRANCH_FIELDS.parentBranchId, ref.parentBranchId);
  m.set(BRANCH_FIELDS.forkedFromBranchHead, ref.forkedFromBranchHead);
  m.set(BRANCH_FIELDS.createdAt, ref.createdAt);
  m.set(BRANCH_FIELDS.createdBy, ref.createdBy);
  if (ref.description !== undefined) m.set(BRANCH_FIELDS.description, ref.description);
  return m;
}

function yMapToBranchRef(m: Y.Map<unknown>): BranchRef {
  const description = m.get(BRANCH_FIELDS.description) as string | undefined;
  const out: BranchRef = {
    id: (m.get(BRANCH_FIELDS.id) as string) ?? '',
    name: (m.get(BRANCH_FIELDS.name) as string) ?? '',
    parentDocId: (m.get(BRANCH_FIELDS.parentDocId) as string) ?? '',
    parentBranchId: (m.get(BRANCH_FIELDS.parentBranchId) as string | null) ?? null,
    forkedFromBranchHead: (m.get(BRANCH_FIELDS.forkedFromBranchHead) as string) ?? '',
    createdAt: (m.get(BRANCH_FIELDS.createdAt) as number) ?? 0,
    createdBy: (m.get(BRANCH_FIELDS.createdBy) as string) ?? '',
    ...(description !== undefined ? { description } : {}),
  };
  return out;
}

// ─── Public accessors ──────────────────────────────────────────────────────

/** Get (creating if needed) the shared `branches` Y.Map root. Each entry
 *  is one branch keyed by branch id. */
export function getBranchesRoot(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(BRANCHES_ROOT_KEY);
}

/** Get (creating if needed) the shared `activeBranchByDoc` Y.Map root.
 *  Each entry is `docId → branchId`. */
export function getActiveBranchByDocRoot(doc: Y.Doc): Y.Map<string> {
  return doc.getMap<string>(ACTIVE_BRANCH_BY_DOC_KEY);
}

/** Read one branch by id (or null). */
export function readBranch(doc: Y.Doc, branchId: string): BranchRef | null {
  const m = getBranchesRoot(doc).get(branchId);
  return m ? yMapToBranchRef(m) : null;
}

/** Read every branch in the registry as a plain array. Order is the
 *  underlying Y.Map insertion order (stable per peer, may differ across
 *  peers — UI should sort by createdAt or name as it wishes). */
export function readAllBranches(doc: Y.Doc): BranchRef[] {
  const out: BranchRef[] = [];
  getBranchesRoot(doc).forEach((m) => out.push(yMapToBranchRef(m)));
  return out;
}

/** Read the active branchId for a doc (or null when no active branch set). */
export function readActiveBranchId(doc: Y.Doc, docId: string): string | null {
  const m = getActiveBranchByDocRoot(doc);
  const id = m.get(docId);
  return id ?? null;
}

/** Read the full active-branch map. */
export function readAllActiveBranches(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  getActiveBranchByDocRoot(doc).forEach((branchId, docId) => {
    out[docId] = branchId;
  });
  return out;
}

// ─── Result shape ──────────────────────────────────────────────────────────

export type ApplyBranchOpResult =
  | { ok: true; applied: true }
  | { ok: false; reason: AddBranchFailReason | RemoveBranchFailReason | RenameBranchFailReason };

// ─── Mutation API ──────────────────────────────────────────────────────────

/** Apply one branch registry op inside a single transact() block.
 *
 *  Returns:
 *   - `{ ok: true, applied: true }` when the op landed.
 *   - `{ ok: false, reason }` when rejected (name collision, has children,
 *     not found). The reasons map 1:1 onto the public adapter API.
 *
 *  Origin defaults to `local-ui`; remote applies pass `remote-update` so
 *  awareness / toast hooks can filter their own writes out.
 */
export function applyBranchOp(
  doc: Y.Doc,
  op: BranchOp,
  origin: BranchOpOrigin = ORIGIN_LOCAL_UI,
): ApplyBranchOpResult {
  // We capture the result inside the transact so the caller sees the
  // post-validation answer. The transact itself is best-effort idempotent
  // — if we reject, no writes happen.
  let result: ApplyBranchOpResult = { ok: true, applied: true };
  doc.transact(() => {
    result = applyOpInner(doc, op);
  }, origin);
  return result;
}

function applyOpInner(doc: Y.Doc, op: BranchOp): ApplyBranchOpResult {
  const branches = getBranchesRoot(doc);

  switch (op.kind) {
    case 'addBranch': {
      const ref = op.ref;
      if (!ref.id) {
        // Caller bug — refuse rather than silently overwrite the empty-id slot.
        return { ok: false, reason: 'name_collision' };
      }
      // Name collision check — siblings under the same parent must have
      // distinct names. See branchTypes.ts file header §1.
      const collides = nameCollidesUnderParent(branches, ref.name, ref.parentBranchId, ref.id);
      if (collides) {
        return { ok: false, reason: 'name_collision' };
      }
      branches.set(ref.id, branchRefToYMap(ref));
      return { ok: true, applied: true };
    }

    case 'removeBranch': {
      if (!branches.has(op.branchId)) {
        return { ok: false, reason: 'not_found' };
      }
      // Protect: refuse if any branch has this one as its parent. See
      // branchTypes.ts file header §2 (cascade vs protect).
      if (hasChildren(branches, op.branchId)) {
        return { ok: false, reason: 'has_children' };
      }
      branches.delete(op.branchId);
      // Also clean up any activeBranchByDoc entries pointing at this id —
      // they're stale. The setActiveBranch op layer would treat them as
      // valid; pre-emptively wipe so UI doesn't render dangling refs.
      const actives = getActiveBranchByDocRoot(doc);
      const toRemove: string[] = [];
      actives.forEach((bid, did) => {
        if (bid === op.branchId) toRemove.push(did);
      });
      for (const did of toRemove) actives.delete(did);
      return { ok: true, applied: true };
    }

    case 'renameBranch': {
      const m = branches.get(op.branchId);
      if (!m) return { ok: false, reason: 'not_found' };
      const parentBranchId = (m.get(BRANCH_FIELDS.parentBranchId) as string | null) ?? null;
      // Sibling collision check — exclude the branch being renamed.
      if (nameCollidesUnderParent(branches, op.name, parentBranchId, op.branchId)) {
        return { ok: false, reason: 'name_collision' };
      }
      m.set(BRANCH_FIELDS.name, op.name);
      return { ok: true, applied: true };
    }

    case 'setActiveBranch': {
      // No validation here — the branchId may legitimately be one that
      // was just deleted on another peer; we let it land (LWW) and the
      // UI surfaces "active branch missing" via its lookup.
      getActiveBranchByDocRoot(doc).set(op.docId, op.branchId);
      return { ok: true, applied: true };
    }

    default: {
      const _never: never = op;
      void _never;
      return { ok: false, reason: 'not_found' };
    }
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/** True if any branch (other than `excludeId`) under `parentBranchId` has
 *  the given name. O(N) over all branches. */
function nameCollidesUnderParent(
  branches: Y.Map<Y.Map<unknown>>,
  name: string,
  parentBranchId: string | null,
  excludeId: string,
): boolean {
  let collides = false;
  branches.forEach((m, id) => {
    if (collides) return;
    if (id === excludeId) return;
    const refName = m.get(BRANCH_FIELDS.name) as string | undefined;
    const refParent = (m.get(BRANCH_FIELDS.parentBranchId) as string | null) ?? null;
    if (refName === name && refParent === parentBranchId) {
      collides = true;
    }
  });
  return collides;
}

/** True if any branch has `branchId` as its parent. */
function hasChildren(branches: Y.Map<Y.Map<unknown>>, branchId: string): boolean {
  let any = false;
  branches.forEach((m) => {
    if (any) return;
    const refParent = (m.get(BRANCH_FIELDS.parentBranchId) as string | null) ?? null;
    if (refParent === branchId) any = true;
  });
  return any;
}

// ─── Bulk population helpers ───────────────────────────────────────────────

/** Bulk-write branches in one transact (used by .nfab import). */
export function populateBranchRegistry(
  doc: Y.Doc,
  refs: readonly BranchRef[],
  origin: BranchOpOrigin = ORIGIN_LOCAL_UI,
): void {
  doc.transact(() => {
    const branches = getBranchesRoot(doc);
    for (const ref of refs) {
      branches.set(ref.id, branchRefToYMap(ref));
    }
  }, origin);
}

/** Clear all branches. Used on new-workspace. */
export function clearBranchRegistry(
  doc: Y.Doc,
  origin: BranchOpOrigin = ORIGIN_LOCAL_UI,
): void {
  doc.transact(() => {
    const branches = getBranchesRoot(doc);
    const ids: string[] = [];
    branches.forEach((_, id) => ids.push(id));
    for (const id of ids) branches.delete(id);
    const actives = getActiveBranchByDocRoot(doc);
    const docIds: string[] = [];
    actives.forEach((_, did) => docIds.push(did));
    for (const did of docIds) actives.delete(did);
  }, origin);
}

// ─── Sync helper ───────────────────────────────────────────────────────────

/** Exchange state between two registry docs. Mirror of sketchYjs.syncDocs. */
export function syncDocs(a: Y.Doc, b: Y.Doc): { aToB: number; bToA: number } {
  const stateA = Y.encodeStateVector(a);
  const stateB = Y.encodeStateVector(b);
  const updateForB = Y.encodeStateAsUpdate(a, stateB);
  const updateForA = Y.encodeStateAsUpdate(b, stateA);
  Y.applyUpdate(b, updateForB, ORIGIN_REMOTE_UPDATE);
  Y.applyUpdate(a, updateForA, ORIGIN_REMOTE_UPDATE);
  return { aToB: updateForB.byteLength, bToA: updateForA.byteLength };
}
