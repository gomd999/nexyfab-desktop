import { createHash } from 'node:crypto';
import type { ComplexSystemGraphV2 } from './complexSystemGraph';
import { verifyComplexSystemGraphBytes } from './complexSystemGraph';

type ChangeBucket = { added: string[]; removed: string[]; modified: string[] };
export type ComplexSystemChangeImpactReport = {
  schema: 'nexyfab.complex-system-change-impact-report.v1';
  status: 'passed' | 'failed' | 'not_run';
  impactPlanReady: boolean;
  systemId: string | null;
  family: ComplexSystemGraphV2['family'] | null;
  baseRevision: number | null;
  targetRevision: number | null;
  baseGraphHash: string | null;
  targetGraphHash: string | null;
  applicationHash: string | null;
  scope: 'none' | 'partial' | 'full' | null;
  changes: { artifacts: ChangeBucket; nodes: ChangeBucket; edges: ChangeBucket; evidence: ChangeBucket };
  directlyChangedNodeIds: string[];
  affectedNodeIds: string[];
  affectedEdgeIds: string[];
  invalidatedEvidenceIds: string[];
  reusableEvidenceIds: string[];
  requiredReverificationKinds: Array<ComplexSystemGraphV2['evidence'][number]['kind']>;
  revalidationRequired: boolean;
  errors: string[];
  blockers: string[];
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

const emptyChanges = () => ({ added: [], removed: [], modified: [] });
const TRACE_RELATIONS = new Set<ComplexSystemGraphV2['edges'][number]['kind']>(['allocated_to', 'realized_by', 'mitigated_by', 'implemented_by']);

export function analyzeComplexSystemChangeImpactBytes(
  baseGraphBytes: Uint8Array,
  targetGraphBytes: Uint8Array,
  baseArtifacts: ReadonlyMap<string, Uint8Array>,
  targetArtifacts: ReadonlyMap<string, Uint8Array>,
): ComplexSystemChangeImpactReport {
  const baseReport = verifyComplexSystemGraphBytes(baseGraphBytes, baseArtifacts);
  const targetReport = verifyComplexSystemGraphBytes(targetGraphBytes, targetArtifacts);
  const errors: string[] = [];
  if (!baseReport.graphReady) errors.push('base_graph_not_ready', ...baseReport.errors.map(item => `base:${item}`), ...baseReport.unresolved.map(item => `base:${item}`));
  if (!targetReport.graphReady) errors.push('target_graph_not_ready', ...targetReport.errors.map(item => `target:${item}`), ...targetReport.unresolved.map(item => `target:${item}`));
  if (errors.length) return failed(baseReport.graphHash, targetReport.graphHash, errors);

  const base = JSON.parse(new TextDecoder().decode(baseGraphBytes)) as ComplexSystemGraphV2;
  const target = JSON.parse(new TextDecoder().decode(targetGraphBytes)) as ComplexSystemGraphV2;
  if (base.systemId !== target.systemId) errors.push('system_id_mismatch');
  if (target.revision !== base.revision + 1) errors.push('target_revision_must_increment_by_one');
  if (base.family !== target.family) errors.push('family_change_requires_new_system');
  if (base.units !== target.units) errors.push('unit_system_change_requires_new_system');
  if (errors.length) return failed(baseReport.graphHash, targetReport.graphHash, errors, base, target);

  const changes = {
    artifacts: diffById(base.artifacts, target.artifacts, item => item.name),
    nodes: diffById(base.nodes, target.nodes, item => item.id),
    edges: diffById(base.edges, target.edges, item => item.id),
    evidence: diffById(base.evidence, target.evidence, item => item.id),
  };
  const changedArtifacts = unionBucket(changes.artifacts);
  const directlyChangedNodes = unionBucket(changes.nodes);
  const directlyChangedEdges = unionBucket(changes.edges);
  const directlyChangedEvidence = unionBucket(changes.evidence);
  for (const node of [...base.nodes, ...target.nodes]) if (node.sourceArtifactNames.some(name => changedArtifacts.has(name))) directlyChangedNodes.add(node.id);
  for (const edge of [...base.edges, ...target.edges]) if (edge.sourceArtifactNames.some(name => changedArtifacts.has(name))) directlyChangedEdges.add(edge.id);
  for (const evidence of [...base.evidence, ...target.evidence]) if (evidence.evidenceArtifactNames.some(name => changedArtifacts.has(name))) directlyChangedEvidence.add(evidence.id);

  const allNodes = uniqueById([...base.nodes, ...target.nodes], item => item.id);
  const allEdges = uniqueById([...base.edges, ...target.edges], item => item.id);
  const allEvidence = uniqueById([...base.evidence, ...target.evidence], item => item.id);
  const affectedNodes = new Set(directlyChangedNodes), affectedEdges = new Set(directlyChangedEdges);
  for (const edge of allEdges.values()) if (directlyChangedEdges.has(edge.id)) { affectedNodes.add(edge.from); affectedNodes.add(edge.to); }

  const containmentParents = new Map<string, Set<string>>(), containmentChildren = new Map<string, Set<string>>();
  for (const edge of allEdges.values()) if (edge.kind === 'contains') { addRelation(containmentParents, edge.to, edge.from); addRelation(containmentChildren, edge.from, edge.to); }
  for (const id of directlyChangedNodes) {
    visitRelations(id, containmentParents, affectedNodes);
    const kind = allNodes.get(id)?.kind;
    if (kind === 'product' || kind === 'subassembly') visitRelations(id, containmentChildren, affectedNodes);
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of allEdges.values()) {
      if (!TRACE_RELATIONS.has(edge.kind)) continue;
      if (affectedNodes.has(edge.from) && !affectedNodes.has(edge.to)) { affectedNodes.add(edge.to); expanded = true; }
      if (affectedNodes.has(edge.to) && !affectedNodes.has(edge.from)) { affectedNodes.add(edge.from); expanded = true; }
    }
  }
  for (const edge of allEdges.values()) if (affectedNodes.has(edge.from) || affectedNodes.has(edge.to)) affectedEdges.add(edge.id);

  const invalidatedEvidence = new Set(directlyChangedEvidence);
  for (const evidence of allEvidence.values()) if (evidence.subjectNodeIds.some(id => affectedNodes.has(id)) || evidence.supportingEdgeIds.some(id => affectedEdges.has(id))) invalidatedEvidence.add(evidence.id);
  const reusableEvidence = target.evidence.filter(item => {
    const previous = base.evidence.find(candidate => candidate.id === item.id);
    return previous && canonical(previous) === canonical(item) && item.status === 'passed' && !invalidatedEvidence.has(item.id);
  }).map(item => item.id).sort();
  const requiredKinds = [...new Set([...base.evidence, ...target.evidence].filter(item => invalidatedEvidence.has(item.id)).map(item => item.kind))].sort() as ComplexSystemChangeImpactReport['requiredReverificationKinds'];
  const substantiveChangeCount = [...Object.values(changes)].reduce((sum, bucket) => sum + bucket.added.length + bucket.removed.length + bucket.modified.length, 0);
  const scope: NonNullable<ComplexSystemChangeImpactReport['scope']> = substantiveChangeCount === 0 ? 'none' : affectedNodes.size >= allNodes.size && affectedEdges.size >= allEdges.size ? 'full' : 'partial';
  const revalidationRequired = substantiveChangeCount > 0 || invalidatedEvidence.size > 0;
  const core = {
    systemId: base.systemId, family: base.family, baseRevision: base.revision, targetRevision: target.revision,
    baseGraphHash: baseReport.graphHash!, targetGraphHash: targetReport.graphHash!, scope, changes,
    directlyChangedNodeIds: [...directlyChangedNodes].sort(), affectedNodeIds: [...affectedNodes].sort(), affectedEdgeIds: [...affectedEdges].sort(),
    invalidatedEvidenceIds: [...invalidatedEvidence].sort(), reusableEvidenceIds: reusableEvidence, requiredReverificationKinds: requiredKinds, revalidationRequired,
  };
  const applicationHash = digest(new TextEncoder().encode(canonical(core)));
  return { schema: 'nexyfab.complex-system-change-impact-report.v1', status: 'passed', impactPlanReady: true, ...core, applicationHash, errors: [], blockers: revalidationRequired ? ['affected_evidence_reverification_required', 'family_contract_reverification_required', 'final_expert_review_required'] : ['target_revision_family_contract_binding_required', 'final_expert_review_required'], releaseReady: false, sideEffects: noSideEffects() };
}

function diffById<T>(base: readonly T[], target: readonly T[], id: (item: T) => string): ChangeBucket {
  const before = new Map(base.map(item => [id(item), item])), after = new Map(target.map(item => [id(item), item]));
  const added = [...after.keys()].filter(key => !before.has(key)).sort(), removed = [...before.keys()].filter(key => !after.has(key)).sort();
  const modified = [...before.keys()].filter(key => after.has(key) && canonical(before.get(key)) !== canonical(after.get(key))).sort();
  return { added, removed, modified };
}
function unionBucket(bucket: ChangeBucket) { return new Set([...bucket.added, ...bucket.removed, ...bucket.modified]); }
function uniqueById<T>(values: readonly T[], id: (item: T) => string) { const map = new Map<string, T>(); for (const value of values) map.set(id(value), value); return map; }
function addRelation(map: Map<string, Set<string>>, from: string, to: string) { const values = map.get(from) ?? new Set<string>(); values.add(to); map.set(from, values); }
function visitRelations(start: string, relations: Map<string, Set<string>>, output: Set<string>) { const queue = [start], visited = new Set<string>(); while (queue.length) { const current = queue.shift()!; if (visited.has(current)) continue; visited.add(current); for (const next of relations.get(current) ?? []) { output.add(next); queue.push(next); } } }
function failed(baseGraphHash: string | null, targetGraphHash: string | null, errors: string[], base?: ComplexSystemGraphV2, target?: ComplexSystemGraphV2): ComplexSystemChangeImpactReport { return { schema: 'nexyfab.complex-system-change-impact-report.v1', status: 'failed', impactPlanReady: false, systemId: base?.systemId ?? null, family: base?.family ?? null, baseRevision: base?.revision ?? null, targetRevision: target?.revision ?? null, baseGraphHash, targetGraphHash, applicationHash: null, scope: null, changes: { artifacts: emptyChanges(), nodes: emptyChanges(), edges: emptyChanges(), evidence: emptyChanges() }, directlyChangedNodeIds: [], affectedNodeIds: [], affectedEdgeIds: [], invalidatedEvidenceIds: [], reusableEvidenceIds: [], requiredReverificationKinds: [], revalidationRequired: true, errors: [...new Set(errors)], blockers: ['change_impact_analysis_incomplete', 'full_reverification_required', 'final_expert_review_required'], releaseReady: false, sideEffects: noSideEffects() }; }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
