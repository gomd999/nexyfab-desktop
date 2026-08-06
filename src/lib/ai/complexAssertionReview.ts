import type { ComplexAccuracyAxis, ComplexBenchmarkCaseV2, ComplexProductTier } from './complexProductBenchmarkV2';

export type AssertionReviewDecision = 'approved' | 'rejected' | 'changes_requested';
export interface AssertionGraphNode { assertionId: string; dependsOn: string[]; }
export interface ComplexAssertionReviewRecord {
  schema: 'nexyfab.complex-assertion-review.v1'; caseId: string; assertionId: string; reviewerId: string;
  decision: AssertionReviewDecision; reviewedArtifactHashes: string[]; tolerancePolicy: string; note: string; reviewedAt: string;
}
export interface AssertionReviewResult { caseValue: ComplexBenchmarkCaseV2; issues: string[]; approvedAssertionIds: string[]; }
const SHA256 = /^[a-f0-9]{64}$/;

export function validateAssertionGraph(caseValue: ComplexBenchmarkCaseV2, graph: readonly AssertionGraphNode[]): string[] {
  const issues: string[] = [], expected = new Set(caseValue.assertions.map(item => item.id)), nodes = new Map<string, AssertionGraphNode>();
  for (const node of graph) { if (!expected.has(node.assertionId) || nodes.has(node.assertionId)) issues.push(`assertion_graph_node_invalid:${node.assertionId}`); nodes.set(node.assertionId, node); }
  for (const id of expected) if (!nodes.has(id)) issues.push(`assertion_graph_node_missing:${id}`);
  for (const node of graph) for (const dependency of node.dependsOn) if (!expected.has(dependency) || dependency === node.assertionId) issues.push(`assertion_graph_dependency_invalid:${node.assertionId}:${dependency}`);
  const visit = (id: string, stack: Set<string>, done: Set<string>): void => { if (stack.has(id)) { issues.push(`assertion_graph_cycle:${id}`); return; } if (done.has(id)) return; stack.add(id); for (const next of nodes.get(id)?.dependsOn ?? []) visit(next, stack, done); stack.delete(id); done.add(id); };
  const done = new Set<string>(); for (const id of expected) visit(id, new Set(), done);
  return [...new Set(issues)];
}

/** Approval is accepted only against the exact artifacts and tolerance policy under review. */
export function applyAssertionReviews(caseValue: ComplexBenchmarkCaseV2, records: readonly ComplexAssertionReviewRecord[]): AssertionReviewResult {
  const issues: string[] = [], byId = new Map(caseValue.assertions.map(item => [item.id, item])), accepted = new Map<string, ComplexAssertionReviewRecord>();
  for (const record of records) {
    const assertion = byId.get(record.assertionId);
    if (record.caseId !== caseValue.caseId || !assertion) { issues.push(`assertion_review_target_invalid:${record.assertionId}`); continue; }
    if (accepted.has(record.assertionId)) { issues.push(`assertion_review_duplicate:${record.assertionId}`); continue; }
    if (!record.reviewerId.trim() || !record.note.trim() || Number.isNaN(Date.parse(record.reviewedAt))) { issues.push(`assertion_review_metadata_invalid:${record.assertionId}`); continue; }
    if (!record.reviewedArtifactHashes.length || record.reviewedArtifactHashes.some(hash => !SHA256.test(hash)) || [...record.reviewedArtifactHashes].sort().join('|') !== [...assertion.artifactHashes].sort().join('|')) { issues.push(`assertion_review_artifacts_mismatch:${record.assertionId}`); continue; }
    if (record.tolerancePolicy !== assertion.tolerancePolicy) { issues.push(`assertion_review_tolerance_mismatch:${record.assertionId}`); continue; }
    accepted.set(record.assertionId, record);
  }
  const assertions = caseValue.assertions.map(assertion => {
    const review = accepted.get(assertion.id);
    if (!review || review.decision !== 'approved') return assertion.provenance === 'legacy-unreviewed' ? { ...assertion, kpiEligible: false } : assertion;
    return { ...assertion, kpiEligible: true, provenance: 'approved-manual' as const };
  });
  return { caseValue: { ...caseValue, assertions }, issues, approvedAssertionIds: [...accepted.values()].filter(item => item.decision === 'approved').map(item => item.assertionId).sort() };
}

export interface AssertionMigrationSeed { id: string; axis: ComplexAccuracyAxis; tolerancePolicy: string; artifactHashes: string[]; dependsOn?: string[]; }
export function migrateAssertionGraphCase(input: { caseId: string; family: ComplexBenchmarkCaseV2['family']; tier: Exclude<ComplexProductTier, 'T4'>; holdoutGroup: string; sourceHash: string; assertions: AssertionMigrationSeed[] }): { caseValue: ComplexBenchmarkCaseV2; graph: AssertionGraphNode[] } {
  if (!SHA256.test(input.sourceHash)) throw new Error('assertion_migration_source_hash_invalid');
  const caseValue: ComplexBenchmarkCaseV2 = { schema: 'nexyfab.complex-benchmark-case.v2', caseId: input.caseId, family: input.family, tier: input.tier, holdoutGroup: input.holdoutGroup, sourceHash: input.sourceHash, split: 'holdout', assertions: input.assertions.map(item => ({ id: item.id, axis: item.axis, required: true, kpiEligible: false, provenance: 'legacy-unreviewed', tolerancePolicy: item.tolerancePolicy, artifactHashes: [...item.artifactHashes] })) };
  const graph = input.assertions.map(item => ({ assertionId: item.id, dependsOn: [...(item.dependsOn ?? [])] }));
  const issues = validateAssertionGraph(caseValue, graph); if (issues.length) throw new Error(issues.join(' '));
  return { caseValue, graph };
}
