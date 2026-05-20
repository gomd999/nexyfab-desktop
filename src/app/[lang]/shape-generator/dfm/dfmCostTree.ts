/**
 * dfmCostTree.ts — Build a hierarchical cost-impact tree from DFM
 * issues to drive "fix this one to save the most" recommendations.
 *
 * DFM analyzers report dozens of issues — too many to act on at
 * once. The cost tree organizes them by:
 *
 *   1. **Operation family** (machining / casting / molding / sheet-
 *      metal). Top-level cost drivers.
 *   2. **Issue category** (small features, tight tolerance, deep
 *      pockets, sharp inside corners).
 *   3. **Individual issue** — one specific feature on the model.
 *
 * Each leaf carries:
 *
 *   - Estimated cost impact (USD).
 *   - Suggested fix.
 *   - Severity (info / warning / critical).
 *
 * Module rolls up costs to the parent nodes and produces a *top-
 * priority list* — the leaves that, if fixed, save the most.
 */

export type IssueSeverity = 'info' | 'warning' | 'critical';

export interface DFMIssue {
  id: string;
  operationFamily: string;
  category: string;
  feature: string;
  costImpactUsd: number;
  severity: IssueSeverity;
  /** Fix suggestion. */
  fix: string;
  /** Optional time saved by fixing, minutes. */
  timeSavedMin?: number;
}

export interface TreeNode {
  id: string;
  label: string;
  costRollupUsd: number;
  childCount: number;
  worstSeverity: IssueSeverity;
  /** Direct children (categories or leaves). */
  children: TreeNode[];
  /** Issues attached directly to this node. */
  issues?: DFMIssue[];
}

export interface DFMCostTreeResult {
  root: TreeNode;
  topFixes: DFMIssue[];
  totalSavingsUsd: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function buildCostTree(issues: DFMIssue[], options: { topN?: number } = {}): DFMCostTreeResult {
  const topN = options.topN ?? 10;
  const familyMap = new Map<string, Map<string, DFMIssue[]>>();
  for (const issue of issues) {
    const family = familyMap.get(issue.operationFamily) ?? new Map<string, DFMIssue[]>();
    const list = family.get(issue.category) ?? [];
    list.push(issue);
    family.set(issue.category, list);
    familyMap.set(issue.operationFamily, family);
  }

  const familyNodes: TreeNode[] = [];
  for (const [familyId, catMap] of familyMap) {
    const catNodes: TreeNode[] = [];
    for (const [catId, catIssues] of catMap) {
      const catCost = catIssues.reduce((s, i) => s + i.costImpactUsd, 0);
      const catSeverity = worstSeverity(catIssues.map(i => i.severity));
      catNodes.push({
        id: `${familyId}/${catId}`,
        label: catId,
        costRollupUsd: catCost,
        childCount: catIssues.length,
        worstSeverity: catSeverity,
        children: [],
        issues: catIssues,
      });
    }
    catNodes.sort((a, b) => b.costRollupUsd - a.costRollupUsd);
    const familyCost = catNodes.reduce((s, c) => s + c.costRollupUsd, 0);
    const familySeverity = worstSeverity(catNodes.map(c => c.worstSeverity));
    familyNodes.push({
      id: familyId,
      label: familyId,
      costRollupUsd: familyCost,
      childCount: catNodes.length,
      worstSeverity: familySeverity,
      children: catNodes,
    });
  }
  familyNodes.sort((a, b) => b.costRollupUsd - a.costRollupUsd);

  const totalCost = familyNodes.reduce((s, n) => s + n.costRollupUsd, 0);
  const totalSeverity = worstSeverity(familyNodes.map(n => n.worstSeverity));
  const root: TreeNode = {
    id: '/',
    label: 'All',
    costRollupUsd: totalCost,
    childCount: familyNodes.length,
    worstSeverity: totalSeverity,
    children: familyNodes,
  };

  const topFixes = [...issues]
    .sort((a, b) => b.costImpactUsd - a.costImpactUsd)
    .slice(0, topN);

  return { root, topFixes, totalSavingsUsd: totalCost };
}

// ── Severity helpers ──────────────────────────────────────────

const SEVERITY_RANK: Record<IssueSeverity, number> = { info: 0, warning: 1, critical: 2 };

function worstSeverity(list: IssueSeverity[]): IssueSeverity {
  let best: IssueSeverity = 'info';
  for (const s of list) {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s;
  }
  return best;
}

// ── Tree walk helpers ─────────────────────────────────────────

export function findNode(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

export function flattenLeaves(root: TreeNode): DFMIssue[] {
  const out: DFMIssue[] = [];
  function walk(n: TreeNode): void {
    if (n.issues) out.push(...n.issues);
    for (const c of n.children) walk(c);
  }
  walk(root);
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface CostTreeSummary {
  issueCount: number;
  familyCount: number;
  categoryCount: number;
  totalSavingsUsd: number;
  worstSeverity: IssueSeverity;
  topFixCount: number;
}

export function summarize(result: DFMCostTreeResult): CostTreeSummary {
  const issues = flattenLeaves(result.root);
  let categories = 0;
  for (const family of result.root.children) {
    categories += family.children.length;
  }
  return {
    issueCount: issues.length,
    familyCount: result.root.children.length,
    categoryCount: categories,
    totalSavingsUsd: result.totalSavingsUsd,
    worstSeverity: result.root.worstSeverity,
    topFixCount: result.topFixes.length,
  };
}
