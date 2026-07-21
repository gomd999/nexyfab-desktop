/**
 * versionBranch.ts — Git-style branch / commit graph for NexyFab models.
 *
 * SolidWorks PDM (Vault) is purely linear — one head per file with
 * check-in / check-out locking. NexyFab borrows the branching idea
 * from git so multiple designers can iterate variants without
 * blocking each other.
 *
 * Data model (in-memory, persistence is the caller's responsibility):
 *
 *   Commit: a snapshot of the feature pipeline + metadata
 *           (author, timestamp, message, parent commits).
 *   Branch: a named pointer to a commit head.
 *   Repo:   the graph of commits + the set of branches.
 *
 * Operations: commit (linear advance), branch (fork), merge
 * (two-parent commit), cherry-pick (single commit replay), tag.
 *
 * No file I/O here — the modeler's persistence layer (memory
 * `nexyflow-persistence`) is the storage backend.
 */

import type { FeatureInstance } from '../features/types';

export interface Commit {
  /** 12-char hash-like id. */
  id: string;
  /** Parent commit ids (1 for normal, 2 for merge, 0 for root). */
  parents: string[];
  authorUserId: string;
  timestamp: number;
  message: string;
  /** Snapshot of the feature pipeline at this commit. Immutable. */
  features: ReadonlyArray<FeatureInstance>;
  /** Optional tags (release labels). */
  tags?: string[];
}

export interface Branch {
  name: string;
  headCommitId: string;
  /** Whether the branch is protected against direct commit (must merge). */
  protected?: boolean;
}

export class VersionRepo {
  private commits = new Map<string, Commit>();
  private branches = new Map<string, Branch>();
  private headBranch: string;

  constructor(initialFeatures: FeatureInstance[], authorUserId: string) {
    const root = this.makeCommit({
      parents: [],
      authorUserId,
      message: 'Initial commit',
      features: initialFeatures,
    });
    this.commits.set(root.id, root);
    this.branches.set('main', { name: 'main', headCommitId: root.id });
    this.headBranch = 'main';
  }

  /** Make a fresh commit on the current branch. */
  commit(opts: {
    authorUserId: string;
    message: string;
    features: FeatureInstance[];
  }): Commit {
    const head = this.branches.get(this.headBranch);
    if (!head) throw new Error(`Branch "${this.headBranch}" not found`);
    if (head.protected) {
      throw new Error(`Branch "${this.headBranch}" is protected — merge instead`);
    }
    const c = this.makeCommit({
      parents: [head.headCommitId],
      authorUserId: opts.authorUserId,
      message: opts.message,
      features: opts.features,
    });
    this.commits.set(c.id, c);
    head.headCommitId = c.id;
    return c;
  }

  /** Fork a new branch from the current branch's head. */
  branch(name: string, opts: { protectedFlag?: boolean; from?: string } = {}): Branch {
    if (this.branches.has(name)) throw new Error(`Branch "${name}" already exists`);
    const fromBranch = opts.from ?? this.headBranch;
    const src = this.branches.get(fromBranch);
    if (!src) throw new Error(`Source branch "${fromBranch}" not found`);
    const b: Branch = { name, headCommitId: src.headCommitId, protected: opts.protectedFlag };
    this.branches.set(name, b);
    return b;
  }

  /** Switch the current head branch. */
  checkout(branchName: string): void {
    if (!this.branches.has(branchName)) throw new Error(`Branch "${branchName}" not found`);
    this.headBranch = branchName;
  }

  /** Current branch (HEAD). */
  current(): { branchName: string; commit: Commit } {
    const head = this.branches.get(this.headBranch)!;
    return { branchName: this.headBranch, commit: this.commits.get(head.headCommitId)! };
  }

  /** All commits — for history UI. */
  listCommits(): Commit[] {
    return Array.from(this.commits.values());
  }

  /** All branches. */
  listBranches(): Branch[] {
    return Array.from(this.branches.values());
  }

  /** Lookup. */
  getCommit(id: string): Commit | null {
    return this.commits.get(id) ?? null;
  }

  /** Tag a commit. */
  tag(commitId: string, tagName: string): void {
    const c = this.commits.get(commitId);
    if (!c) throw new Error(`Commit ${commitId} not found`);
    if (!c.tags) (c as { tags: string[] }).tags = [];
    if (!c.tags!.includes(tagName)) c.tags!.push(tagName);
  }

  /** Walk back from a commit toward the root. */
  ancestors(commitId: string): Commit[] {
    const out: Commit[] = [];
    const seen = new Set<string>();
    const stack = [commitId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const c = this.commits.get(id);
      if (c) {
        out.push(c);
        stack.push(...c.parents);
      }
    }
    return out;
  }

  /** Lowest common ancestor (LCA) — used by merge for diff base. */
  lowestCommonAncestor(aId: string, bId: string): Commit | null {
    const aAncestors = new Set(this.ancestors(aId).map(c => c.id));
    // Walk B's ancestors; first hit on A's set is the LCA.
    const visited = new Set<string>();
    const stack = [bId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (aAncestors.has(id)) return this.commits.get(id) ?? null;
      const c = this.commits.get(id);
      if (c) stack.push(...c.parents);
    }
    return null;
  }

  /**
   * Record a merge of `otherParentId` into the current branch — a
   * two-parent commit whose feature snapshot is the (conflict-resolved)
   * result produced by `mergeFeatures` + `resolveConflict`.
   *
   * Merging INTO a protected branch is allowed by design: "protected"
   * means "no direct commit — changes arrive via merge" (see `commit`).
   */
  merge(opts: {
    authorUserId: string;
    message: string;
    features: FeatureInstance[];
    otherParentId: string;
  }): Commit {
    const head = this.branches.get(this.headBranch);
    if (!head) throw new Error(`Branch "${this.headBranch}" not found`);
    if (!this.commits.has(opts.otherParentId)) {
      throw new Error(`Commit ${opts.otherParentId} not found`);
    }
    if (head.headCommitId === opts.otherParentId) {
      throw new Error('Cannot merge a branch into itself');
    }
    const c = this.makeCommit({
      parents: [head.headCommitId, opts.otherParentId],
      authorUserId: opts.authorUserId,
      message: opts.message,
      features: opts.features,
    });
    this.commits.set(c.id, c);
    head.headCommitId = c.id;
    return c;
  }

  /** Cherry-pick — apply a single commit's diff onto the current head. */
  cherryPick(commitId: string, authorUserId: string): Commit {
    const source = this.commits.get(commitId);
    if (!source) throw new Error(`Commit ${commitId} not found`);
    // Naive impl: snapshot the source's features (no 3-way merge).
    return this.commit({
      authorUserId,
      message: `Cherry-pick: ${source.message}`,
      features: source.features.slice(),
    });
  }

  /** Internal — generate commit ids. */
  private commitCounter = 0;
  private makeCommit(input: {
    parents: string[];
    authorUserId: string;
    message: string;
    features: FeatureInstance[];
  }): Commit {
    const id = `c_${(++this.commitCounter).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      parents: input.parents.slice(),
      authorUserId: input.authorUserId,
      timestamp: Date.now(),
      message: input.message,
      features: input.features.map(f => ({ ...f })),
    };
  }
}
