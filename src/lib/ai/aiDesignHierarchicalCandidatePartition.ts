import { createHash } from 'node:crypto';
import type { AiDesignCandidateArtifactV1 } from './aiDesignCandidateArtifact';
import type { ProductStructureGraphV1, ProductStructureNodeKind } from './aiDesignProductStructureGraph';

export const AI_DESIGN_HIERARCHICAL_CANDIDATE_ARTIFACT_SCHEMA = 'nexyfab.ai-design-hierarchical-candidate-artifact.v1' as const;
export const AI_DESIGN_GRAPH_PARTITION_SCHEMA = 'nexyfab.ai-design-graph-partition.v1' as const;
export const AI_DESIGN_PARTITION_MAX = 256;
export const AI_DESIGN_PARTITION_MAX_NODES = 2_000;
export type PartitionAuthorityStatus = 'verified' | 'failed' | 'unknown' | 'not_run';

export interface AiDesignGraphPartitionV1 {
  schema: typeof AI_DESIGN_GRAPH_PARTITION_SCHEMA;
  partitionId: string;
  artifactId: string;
  nodeIds: readonly string[];
  boundaryNodeIds: readonly string[];
  boundaryEdges: readonly string[];
  partitionDigest: string;
  exactGeometryStatus: PartitionAuthorityStatus;
  manufacturingStatus: PartitionAuthorityStatus;
}
export interface AiDesignHierarchicalCandidateArtifactV1 {
  schema: typeof AI_DESIGN_HIERARCHICAL_CANDIDATE_ARTIFACT_SCHEMA;
  artifact: AiDesignCandidateArtifactV1;
  level: 'assembly' | 'subassembly' | 'component';
  parentArtifactId: string | null;
  childArtifactIds: readonly string[];
  graphPartitionIds: readonly string[];
  graphCoverage: 'complete' | 'partial';
  artifactDigest: string;
}
export interface GraphPartitionDefinition { partitionId: string; artifactId: string; nodeIds: readonly string[]; boundaryNodeIds?: readonly string[]; }
export interface AiDesignGraphPartitionResult { partitions: readonly AiDesignGraphPartitionV1[]; coverage: 'complete' | 'partial'; issues: readonly string[]; }

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const HASH = /^[a-f0-9]{64}$/;
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
function canonical(value: unknown): string { if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value); if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('partition_non_finite'); return JSON.stringify(value); } if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`; } throw new Error('partition_non_canonical'); }
function digest(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }

function partitionMaterial(partition: Omit<AiDesignGraphPartitionV1, 'partitionDigest'> | AiDesignGraphPartitionV1): unknown { const { partitionDigest: _digest, ...rest } = partition as AiDesignGraphPartitionV1; return rest; }
function artifactMaterial(value: Omit<AiDesignHierarchicalCandidateArtifactV1, 'artifactDigest'> | AiDesignHierarchicalCandidateArtifactV1): unknown { const { artifactDigest: _digest, ...rest } = value as AiDesignHierarchicalCandidateArtifactV1; return rest; }

export function createAiDesignGraphPartitions(graph: ProductStructureGraphV1, definitions: readonly GraphPartitionDefinition[]): AiDesignGraphPartitionResult {
  const issues: string[] = []; const nodeIds = new Set(graph.nodes.map(node => node.nodeId)); const assigned = new Map<string, string>(); const partitions: AiDesignGraphPartitionV1[] = [];
  if (definitions.length > AI_DESIGN_PARTITION_MAX) issues.push('partition_definition_limit_exceeded');
  const boundaryDeclarations = new Map<string, number>();
  for (const definition of definitions.slice(0, AI_DESIGN_PARTITION_MAX)) for (const nodeId of new Set(definition.boundaryNodeIds ?? [])) boundaryDeclarations.set(nodeId, (boundaryDeclarations.get(nodeId) ?? 0) + 1);
  for (const definition of definitions.slice(0, AI_DESIGN_PARTITION_MAX)) {
    if (!isId(definition.partitionId) || !isId(definition.artifactId) || !definition.nodeIds.length || definition.nodeIds.length > AI_DESIGN_PARTITION_MAX_NODES) { issues.push(`partition_definition_invalid:${definition.partitionId}`); continue; }
    const unique = [...new Set(definition.nodeIds)].sort(); const boundaries = [...new Set(definition.boundaryNodeIds ?? [])].sort();
    for (const nodeId of unique) { if (!nodeIds.has(nodeId)) issues.push(`partition_node_missing:${nodeId}`); const prior = assigned.get(nodeId); if (prior && (boundaryDeclarations.get(nodeId) ?? 0) < 2) issues.push(`partition_overlap_without_boundary:${nodeId}`); else if (!prior) assigned.set(nodeId, definition.partitionId); }
    if (boundaries.some(nodeId => !unique.includes(nodeId))) issues.push(`partition_boundary_outside:${definition.partitionId}`);
    const boundaryEdges = graph.edges.filter(edge => unique.includes(edge.from) !== unique.includes(edge.to)).map(edge => edge.edgeId).sort();
    const partition = { schema: AI_DESIGN_GRAPH_PARTITION_SCHEMA, partitionId: definition.partitionId, artifactId: definition.artifactId, nodeIds: unique, boundaryNodeIds: boundaries, boundaryEdges, partitionDigest: '', exactGeometryStatus: 'not_run' as const, manufacturingStatus: 'not_run' as const };
    partition.partitionDigest = digest(partitionMaterial(partition)); partitions.push(Object.freeze(structuredClone(partition)));
  }
  const coverage = graph.nodes.every(node => assigned.has(node.nodeId)) ? 'complete' : 'partial';
  return { partitions: Object.freeze(partitions), coverage, issues: [...new Set(issues)] };
}

export function validateAiDesignGraphPartition(value: unknown, graph?: ProductStructureGraphV1): string[] {
  if (!value || typeof value !== 'object') return ['partition_not_object']; const partition = value as Partial<AiDesignGraphPartitionV1>; const issues: string[] = [];
  if (partition.schema !== AI_DESIGN_GRAPH_PARTITION_SCHEMA || !isId(partition.partitionId) || !isId(partition.artifactId) || !Array.isArray(partition.nodeIds) || partition.nodeIds.length === 0 || partition.nodeIds.length > AI_DESIGN_PARTITION_MAX_NODES || partition.nodeIds.some(nodeId => !isId(nodeId)) || new Set(partition.nodeIds).size !== partition.nodeIds.length || !Array.isArray(partition.boundaryNodeIds) || partition.boundaryNodeIds.some(nodeId => !isId(nodeId)) || !Array.isArray(partition.boundaryEdges) || partition.boundaryEdges.some(edgeId => !isId(edgeId))) issues.push('partition_shape_invalid');
  if (!HASH.test(partition.partitionDigest ?? '') || partition.exactGeometryStatus !== 'not_run' || partition.manufacturingStatus !== 'not_run') issues.push('partition_authority_invalid');
  if (graph) { const nodes = new Set(graph.nodes.map(node => node.nodeId)); if ((partition.nodeIds ?? []).some(nodeId => !nodes.has(nodeId))) issues.push('partition_graph_binding_invalid'); const selected = new Set(partition.nodeIds ?? []); const expectedBoundaryEdges = graph.edges.filter(edge => selected.has(edge.from) !== selected.has(edge.to)).map(edge => edge.edgeId).sort(); if (JSON.stringify(expectedBoundaryEdges) !== JSON.stringify([...(partition.boundaryEdges ?? [])].sort())) issues.push('partition_boundary_edges_mismatch'); }
  if (issues.length === 0 && partition.partitionDigest !== digest(partitionMaterial(partition as AiDesignGraphPartitionV1))) issues.push('partition_digest_mismatch');
  return [...new Set(issues)];
}

export function createAiDesignHierarchicalCandidateArtifact(input: Omit<AiDesignHierarchicalCandidateArtifactV1, 'schema' | 'artifactDigest'>): AiDesignHierarchicalCandidateArtifactV1 {
  if (input.childArtifactIds.length > AI_DESIGN_PARTITION_MAX_NODES || input.graphPartitionIds.length > AI_DESIGN_PARTITION_MAX) throw new Error('hierarchical_artifact_bounds_exceeded');
  const value = { schema: AI_DESIGN_HIERARCHICAL_CANDIDATE_ARTIFACT_SCHEMA, ...input, artifactDigest: '' } as AiDesignHierarchicalCandidateArtifactV1;
  value.artifactDigest = digest(artifactMaterial(value)); return Object.freeze(structuredClone(value));
}

export function validateAiDesignHierarchicalCandidateArtifact(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['hierarchical_artifact_not_object']; const item = value as Partial<AiDesignHierarchicalCandidateArtifactV1>; const issues: string[] = [];
  if (item.schema !== AI_DESIGN_HIERARCHICAL_CANDIDATE_ARTIFACT_SCHEMA || !item.artifact || !['assembly', 'subassembly', 'component'].includes(item.level ?? '') || (item.parentArtifactId !== null && !isId(item.parentArtifactId)) || !Array.isArray(item.childArtifactIds) || item.childArtifactIds.length > AI_DESIGN_PARTITION_MAX_NODES || item.childArtifactIds.some(value => !isId(value)) || new Set(item.childArtifactIds).size !== item.childArtifactIds.length || !Array.isArray(item.graphPartitionIds) || item.graphPartitionIds.length > AI_DESIGN_PARTITION_MAX || item.graphPartitionIds.some(value => !isId(value)) || new Set(item.graphPartitionIds).size !== item.graphPartitionIds.length || !['complete', 'partial'].includes(item.graphCoverage ?? '')) issues.push('hierarchical_artifact_shape_invalid');
  if (item.artifact && (item.artifact.schema !== 'nexyfab.ai-design-candidate-artifact.v1' || !isId(item.artifact.artifactId) || !isId(item.artifact.projectId) || !isId(item.artifact.sessionId) || !HASH.test(item.artifact.manifestDigest ?? ''))) issues.push('base_artifact:shape_invalid');
  if (!HASH.test(item.artifactDigest ?? '')) issues.push('hierarchical_artifact_digest_invalid');
  if (issues.length === 0 && item.artifactDigest !== digest(artifactMaterial(item as AiDesignHierarchicalCandidateArtifactV1))) issues.push('hierarchical_artifact_digest_mismatch');
  return [...new Set(issues)];
}

/** Validates parent/child lineage and cycle freedom for a complete hierarchy sidecar. */
export function validateAiDesignHierarchicalCandidateSet(values: readonly AiDesignHierarchicalCandidateArtifactV1[]): string[] {
  const issues = values.flatMap(validateAiDesignHierarchicalCandidateArtifact);
  const byId = new Map<string, AiDesignHierarchicalCandidateArtifactV1>();
  for (const value of values) { if (byId.has(value.artifact.artifactId)) issues.push(`hierarchical_artifact_duplicate:${value.artifact.artifactId}`); byId.set(value.artifact.artifactId, value); }
  for (const value of values) {
    if (value.parentArtifactId) {
      const parent = byId.get(value.parentArtifactId);
      if (!parent || !parent.childArtifactIds.includes(value.artifact.artifactId)) issues.push(`hierarchical_parent_mismatch:${value.artifact.artifactId}`);
      if (parent && (parent.artifact.projectId !== value.artifact.projectId || parent.artifact.sessionId !== value.artifact.sessionId || parent.artifact.candidateId !== value.artifact.candidateId)) issues.push(`hierarchical_scope_mismatch:${value.artifact.artifactId}`);
    }
    for (const childId of value.childArtifactIds) if (byId.get(childId)?.parentArtifactId !== value.artifact.artifactId) issues.push(`hierarchical_child_mismatch:${childId}`);
    const seen = new Set<string>(); let cursor: AiDesignHierarchicalCandidateArtifactV1 | undefined = value;
    while (cursor) { if (seen.has(cursor.artifact.artifactId)) { issues.push(`hierarchical_cycle:${cursor.artifact.artifactId}`); break; } seen.add(cursor.artifact.artifactId); cursor = cursor.parentArtifactId ? byId.get(cursor.parentArtifactId) : undefined; }
  }
  return [...new Set(issues)];
}

export function partitionNodeKinds(graph: ProductStructureGraphV1): Readonly<Record<ProductStructureNodeKind, readonly string[]>> {
  return Object.freeze({ assembly: graph.nodes.filter(node => node.kind === 'assembly').map(node => node.nodeId).sort(), subassembly: graph.nodes.filter(node => node.kind === 'subassembly').map(node => node.nodeId).sort(), component: graph.nodes.filter(node => node.kind === 'component').map(node => node.nodeId).sort(), interface: graph.nodes.filter(node => node.kind === 'interface').map(node => node.nodeId).sort() });
}
