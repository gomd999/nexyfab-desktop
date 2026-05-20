/**
 * promptVariantGuard.ts — Safety net for prompt A/B experiments.
 *
 * NexyFab runs prompt variants in production via `prompt-variant-burnin`
 * (cron). When a new variant ships worse-than-baseline metrics (higher
 * error rate, longer p95 latency, or — added here — lower eval-suite
 * pass rate), the variant should be auto-disabled before it touches
 * more users.
 *
 * The cron already disables variants on call-time metrics. This module
 * adds the EVAL dimension: when a variant's eval-suite pass rate drops
 * by more than the configured threshold vs. the baseline's last run,
 * `shouldDisableVariantByEval` returns the disable verdict + reason.
 *
 * Inputs are intentionally minimal (just the eval snapshots) so the
 * module can be re-used from cron, CI, and ad-hoc admin tooling.
 */

export interface EvalSnapshot {
  /** Prompt identifier — baseline shares the prefix, variant has the
   *  `:variant-name` suffix per NexyFab convention. */
  promptId: string;
  /** Pass rate as a 0..1 fraction (matches `EvalSuiteResult.passRate`). */
  passRate: number;
  /** Total cases run — guards against drawing conclusions from too few. */
  totalCases: number;
  /** Snapshot timestamp (ms epoch). */
  timestamp: number;
}

export interface VariantGuardVerdict {
  variantId: string;
  baselineId: string;
  variantPassRate: number;
  baselinePassRate: number;
  passRateDrop: number;
  decision: 'ok' | 'warn' | 'disable' | 'insufficient_data';
  reason?: string;
}

export interface VariantGuardOptions {
  /** Minimum cases each side must clear before we trust the comparison. */
  minCases?: number;
  /** Drop in pass rate (variant − baseline) that triggers a warning. */
  warnDropThreshold?: number;
  /** Drop in pass rate that triggers auto-disable. */
  disableDropThreshold?: number;
}

const DEFAULT_MIN_CASES = 10;
const DEFAULT_WARN_DROP = 0.05; // 5 percentage points
const DEFAULT_DISABLE_DROP = 0.15; // 15 percentage points

/** Pair the eval snapshots by base id — `prompt-xyz` is the baseline
 *  for `prompt-xyz:variant-foo`. Returns a verdict per variant. */
export function judgeVariants(
  snapshots: EvalSnapshot[],
  opts: VariantGuardOptions = {},
): VariantGuardVerdict[] {
  const minCases = opts.minCases ?? DEFAULT_MIN_CASES;
  const warnDrop = opts.warnDropThreshold ?? DEFAULT_WARN_DROP;
  const disableDrop = opts.disableDropThreshold ?? DEFAULT_DISABLE_DROP;

  // Index by promptId for lookup.
  const byId = new Map<string, EvalSnapshot>();
  for (const s of snapshots) {
    const existing = byId.get(s.promptId);
    // Keep the most recent snapshot per promptId.
    if (!existing || s.timestamp > existing.timestamp) byId.set(s.promptId, s);
  }

  const verdicts: VariantGuardVerdict[] = [];
  for (const snap of byId.values()) {
    if (!snap.promptId.includes(':')) continue; // baseline, not a variant
    const baselineId = snap.promptId.split(':')[0];
    const baseline = byId.get(baselineId);
    if (!baseline) {
      verdicts.push({
        variantId: snap.promptId,
        baselineId,
        variantPassRate: snap.passRate,
        baselinePassRate: 0,
        passRateDrop: 0,
        decision: 'insufficient_data',
        reason: `no baseline snapshot for '${baselineId}'`,
      });
      continue;
    }
    if (snap.totalCases < minCases || baseline.totalCases < minCases) {
      verdicts.push({
        variantId: snap.promptId,
        baselineId,
        variantPassRate: snap.passRate,
        baselinePassRate: baseline.passRate,
        passRateDrop: baseline.passRate - snap.passRate,
        decision: 'insufficient_data',
        reason: `need ≥ ${minCases} cases each (variant ${snap.totalCases}, baseline ${baseline.totalCases})`,
      });
      continue;
    }
    const drop = baseline.passRate - snap.passRate;
    let decision: VariantGuardVerdict['decision'] = 'ok';
    let reason: string | undefined;
    // Strict > with float-point epsilon so subtractions like
    // (0.90 - 0.85 = 0.0500000000000…) don't flap the threshold.
    const eps = 1e-9;
    if (drop > disableDrop + eps) {
      decision = 'disable';
      reason = `pass rate dropped ${(drop * 100).toFixed(1)} pp (> ${(disableDrop * 100).toFixed(0)} pp)`;
    } else if (drop > warnDrop + eps) {
      decision = 'warn';
      reason = `pass rate dropped ${(drop * 100).toFixed(1)} pp (> ${(warnDrop * 100).toFixed(0)} pp)`;
    }
    verdicts.push({
      variantId: snap.promptId,
      baselineId,
      variantPassRate: snap.passRate,
      baselinePassRate: baseline.passRate,
      passRateDrop: drop,
      decision,
      reason,
    });
  }
  return verdicts;
}

/** Convenience: filter verdicts down to the ones the cron should
 *  actually act on (disable + warn). `decision='ok'` and
 *  `'insufficient_data'` are no-ops at action time. */
export function actionableVerdicts(verdicts: VariantGuardVerdict[]): VariantGuardVerdict[] {
  return verdicts.filter(v => v.decision === 'disable' || v.decision === 'warn');
}
