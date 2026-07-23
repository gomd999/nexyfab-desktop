/**
 * design-driver/pdmAdapter — Wave A Track WA-D2 (어댑터 · 되먹임).
 *
 * The PRODUCT adapter between the AI design driver and the tested PDM review
 * loop — the promotion of `waGate.test.ts`'s throwaway local adapter into a
 * real, owned, tested module. Three seams:
 *
 *   1. driverResultToAiRun — a VERIFIED driver package (ok:true) → the
 *      `recordAiRun` input the review queue commits. A refused result
 *      (ok:false) is NOT queued: verification failures never reach a human
 *      reviewer — they come back with their stage + reason instead (§0:
 *      "모든 AI 산출물은 실측 게이트를 통과한 것만 사람 앞에 도착한다").
 *   2. directiveToBrief — a `RevisionDirective` (the review-queue's
 *      changes-requested IR) + the original brief → the DesignBrief the next
 *      run executes. The reviewer's comments are carried both as human text
 *      (llmPlanner reads it — WA-D1 계약면) AND as structured `params`
 *      (deterministic planners ignore them, so the fixture planner re-runs the
 *      SAME plan; the LLM planner consumes them to actually revise). Lineage
 *      (어느 run의 개정인지) is preserved in params.
 *   3. runReviewCycle — a thin brief→run→record→(review)→rerun orchestration
 *      that stitches the driver and the review queue. It NEVER approves on its
 *      own; approval is the injected human `review` callback's decision
 *      (§0: 승인은 사람).
 *
 * Ownership: this file + its test are the ONLY files this track creates.
 * design-driver siblings and pdm/reviewQueue are CONSUMED (import-only) —
 * never modified.
 *
 * Honesty note (근사 명시): the FeatureInstance snapshot this adapter records
 * into PDM is a VERIFICATION snapshot — a per-part container of the measured
 * scalars a reviewer diffs (volume + each measured dimension + its deviation),
 * NOT the executable feature tree. The `type: 'shell'` tag is an inert
 * placeholder; these instances are not meant to be re-meshed. This is the one
 * approximation in the mapping and it is deliberate: the review loop diffs
 * verification results across runs, and the full geometry lives in the driver
 * package (carried verbatim under the report's `driverGates`).
 *
 * ⚠ Scope note (260723 architecture-debt scoping): "verification failures
 * never reach a human reviewer" / gate-approval guarantees in this file and
 * reviewQueue.ts describe THIS in-memory review-queue model only — they are
 * NOT enforced by the server persistence route (`POST /api/documents/[id]/
 * versions`), which treats gate status as purely advisory metadata. See
 * reviewQueue.ts's invariants block for the full explanation.
 */

import type {
  DesignBrief,
  DriverResult,
  GateResult,
  PartPackage,
} from './types';
import { runDesignDriver, type DriverDeps } from './designDriver';
import type { FeatureInstance } from '@/app/[lang]/shape-generator/features/types';
import { VersionRepo } from '@/app/[lang]/shape-generator/pdm/versionBranch';
import {
  recordAiRun,
  approveRun,
  buildRevisionDirective,
  type AiRunInput,
  type AiRunRecord,
  type ApproveOutcome,
  type GateResultLike,
  type ReviewComment,
  type RevisionDirective,
  type VerificationReportLike,
} from '@/app/[lang]/shape-generator/pdm/reviewQueue';

// ─── 1. driver package → review-queue input ────────────────────────────────

/**
 * Representative numeric summary of a gate for the loose review-queue report
 * (GateResultLike carries one measured value + threshold). The FULL metrics
 * object is not lost — it rides along verbatim under the report's `driverGates`
 * extra field. Keys per gate.kind mirror the gate implementations
 * (geometryGate / assemblyGate / manufacturingGate / drawingGate).
 */
function gateNumericSummary(g: GateResult): { value?: number; expected?: number; unit?: string } {
  const m = g.metrics;
  switch (g.kind) {
    case 'geometry':
      return { value: m.totalVolumeMm3, expected: m.expectedVolumeMm3, unit: 'mm3' };
    case 'assembly':
      return { value: m.finalMaxResidual, expected: m.tolerance, unit: 'mm' };
    case 'dfm':
      return { value: m.minDimMm, expected: m.minThicknessLimitMm, unit: 'mm' };
    case 'drawing':
      return { value: m.maxExpectedDeviation, expected: m.matchTol, unit: 'mm' };
    default:
      return {};
  }
}

function gateToLike(g: GateResult): GateResultLike {
  const s = gateNumericSummary(g);
  const like: GateResultLike = { id: g.id, pass: g.pass };
  if (s.value !== undefined && Number.isFinite(s.value)) like.value = s.value;
  if (s.expected !== undefined && Number.isFinite(s.expected)) like.expected = s.expected;
  if (like.value !== undefined && s.unit) like.unit = s.unit;
  if (g.reason) like.reason = g.reason;
  return like;
}

/**
 * Deterministic verification snapshot for ONE part: a stable id plus the
 * measured scalars a reviewer diffs across runs. Same package ⇒ same params,
 * byte-for-byte (dimension order is the plan's order). See module honesty note.
 */
function partPackageToFeature(runId: string, part: PartPackage): FeatureInstance {
  const params: Record<string, number> = {
    volumeMm3: part.volumeMm3,
    dimensionCount: part.dimensions.length,
  };
  for (const d of part.dimensions) {
    params[`dim:${d.id}`] = d.value;
    if (d.deviation !== undefined && Number.isFinite(d.deviation)) {
      params[`dim:${d.id}:dev`] = d.deviation;
    }
  }
  return { id: `${runId}:${part.partId}`, type: 'shell', params, enabled: true };
}

function driverReportLike(result: Extract<DriverResult, { ok: true }>): VerificationReportLike {
  const report = result.package.report;
  return {
    gates: result.gates.map(gateToLike),
    // Extras (VerificationReportLike has an index signature) — the reviewer's
    // full-fidelity context, preserved without polluting GateResultLike.
    allPassed: report.allPassed,
    planId: report.planId,
    briefId: report.briefId,
    approximations: report.approximations,
    limitations: report.limitations,
    /** Full driver gate IR (metrics + notes) — not lost in the loose mapping. */
    driverGates: result.gates,
  };
}

/** Outcome of adapting a driver result for the review queue. */
export type DriverToAiRunResult =
  | { ok: true; input: AiRunInput }
  /** The driver refused — NOT queued (unverified work never reaches a human). */
  | { ok: false; stage: 'plan' | 'verify'; reason: string; failedGateIds: string[] };

/**
 * Adapt a driver run for the PDM review queue.
 *
 *   - ok:true (all gates passed, package built) → `{ ok:true, input }` where
 *     `input` is ready for `recordAiRun`: one verification-snapshot
 *     FeatureInstance per part + a VerificationReportLike whose every gate
 *     passed (so `approveRun` can merge it after human approval).
 *   - ok:false (planner refused / a gate failed) → `{ ok:false, ... }`
 *     carrying the refusal stage + reason + failed gate ids. This is NOT
 *     enqueued: failed verification never reaches the reviewer.
 */
export function driverResultToAiRun(
  runId: string,
  briefSummary: string,
  author: string,
  result: DriverResult,
): DriverToAiRunResult {
  if (!result.ok) {
    return {
      ok: false,
      stage: result.refusal.stage,
      reason: result.refusal.reason,
      failedGateIds: result.refusal.failedGateIds,
    };
  }
  const features = result.package.parts.map((p) => partPackageToFeature(runId, p));
  return {
    ok: true,
    input: { runId, briefSummary, author, features, report: driverReportLike(result) },
  };
}

// ─── 2. revision directive → next-run brief ────────────────────────────────

/**
 * Structured revision params written onto the next-run brief. Deterministic
 * planners ignore them (so the fixture planner replays the same plan); the LLM
 * planner (WA-D1) reads them to actually apply the reviewer's changes. This is
 * the brief-field CONTRACT WA-D1 codes against.
 */
export interface RevisionBriefParams {
  /** runId of the run being revised (immediate parent in the lineage chain). */
  revisionOf: string;
  /** PDM branch the reviewed run lives on. */
  revisionBranch: string;
  /** Commit the reviewer's comments refer to. */
  revisionBaseCommit: string;
  /** 1 for the first revision, incremented each further revision (lineage depth). */
  revisionRound: number;
  revisionCommentCount: number;
  /** JSON.stringify(ReviewComment[]) — the reviewer's comments, verbatim. */
  revisionComments: string;
  /** Comma-joined ids of gates that must re-pass on the next run (may be ''). */
  revisionFailedGates: string;
}

/**
 * Turn a `RevisionDirective` + the brief that produced the reviewed run into
 * the brief the next run executes.
 *
 * Contract:
 *   - `id` and any existing `params` are PRESERVED — a deterministic planner
 *     that dispatched on `params.fixture ?? id` re-resolves the SAME plan, so
 *     the cycle re-runs without an LLM (WA-D1 not required for the loop to
 *     close).
 *   - the reviewer's comments are appended to `text` (human-readable, for the
 *     LLM planner) AND encoded in `params` (structured, machine-readable).
 *   - lineage is preserved: `revisionOf` points at the revised run and
 *     `revisionRound` counts the depth, so a chain of revisions is traceable.
 */
export function directiveToBrief(directive: RevisionDirective, originalBrief: DesignBrief): DesignBrief {
  const prior = Number(originalBrief.params?.revisionRound ?? 0);
  const round = Number.isFinite(prior) ? prior + 1 : 1;

  const commentLines = directive.comments.map(
    (c) => `- ${c.featureId ? `[${c.featureId}] ` : ''}${c.note}`,
  );
  const gateLine = directive.failedGates.length
    ? `\nMust re-pass gates: ${directive.failedGates.map((g) => g.id).join(', ')}`
    : '';
  const revisionBlock =
    `\n\n[REVISION ${round} — of run '${directive.runId}' at commit ${directive.baseCommitId} ` +
    `on ${directive.branchName}]\nAddress every reviewer comment:\n${commentLines.join('\n')}${gateLine}`;

  const params: Record<string, number | string> = {
    ...(originalBrief.params ?? {}),
    revisionOf: directive.runId,
    revisionBranch: directive.branchName,
    revisionBaseCommit: directive.baseCommitId,
    revisionRound: round,
    revisionCommentCount: directive.comments.length,
    revisionComments: JSON.stringify(directive.comments),
    revisionFailedGates: directive.failedGates.map((g) => g.id).join(','),
  };

  return { id: originalBrief.id, text: originalBrief.text + revisionBlock, params };
}

// ─── 3. review cycle orchestration ─────────────────────────────────────────

/** A human's decision on a recorded run. No decision → the loop cannot advance. */
export type ReviewDecision =
  | { action: 'approve'; approver: string }
  | { action: 'request_changes'; comments: ReviewComment[] }
  | { action: 'stop' };

export interface ReviewCycleReviewArgs {
  record: AiRunRecord;
  result: Extract<DriverResult, { ok: true }>;
  round: number;
}

export interface ReviewCycleConfig extends DriverDeps {
  repo: VersionRepo;
  /** PDM commit author for AI runs. Default 'design-driver'. */
  author?: string;
  /** Human review step — decides approve / request_changes / stop per run. */
  review: (args: ReviewCycleReviewArgs) => ReviewDecision | Promise<ReviewDecision>;
  /** runId for round r. Default: `runId` for r=0, `${runId}-rev${r}` after. */
  makeRunId?: (round: number) => string;
  /** Safety bound on revision rounds. Default 8. */
  maxRounds?: number;
}

export interface ReviewCycleRound {
  round: number;
  runId: string;
  brief: DesignBrief;
  result: DriverResult;
  /** Present iff the driver produced a package and it was queued for review. */
  record?: AiRunRecord;
  decision?: ReviewDecision;
  approval?: ApproveOutcome;
  directive?: RevisionDirective;
  /** Present iff the driver refused — nothing reached the reviewer this round. */
  refused?: { stage: 'plan' | 'verify'; reason: string; failedGateIds: string[] };
}

export type ReviewCycleOutcome =
  | { status: 'approved'; mergeCommitId: string; rounds: ReviewCycleRound[] }
  /** Human stopped, or approval was refused (gate/conflict) — run left pending. */
  | { status: 'stopped'; rounds: ReviewCycleRound[] }
  /** The driver refused — the run never reached the reviewer. */
  | { status: 'refused'; rounds: ReviewCycleRound[] }
  /** maxRounds exhausted without approval. */
  | { status: 'exhausted'; rounds: ReviewCycleRound[] };

/**
 * Run a full review cycle: for each round, run the driver, record the verified
 * package into PDM, ask the human `review` callback, and either approve (merge),
 * stop (leave pending), or apply the reviewer's changes and re-run. A refused
 * driver result ends the cycle without queueing (unverified work never reaches
 * the reviewer). This helper NEVER approves on its own — approval is the
 * callback's explicit decision.
 */
export async function runReviewCycle(
  initialBrief: DesignBrief,
  runId: string,
  cfg: ReviewCycleConfig,
): Promise<ReviewCycleOutcome> {
  const author = cfg.author ?? 'design-driver';
  const makeRunId = cfg.makeRunId ?? ((r: number) => (r === 0 ? runId : `${runId}-rev${r}`));
  const maxRounds = cfg.maxRounds ?? 8;
  const rounds: ReviewCycleRound[] = [];
  let brief = initialBrief;

  for (let r = 0; r < maxRounds; r++) {
    const rid = makeRunId(r);
    const result = await runDesignDriver(brief, { planner: cfg.planner });
    const briefSummary = (brief.text.split('\n')[0] ?? rid).trim() || rid;
    const adapted = driverResultToAiRun(rid, briefSummary, author, result);

    if (!adapted.ok) {
      rounds.push({
        round: r,
        runId: rid,
        brief,
        result,
        refused: { stage: adapted.stage, reason: adapted.reason, failedGateIds: adapted.failedGateIds },
      });
      return { status: 'refused', rounds };
    }

    const record = recordAiRun(cfg.repo, adapted.input);
    const okResult = result as Extract<DriverResult, { ok: true }>;
    const decision = await cfg.review({ record, result: okResult, round: r });
    const entry: ReviewCycleRound = { round: r, runId: rid, brief, result, record, decision };

    if (decision.action === 'approve') {
      const approval = approveRun(cfg.repo, record, decision.approver);
      entry.approval = approval;
      rounds.push(entry);
      if (approval.ok) return { status: 'approved', mergeCommitId: approval.mergeCommit.id, rounds };
      // Approval refused (gate/conflict) — a human must resolve; do not loop.
      return { status: 'stopped', rounds };
    }

    if (decision.action === 'stop') {
      rounds.push(entry);
      return { status: 'stopped', rounds };
    }

    // request_changes → build the directive, fold it into the next brief.
    const directive = buildRevisionDirective(record, decision.comments);
    entry.directive = directive;
    rounds.push(entry);
    brief = directiveToBrief(directive, brief);
  }

  return { status: 'exhausted', rounds };
}
