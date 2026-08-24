import { createHash } from 'node:crypto';

export const SPATIAL_DEPENDENCY_GRAPH_SCHEMA = 'nexyfab.spatial-dependency-graph.v1' as const;
export type CoordinationDomain = 'mechanical' | 'building' | 'civil' | 'landscape' | 'interior';
export type DependencyArtifactStatus = 'CURRENT' | 'HOLD' | 'STALE';

export interface SpatialUpstreamBinding {
  artifactId: string;
  sourceRevision: string;
  contentSha256: string;
}

export interface SpatialDependencyArtifact {
  artifactId: string;
  domain: CoordinationDomain;
  kind: string;
  sourceRevision: string;
  contentSha256: string;
  status: DependencyArtifactStatus;
  upstreamBindings: SpatialUpstreamBinding[];
}

export interface SpatialDependencyGraph {
  schema: typeof SPATIAL_DEPENDENCY_GRAPH_SCHEMA;
  projectId: string;
  artifacts: SpatialDependencyArtifact[];
}

export interface SpatialRevisionChange {
  artifactId: string;
  sourceRevision: string;
  contentSha256: string;
}

export interface SpatialDependencyEvaluation {
  status: 'PASS' | 'HOLD';
  issues: string[];
  canonicalSha256?: string;
}

export interface SpatialInvalidationResult {
  graph: SpatialDependencyGraph;
  invalidatedArtifactIds: string[];
  issues: string[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KIND = /^[a-z][a-z0-9._-]{0,63}$/;
const SHA = /^[a-f0-9]{64}$/;
const DOMAINS: CoordinationDomain[] = ['mechanical', 'building', 'civil', 'landscape', 'interior'];
const GRAPH_KEYS = ['schema', 'projectId', 'artifacts'];
const ARTIFACT_KEYS = ['artifactId', 'domain', 'kind', 'sourceRevision', 'contentSha256', 'status', 'upstreamBindings'];
const BINDING_KEYS = ['artifactId', 'sourceRevision', 'contentSha256'];
const MAX_ARTIFACTS = 2_000;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : isRecord(value)
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const unique = (items: string[]) => [...new Set(items)];

function allowedDependency(upstream: CoordinationDomain, downstream: CoordinationDomain): boolean {
  if (upstream === downstream) return true;
  return (upstream === 'mechanical' && (downstream === 'building' || downstream === 'interior'))
    || (upstream === 'civil' && (downstream === 'building' || downstream === 'landscape'))
    || (upstream === 'building' && downstream === 'interior');
}

export function hashSpatialDependencyGraph(graph: SpatialDependencyGraph): string {
  return createHash('sha256').update(canonical(graph), 'utf8').digest('hex');
}

export function evaluateSpatialDependencyGraph(input: unknown): SpatialDependencyEvaluation {
  const issues: string[] = [];
  if (!isRecord(input) || !exactKeys(input, GRAPH_KEYS)) return { status: 'HOLD', issues: ['graph_keys_invalid'] };
  const graph = input as unknown as SpatialDependencyGraph;
  if (graph.schema !== SPATIAL_DEPENDENCY_GRAPH_SCHEMA) issues.push('schema_invalid');
  if (typeof graph.projectId !== 'string' || !ID.test(graph.projectId)) issues.push('project_id_invalid');
  if (!Array.isArray(graph.artifacts) || graph.artifacts.length === 0 || graph.artifacts.length > MAX_ARTIFACTS) return { status: 'HOLD', issues: [...issues, 'artifacts_invalid'] };

  const artifacts = new Map<string, SpatialDependencyArtifact>();
  graph.artifacts.forEach((artifact, index) => {
    const path = `artifacts[${index}]`;
    if (!isRecord(artifact) || !exactKeys(artifact, ARTIFACT_KEYS)) { issues.push(`${path}:keys_invalid`); return; }
    if (typeof artifact.artifactId !== 'string' || !ID.test(artifact.artifactId)) issues.push(`${path}:id_invalid`);
    else if (artifacts.has(artifact.artifactId)) issues.push(`${path}:id_duplicate`);
    else artifacts.set(artifact.artifactId, artifact as SpatialDependencyArtifact);
    if (!DOMAINS.includes(artifact.domain as CoordinationDomain)) issues.push(`${path}:domain_invalid`);
    if (typeof artifact.kind !== 'string' || !KIND.test(artifact.kind)) issues.push(`${path}:kind_invalid`);
    if (typeof artifact.sourceRevision !== 'string' || !ID.test(artifact.sourceRevision)) issues.push(`${path}:revision_invalid`);
    if (typeof artifact.contentSha256 !== 'string' || !SHA.test(artifact.contentSha256)) issues.push(`${path}:hash_invalid`);
    if (!['CURRENT', 'HOLD', 'STALE'].includes(artifact.status as string)) issues.push(`${path}:status_invalid`);
    if (artifact.status !== 'CURRENT') issues.push(`${path}:status_${String(artifact.status).toLowerCase()}`);
    if (!Array.isArray(artifact.upstreamBindings) || artifact.upstreamBindings.length > MAX_ARTIFACTS) { issues.push(`${path}:bindings_invalid`); return; }
    const bindingIds = new Set<string>();
    artifact.upstreamBindings.forEach((binding, bindingIndex) => {
      const bindingPath = `${path}.upstreamBindings[${bindingIndex}]`;
      if (!isRecord(binding) || !exactKeys(binding, BINDING_KEYS)) { issues.push(`${bindingPath}:keys_invalid`); return; }
      if (typeof binding.artifactId !== 'string' || !ID.test(binding.artifactId)) issues.push(`${bindingPath}:id_invalid`);
      else if (bindingIds.has(binding.artifactId)) issues.push(`${bindingPath}:id_duplicate`);
      else bindingIds.add(binding.artifactId);
      if (typeof binding.sourceRevision !== 'string' || !ID.test(binding.sourceRevision)) issues.push(`${bindingPath}:revision_invalid`);
      if (typeof binding.contentSha256 !== 'string' || !SHA.test(binding.contentSha256)) issues.push(`${bindingPath}:hash_invalid`);
    });
  });

  for (const artifact of graph.artifacts) {
    if (!isRecord(artifact) || !Array.isArray(artifact.upstreamBindings)) continue;
    for (const binding of artifact.upstreamBindings) {
      const upstream = artifacts.get(binding.artifactId);
      if (!upstream) { issues.push(`dependency_missing:${artifact.artifactId}:${binding.artifactId}`); continue; }
      if (!allowedDependency(upstream.domain, artifact.domain)) issues.push(`dependency_domain_forbidden:${upstream.domain}:${artifact.domain}`);
      if (upstream.sourceRevision !== binding.sourceRevision || upstream.contentSha256 !== binding.contentSha256 || upstream.status !== 'CURRENT') issues.push(`dependency_stale:${artifact.artifactId}:${binding.artifactId}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { issues.push(`dependency_cycle:${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const artifact = artifacts.get(id);
    for (const binding of artifact?.upstreamBindings ?? []) if (artifacts.has(binding.artifactId)) visit(binding.artifactId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of artifacts.keys()) visit(id);

  const uniqueIssues = unique(issues);
  return uniqueIssues.length
    ? { status: 'HOLD', issues: uniqueIssues }
    : { status: 'PASS', issues: [], canonicalSha256: hashSpatialDependencyGraph(graph) };
}

export function invalidateSpatialDependents(graph: SpatialDependencyGraph, changes: SpatialRevisionChange[]): SpatialInvalidationResult {
  const initial = evaluateSpatialDependencyGraph(graph);
  if (initial.status !== 'PASS') return { graph, invalidatedArtifactIds: [], issues: initial.issues };
  const issues: string[] = [];
  const byId = new Map(graph.artifacts.map(artifact => [artifact.artifactId, { ...artifact, upstreamBindings: artifact.upstreamBindings.map(binding => ({ ...binding })) }]));
  const changedIds = new Set<string>();
  for (const change of changes) {
    const artifact = byId.get(change.artifactId);
    if (!artifact) { issues.push(`change_artifact_missing:${change.artifactId}`); continue; }
    if (!ID.test(change.sourceRevision) || !SHA.test(change.contentSha256)) { issues.push(`change_invalid:${change.artifactId}`); continue; }
    artifact.sourceRevision = change.sourceRevision;
    artifact.contentSha256 = change.contentSha256;
    artifact.status = 'CURRENT';
    changedIds.add(change.artifactId);
  }

  const invalidated = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const artifact of byId.values()) {
      if (changedIds.has(artifact.artifactId) || invalidated.has(artifact.artifactId)) continue;
      const stale = artifact.upstreamBindings.some(binding => {
        const upstream = byId.get(binding.artifactId);
        return !upstream || upstream.status !== 'CURRENT' || upstream.sourceRevision !== binding.sourceRevision || upstream.contentSha256 !== binding.contentSha256;
      });
      if (stale) {
        artifact.status = 'STALE';
        invalidated.add(artifact.artifactId);
        changed = true;
      }
    }
  }
  return {
    graph: { ...graph, artifacts: graph.artifacts.map(artifact => byId.get(artifact.artifactId)!) },
    invalidatedArtifactIds: [...invalidated].sort(),
    issues: unique(issues),
  };
}
