/**
 * pdmAdapter.test.ts — Wave A Track WA-D2 (executed).
 *
 * Proves the PRODUCT adapter between the design driver and the tested PDM
 * review loop (the promotion of waGate.test.ts's local adapter):
 *   - driverResultToAiRun round-trip: a verified package → recorded run →
 *     human approve = 2-parent merge on main (via the REAL VersionRepo).
 *   - a refused driver result (ok:false) is NOT queued — it returns its
 *     stage + reason, and no ai/<runId> branch is created.
 *   - directiveToBrief preserves lineage + comments and re-runs deterministically.
 *   - runReviewCycle stitches driver ↔ review queue with an injected human
 *     reviewer (no auto-approval).
 *
 * Everything runs — no mocked geometry, no mocked repo (원칙: 실행하지 않은
 * 판정은 판정이 아니다).
 */

import { describe, it, expect } from 'vitest';
import {
  runDesignDriver,
  fixturePlanner,
  staticPlanner,
  lBracketPlan,
  type DesignBrief,
  type DriverResult,
} from '@/lib/ai/design-driver';
import {
  driverResultToAiRun,
  directiveToBrief,
  runReviewCycle,
  type ReviewCycleReviewArgs,
  type ReviewDecision,
  type RevisionBriefParams,
} from '@/lib/ai/design-driver/pdmAdapter';
import { VersionRepo } from '@/app/[lang]/shape-generator/pdm/versionBranch';
import {
  recordAiRun,
  approveRun,
  buildRevisionDirective,
} from '@/app/[lang]/shape-generator/pdm/reviewQueue';

const AI = 'design-driver';
const REVIEWER = 'partner-reviewer';

const bracketBrief = (): DesignBrief => ({ id: 'l-bracket', text: 'fixture l-bracket' });

async function runBracket(): Promise<DriverResult> {
  return runDesignDriver(bracketBrief(), { planner: fixturePlanner });
}

describe('driverResultToAiRun — verified package → review-queue input', () => {
  it('maps a passing driver run to a recordable AiRunInput (stable id + measured snapshot)', async () => {
    const res = await runBracket();
    const adapted = driverResultToAiRun('run-1', 'bracket v1', AI, res);
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;

    const input = adapted.input;
    expect(input.runId).toBe('run-1');
    expect(input.author).toBe(AI);
    // One verification-snapshot feature per part, stable id `${runId}:${partId}`.
    expect(input.features).toHaveLength(1);
    const feat = input.features[0]!;
    expect(feat.id).toBe('run-1:bracket');
    expect(feat.enabled).toBe(true);
    // Measured scalars a reviewer diffs: exact prism volume + each measured dim.
    expect(feat.params.volumeMm3).toBeCloseTo(14720, 6);
    expect(feat.params.dimensionCount).toBe(5);
    expect(feat.params['dim:d_width']).toBeCloseTo(60, 9);
    expect(feat.params['dim:d_depth']).toBeCloseTo(20, 9);
    // Report: every gate passed (so it can be approved) + honesty extras.
    expect(input.report.gates.length).toBeGreaterThanOrEqual(3);
    expect(input.report.gates.every((g) => g.pass)).toBe(true);
    const geo = input.report.gates.find((g) => g.id === 'geometry:bracket')!;
    expect(geo.value).toBeCloseTo(14720, 6);
    expect(geo.unit).toBe('mm3');
    expect(input.report.allPassed).toBe(true);
    expect(Array.isArray(input.report.limitations)).toBe(true);
    // Full-fidelity driver gate IR preserved (not lost in the loose mapping).
    expect(Array.isArray(input.report.driverGates)).toBe(true);
  });

  it('round-trip: adapted input → recordAiRun → human approve = 2-parent merge on main', async () => {
    const repo = new VersionRepo([], REVIEWER);
    const res = await runBracket();
    const adapted = driverResultToAiRun('run-1', 'bracket v1', AI, res);
    if (!adapted.ok) throw new Error('expected ok');

    const rec = recordAiRun(repo, adapted.input);
    expect(rec.branchName).toBe('ai/run-1');
    expect(rec.status).toBe('pending');

    const approved = approveRun(repo, rec, REVIEWER);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.mergeCommit.parents).toHaveLength(2);
    expect(approved.mergeCommit.parents).toContain(rec.commitId);
    // The verification snapshot landed on main.
    expect(approved.mergeCommit.features.map((f) => f.id)).toContain('run-1:bracket');
  });

  it('is deterministic: the same package maps to the same snapshot params', async () => {
    const a = driverResultToAiRun('run-x', 's', AI, await runBracket());
    const b = driverResultToAiRun('run-x', 's', AI, await runBracket());
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.input.features).toEqual(b.input.features);
  });
});

describe('driverResultToAiRun — refused results never reach the queue', () => {
  it('planner refusal (unknown brief) → ok:false stage=plan, nothing queued', async () => {
    const repo = new VersionRepo([], REVIEWER);
    const res = await runDesignDriver(
      { id: 'unknown-thing', text: 'the fixture planner does not know this' },
      { planner: fixturePlanner },
    );
    const adapted = driverResultToAiRun('run-bad', 'bad', AI, res);
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.stage).toBe('plan');
    expect(adapted.reason).toContain('unknown brief');
    // Caller must NOT enqueue — assert the branch was never forked.
    expect(repo.listBranches().find((b) => b.name === 'ai/run-bad')).toBeUndefined();
  });

  it('gate failure (wrong expected volume) → ok:false stage=verify with failed gate ids', async () => {
    const plan = lBracketPlan();
    plan.parts[0]!.expectedVolume = { valueMm3: 99999, basis: 'deliberately wrong for the test' };
    const res = await runDesignDriver(bracketBrief(), { planner: staticPlanner(plan) });
    expect(res.ok).toBe(false);

    const adapted = driverResultToAiRun('run-fail', 'broken', AI, res);
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.stage).toBe('verify');
    expect(adapted.failedGateIds).toContain('geometry:bracket');
    expect(adapted.reason).toContain('geometry:bracket');
  });
});

describe('directiveToBrief — lineage + comments → next-run brief', () => {
  it('preserves id/params, appends comments, encodes structured revision params', async () => {
    const repo = new VersionRepo([], REVIEWER);
    // Brief that dispatches via params.fixture (id differs on purpose).
    const original: DesignBrief = {
      id: 'customer-req-42',
      text: 'a mounting bracket',
      params: { fixture: 'l-bracket', qty: 2 },
    };
    const res0 = driverResultToAiRun('run-1', 'v1', AI, await runBracket());
    if (!res0.ok) throw new Error('ok expected');
    const rec = recordAiRun(repo, res0.input);
    const directive = buildRevisionDirective(rec, [
      { featureId: 'run-1:bracket', note: 'flange needs a chamfer note' },
      { note: 'reduce overall mass' },
    ]);

    const revised = directiveToBrief(directive, original);

    // id + prior params preserved (deterministic planner re-dispatch survives).
    expect(revised.id).toBe('customer-req-42');
    expect(revised.params!.fixture).toBe('l-bracket');
    expect(revised.params!.qty).toBe(2);
    // Comments appear in human-readable text (LLM planner reads this).
    expect(revised.text).toContain('a mounting bracket');
    expect(revised.text).toContain('flange needs a chamfer note');
    expect(revised.text).toContain('reduce overall mass');
    // Structured revision params (WA-D1 contract) + lineage.
    const p = revised.params as unknown as RevisionBriefParams;
    expect(p.revisionOf).toBe('run-1');
    expect(p.revisionBranch).toBe('ai/run-1');
    expect(p.revisionBaseCommit).toBe(rec.commitId);
    expect(p.revisionRound).toBe(1);
    expect(p.revisionCommentCount).toBe(2);
    expect(JSON.parse(p.revisionComments)).toEqual([
      { featureId: 'run-1:bracket', note: 'flange needs a chamfer note' },
      { note: 'reduce overall mass' },
    ]);
  });

  it('increments the round across a chain of revisions (lineage depth)', async () => {
    const repo = new VersionRepo([], REVIEWER);
    const original = bracketBrief();
    const a = driverResultToAiRun('run-1', 'v1', AI, await runBracket());
    if (!a.ok) throw new Error('ok');
    const rec1 = recordAiRun(repo, a.input);
    const d1 = buildRevisionDirective(rec1, [{ note: 'first change' }]);
    const rev1 = directiveToBrief(d1, original);
    expect(rev1.params!.revisionRound).toBe(1);

    const b = driverResultToAiRun('run-2', 'v2', AI, await runBracket());
    if (!b.ok) throw new Error('ok');
    const rec2 = recordAiRun(repo, b.input);
    const d2 = buildRevisionDirective(rec2, [{ note: 'second change' }]);
    const rev2 = directiveToBrief(d2, rev1);
    expect(rev2.params!.revisionRound).toBe(2);
    expect(rev2.params!.revisionOf).toBe('run-2');
  });

  it('the revised brief re-runs deterministically (fixture planner replays the plan)', async () => {
    const repo = new VersionRepo([], REVIEWER);
    const original = bracketBrief();
    const a = driverResultToAiRun('run-1', 'v1', AI, await runBracket());
    if (!a.ok) throw new Error('ok');
    const rec = recordAiRun(repo, a.input);
    const directive = buildRevisionDirective(rec, [{ note: 'tweak' }]);
    const revised = directiveToBrief(directive, original);

    const rerun = await runDesignDriver(revised, { planner: fixturePlanner });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) return;
    expect(rerun.plan.planId).toBe('fixture-l-bracket');
  });
});

describe('runReviewCycle — driver ↔ review queue orchestration', () => {
  it('request_changes then approve → approved with a 2-parent merge; no auto-approval', async () => {
    const repo = new VersionRepo([], REVIEWER);
    const seen: Array<{ round: number; action: string }> = [];
    const review = ({ round, record }: ReviewCycleReviewArgs): ReviewDecision => {
      if (round === 0) {
        seen.push({ round, action: 'request_changes' });
        return { action: 'request_changes', comments: [{ featureId: `${record.runId}:bracket`, note: 'add chamfer' }] };
      }
      seen.push({ round, action: 'approve' });
      return { action: 'approve', approver: REVIEWER };
    };

    const outcome = await runReviewCycle(bracketBrief(), 'cyc', { planner: fixturePlanner, repo, review });
    expect(outcome.status).toBe('approved');
    if (outcome.status !== 'approved') return;
    expect(outcome.rounds).toHaveLength(2);
    // Round 0 requested changes and produced a directive (no approval).
    expect(outcome.rounds[0]!.directive).toBeDefined();
    expect(outcome.rounds[0]!.approval).toBeUndefined();
    expect(outcome.rounds[0]!.runId).toBe('cyc');
    // Round 1 re-ran on the revised brief and was approved (2-parent merge).
    expect(outcome.rounds[1]!.runId).toBe('cyc-rev1');
    const brief1 = outcome.rounds[1]!.brief;
    expect(brief1.params!.revisionOf).toBe('cyc');
    expect(brief1.text).toContain('add chamfer');
    const approval = outcome.rounds[1]!.approval!;
    expect(approval.ok).toBe(true);
    if (!approval.ok) return;
    expect(approval.mergeCommit.parents).toHaveLength(2);
    expect(outcome.mergeCommitId).toBe(approval.mergeCommit.id);
    // The human callback is the ONLY approver — the helper never auto-approved.
    expect(seen).toEqual([
      { round: 0, action: 'request_changes' },
      { round: 1, action: 'approve' },
    ]);
    // main advanced to the merge.
    expect(repo.listBranches().find((b) => b.name === 'main')!.headCommitId).toBe(outcome.mergeCommitId);
  });

  it('stop decision leaves the run pending (no merge)', async () => {
    const repo = new VersionRepo([], REVIEWER);
    const outcome = await runReviewCycle(bracketBrief(), 'cyc2', {
      planner: fixturePlanner,
      repo,
      review: () => ({ action: 'stop' }),
    });
    expect(outcome.status).toBe('stopped');
    if (outcome.status !== 'stopped') return;
    expect(outcome.rounds).toHaveLength(1);
    expect(outcome.rounds[0]!.record!.status).toBe('pending');
    // No merge commit created on main (head is still the empty root).
    const main = repo.listBranches().find((b) => b.name === 'main')!;
    expect(repo.getCommit(main.headCommitId)!.parents.length).toBeLessThan(2);
  });

  it('a refused driver result ends the cycle without queueing', async () => {
    const repo = new VersionRepo([], REVIEWER);
    const outcome = await runReviewCycle(
      { id: 'unknown', text: 'planner does not know this' },
      'cyc3',
      { planner: fixturePlanner, repo, review: () => ({ action: 'approve', approver: REVIEWER }) },
    );
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.rounds[0]!.refused!.stage).toBe('plan');
    expect(outcome.rounds[0]!.record).toBeUndefined();
    expect(repo.listBranches().find((b) => b.name === 'ai/cyc3')).toBeUndefined();
  });
});
