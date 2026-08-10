export const DESIGN_ARTIFACT_GRAPH_SCHEMA = 'nexyfab.design-artifact-graph.v1' as const;

export type DesignArtifactKind = 'model' | 'drawing' | 'quantity' | 'bim_quality' | 'ifc' | 'simulation';
export type DesignArtifactState = 'current' | 'stale' | 'review_required' | 'blocked';
export type ArtifactDependencyPolicy = 'invalidate' | 'notify' | 'locked';

export interface ArtifactInputBinding {
  artifactId: string;
  revision: number;
  contentHash: string;
}
export interface ArtifactVerification {
  status: 'passed' | 'failed' | 'not_run';
  verifierId: string;
  evidenceHash?: string;
  issues: string[];
}

export interface DesignArtifactNode {
  id: string;
  kind: DesignArtifactKind;
  revision: number;
  contentHash: string;
  state: DesignArtifactState;
  inputs: ArtifactInputBinding[];
  verification: ArtifactVerification;
  staleBecause: string[];
}

export interface ArtifactDependencyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  policy: ArtifactDependencyPolicy;
}

export interface DesignArtifactGraph {
  schema: typeof DESIGN_ARTIFACT_GRAPH_SCHEMA;
  projectId: string;
  revision: number;
  artifacts: DesignArtifactNode[];
  dependencies: ArtifactDependencyEdge[];
}

export interface ArtifactSourceChange {
  artifactId: string;
  expectedRevision: number;
  contentHash: string;
  verification: ArtifactVerification;
}

export interface ArtifactRegenerationCommit {
  artifactId: string;
  expectedRevision: number;
  contentHash: string;
  inputs: ArtifactInputBinding[];
  verification: ArtifactVerification;
}

export interface ArtifactGraphTransactionResult {
  committed: boolean;
  graph: DesignArtifactGraph;
  staleArtifactIds: string[];
  reviewArtifactIds: string[];
  issues: string[];
}

export interface ArtifactReleaseReport {
  releaseReady: boolean;
  requiredKinds: DesignArtifactKind[];
  missingKinds: DesignArtifactKind[];
  staleArtifactIds: string[];
  unverifiedArtifactIds: string[];
  bindingIssueArtifactIds: string[];
  graphIssues: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

function bindingKey(binding: ArtifactInputBinding): string {
  return `${binding.artifactId}:${binding.revision}:${binding.contentHash}`;
}

function exactBindings(left: readonly ArtifactInputBinding[], right: readonly ArtifactInputBinding[]): boolean {
  const a = left.map(bindingKey).sort(); const b = right.map(bindingKey).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function incoming(graph: DesignArtifactGraph, artifactId: string): ArtifactDependencyEdge[] {
  return graph.dependencies.filter(edge => edge.targetId === artifactId && edge.policy !== 'notify');
}

function expectedBindings(graph: DesignArtifactGraph, artifactId: string): ArtifactInputBinding[] {
  const byId = new Map(graph.artifacts.map(artifact => [artifact.id, artifact]));
  return incoming(graph, artifactId).map(edge => byId.get(edge.sourceId)!).filter(Boolean)
    .map(artifact => ({ artifactId: artifact.id, revision: artifact.revision, contentHash: artifact.contentHash }));
}

export function validateDesignArtifactGraph(graph: DesignArtifactGraph): string[] {
  const issues: string[] = [];
  if (graph.schema !== DESIGN_ARTIFACT_GRAPH_SCHEMA || !graph.projectId.trim() || !Number.isSafeInteger(graph.revision) || graph.revision < 0) issues.push('invalid_graph_header');
  const artifacts = new Map<string, DesignArtifactNode>();
  for (const artifact of graph.artifacts) {
    if (!artifact.id.trim() || artifacts.has(artifact.id)) issues.push(`duplicate_or_empty_artifact:${artifact.id || '(empty)'}`);
    if (!Number.isSafeInteger(artifact.revision) || artifact.revision < 0 || !SHA256.test(artifact.contentHash)) issues.push(`invalid_artifact_identity:${artifact.id}`);
    if (!artifact.verification.verifierId.trim() || artifact.verification.issues.some(value => !value.trim())) issues.push(`invalid_verification:${artifact.id}`);
    if (artifact.verification.evidenceHash !== undefined && !SHA256.test(artifact.verification.evidenceHash)) issues.push(`invalid_evidence_hash:${artifact.id}`);
    if (artifact.state === 'current' && artifact.verification.status !== 'passed') issues.push(`current_artifact_not_verified:${artifact.id}`);
    if (artifact.state === 'current' && artifact.staleBecause.length) issues.push(`current_artifact_has_stale_reason:${artifact.id}`);
    if (new Set(artifact.inputs.map(binding => binding.artifactId)).size !== artifact.inputs.length || artifact.inputs.some(binding => !binding.artifactId.trim() || !Number.isSafeInteger(binding.revision) || binding.revision < 0 || !SHA256.test(binding.contentHash))) issues.push(`invalid_input_binding:${artifact.id}`);
    artifacts.set(artifact.id, artifact);
  }
  const edgeIds = new Set<string>(); const signatures = new Set<string>();
  for (const edge of graph.dependencies) {
    const signature = `${edge.sourceId}:${edge.targetId}:${edge.policy}`;
    if (!edge.id.trim() || edgeIds.has(edge.id) || signatures.has(signature)) issues.push(`duplicate_or_empty_dependency:${edge.id || '(empty)'}`);
    if (!artifacts.has(edge.sourceId) || !artifacts.has(edge.targetId) || edge.sourceId === edge.targetId) issues.push(`invalid_dependency_endpoint:${edge.id}`);
    edgeIds.add(edge.id); signatures.add(signature);
  }
  const adjacency = new Map(graph.artifacts.map(artifact => [artifact.id, [] as string[]]));
  for (const edge of graph.dependencies) if (edge.policy !== 'notify' && adjacency.has(edge.sourceId)) adjacency.get(edge.sourceId)!.push(edge.targetId);
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true; if (visited.has(id)) return false;
    visiting.add(id); for (const target of adjacency.get(id) ?? []) if (visit(target)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  for (const id of adjacency.keys()) if (visit(id)) { issues.push('dependency_cycle'); break; }
  for (const artifact of graph.artifacts) {
    if (artifact.state !== 'current') continue;
    const expected = expectedBindings(graph, artifact.id);
    if (!exactBindings(artifact.inputs, expected)) issues.push(`current_artifact_binding_mismatch:${artifact.id}`);
    if (expected.some(binding => artifacts.get(binding.artifactId)?.state !== 'current')) issues.push(`current_artifact_depends_on_noncurrent:${artifact.id}`);
  }
  return issues;
}

function downstream(graph: DesignArtifactGraph, changedIds: readonly string[]): { stale: Set<string>; review: Set<string>; locked: Set<string> } {
  const stale = new Set<string>(), review = new Set<string>(), locked = new Set<string>(), visited = new Set(changedIds), queue = [...changedIds];
  while (queue.length) {
    const source = queue.shift()!;
    for (const edge of graph.dependencies.filter(candidate => candidate.sourceId === source)) {
      if (edge.policy === 'locked') { locked.add(edge.targetId); continue; }
      if (edge.policy === 'notify') { review.add(edge.targetId); continue; }
      if (visited.has(edge.targetId)) continue;
      visited.add(edge.targetId); stale.add(edge.targetId); queue.push(edge.targetId);
    }
  }
  return { stale, review, locked };
}

function failed(graph: DesignArtifactGraph, issues: string[]): ArtifactGraphTransactionResult {
  return { committed: false, graph, staleArtifactIds: [], reviewArtifactIds: [], issues };
}

export function applyArtifactSourceChanges(
  graph: DesignArtifactGraph,
  baseGraphRevision: number,
  changes: readonly ArtifactSourceChange[],
): ArtifactGraphTransactionResult {
  const graphIssues = validateDesignArtifactGraph(graph);
  if (graphIssues.length) return failed(graph, graphIssues);
  if (baseGraphRevision !== graph.revision) return failed(graph, ['stale_graph_revision']);
  if (!changes.length) return failed(graph, ['source_change_required']);
  const byId = new Map(graph.artifacts.map(artifact => [artifact.id, artifact]));
  const changedIds = new Set<string>();
  for (const change of changes) {
    const artifact = byId.get(change.artifactId);
    if (!artifact) return failed(graph, [`unknown_artifact:${change.artifactId}`]);
    if (changedIds.has(change.artifactId)) return failed(graph, [`duplicate_source_change:${change.artifactId}`]);
    if (artifact.revision !== change.expectedRevision) return failed(graph, [`stale_artifact_revision:${change.artifactId}`]);
    if (!SHA256.test(change.contentHash) || change.verification.status !== 'passed' || !change.verification.evidenceHash || !SHA256.test(change.verification.evidenceHash)) return failed(graph, [`unverified_source_change:${change.artifactId}`]);
    changedIds.add(change.artifactId);
  }
  const impact = downstream(graph, [...changedIds]);
  if (impact.locked.size) return failed(graph, [`locked_downstream_requires_approval:${[...impact.locked].sort().join(',')}`]);
  const artifacts = structuredClone(graph.artifacts);
  for (let index = 0; index < artifacts.length; index++) {
    const artifact = artifacts[index]!; const change = changes.find(value => value.artifactId === artifact.id);
    if (change) artifacts[index] = { ...artifact, revision: artifact.revision + 1, contentHash: change.contentHash, state: 'current', verification: structuredClone(change.verification), staleBecause: [] };
    else if (impact.stale.has(artifact.id)) artifacts[index] = { ...artifact, state: 'stale', verification: { ...artifact.verification, status: 'not_run', issues: ['upstream_changed'] }, staleBecause: [...changedIds].sort() };
    else if (impact.review.has(artifact.id)) artifacts[index] = { ...artifact, state: 'review_required', staleBecause: [...changedIds].sort() };
  }
  const candidate: DesignArtifactGraph = { ...graph, revision: graph.revision + 1, artifacts };
  const candidateIssues = validateDesignArtifactGraph(candidate).filter(value => !value.startsWith('current_artifact_binding_mismatch:') && !value.startsWith('current_artifact_depends_on_noncurrent:'));
  if (candidateIssues.length) return failed(graph, candidateIssues);
  return { committed: true, graph: candidate, staleArtifactIds: [...impact.stale].sort(), reviewArtifactIds: [...impact.review].sort(), issues: [] };
}

export function commitArtifactRegeneration(
  graph: DesignArtifactGraph,
  baseGraphRevision: number,
  commits: readonly ArtifactRegenerationCommit[],
): ArtifactGraphTransactionResult {
  const graphIssues = validateDesignArtifactGraph(graph).filter(value => !value.startsWith('current_artifact_binding_mismatch:') && !value.startsWith('current_artifact_depends_on_noncurrent:'));
  if (graphIssues.length) return failed(graph, graphIssues);
  if (baseGraphRevision !== graph.revision) return failed(graph, ['stale_graph_revision']);
  if (!commits.length) return failed(graph, ['regeneration_commit_required']);
  const candidate = structuredClone(graph);
  const committed = new Set<string>();
  for (const commit of commits) {
    const index = candidate.artifacts.findIndex(artifact => artifact.id === commit.artifactId);
    if (index < 0) return failed(graph, [`unknown_artifact:${commit.artifactId}`]);
    const artifact = candidate.artifacts[index]!;
    if (committed.has(artifact.id)) return failed(graph, [`duplicate_regeneration_commit:${artifact.id}`]);
    if (artifact.state === 'current' || artifact.revision !== commit.expectedRevision) return failed(graph, [`artifact_not_stale_or_revision_mismatch:${artifact.id}`]);
    if (!SHA256.test(commit.contentHash) || commit.verification.status !== 'passed' || !commit.verification.evidenceHash || !SHA256.test(commit.verification.evidenceHash)) return failed(graph, [`regeneration_not_verified:${artifact.id}`]);
    const expected = expectedBindings(candidate, artifact.id);
    const expectedSourcesCurrent = expected.every(binding => candidate.artifacts.find(value => value.id === binding.artifactId)?.state === 'current');
    if (!expectedSourcesCurrent || !exactBindings(commit.inputs, expected)) return failed(graph, [`regeneration_input_binding_mismatch:${artifact.id}`]);
    candidate.artifacts[index] = { ...artifact, revision: artifact.revision + 1, contentHash: commit.contentHash, state: 'current', inputs: structuredClone(commit.inputs), verification: structuredClone(commit.verification), staleBecause: [] };
    committed.add(artifact.id);
  }
  candidate.revision += 1;
  const candidateIssues = validateDesignArtifactGraph(candidate).filter(value => !value.startsWith('current_artifact_binding_mismatch:') && !value.startsWith('current_artifact_depends_on_noncurrent:'));
  if (candidateIssues.length) return failed(graph, candidateIssues);
  return { committed: true, graph: candidate, staleArtifactIds: candidate.artifacts.filter(artifact => artifact.state === 'stale').map(artifact => artifact.id).sort(), reviewArtifactIds: candidate.artifacts.filter(artifact => artifact.state === 'review_required').map(artifact => artifact.id).sort(), issues: [] };
}

export function evaluateArtifactRelease(
  graph: DesignArtifactGraph,
  requiredKinds: readonly DesignArtifactKind[] = ['model', 'drawing', 'quantity', 'bim_quality', 'ifc'],
): ArtifactReleaseReport {
  const graphIssues = validateDesignArtifactGraph(graph);
  const missingKinds = requiredKinds.filter(kind => !graph.artifacts.some(artifact => artifact.kind === kind));
  const required = graph.artifacts.filter(artifact => requiredKinds.includes(artifact.kind));
  const staleArtifactIds = required.filter(artifact => artifact.state !== 'current').map(artifact => artifact.id).sort();
  const unverifiedArtifactIds = required.filter(artifact => artifact.verification.status !== 'passed' || !artifact.verification.evidenceHash).map(artifact => artifact.id).sort();
  const bindingIssueArtifactIds = graphIssues.filter(value => value.startsWith('current_artifact_binding_mismatch:') || value.startsWith('current_artifact_depends_on_noncurrent:')).map(value => value.split(':')[1]!).sort();
  return { releaseReady: missingKinds.length === 0 && staleArtifactIds.length === 0 && unverifiedArtifactIds.length === 0 && bindingIssueArtifactIds.length === 0 && graphIssues.length === 0, requiredKinds: [...requiredKinds], missingKinds, staleArtifactIds, unverifiedArtifactIds, bindingIssueArtifactIds, graphIssues };
}
