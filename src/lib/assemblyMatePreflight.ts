/**
 * Lightweight validation before running assembly mate solvers — catches obvious
 * structural issues (enterprise CAD tools do extensive checking; this is a minimal guardrail).
 */

export interface MatePreflightRow {
  id: string;
  partA: string;
  partB: string;
  type?: string;
}

export function preflightAssemblyMates(mates: MatePreflightRow[]): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const seenIds = new Set<string>();

  for (const m of mates) {
    if (!m.id?.trim()) {
      issues.push('Mate without id');
      continue;
    }
    if (seenIds.has(m.id)) issues.push(`Duplicate mate id: ${m.id}`);
    seenIds.add(m.id);

    const a = m.partA?.trim() ?? '';
    const b = m.partB?.trim() ?? '';
    if (!a || !b) issues.push(`Mate ${m.id}: missing partA or partB`);
    if (a && b && a === b) issues.push(`Mate ${m.id}: partA and partB are the same instance`);
  }

  return { ok: issues.length === 0, issues };
}

/** Warn when mate graph may be under- or over-constrained (heuristic, not full DOF). */
export function mateGraphSummary(mates: MatePreflightRow[]): {
  mateCount: number;
  uniqueParts: number;
  warnings: string[];
} {
  const parts = new Set<string>();
  for (const m of mates) {
    if (m.partA?.trim()) parts.add(m.partA.trim());
    if (m.partB?.trim()) parts.add(m.partB.trim());
  }
  const warnings: string[] = [];
  const n = mates.length;
  const p = parts.size;
  if (p >= 2 && n === 0) warnings.push('Multiple parts but no mates defined.');
  if (p >= 4 && n < p - 1) warnings.push('Few mates relative to part count — assembly may be under-constrained.');
  return { mateCount: n, uniqueParts: p, warnings };
}
