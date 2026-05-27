/**
 * perfBudget.ts — JSON-driven performance budget assertion.
 *
 * CI consumes `perf-budget.json` at repo root + the output of
 * `next build` / Lighthouse and fails when any metric blows its
 * budget. The point is to catch regressions where a feature flag's
 * "convenient" lazy-load gets accidentally promoted to eager, or
 * a renderer bumps LCP by 500ms.
 *
 * Budgets live in their own file (not env vars) so PR reviews can
 * see the change explicitly when limits are loosened.
 */

export type MetricKind = 'lt' | 'gt';

export interface BudgetEntry {
  /** Friendly label shown in violations. */
  label: string;
  /** Path within the input metrics object (dot-notation). */
  path: string;
  /** Numeric threshold. */
  limit: number;
  /** Direction: 'lt' = metric must be <= limit (e.g. LCP <= 2500ms). */
  kind: MetricKind;
  /** Optional severity ladder. 'block' fails CI; 'warn' logs only. */
  severity?: 'block' | 'warn';
}

export interface BudgetFile {
  version: 1;
  entries: BudgetEntry[];
}

export interface BudgetViolation {
  entry: BudgetEntry;
  observed: number;
  delta: number;
}

export interface BudgetReport {
  total: number;
  blocked: BudgetViolation[];
  warned: BudgetViolation[];
  ok: BudgetEntry[];
  /** Whether CI should fail. */
  failed: boolean;
}

function getPath(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, o);
}

export function evaluateBudget(file: BudgetFile, metrics: unknown): BudgetReport {
  const blocked: BudgetViolation[] = [];
  const warned: BudgetViolation[] = [];
  const ok: BudgetEntry[] = [];

  for (const entry of file.entries) {
    const val = getPath(metrics, entry.path);
    if (typeof val !== 'number' || !Number.isFinite(val)) continue;
    const violates = entry.kind === 'lt' ? val > entry.limit : val < entry.limit;
    if (!violates) {
      ok.push(entry);
      continue;
    }
    const delta = entry.kind === 'lt' ? val - entry.limit : entry.limit - val;
    const violation: BudgetViolation = { entry, observed: val, delta };
    if ((entry.severity ?? 'block') === 'warn') warned.push(violation);
    else blocked.push(violation);
  }

  return {
    total: file.entries.length,
    blocked,
    warned,
    ok,
    failed: blocked.length > 0,
  };
}

export function formatViolation(v: BudgetViolation): string {
  const arrow = v.entry.kind === 'lt' ? '>' : '<';
  return `${v.entry.label}: ${v.observed} ${arrow} ${v.entry.limit} (Δ ${v.delta.toFixed(1)})`;
}

export function formatBudgetReport(r: BudgetReport): string {
  const lines: string[] = [];
  lines.push(`Perf budget — ${r.ok.length}/${r.total} ok`);
  for (const v of r.blocked) lines.push(`  [BLOCK] ${formatViolation(v)}`);
  for (const v of r.warned) lines.push(`  [WARN ] ${formatViolation(v)}`);
  return lines.join('\n');
}

/** Convenience for CI scripts. Throws on `failed`. */
export function assertBudget(file: BudgetFile, metrics: unknown): BudgetReport {
  const report = evaluateBudget(file, metrics);
  if (report.failed) {
    throw new Error('Perf budget violated:\n' + formatBudgetReport(report));
  }
  return report;
}
