/**
 * a11yAudit.ts — Programmatic a11y report aggregation.
 *
 * Pairs with axe-core (run separately via the CI Playwright script).
 * This module takes axe's raw output and rolls it up into a stable
 * pass/fail report with severity-weighted score so PRs see a single
 * "a11y dropped from 92 → 78" line rather than 200 separate violation
 * objects.
 *
 * No DOM access here — pure data transformation, importable in node.
 */

export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface AxeViolation {
  id: string;
  impact: Impact;
  description: string;
  help: string;
  helpUrl?: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
}

export interface AxeResultSet {
  url: string;
  violations: AxeViolation[];
  passes?: Array<{ id: string }>;
  incomplete?: Array<{ id: string }>;
}

export interface A11yReport {
  /** 0-100 composite. */
  score: number;
  totalViolations: number;
  byImpact: Record<Impact, number>;
  topRules: Array<{ id: string; count: number; impact: Impact }>;
  /** True when any 'critical' or 'serious' was found. */
  failed: boolean;
}

const IMPACT_WEIGHTS: Record<Impact, number> = {
  minor: 1,
  moderate: 3,
  serious: 10,
  critical: 25,
};

export function aggregateAxeResults(results: AxeResultSet[]): A11yReport {
  const byImpact: Record<Impact, number> = { minor: 0, moderate: 0, serious: 0, critical: 0 };
  const rules = new Map<string, { count: number; impact: Impact }>();
  let totalNodes = 0;
  let weightedFailures = 0;

  for (const r of results) {
    for (const v of r.violations) {
      const nodeCount = v.nodes.length;
      totalNodes += nodeCount;
      byImpact[v.impact] += nodeCount;
      weightedFailures += IMPACT_WEIGHTS[v.impact] * nodeCount;
      const rule = rules.get(v.id);
      if (rule) rule.count += nodeCount;
      else rules.set(v.id, { count: nodeCount, impact: v.impact });
    }
  }

  // Score: 100 minus weighted failures, floored at 0.
  // Weight 100 ≈ "one critical or 10 minors" caps you near 0.
  const score = Math.max(0, Math.round(100 - weightedFailures / 4));

  const topRules = Array.from(rules.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([id, { count, impact }]) => ({ id, count, impact }));

  return {
    score,
    totalViolations: totalNodes,
    byImpact,
    topRules,
    failed: byImpact.critical > 0 || byImpact.serious > 0,
  };
}

export function formatA11yReport(r: A11yReport): string {
  const lines: string[] = [];
  lines.push(`A11y score: ${r.score}/100 — ${r.totalViolations} violation node(s)`);
  lines.push(`  critical=${r.byImpact.critical} serious=${r.byImpact.serious} moderate=${r.byImpact.moderate} minor=${r.byImpact.minor}`);
  if (r.topRules.length > 0) {
    lines.push('  Top rules:');
    for (const rule of r.topRules.slice(0, 5)) {
      lines.push(`    [${rule.impact}] ${rule.id}: ${rule.count}`);
    }
  }
  return lines.join('\n');
}

/** Convenience for CI script. Throws on `failed`. */
export function assertA11y(results: AxeResultSet[], minScore = 80): A11yReport {
  const r = aggregateAxeResults(results);
  if (r.failed) {
    throw new Error('A11y critical/serious violations:\n' + formatA11yReport(r));
  }
  if (r.score < minScore) {
    throw new Error(`A11y score ${r.score} < ${minScore}:\n` + formatA11yReport(r));
  }
  return r;
}
