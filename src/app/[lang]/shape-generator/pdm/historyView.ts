/**
 * historyView.ts — Commit graph layout + per-version diff.
 *
 * The UI needs two things from the commit graph:
 *   1. A 2D layout (column + row) for rendering a git-graph view.
 *   2. A feature-level diff between two commits for the
 *      compare-versions modal.
 *
 * Layout algorithm: simplified swimlane — each branch gets a
 * column index, commits ascend by timestamp. Merge commits draw
 * connector lines from both parent columns.
 *
 * Diff: feature-by-feature comparison. Output is a list of
 * {added, removed, modified} entries the UI lists.
 */

import type { Commit } from './versionBranch';
import type { FeatureInstance } from '../features/types';

export interface CommitNode {
  commitId: string;
  /** Column index (0 = main, 1+ = side branches). */
  column: number;
  /** Row index — older = lower number. */
  row: number;
  /** Parent commit positions for drawing connector lines. */
  parents: Array<{ commitId: string; column: number; row: number }>;
}

export interface CommitGraph {
  nodes: CommitNode[];
  /** Max column used (1 = single branch, 2+ = multi-branch). */
  columnCount: number;
}

/** Lay out commits topologically by timestamp + branch column. */
export function layoutCommitGraph(
  commits: Commit[],
  /** Optional branch-head mapping for stable column assignment. */
  branchHeads: ReadonlyArray<{ branch: string; commitId: string }> = [],
): CommitGraph {
  const sorted = commits.slice().sort((a, b) => a.timestamp - b.timestamp);

  // Stable column assignment: a commit shares its parent's column
  // unless it's a fork point (first child gets parent's column,
  // subsequent children get a new column).
  const colByCommit = new Map<string, number>();
  let nextCol = 0;

  // Pre-seed columns from branch heads when supplied — `main` (or
  // first branch) gets column 0, others increment.
  for (const { commitId } of branchHeads) {
    if (!colByCommit.has(commitId)) colByCommit.set(commitId, nextCol++);
  }

  for (const c of sorted) {
    if (colByCommit.has(c.id)) continue;
    if (c.parents.length === 0) {
      colByCommit.set(c.id, nextCol++);
      continue;
    }
    // First parent's column wins.
    const parentCol = colByCommit.get(c.parents[0]!);
    if (parentCol === undefined) {
      colByCommit.set(c.id, nextCol++);
    } else {
      // If parent column is "owned" by another commit already in
      // this slot, fork.
      const owner = sorted.find(x => colByCommit.get(x.id) === parentCol && x !== c
        && x.parents.includes(c.parents[0]!));
      if (owner) {
        colByCommit.set(c.id, nextCol++);
      } else {
        colByCommit.set(c.id, parentCol);
      }
    }
  }

  const nodes: CommitNode[] = sorted.map((c, row) => ({
    commitId: c.id,
    column: colByCommit.get(c.id) ?? 0,
    row,
    parents: c.parents.map(pid => {
      const parentNode = sorted.findIndex(x => x.id === pid);
      return {
        commitId: pid,
        column: colByCommit.get(pid) ?? 0,
        row: parentNode,
      };
    }),
  }));

  return { nodes, columnCount: nextCol };
}

// ── Diff ────────────────────────────────────────────────────────────

export type DiffEntryKind = 'added' | 'removed' | 'modified';

export interface DiffEntry {
  featureId: string;
  kind: DiffEntryKind;
  /** For modified: which params changed. */
  changedParams?: Array<{ key: string; before: number; after: number }>;
  enabledChanged?: { before: boolean; after: boolean };
}

export interface DiffSummary {
  entries: DiffEntry[];
  added: number;
  removed: number;
  modified: number;
}

export function diffCommits(a: Commit, b: Commit): DiffSummary {
  const aMap = new Map(a.features.map(f => [f.id, f] as const));
  const bMap = new Map(b.features.map(f => [f.id, f] as const));
  const entries: DiffEntry[] = [];

  for (const [id, fa] of aMap) {
    const fb = bMap.get(id);
    if (!fb) {
      entries.push({ featureId: id, kind: 'removed' });
      continue;
    }
    const changedParams: Array<{ key: string; before: number; after: number }> = [];
    const keys = new Set([...Object.keys(fa.params), ...Object.keys(fb.params)]);
    for (const k of keys) {
      if (fa.params[k] !== fb.params[k]) {
        changedParams.push({ key: k, before: fa.params[k] ?? 0, after: fb.params[k] ?? 0 });
      }
    }
    const enabledChanged = fa.enabled !== fb.enabled
      ? { before: fa.enabled, after: fb.enabled }
      : undefined;
    if (changedParams.length > 0 || enabledChanged) {
      entries.push({ featureId: id, kind: 'modified', changedParams, enabledChanged });
    }
  }
  for (const [id, fb] of bMap) {
    if (!aMap.has(id)) {
      entries.push({ featureId: id, kind: 'added' });
      void fb;
    }
  }

  const added    = entries.filter(e => e.kind === 'added').length;
  const removed  = entries.filter(e => e.kind === 'removed').length;
  const modified = entries.filter(e => e.kind === 'modified').length;
  return { entries, added, removed, modified };
}

// Keep the type import alive even though only used in signatures above.
export type _HistoryFeatureRef = FeatureInstance;
