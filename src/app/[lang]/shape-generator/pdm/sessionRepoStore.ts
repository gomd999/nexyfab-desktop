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
 */

import { create } from 'zustand';
import { VersionRepo, type Commit, type Branch } from './versionBranch';
import {
  mergeFeatures,
  resolveConflict,
  type MergeResult,
} from './conflictResolution';
import type { FeatureInstance } from '../features/types';

export interface PendingMerge {
  sourceBranch: string;
  targetBranch: string;
  result: MergeResult;
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

  init: (features, author) => {
    if (get().repo) return; // idempotent — never clobber an existing history
    set({ repo: new VersionRepo(features, author), isDemo: false, rev: get().rev + 1 });
  },

  loadDemo: () => {
    if (get().repo) return;
    set({ repo: buildDemoRepo(), isDemo: true, rev: get().rev + 1 });
  },

  reset: () => set({ repo: null, isDemo: false, pendingMerge: null, rev: get().rev + 1 }),

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
}));
