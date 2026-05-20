/**
 * promptEvaluation.ts — Regression + variant comparison framework
 * for the NexyFab prompt registry.
 *
 * The prompt registry (`prompts/index.ts`) supports A/B variants via
 * id like `{base}:variantName`. But shipping a variant without
 * measuring it is dangerous — a "tighter" prompt that breaks 20% of
 * existing flows is worse than the baseline. This module is the
 * harness that:
 *
 *   1. Holds a set of *golden cases* per prompt id — input + expected
 *      output shape.
 *   2. Runs every variant against every case, computing a per-case
 *      score and an aggregate.
 *   3. Reports regressions: cases that pass on baseline but fail on
 *      variant.
 *   4. Surfaces a confidence metric (golden-case pass rate) used by
 *      the rollout decision.
 *
 * Scoring is pluggable — a case can be checked by JSON schema,
 * string contains, semantic similarity (caller-supplied), or
 * arbitrary predicate.
 */

export type CaseStatus = 'pass' | 'fail' | 'error';

export interface GoldenCase<TInput = unknown, TOutput = unknown> {
  /** Stable id. */
  id: string;
  /** Description shown in reports. */
  description: string;
  /** Tags for filtering. */
  tags?: string[];
  /** Input the prompt will be evaluated against. */
  input: TInput;
  /** Predicate that decides whether the response is acceptable. */
  check: (output: TOutput) => boolean;
}

export interface CaseResult {
  caseId: string;
  status: CaseStatus;
  /** Error message when status === 'error'. */
  errorMessage?: string;
  /** Optional score 0..1 for partial credit (default 1 if pass, 0 if fail). */
  score: number;
  durationMs: number;
}

export interface VariantEvaluation {
  promptId: string;
  variantName: string;
  cases: CaseResult[];
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number;
  meanScore: number;
}

export type PromptRunner<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

/** Run all golden cases against a single variant. */
export async function evaluateVariant<TInput, TOutput>(
  promptId: string,
  variantName: string,
  runner: PromptRunner<TInput, TOutput>,
  cases: Array<GoldenCase<TInput, TOutput>>,
): Promise<VariantEvaluation> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const start = Date.now();
    try {
      const out = await runner(c.input);
      const pass = c.check(out);
      results.push({
        caseId: c.id,
        status: pass ? 'pass' : 'fail',
        score: pass ? 1 : 0,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      results.push({
        caseId: c.id,
        status: 'error',
        errorMessage: e instanceof Error ? e.message : String(e),
        score: 0,
        durationMs: Date.now() - start,
      });
    }
  }
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const errored = results.filter(r => r.status === 'error').length;
  return {
    promptId,
    variantName,
    cases: results,
    totalCases: cases.length,
    passed,
    failed,
    errored,
    passRate: cases.length > 0 ? passed / cases.length : 0,
    meanScore: cases.length > 0 ? results.reduce((s, r) => s + r.score, 0) / cases.length : 0,
  };
}

// ── Regression detection ─────────────────────────────────────────

export interface RegressionReport {
  promptId: string;
  baselineVariant: string;
  candidateVariant: string;
  /** Cases that PASSED on baseline but FAIL on candidate — these are
   *  the regressions the team must triage before rollout. */
  regressed: Array<{ caseId: string; baselineStatus: CaseStatus; candidateStatus: CaseStatus }>;
  /** Cases the candidate fixed (failed baseline, pass candidate). */
  improved: Array<{ caseId: string; baselineStatus: CaseStatus; candidateStatus: CaseStatus }>;
  /** Pass-rate delta in percentage points. */
  passRateDeltaPp: number;
  /** Recommendation. */
  recommendation: 'safe-to-rollout' | 'needs-review' | 'do-not-rollout';
}

export function compareVariants(
  baseline: VariantEvaluation,
  candidate: VariantEvaluation,
): RegressionReport {
  if (baseline.promptId !== candidate.promptId) {
    throw new Error(`Variant comparison requires same promptId — got "${baseline.promptId}" vs "${candidate.promptId}"`);
  }
  const baselineMap = new Map(baseline.cases.map(c => [c.caseId, c]));
  const candidateMap = new Map(candidate.cases.map(c => [c.caseId, c]));
  const regressed: RegressionReport['regressed'] = [];
  const improved: RegressionReport['improved'] = [];
  for (const [caseId, baselineCase] of baselineMap) {
    const candCase = candidateMap.get(caseId);
    if (!candCase) continue;
    if (baselineCase.status === 'pass' && candCase.status !== 'pass') {
      regressed.push({
        caseId,
        baselineStatus: baselineCase.status,
        candidateStatus: candCase.status,
      });
    } else if (baselineCase.status !== 'pass' && candCase.status === 'pass') {
      improved.push({
        caseId,
        baselineStatus: baselineCase.status,
        candidateStatus: candCase.status,
      });
    }
  }
  const deltaPp = (candidate.passRate - baseline.passRate) * 100;
  let recommendation: RegressionReport['recommendation'];
  if (regressed.length === 0 && deltaPp >= 0) recommendation = 'safe-to-rollout';
  else if (regressed.length === 0 || deltaPp >= 5) recommendation = 'needs-review';
  else recommendation = 'do-not-rollout';

  return {
    promptId: baseline.promptId,
    baselineVariant: baseline.variantName,
    candidateVariant: candidate.variantName,
    regressed,
    improved,
    passRateDeltaPp: deltaPp,
    recommendation,
  };
}

// ── Aggregate registry ───────────────────────────────────────────

export interface RegistryEvaluation {
  /** Per-prompt baseline + variant + comparison. */
  perPrompt: Array<{
    promptId: string;
    baseline: VariantEvaluation;
    variant: VariantEvaluation;
    regression: RegressionReport;
  }>;
  /** Overall rollout safety — true when *every* prompt is safe. */
  allSafeToRollout: boolean;
  /** Aggregate delta in percentage points (weighted by case count). */
  weightedDeltaPp: number;
}

export function aggregateRegistryEval(
  entries: Array<{ baseline: VariantEvaluation; variant: VariantEvaluation }>,
): RegistryEvaluation {
  let totalCases = 0;
  let weightedDelta = 0;
  let allSafe = true;
  const perPrompt: RegistryEvaluation['perPrompt'] = [];
  for (const e of entries) {
    const reg = compareVariants(e.baseline, e.variant);
    perPrompt.push({
      promptId: e.baseline.promptId,
      baseline: e.baseline,
      variant: e.variant,
      regression: reg,
    });
    totalCases += e.baseline.totalCases;
    weightedDelta += reg.passRateDeltaPp * e.baseline.totalCases;
    if (reg.recommendation !== 'safe-to-rollout') allSafe = false;
  }
  return {
    perPrompt,
    allSafeToRollout: allSafe,
    weightedDeltaPp: totalCases > 0 ? weightedDelta / totalCases : 0,
  };
}
