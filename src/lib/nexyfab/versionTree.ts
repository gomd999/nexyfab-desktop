// PDM version tree — branching version graph for project history.
// Existing project save flow keeps a flat "latest" copy; this module adds
// labeled commits, branches, and merge operations so engineering teams can
// safely experiment without losing the production design.
//
// Storage layer is intentionally pluggable: the in-memory implementation
// below works for client-side undo trees, while the same shape can be
// backed by the existing nf_projects table with a `parent_id` column.

export interface VersionNode {
  id: string;
  /** Parent commit id; null for the initial commit. */
  parentId: string | null;
  /** Branch this commit lives on. Used for visualization. */
  branch: string;
  /** ISO timestamp of creation. */
  createdAt: number;
  /** Author (user id or display name). */
  author: string;
  /** Commit message. */
  message: string;
  /** Project payload — opaque to this module; usually the autosave scene blob. */
  payload: unknown;
  /** Optional tags ("v1.0", "release", "experimental"). */
  tags?: string[];
}

export interface MergeConflict {
  field: string;
  ours: unknown;
  theirs: unknown;
}

export interface MergeResult {
  ok: boolean;
  conflicts: MergeConflict[];
  merged?: unknown;
}

// ─── Repo ──────────────────────────────────────────────────────────────────

export class VersionRepo {
  private nodes = new Map<string, VersionNode>();
  private branchHeads = new Map<string, string>(); // branch → tip node id

  constructor(initial?: VersionNode[]) {
    if (initial) {
      for (const n of initial) this.nodes.set(n.id, n);
      // Compute branch heads as the latest node per branch.
      const byBranch = new Map<string, VersionNode>();
      for (const n of initial) {
        const cur = byBranch.get(n.branch);
        if (!cur || n.createdAt > cur.createdAt) byBranch.set(n.branch, n);
      }
      for (const [b, n] of byBranch) this.branchHeads.set(b, n.id);
    }
  }

  /** Snapshot all nodes (ordered by createdAt, ascending). */
  list(): VersionNode[] {
    return [...this.nodes.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** All branches and their tip node ids. */
  branches(): { name: string; tipId: string }[] {
    return [...this.branchHeads.entries()].map(([name, tipId]) => ({ name, tipId }));
  }

  /** Append a commit on `branch` (creating the branch if missing). */
  commit(input: Omit<VersionNode, 'id' | 'parentId' | 'createdAt'> & { parentId?: string }): VersionNode {
    const parentId = input.parentId ?? this.branchHeads.get(input.branch) ?? null;
    const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const node: VersionNode = {
      id,
      parentId,
      branch: input.branch,
      createdAt: Date.now(),
      author: input.author,
      message: input.message,
      payload: input.payload,
      tags: input.tags,
    };
    this.nodes.set(id, node);
    this.branchHeads.set(input.branch, id);
    return node;
  }

  /** Create a new branch starting at `fromId`. */
  branch(name: string, fromId: string): void {
    if (!this.nodes.has(fromId)) throw new Error(`Unknown parent ${fromId}`);
    if (this.branchHeads.has(name)) throw new Error(`Branch ${name} already exists`);
    this.branchHeads.set(name, fromId);
  }

  /** Walk parent chain — returns ancestors from `id` up to root. */
  ancestors(id: string): VersionNode[] {
    const out: VersionNode[] = [];
    let cur: string | null = id;
    while (cur) {
      const n = this.nodes.get(cur);
      if (!n) break;
      out.push(n);
      cur = n.parentId;
    }
    return out;
  }

  /** Find the most-recent common ancestor of two commits. */
  mergeBase(a: string, b: string): VersionNode | null {
    const ancestorsA = new Set(this.ancestors(a).map(n => n.id));
    for (const n of this.ancestors(b)) {
      if (ancestorsA.has(n.id)) return n;
    }
    return null;
  }
}

// ─── Three-way merge for plain-JSON payloads ──────────────────────────────

/**
 * Three-way merge based on JSON diffs. Fields that changed on only one side
 * are taken from that side; fields that changed on both sides become
 * conflicts the user resolves manually.
 */
export function threeWayMerge<T extends Record<string, unknown>>(
  base: T, ours: T, theirs: T,
): MergeResult {
  const conflicts: MergeConflict[] = [];
  const merged: Record<string, unknown> = { ...base };
  const allKeys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const k of allKeys) {
    const b = base[k];
    const o = ours[k];
    const t = theirs[k];
    const oChanged = !shallowEqual(b, o);
    const tChanged = !shallowEqual(b, t);
    if (oChanged && tChanged && !shallowEqual(o, t)) {
      conflicts.push({ field: k, ours: o, theirs: t });
      continue;
    }
    if (oChanged) merged[k] = o;
    else if (tChanged) merged[k] = t;
  }
  return { ok: conflicts.length === 0, conflicts, merged: merged as T };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
