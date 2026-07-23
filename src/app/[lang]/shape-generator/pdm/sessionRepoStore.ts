/**
 * sessionRepoStore.ts — Wave 6 Track W6-D.
 *
 * Client-session PDM state consumed by VersionTreePanel. Wraps the TESTED
 * engine modules (versionBranch.VersionRepo + conflictResolution.mergeFeatures
 * / resolveConflict) behind a Zustand store so the shell UI re-renders on
 * repo mutations (the repo itself is a mutable class — `rev` is bumped on
 * every mutation to notify subscribers).
 *
 * Honest-data rules (랜딩 mock 금지 원칙):
 *   - `repo === null` until the user records a first commit from the REAL
 *     current model snapshot (or explicitly opts into the labeled demo).
 *   - `isDemo` is sticky for a demo-seeded repo; the UI must render a
 *     visible "sample data" banner while it is true.
 *
 * Persistence is intentionally out of scope for W6-D: this is an in-memory,
 * per-session history (the engine docs state persistence is the caller's
 * responsibility; the nf_projects parent_id backend does not exist yet).
 *
 * ⚠ Gate/approval status specifically (260723 architecture-debt scoping):
 * this store's gate-refusal checks (via reviewQueue.approveRun) are ALSO
 * in-memory/per-session. The G4 server bridge below (bindDocument/
 * persistCommit/commitAndPersist) persists commit graph metadata but not
 * gate status as an ENFORCED condition — the server accepts an optional
 * advisory `gateReport` (see documentPersistence.ts), never as a write
 * gate. Nothing here stops a caller from invoking `commitAndPersist` with
 * features that never went through (or failed) review.
 */

import { create } from 'zustand';
import { VersionRepo, type Commit, type Branch } from './versionBranch';
import {
  mergeFeatures,
  resolveConflict,
  type MergeResult,
} from './conflictResolution';
import {
  recordAiRun,
  approveRun,
  buildRevisionDirective,
  type AiRunInput,
  type AiRunRecord,
  type ApproveOutcome,
  type ReviewComment,
  type RevisionDirective,
} from './reviewQueue';
import {
  pushCommitVersion,
  fetchVersionHistory,
  reconstructGraph,
  PersistenceError,
  type PersistFailureReason,
  type ReconstructedGraph,
} from './documentPersistence';
import type { FeatureInstance } from '../features/types';

export interface PendingMerge {
  sourceBranch: string;
  targetBranch: string;
  result: MergeResult;
}

/** Result IR for a persistence action — success carries the server version id,
 *  failure carries a typed reason (never a silent drop). */
export interface PersistResult {
  ok: boolean;
  reason?: PersistFailureReason;
  /** Server version id the commit was snapshotted to (push) — on success. */
  versionId?: string;
  /** Reconstructed graph read-model (load) — on success. */
  graph?: ReconstructedGraph;
}

export interface PdmSessionState {
  repo: VersionRepo | null;
  /** Mutation counter — subscribing to this re-renders after repo changes. */
  rev: number;
  /** True when the repo holds the opt-in demo seed, never real model data. */
  isDemo: boolean;
  pendingMerge: PendingMerge | null;

  /** Create the session repo from the current REAL feature snapshot. */
  init: (features: FeatureInstance[], author: string) => void;
  /** Opt-in demo seed — clearly-labeled sample history (never auto-loaded). */
  loadDemo: () => void;
  /** Drop the session repo (also used to leave demo mode). */
  reset: () => void;

  commit: (features: FeatureInstance[], message: string, author: string) => Commit | null;
  createBranch: (name: string) => boolean;
  checkout: (name: string) => boolean;
  tagCommit: (commitId: string, tag: string) => void;

  /** 3-way merge of `sourceBranch` into the current branch (LCA base). */
  startMerge: (sourceBranch: string) => void;
  resolvePending: (featureId: string, choice: 'ours' | 'theirs') => void;
  /** Records the 2-parent merge commit. Null until all conflicts resolved. */
  applyMerge: (author: string) => Commit | null;
  abortMerge: () => void;

  // ── Wave A WA-C: AI review queue (additive — wraps pdm/reviewQueue) ──────
  /** AI runs recorded as `ai/<runId>` branch commits, awaiting review. */
  aiRuns: AiRunRecord[];
  /** Record an AI run (branch + commit) and enqueue it. Null when no repo
   *  or duplicate runId — the run is NOT silently re-recorded. */
  enqueueAiRun: (input: AiRunInput) => AiRunRecord | null;
  /** Approve = 3-way merge into main. Refusals (gate fail / conflict) come
   *  back as the ApproveOutcome IR — conflicts are never auto-resolved. */
  approveAiRun: (runId: string, approver: string) => ApproveOutcome | null;
  /** Request changes → RevisionDirective IR (next AI run's input contract). */
  requestAiChanges: (runId: string, comments: ReviewComment[]) => RevisionDirective | null;

  // ── G4 carry-over: opt-in server persistence (documents version API) ────────
  // Additive & opt-in: an UNBOUND session (documentId === null) is unchanged —
  // pure in-memory, no network, no behavioural difference. Persistence engages
  // ONLY after bindDocument(). Failures are surfaced as typed reasons; a commit
  // snapshot is never silently lost.

  /** Bound document id, or null for a pure in-memory session (the default). */
  documentId: string | null;
  /** Fetch impl used for persistence (injectable for tests). */
  persistFetch: typeof fetch | null;
  /** Last persistence failure reason + message, or null. Cleared on success. */
  lastPersistError: { reason: PersistFailureReason; message: string } | null;
  /** PDM commit id → server version id, filled as commits are pushed/loaded. */
  versionIdByCommit: Record<string, string>;
  /** Read-model of the last loaded server history (for the history view). */
  restoredGraph: ReconstructedGraph | null;

  /** Opt into persistence by binding a server document. No repo mutation. */
  bindDocument: (documentId: string, opts?: { fetchImpl?: typeof fetch }) => void;
  /** Leave persistence (repo + history untouched; only the binding is dropped). */
  unbindDocument: () => void;
  /** Push a commit to the server as an explicit version snapshot. Unbound →
   *  { ok:false, reason:'not_bound' } (a no-op, not an error). */
  persistCommit: (commit: Commit) => Promise<PersistResult>;
  /** commit() + persistCommit() — the "commit → POST snapshot" wiring. When
   *  unbound, this is exactly the old in-memory commit (persist is a no-op). */
  commitAndPersist: (
    features: FeatureInstance[],
    message: string,
    author: string,
  ) => Promise<{ commit: Commit | null; persist: PersistResult }>;
  /** Load the server version history and rebuild the commit graph read-model. */
  loadHistory: () => Promise<PersistResult>;
}

const demoFeature = (
  id: string,
  type: FeatureInstance['type'],
  params: Record<string, number>,
): FeatureInstance => ({ id, type, params, enabled: true });

/** Build the labeled sample history: main×3 + experiment branch×1. */
function buildDemoRepo(): VersionRepo {
  const base = [
    demoFeature('demo-sketch', 'sketch', { width: 80, height: 40 }),
    demoFeature('demo-fillet', 'fillet', { radius: 2 }),
  ];
  const repo = new VersionRepo(base, 'demo-user');
  repo.commit({
    authorUserId: 'demo-user',
    message: 'Add mounting holes',
    features: [...base, demoFeature('demo-hole', 'hole', { diameter: 6, count: 4 })],
  });
  repo.branch('experiment/lighter');
  repo.commit({
    authorUserId: 'demo-user',
    message: 'Fillet R 3.0',
    features: [
      demoFeature('demo-sketch', 'sketch', { width: 80, height: 40 }),
      demoFeature('demo-fillet', 'fillet', { radius: 3 }),
      demoFeature('demo-hole', 'hole', { diameter: 6, count: 4 }),
    ],
  });
  repo.checkout('experiment/lighter');
  repo.commit({
    authorUserId: 'demo-kim',
    message: 'Shell 1.5mm (weight cut)',
    features: [
      demoFeature('demo-sketch', 'sketch', { width: 80, height: 40 }),
      demoFeature('demo-fillet', 'fillet', { radius: 1 }),
      demoFeature('demo-hole', 'hole', { diameter: 6, count: 4 }),
      demoFeature('demo-shell', 'shell', { thickness: 1.5 }),
    ],
  });
  repo.checkout('main');
  return repo;
}

export const usePdmSessionStore = create<PdmSessionState>((set, get) => ({
  repo: null,
  rev: 0,
  isDemo: false,
  pendingMerge: null,
  aiRuns: [],

  documentId: null,
  persistFetch: null,
  lastPersistError: null,
  versionIdByCommit: {},
  restoredGraph: null,

  init: (features, author) => {
    if (get().repo) return; // idempotent — never clobber an existing history
    set({ repo: new VersionRepo(features, author), isDemo: false, rev: get().rev + 1 });
  },

  loadDemo: () => {
    if (get().repo) return;
    set({ repo: buildDemoRepo(), isDemo: true, rev: get().rev + 1 });
  },

  reset: () => set({ repo: null, isDemo: false, pendingMerge: null, aiRuns: [], rev: get().rev + 1 }),

  commit: (features, message, author) => {
    const { repo } = get();
    if (!repo) return null;
    try {
      const c = repo.commit({ authorUserId: author, message, features });
      set(s => ({ rev: s.rev + 1 }));
      return c;
    } catch {
      // Protected branch — surfaced by the UI as a no-op with the engine rule.
      return null;
    }
  },

  createBranch: (name) => {
    const { repo } = get();
    if (!repo || !name.trim()) return false;
    try {
      repo.branch(name.trim());
      repo.checkout(name.trim());
      set(s => ({ rev: s.rev + 1 }));
      return true;
    } catch {
      return false; // duplicate name
    }
  },

  checkout: (name) => {
    const { repo } = get();
    if (!repo) return false;
    try {
      repo.checkout(name);
      set(s => ({ rev: s.rev + 1 }));
      return true;
    } catch {
      return false;
    }
  },

  tagCommit: (commitId, tag) => {
    const { repo } = get();
    if (!repo || !tag.trim()) return;
    try {
      repo.tag(commitId, tag.trim());
      set(s => ({ rev: s.rev + 1 }));
    } catch { /* unknown commit — ignore */ }
  },

  startMerge: (sourceBranch) => {
    const { repo } = get();
    if (!repo) return;
    const target = repo.current();
    if (sourceBranch === target.branchName) return;
    const source: Branch | undefined = repo
      .listBranches()
      .find(b => b.name === sourceBranch);
    if (!source) return;
    const sourceHead = repo.getCommit(source.headCommitId);
    if (!sourceHead) return;
    const lca = repo.lowestCommonAncestor(target.commit.id, sourceHead.id);
    const result = mergeFeatures({
      base: (lca?.features ?? []).slice(),
      ours: target.commit.features.slice(),
      theirs: sourceHead.features.slice(),
    });
    set({
      pendingMerge: { sourceBranch, targetBranch: target.branchName, result },
    });
  },

  resolvePending: (featureId, choice) => {
    const { pendingMerge } = get();
    if (!pendingMerge) return;
    set({
      pendingMerge: {
        ...pendingMerge,
        result: resolveConflict(pendingMerge.result, featureId, choice),
      },
    });
  },

  applyMerge: (author) => {
    const { repo, pendingMerge } = get();
    if (!repo || !pendingMerge) return null;
    if (pendingMerge.result.conflicts.length > 0) return null;
    const source = repo.listBranches().find(b => b.name === pendingMerge.sourceBranch);
    if (!source) return null;
    try {
      // Merge lands on the branch the merge was STARTED from, even if the
      // user checked out elsewhere while resolving conflicts.
      repo.checkout(pendingMerge.targetBranch);
      const c = repo.merge({
        authorUserId: author,
        message: `Merge ${pendingMerge.sourceBranch} into ${pendingMerge.targetBranch}`,
        features: pendingMerge.result.merged.slice(),
        otherParentId: source.headCommitId,
      });
      set(s => ({ pendingMerge: null, rev: s.rev + 1 }));
      return c;
    } catch {
      return null;
    }
  },

  abortMerge: () => set({ pendingMerge: null }),

  // ── Wave A WA-C: AI review queue ──────────────────────────────────────────

  enqueueAiRun: (input) => {
    const { repo } = get();
    if (!repo) return null;
    try {
      const run = recordAiRun(repo, input);
      set(s => ({ aiRuns: [...s.aiRuns, run], rev: s.rev + 1 }));
      return run;
    } catch {
      // Duplicate runId (branch exists) — refuse rather than re-record.
      return null;
    }
  },

  approveAiRun: (runId, approver) => {
    const { repo, aiRuns } = get();
    if (!repo) return null;
    const run = aiRuns.find(r => r.runId === runId);
    if (!run) return null;
    const outcome = approveRun(repo, run, approver);
    if (outcome.ok) {
      set(s => ({
        aiRuns: s.aiRuns.map(r =>
          r.runId === runId
            ? { ...r, status: 'approved' as const, mergeCommitId: outcome.mergeCommit.id }
            : r,
        ),
        rev: s.rev + 1,
      }));
    }
    // Refusals (gate_failed / conflict / not_pending) leave the run as-is —
    // the outcome IR is returned to the caller for display / human action.
    return outcome;
  },

  requestAiChanges: (runId, comments) => {
    const { aiRuns } = get();
    const run = aiRuns.find(r => r.runId === runId);
    if (!run || run.status !== 'pending') return null;
    let directive: RevisionDirective;
    try {
      directive = buildRevisionDirective(run, comments);
    } catch {
      return null; // no comments — not actionable
    }
    set(s => ({
      aiRuns: s.aiRuns.map(r =>
        r.runId === runId ? { ...r, status: 'changes_requested' as const } : r,
      ),
      rev: s.rev + 1,
    }));
    return directive;
  },

  // ── G4 carry-over: opt-in server persistence ────────────────────────────────

  bindDocument: (documentId, opts = {}) => {
    if (!documentId) return; // never bind to an empty id
    set({
      documentId,
      persistFetch: opts.fetchImpl ?? null,
      lastPersistError: null,
    });
  },

  unbindDocument: () =>
    set({
      documentId: null,
      persistFetch: null,
      lastPersistError: null,
      versionIdByCommit: {},
      restoredGraph: null,
    }),

  persistCommit: async (commit) => {
    const { documentId, persistFetch, versionIdByCommit, repo } = get();
    // Unbound session → pure in-memory, no network. Opt-in, so this is a
    // no-op result rather than an error (nothing was lost — nothing to save to).
    if (!documentId) return { ok: false, reason: 'not_bound' };

    // Branch the commit lives on — needed so the graph round-trips per-branch.
    // Fall back to the repo's current branch, else 'main'.
    const branch = repo?.current().branchName ?? 'main';
    // Server rule: branchName requires the first-parent's version id.
    const firstParent = commit.parents[0];
    const parentVersionId = firstParent ? versionIdByCommit[firstParent] ?? null : null;

    try {
      const version = await pushCommitVersion(documentId, commit, branch, {
        fetchImpl: persistFetch ?? undefined,
        parentVersionId,
      });
      set(s => ({
        versionIdByCommit: { ...s.versionIdByCommit, [commit.id]: version.id },
        lastPersistError: null,
      }));
      return { ok: true, versionId: version.id };
    } catch (err) {
      const reason: PersistFailureReason =
        err instanceof PersistenceError ? err.reason : 'server_error';
      const message = err instanceof Error ? err.message : String(err);
      set({ lastPersistError: { reason, message } });
      return { ok: false, reason };
    }
  },

  commitAndPersist: async (features, message, author) => {
    const commit = get().commit(features, message, author);
    if (!commit) return { commit: null, persist: { ok: false, reason: 'not_bound' } };
    const persist = await get().persistCommit(commit);
    return { commit, persist };
  },

  loadHistory: async () => {
    const { documentId, persistFetch } = get();
    if (!documentId) return { ok: false, reason: 'not_bound' };
    try {
      const versions = await fetchVersionHistory(documentId, {
        fetchImpl: persistFetch ?? undefined,
      });
      const graph = reconstructGraph(versions);
      // Rebuild the commit→version map so a subsequent branch-commit push can
      // still supply parentVersionId (lineage survives the reload).
      const map: Record<string, string> = {};
      for (const c of graph.commits) map[c.id] = c.versionId;
      set(s => ({
        restoredGraph: graph,
        versionIdByCommit: { ...s.versionIdByCommit, ...map },
        lastPersistError: null,
        rev: s.rev + 1,
      }));
      return { ok: true, graph };
    } catch (err) {
      const reason: PersistFailureReason =
        err instanceof PersistenceError ? err.reason : 'server_error';
      const message = err instanceof Error ? err.message : String(err);
      set({ lastPersistError: { reason, message } });
      return { ok: false, reason };
    }
  },
}));
