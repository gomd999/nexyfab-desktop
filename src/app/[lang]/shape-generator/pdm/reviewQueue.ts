/**
 * reviewQueue.ts — Wave A Track WA-C (AI 검토 루프).
 *
 * Pure layer for the AI review loop on top of the TESTED PDM engine
 * (versionBranch.VersionRepo + conflictResolution.mergeFeatures):
 *
 *   AI run  →  recorded as a commit on branch `ai/<runId>`  →  enqueued as a
 *   review item (diff + verification report)  →  a HUMAN either
 *     - approves  → 3-way merge into `main` (2-parent merge commit), or
 *     - requests changes → a RevisionDirective IR is returned; that IR is the
 *       INPUT CONTRACT for the next AI run (the driver re-plans from it).
 *
 * Invariants (Wave A §0, enforced here, not just documented):
 *   - A run whose verification report contains ANY failed gate can NOT be
 *     approved — not even by a human. Failed work never reaches `main`;
 *     the only path forward is `requestChanges` → a new run.
 *   - ⚠ SCOPE OF THIS GUARANTEE (260723 architecture-debt scoping): the above
 *     is a CLIENT-SESSION invariant only, enforced by THIS in-memory
 *     VersionRepo (sessionRepoStore.ts — explicitly "in-memory, per-session").
 *     The actual server persistence route (`POST /api/documents/[id]/versions`)
 *     has NO knowledge of gates/approval — it accepts a `gateReport` as
 *     purely ADVISORY, client-asserted metadata (like `label`/`branchName`),
 *     never as a condition for whether the write succeeds. Any authenticated
 *     editor holding the document lock can persist ANY state — gate-failed,
 *     gate-passed, or gate-unreported — as the new "current" server version.
 *     "Failed work never reaches main" describes THIS module's branch graph,
 *     not the server's `nf_documents`/`nf_document_versions` tables.
 *   - Merge conflicts are NEVER auto-resolved. `approveRun` returns the
 *     conflict IR verbatim and leaves the run pending — resolution is a
 *     human's job (via the existing merge UI / a follow-up run).
 *   - This module does not import anything from `src/lib/ai/design-driver/`:
 *     driver output is consumed through STRUCTURAL types below
 *     (VerificationReportLike / AiRunInput), so the tracks stay decoupled.
 *
 * No I/O and no store coupling here — callers pass the VersionRepo in
 * (sessionRepoStore wraps this layer for the shell UI).
 */

import { VersionRepo, type Commit } from './versionBranch';
import { mergeFeatures, type MergeConflict } from './conflictResolution';
import type { FeatureInstance } from '../features/types';

// ── Structural driver types (loose on purpose — no design-driver import) ────

/** One verification gate outcome as reported by the AI driver. */
export interface GateResultLike {
  /** Gate id, e.g. 'geometry.watertight', 'dimension.measured'. */
  id: string;
  pass: boolean;
  /** Measured value (when the gate is numeric). */
  value?: number;
  /** Expected / threshold value the measurement was checked against. */
  expected?: number;
  unit?: string;
  /** Human-readable reason — REQUIRED semantics when pass === false. */
  reason?: string;
}

/**
 * Shape of a driver verification report we rely on. Extra fields from the
 * real driver report pass through untouched (index signature).
 */
export interface VerificationReportLike {
  gates: GateResultLike[];
  [extra: string]: unknown;
}

/** What the AI driver hands us after a run (structural, not imported). */
export interface AiRunInput {
  runId: string;
  /** One-line summary of the brief the run executed. */
  briefSummary: string;
  /** The feature snapshot the run produced (deterministic build output). */
  features: FeatureInstance[];
  report: VerificationReportLike;
  /** Recorded author for the PDM commit (e.g. 'ai-driver'). */
  author: string;
  /** Optional commit message; defaults to the brief summary. */
  message?: string;
}

// ── Queue records ───────────────────────────────────────────────────────────

export type AiRunStatus = 'pending' | 'approved' | 'changes_requested';

export interface AiRunRecord {
  runId: string;
  /** PDM branch the run was recorded on — always `ai/<runId>`. */
  branchName: string;
  /** The run's commit on that branch (what the reviewer diffs). */
  commitId: string;
  briefSummary: string;
  report: VerificationReportLike;
  status: AiRunStatus;
  enqueuedAt: number;
  /** Set when status === 'approved'. */
  mergeCommitId?: string;
}

// ── RevisionDirective IR — the next-run input contract ──────────────────────

export interface ReviewComment {
  /** Feature the comment targets; omitted for whole-model comments. */
  featureId?: string;
  note: string;
}

/**
 * RevisionDirective — the IR returned by `requestChanges`.
 *
 * CONTRACT (next AI run input): the driver MUST
 *   1. resume from `branchName` at `baseCommitId` (not from main),
 *   2. address every entry in `comments` (featureId-scoped when present),
 *   3. re-pass every gate listed in `failedGates` (these blocked approval),
 *   4. produce a NEW run (new runId / new commit) — this directive never
 *      mutates the reviewed commit.
 */
export interface RevisionDirective {
  kind: 'revision_directive';
  /** The run being revised. */
  runId: string;
  branchName: string;
  /** Commit the comments refer to (the reviewed snapshot). */
  baseCommitId: string;
  briefSummary: string;
  comments: ReviewComment[];
  /** Gates that failed on the reviewed run — must pass on the next run. */
  failedGates: GateResultLike[];
  issuedAt: number;
}

// ── Approve outcome (discriminated — refusals carry their reason) ───────────

export type ApproveOutcome =
  | { ok: true; mergeCommit: Commit }
  /** Verification failed — human approval can NOT override gates. */
  | { ok: false; reason: 'gate_failed'; failedGates: GateResultLike[] }
  /** Merge conflicts — returned verbatim, never auto-resolved. */
  | { ok: false; reason: 'conflict'; conflicts: MergeConflict[] }
  | { ok: false; reason: 'not_pending'; status: AiRunStatus }
  | { ok: false; reason: 'commit_missing' };

// ── Helpers ─────────────────────────────────────────────────────────────────

export function aiBranchName(runId: string): string {
  return `ai/${runId}`;
}

export function failedGates(report: VerificationReportLike): GateResultLike[] {
  return report.gates.filter(g => !g.pass);
}

// ── Operations ──────────────────────────────────────────────────────────────

/**
 * Record an AI run into PDM: fork `ai/<runId>` from main's head, commit the
 * run's feature snapshot there, and return the pending review record.
 * The caller's current checkout is preserved.
 *
 * Throws when the branch already exists (duplicate runId) — a runId maps to
 * exactly one recorded branch; re-runs get new runIds.
 */
export function recordAiRun(repo: VersionRepo, input: AiRunInput): AiRunRecord {
  const branchName = aiBranchName(input.runId);
  const prevBranch = repo.current().branchName;
  repo.branch(branchName, { from: 'main' });
  repo.checkout(branchName);
  try {
    const c = repo.commit({
      authorUserId: input.author,
      message: input.message ?? `[ai] ${input.briefSummary}`,
      features: input.features,
    });
    return {
      runId: input.runId,
      branchName,
      commitId: c.id,
      briefSummary: input.briefSummary,
      report: input.report,
      status: 'pending',
      enqueuedAt: Date.now(),
    };
  } finally {
    repo.checkout(prevBranch);
  }
}

/**
 * Approve a pending run = 3-way merge `ai/<runId>` into `main`.
 *
 *   - Any failed gate → refusal with the gate list (no override path).
 *   - Merge conflicts → refusal with the conflict IR (human resolves; this
 *     function NEVER picks a side).
 *   - Clean merge → 2-parent merge commit on `main` (HEAD moves to main,
 *     mirroring sessionRepoStore.applyMerge semantics).
 *
 * The record itself is not mutated — the caller applies the status change
 * on `ok === true` (pure layer stays side-effect-free on queue data).
 */
export function approveRun(
  repo: VersionRepo,
  run: AiRunRecord,
  approver: string,
): ApproveOutcome {
  if (run.status !== 'pending') {
    return { ok: false, reason: 'not_pending', status: run.status };
  }
  const failed = failedGates(run.report);
  if (failed.length > 0) {
    return { ok: false, reason: 'gate_failed', failedGates: failed };
  }
  const main = repo.listBranches().find(b => b.name === 'main');
  const runCommit = repo.getCommit(run.commitId);
  if (!main || !runCommit) return { ok: false, reason: 'commit_missing' };
  const mainHead = repo.getCommit(main.headCommitId);
  if (!mainHead) return { ok: false, reason: 'commit_missing' };

  const lca = repo.lowestCommonAncestor(mainHead.id, runCommit.id);
  const result = mergeFeatures({
    base: (lca?.features ?? []).slice(),
    ours: mainHead.features.slice(),
    theirs: runCommit.features.slice(),
  });
  if (result.conflicts.length > 0) {
    return { ok: false, reason: 'conflict', conflicts: result.conflicts };
  }

  repo.checkout('main');
  const mergeCommit = repo.merge({
    authorUserId: approver,
    message: `Approve ${run.branchName}: merge into main`,
    features: result.merged.slice(),
    otherParentId: run.commitId,
  });
  return { ok: true, mergeCommit };
}

/**
 * Request changes on a run → RevisionDirective IR (see contract above).
 * Requires at least one comment — a change request without content is not
 * actionable input for the next run.
 */
export function buildRevisionDirective(
  run: AiRunRecord,
  comments: ReviewComment[],
): RevisionDirective {
  if (comments.length === 0) {
    throw new Error('requestChanges requires at least one comment');
  }
  return {
    kind: 'revision_directive',
    runId: run.runId,
    branchName: run.branchName,
    baseCommitId: run.commitId,
    briefSummary: run.briefSummary,
    comments: comments.map(c => ({ ...c })),
    failedGates: failedGates(run.report),
    issuedAt: Date.now(),
  };
}
