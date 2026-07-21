/**
 * reviewQueue.test.ts — Wave A Track WA-C.
 *
 * Proves the AI review loop's pure layer against the REAL PDM engine
 * (VersionRepo + mergeFeatures — no mocks):
 *   - recordAiRun forks ai/<runId> from main and commits the run snapshot
 *   - approve = measured 2-parent merge commit on main
 *   - conflicting run → conflict IR returned verbatim, NOTHING auto-resolved
 *   - failed gate → approval refused with the gate list (no human override)
 *   - requestChanges → RevisionDirective IR (next-run input contract)
 * plus the sessionRepoStore additive wrappers (enqueue/approve/requestChanges
 * and reset clearing the queue).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VersionRepo } from './versionBranch';
import {
  recordAiRun,
  approveRun,
  buildRevisionDirective,
  aiBranchName,
  failedGates,
  type AiRunInput,
  type VerificationReportLike,
} from './reviewQueue';
import { usePdmSessionStore } from './sessionRepoStore';
import type { FeatureInstance } from '../features/types';

const f = (id: string, params: Record<string, number> = {}): FeatureInstance => ({
  id, type: 'fillet', params, enabled: true,
});

const passReport = (): VerificationReportLike => ({
  gates: [
    { id: 'geometry.watertight', pass: true },
    { id: 'geometry.volume', pass: true, value: 1279.98, expected: 1280, unit: 'mm3' },
    { id: 'dimension.measured', pass: true, value: 40, expected: 40, unit: 'mm' },
  ],
});

const failReport = (): VerificationReportLike => ({
  gates: [
    { id: 'geometry.watertight', pass: true },
    { id: 'dfm.minWall', pass: false, value: 0.4, expected: 0.8, unit: 'mm', reason: 'wall 0.4mm < min 0.8mm' },
  ],
});

const runInput = (runId: string, features: FeatureInstance[], report = passReport()): AiRunInput => ({
  runId,
  briefSummary: `brief for ${runId}`,
  features,
  report,
  author: 'ai-driver',
});

describe('recordAiRun', () => {
  it('forks ai/<runId> from main head, commits the snapshot, preserves checkout', () => {
    const repo = new VersionRepo([f('a', { radius: 3 })], 'human');
    repo.branch('wip');
    repo.checkout('wip');

    const run = recordAiRun(repo, runInput('r1', [f('a', { radius: 3 }), f('b', { d: 6 })]));

    expect(run.branchName).toBe('ai/r1');
    expect(run.status).toBe('pending');
    // Checkout preserved.
    expect(repo.current().branchName).toBe('wip');
    // Branch exists with the run commit at its head, parented on main's head.
    const branch = repo.listBranches().find(b => b.name === 'ai/r1')!;
    expect(branch.headCommitId).toBe(run.commitId);
    const c = repo.getCommit(run.commitId)!;
    const mainHead = repo.listBranches().find(b => b.name === 'main')!.headCommitId;
    expect(c.parents).toEqual([mainHead]);
    expect(c.features.map(x => x.id)).toEqual(['a', 'b']);
    expect(c.authorUserId).toBe('ai-driver');
  });

  it('refuses a duplicate runId (branch already exists)', () => {
    const repo = new VersionRepo([f('a')], 'human');
    recordAiRun(repo, runInput('r1', [f('a'), f('b')]));
    expect(() => recordAiRun(repo, runInput('r1', [f('a')]))).toThrow(/already exists/);
  });
});

describe('approveRun — measured merge', () => {
  it('enqueue→approve lands a 2-parent merge commit on main with the AI change', () => {
    const repo = new VersionRepo([f('a', { radius: 3 })], 'human');
    const run = recordAiRun(repo, runInput('r1', [f('a', { radius: 3 }), f('b', { d: 6 })]));
    const mainHeadBefore = repo.listBranches().find(b => b.name === 'main')!.headCommitId;

    const outcome = approveRun(repo, run, 'reviewer-kim');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Measured 2-parent merge commit: [old main head, run commit].
    expect(outcome.mergeCommit.parents).toHaveLength(2);
    expect(outcome.mergeCommit.parents[0]).toBe(mainHeadBefore);
    expect(outcome.mergeCommit.parents[1]).toBe(run.commitId);
    expect(outcome.mergeCommit.authorUserId).toBe('reviewer-kim');
    // main advanced to the merge commit; AI feature landed.
    const main = repo.listBranches().find(b => b.name === 'main')!;
    expect(main.headCommitId).toBe(outcome.mergeCommit.id);
    expect(outcome.mergeCommit.features.find(x => x.id === 'b')?.params.d).toBe(6);
  });

  it('merges cleanly when main advanced on a DIFFERENT feature after the fork (3-way, LCA base)', () => {
    const repo = new VersionRepo([f('a', { radius: 3 })], 'human');
    const run = recordAiRun(repo, runInput('r1', [f('a', { radius: 3 }), f('b', { d: 6 })]));
    // Human meanwhile edits a different feature on main.
    repo.checkout('main');
    repo.commit({ authorUserId: 'human', message: 'add c', features: [f('a', { radius: 3 }), f('c', { t: 1 })] });

    const outcome = approveRun(repo, run, 'reviewer');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const ids = outcome.mergeCommit.features.map(x => x.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('conflicting run → conflict IR returned, NO auto-resolution, NO commit, run stays pending', () => {
    const repo = new VersionRepo([f('a', { radius: 3 })], 'human');
    // AI edits a.radius → 5.
    const run = recordAiRun(repo, runInput('r1', [f('a', { radius: 5 })]));
    // Human concurrently edits a.radius → 7 on main → modify-modify conflict.
    repo.checkout('main');
    repo.commit({ authorUserId: 'human', message: 'r7', features: [f('a', { radius: 7 })] });
    const commitsBefore = repo.listCommits().length;
    const mainHeadBefore = repo.listBranches().find(b => b.name === 'main')!.headCommitId;

    const outcome = approveRun(repo, run, 'reviewer');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('conflict');
    if (outcome.reason !== 'conflict') return;
    // Conflict IR carries both sides verbatim — nothing was picked for us.
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0]!.featureId).toBe('a');
    expect(outcome.conflicts[0]!.kind).toBe('modify-modify');
    expect(outcome.conflicts[0]!.ours?.params.radius).toBe(7);
    expect(outcome.conflicts[0]!.theirs?.params.radius).toBe(5);
    // No commit was created; main did not move; run untouched.
    expect(repo.listCommits()).toHaveLength(commitsBefore);
    expect(repo.listBranches().find(b => b.name === 'main')!.headCommitId).toBe(mainHeadBefore);
    expect(run.status).toBe('pending');
  });

  it('failed gate → approval refused with the failed gates; human approval cannot override', () => {
    const repo = new VersionRepo([f('a')], 'human');
    const run = recordAiRun(repo, runInput('r1', [f('a'), f('b')], failReport()));
    const commitsBefore = repo.listCommits().length;

    const outcome = approveRun(repo, run, 'reviewer');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('gate_failed');
    if (outcome.reason !== 'gate_failed') return;
    expect(outcome.failedGates).toHaveLength(1);
    expect(outcome.failedGates[0]!.id).toBe('dfm.minWall');
    expect(outcome.failedGates[0]!.reason).toContain('0.4mm');
    expect(repo.listCommits()).toHaveLength(commitsBefore); // nothing merged
  });

  it('non-pending run → not_pending refusal', () => {
    const repo = new VersionRepo([f('a')], 'human');
    const run = recordAiRun(repo, runInput('r1', [f('a'), f('b')]));
    const approved = { ...run, status: 'approved' as const };
    const outcome = approveRun(repo, approved, 'reviewer');
    expect(outcome).toEqual({ ok: false, reason: 'not_pending', status: 'approved' });
  });
});

describe('buildRevisionDirective — next-run input contract', () => {
  it('carries runId/branch/base commit, comments (with target feature ids) and failed gates', () => {
    const repo = new VersionRepo([f('a')], 'human');
    const run = recordAiRun(repo, runInput('r9', [f('a'), f('b', { d: 6 })], failReport()));

    const d = buildRevisionDirective(run, [
      { featureId: 'b', note: 'hole diameter should be 8mm, not 6mm' },
      { note: 'overall: reduce mass' },
    ]);

    expect(d.kind).toBe('revision_directive');
    expect(d.runId).toBe('r9');
    expect(d.branchName).toBe(aiBranchName('r9'));
    expect(d.baseCommitId).toBe(run.commitId);
    expect(d.briefSummary).toBe('brief for r9');
    expect(d.comments).toEqual([
      { featureId: 'b', note: 'hole diameter should be 8mm, not 6mm' },
      { note: 'overall: reduce mass' },
    ]);
    // Failed gates ride along — the next run must re-pass them.
    expect(d.failedGates.map(g => g.id)).toEqual(['dfm.minWall']);
    expect(typeof d.issuedAt).toBe('number');
  });

  it('refuses an empty change request (not actionable input)', () => {
    const repo = new VersionRepo([f('a')], 'human');
    const run = recordAiRun(repo, runInput('r1', [f('a')], passReport()));
    expect(() => buildRevisionDirective(run, [])).toThrow(/at least one comment/);
  });
});

describe('failedGates helper', () => {
  it('filters exactly the failing gates', () => {
    expect(failedGates(passReport())).toHaveLength(0);
    expect(failedGates(failReport()).map(g => g.id)).toEqual(['dfm.minWall']);
  });
});

// ── sessionRepoStore additive wrappers ──────────────────────────────────────

const store = () => usePdmSessionStore.getState();

beforeEach(() => {
  usePdmSessionStore.setState({ repo: null, rev: 0, isDemo: false, pendingMerge: null, aiRuns: [] });
});

describe('sessionRepoStore — AI review queue (additive)', () => {
  it('enqueueAiRun records the branch commit and queues the run; null without a repo', () => {
    expect(store().enqueueAiRun(runInput('r1', [f('a')]))).toBeNull();

    store().init([f('a', { radius: 3 })], 'human');
    const run = store().enqueueAiRun(runInput('r1', [f('a', { radius: 3 }), f('b', { d: 6 })]));
    expect(run).not.toBeNull();
    expect(store().aiRuns).toHaveLength(1);
    expect(store().aiRuns[0]!.branchName).toBe('ai/r1');
    // Duplicate runId → refused, queue unchanged.
    expect(store().enqueueAiRun(runInput('r1', [f('a')]))).toBeNull();
    expect(store().aiRuns).toHaveLength(1);
  });

  it('approveAiRun marks the run approved with the merge commit id', () => {
    store().init([f('a', { radius: 3 })], 'human');
    store().enqueueAiRun(runInput('r1', [f('a', { radius: 3 }), f('b', { d: 6 })]));

    const outcome = store().approveAiRun('r1', 'reviewer');
    expect(outcome?.ok).toBe(true);
    const rec = store().aiRuns[0]!;
    expect(rec.status).toBe('approved');
    expect(rec.mergeCommitId).toBeDefined();
    const head = store().repo!.current().commit;
    expect(head.id).toBe(rec.mergeCommitId);
    expect(head.parents).toHaveLength(2);
    // Approving again → not_pending (no second merge).
    const again = store().approveAiRun('r1', 'reviewer');
    expect(again && !again.ok && again.reason).toBe('not_pending');
  });

  it('approveAiRun surfaces gate_failed and leaves the run pending', () => {
    store().init([f('a')], 'human');
    store().enqueueAiRun(runInput('r1', [f('a'), f('b')], failReport()));
    const outcome = store().approveAiRun('r1', 'reviewer');
    expect(outcome && !outcome.ok && outcome.reason).toBe('gate_failed');
    expect(store().aiRuns[0]!.status).toBe('pending');
  });

  it('requestAiChanges returns the directive and marks the run changes_requested', () => {
    store().init([f('a')], 'human');
    store().enqueueAiRun(runInput('r1', [f('a'), f('b', { d: 6 })]));

    const d = store().requestAiChanges('r1', [{ featureId: 'b', note: 'use 8mm' }]);
    expect(d?.kind).toBe('revision_directive');
    expect(d?.comments[0]).toEqual({ featureId: 'b', note: 'use 8mm' });
    expect(store().aiRuns[0]!.status).toBe('changes_requested');
    // No comments → null, status untouched thereafter.
    expect(store().requestAiChanges('r1', [])).toBeNull();
  });

  it('reset clears the queue with the repo', () => {
    store().init([f('a')], 'human');
    store().enqueueAiRun(runInput('r1', [f('a'), f('b')]));
    expect(store().aiRuns).toHaveLength(1);
    store().reset();
    expect(store().aiRuns).toHaveLength(0);
    expect(store().repo).toBeNull();
  });
});
