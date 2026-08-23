import { hashArchitectureInteriorEvidenceV2, validateArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import { buildArchitectureInteriorDrawingArtifact, type ArchitectureInteriorDrawingArtifact } from './architectureInteriorDrawingArtifact';
import { buildArchitectureInteriorIfcArtifact, type ArchitectureInteriorIfcArtifact } from './architectureInteriorIfcArtifact';
import { buildArchitectureInteriorQuantityArtifact, type ArchitectureInteriorQuantityArtifact } from './architectureInteriorQuantityArtifact';
import { validateDesignArtifactGraph, type DesignArtifactKind, type DesignArtifactNode, type ArtifactDependencyEdge, type ArtifactInputBinding } from './designArtifactGraph';

/**
 * Derived artifacts are generated against an immutable semantic workspace
 * snapshot. The result is a separate bundle: it never mutates or re-hashes
 * the source workspace. This avoids claiming a design revision for a derived
 * deliverable and avoids a circular binding to the final workspace hash.
 */
export const ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA = 'nexyfab.architecture-interior-artifact-transaction.v1' as const;

export type ArchitectureInteriorDerivedArtifactKind = Extract<DesignArtifactKind, 'quantity' | 'drawing' | 'ifc'>;
export type ArchitectureInteriorArtifactTransactionInput = {
  workspace: ArchitectureInteriorWorkspaceV2;
  expectedWorkspaceRevision: number;
  requestedKinds: readonly ArchitectureInteriorDerivedArtifactKind[];
};

export type ArchitectureInteriorDerivedArtifactPayload = {
  kind: ArchitectureInteriorDerivedArtifactKind;
  artifact: DesignArtifactNode;
  contentHash: string;
  payload: ArchitectureInteriorQuantityArtifact['payload'] | ArchitectureInteriorDrawingArtifact['payload'] | ArchitectureInteriorIfcArtifact['payload'];
};

export type ArchitectureInteriorArtifactTransactionSuccess = {
  committed: true;
  schema: typeof ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA;
  bundle: ArchitectureInteriorArtifactBundle;
};

export type ArchitectureInteriorArtifactBundle = {
  schema: typeof ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA;
  source: {
    projectId: string;
    revision: number;
    contentHash: string;
    architectureDocumentId: string;
    interiorDocumentId: string;
    architectureDocumentHash: string;
    interiorDocumentHash: string;
  };
  artifactGraph: ArchitectureInteriorWorkspaceV2['artifactGraph'];
  artifacts: ArchitectureInteriorDerivedArtifactPayload[];
  bundleHash: string;
};

export type ArchitectureInteriorArtifactTransactionFailure = {
  committed: false;
  schema: typeof ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA;
  workspace: ArchitectureInteriorWorkspaceV2;
  code:
    | 'invalid_workspace'
    | 'stale_workspace_revision'
    | 'requested_kind_invalid'
    | 'requested_kind_duplicate'
    | 'missing_model_source'
    | 'locked_dependency'
    | 'artifact_id_collision'
    | 'dependency_id_collision'
    | 'artifact_build_failed'
    | 'artifact_graph_invalid'
    | 'workspace_hash_invalid';
  issues: string[];
};

export type ArchitectureInteriorArtifactTransactionResult = ArchitectureInteriorArtifactTransactionSuccess | ArchitectureInteriorArtifactTransactionFailure;
const SHA256 = /^[a-f0-9]{64}$/;

const ORDER: readonly ArchitectureInteriorDerivedArtifactKind[] = ['quantity', 'drawing', 'ifc'];
const ALLOWED = new Set<ArchitectureInteriorDerivedArtifactKind>(ORDER);
const PAYLOAD_SCHEMA_BY_KIND: Record<ArchitectureInteriorDerivedArtifactKind, string> = {
  quantity: 'nexyfab.architecture-interior-quantity.v1',
  drawing: 'nexyfab.architecture-interior-drawing.v1',
  ifc: 'nexyfab.architecture-interior-ifc.v1',
};

export function hashArchitectureInteriorArtifactBundle(bundle: Omit<ArchitectureInteriorArtifactBundle, 'bundleHash'> | ArchitectureInteriorArtifactBundle): string {
  const copy = structuredClone(bundle) as ArchitectureInteriorArtifactBundle;
  copy.bundleHash = '';
  return hashArchitectureInteriorEvidenceV2(copy);
}

export function validateArchitectureInteriorArtifactBundle(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['bundle_invalid'];
  const bundle = value as Partial<ArchitectureInteriorArtifactBundle>;
  const issues: string[] = [];
  if (bundle.schema !== ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA) issues.push('bundle_schema_invalid');
  const source = bundle.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) issues.push('bundle_source_invalid');
  else {
    if (typeof source.projectId !== 'string' || !source.projectId.trim() || !Number.isSafeInteger(source.revision) || source.revision < 0 || typeof source.architectureDocumentId !== 'string' || !source.architectureDocumentId.trim() || typeof source.interiorDocumentId !== 'string' || !source.interiorDocumentId.trim()) issues.push('bundle_source_identity_invalid');
    for (const hash of [source.contentHash, source.architectureDocumentHash, source.interiorDocumentHash]) if (typeof hash !== 'string' || !SHA256.test(hash)) issues.push('bundle_source_hash_invalid');
  }
  const graph = bundle.artifactGraph;
  if (!graph || typeof graph !== 'object') issues.push('bundle_graph_invalid');
  else {
    issues.push(...validateDesignArtifactGraph(graph));
    if (source && graph.projectId !== source.projectId) issues.push('bundle_graph_project_mismatch');
    if (source && graph.revision !== source.revision) issues.push('bundle_graph_revision_mismatch');
  }
  if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length === 0) issues.push('bundle_artifacts_missing');
  else {
    const ids = new Set<string>();
    const graphArtifacts = new Map((graph?.artifacts ?? []).map(artifact => [artifact.id, artifact]));
    for (const item of bundle.artifacts) {
      if (!item || typeof item !== 'object' || !item.artifact || !ALLOWED.has(item.kind as ArchitectureInteriorDerivedArtifactKind) || typeof item.contentHash !== 'string' || !SHA256.test(item.contentHash)) { issues.push('bundle_artifact_invalid'); continue; }
      if (ids.has(item.artifact.id)) issues.push('bundle_artifact_duplicate');
      ids.add(item.artifact.id);
      const graphArtifact = graphArtifacts.get(item.artifact.id);
      if (!graphArtifact || graphArtifact.kind !== item.kind || graphArtifact.contentHash !== item.contentHash || graphArtifact.state !== 'current' || hashArchitectureInteriorEvidenceV2(item.artifact) !== hashArchitectureInteriorEvidenceV2(graphArtifact)) issues.push(`bundle_artifact_graph_mismatch:${item.artifact.id}`);
      const payloadSchema = (item.payload as { schema?: unknown })?.schema;
      if (payloadSchema !== PAYLOAD_SCHEMA_BY_KIND[item.kind]) issues.push(`bundle_artifact_payload_schema_mismatch:${item.artifact.id}`);
      try { if (hashArchitectureInteriorEvidenceV2(item.payload) !== item.contentHash) issues.push(`bundle_artifact_payload_hash_mismatch:${item.artifact.id}`); } catch { issues.push(`bundle_artifact_payload_hash_invalid:${item.artifact.id}`); }
      const binding = (item.payload as { binding?: { projectId?: string; revision?: number; workspaceContentHash?: string; architectureDocumentId?: string; interiorDocumentId?: string; architectureDocumentHash?: string; interiorDocumentHash?: string } })?.binding;
      if (!binding || binding.projectId !== source?.projectId || binding.revision !== source?.revision || binding.workspaceContentHash !== source?.contentHash || binding.architectureDocumentId !== source?.architectureDocumentId || binding.interiorDocumentId !== source?.interiorDocumentId || binding.architectureDocumentHash !== source?.architectureDocumentHash || binding.interiorDocumentHash !== source?.interiorDocumentHash) issues.push(`bundle_artifact_source_mismatch:${item.artifact.id}`);
    }
  }
  if (typeof bundle.bundleHash !== 'string' || !SHA256.test(bundle.bundleHash)) issues.push('bundle_hash_invalid');
  else {
    try { if (hashArchitectureInteriorArtifactBundle(bundle as ArchitectureInteriorArtifactBundle) !== bundle.bundleHash) issues.push('bundle_hash_mismatch'); } catch { issues.push('bundle_hash_invalid'); }
  }
  return [...new Set(issues)];
}

function fail(
  workspace: ArchitectureInteriorWorkspaceV2,
  code: ArchitectureInteriorArtifactTransactionFailure['code'],
  issues: string[],
): ArchitectureInteriorArtifactTransactionFailure {
  return { committed: false, schema: ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA, workspace, code, issues };
}

function artifactForKind(workspace: ArchitectureInteriorWorkspaceV2, kind: ArchitectureInteriorDerivedArtifactKind, modelInputs: readonly ArtifactInputBinding[]) {
  if (kind === 'quantity') return buildArchitectureInteriorQuantityArtifact(workspace, modelInputs);
  if (kind === 'drawing') return buildArchitectureInteriorDrawingArtifact(workspace, modelInputs);
  return buildArchitectureInteriorIfcArtifact(workspace, modelInputs);
}

function stableKinds(kinds: readonly ArchitectureInteriorDerivedArtifactKind[]): ArchitectureInteriorDerivedArtifactKind[] {
  return [...kinds].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

function allCurrentModelInputs(workspace: ArchitectureInteriorWorkspaceV2): Set<string> {
  return new Set(workspace.artifactGraph.artifacts.filter(item => item.kind === 'model' && item.state === 'current').map(item => item.id));
}

/**
 * A semantic edit invalidates model nodes as well as their derived outputs.
 * Rebuilding a drawing/quantity/IFC bundle must therefore first refresh the
 * model source nodes from the immutable workspace snapshot.  Without this
 * step a stale model graph could never be rebuilt: the builders intentionally
 * accept only current model inputs.  IDs stay stable so downstream history and
 * selection lineage remain addressable; only the model revision/content hash
 * and verification receipt advance.
 */
function refreshStaleModelSources(workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorWorkspaceV2 {
  const architectureGeometryHash = workspace.architecture.geometry.contentHash;
  const interiorGeometryHash = workspace.interior.geometry.contentHash;
  const refreshed = structuredClone(workspace) as ArchitectureInteriorWorkspaceV2;
  const modelArtifacts = refreshed.artifactGraph.artifacts.filter(artifact => artifact.kind === 'model');
  if (modelArtifacts.some(artifact => artifact.state === 'current')) return refreshed;
  const latestModelRevision = Math.max(...modelArtifacts.map(artifact => artifact.revision));
  refreshed.artifactGraph.artifacts = refreshed.artifactGraph.artifacts.map((artifact) => {
    if (artifact.kind !== 'model' || artifact.state === 'current' || artifact.revision !== latestModelRevision) return artifact;
    const sourceHash = artifact.id.toLowerCase().includes('architecture')
      ? architectureGeometryHash
      : artifact.id.toLowerCase().includes('interior')
        ? interiorGeometryHash
        : hashArchitectureInteriorEvidenceV2({
          schema: 'nexyfab.architecture-interior-model-source.v1',
          modelId: artifact.id,
          workspaceContentHash: workspace.contentHash,
          architectureGeometryHash,
          interiorGeometryHash,
        });
    const evidenceHash = hashArchitectureInteriorEvidenceV2({
      schema: 'nexyfab.architecture-interior-model-verification.v1',
      modelId: artifact.id,
      revision: workspace.workspace.revision,
      contentHash: sourceHash,
      workspaceContentHash: workspace.contentHash,
    });
    return {
      ...artifact,
      revision: workspace.workspace.revision,
      contentHash: sourceHash,
      state: 'current' as const,
      verification: {
        status: 'passed' as const,
        verifierId: 'architecture-interior-model-source-refresh.v1',
        evidenceHash,
        issues: [],
      },
      staleBecause: [],
    };
  });
  return refreshed;
}

function asGenerated(value: ReturnType<typeof buildArchitectureInteriorQuantityArtifact> | ReturnType<typeof buildArchitectureInteriorDrawingArtifact> | ReturnType<typeof buildArchitectureInteriorIfcArtifact>): { artifact: DesignArtifactNode; dependencies: ArtifactDependencyEdge[]; derived: ArchitectureInteriorDerivedArtifactPayload } | null {
  if (!value.ok) return null;
  const result = value.result;
  return {
    artifact: result.artifact,
    dependencies: result.dependencies,
    derived: {
      kind: result.artifact.kind as ArchitectureInteriorDerivedArtifactKind,
      artifact: structuredClone(result.artifact),
      contentHash: result.contentHash,
      payload: result.payload,
    },
  };
}

function dependencySignature(edge: ArtifactDependencyEdge): string {
  return `${edge.sourceId}:${edge.targetId}:${edge.policy}`;
}

export function executeArchitectureInteriorArtifactTransaction(input: ArchitectureInteriorArtifactTransactionInput): ArchitectureInteriorArtifactTransactionResult {
  const original = input.workspace;
  let workspaceIssues: string[];
  try { workspaceIssues = validateArchitectureInteriorWorkspaceV2(original); } catch { return fail(original, 'invalid_workspace', ['workspace_validation_failed']); }
  if (workspaceIssues.length) return fail(original, 'invalid_workspace', workspaceIssues);
  if (!Number.isSafeInteger(input.expectedWorkspaceRevision) || input.expectedWorkspaceRevision !== original.workspace.revision || original.artifactGraph.revision !== original.workspace.revision) {
    return fail(original, 'stale_workspace_revision', ['expected_workspace_revision_does_not_match_current_workspace']);
  }
  if (!Array.isArray(input.requestedKinds) || input.requestedKinds.length === 0) return fail(original, 'requested_kind_invalid', ['at_least_one_derived_artifact_is_required']);
  for (const kind of input.requestedKinds) if (!ALLOWED.has(kind)) return fail(original, 'requested_kind_invalid', [`unsupported_derived_artifact_kind:${String(kind)}`]);
  if (new Set(input.requestedKinds).size !== input.requestedKinds.length) return fail(original, 'requested_kind_duplicate', ['requested_derived_artifact_kind_repeated']);

  const sourceWorkspace = refreshStaleModelSources(original);
  const originalModelState = new Map(original.artifactGraph.artifacts.filter(item => item.kind === 'model').map(item => [item.id, item.state]));
  const refreshedModelIds = new Set(sourceWorkspace.artifactGraph.artifacts.filter(item => item.kind === 'model' && item.state === 'current' && originalModelState.get(item.id) !== 'current').map(item => item.id));
  if ([...refreshedModelIds].some(modelId => original.artifactGraph.dependencies.some(edge => edge.policy === 'locked' && (edge.sourceId === modelId || edge.targetId === modelId)))) {
    return fail(original, 'locked_dependency', ['locked_model_source_requires_approval']);
  }
  const currentModelIds = allCurrentModelInputs(sourceWorkspace);
  if (currentModelIds.size === 0) return fail(original, 'missing_model_source', ['current_model_artifact_required']);
  const modelInputs = sourceWorkspace.artifactGraph.artifacts
    .filter(item => item.kind === 'model' && item.state === 'current')
    .map(item => ({ artifactId: item.id, revision: item.revision, contentHash: item.contentHash }));

  const generated: Array<{ artifact: DesignArtifactNode; dependencies: ArtifactDependencyEdge[]; derived: ArchitectureInteriorDerivedArtifactPayload }> = [];
  for (const kind of stableKinds(input.requestedKinds)) {
    let built: ReturnType<typeof artifactForKind>;
    try { built = artifactForKind(original, kind, modelInputs); } catch { return fail(original, 'artifact_build_failed', [`${kind}_builder_failed`]); }
    if (!built.ok) return fail(original, 'artifact_build_failed', [`${kind}:${built.code}`, ...built.issues]);
    const normalized = asGenerated(built);
    if (!normalized) return fail(original, 'artifact_build_failed', [`${kind}:builder_result_invalid`]);
    if (!normalized.artifact.inputs.length || normalized.artifact.inputs.some(binding => !currentModelIds.has(binding.artifactId))) return fail(original, 'missing_model_source', [`${kind}:model_input_missing_or_noncurrent`]);
    generated.push(normalized);
  }

  const candidate = structuredClone(sourceWorkspace) as ArchitectureInteriorWorkspaceV2;
  const targetIds = new Set(generated.map(item => item.artifact.id));
  const originalById = new Map(sourceWorkspace.artifactGraph.artifacts.map(item => [item.id, item]));
  for (const item of generated) {
    const existing = originalById.get(item.artifact.id);
    if (existing && existing.kind !== item.artifact.kind) return fail(original, 'artifact_id_collision', [`artifact_id_kind_collision:${item.artifact.id}`]);
    if (existing && sourceWorkspace.artifactGraph.dependencies.some(edge => (edge.sourceId === existing.id || edge.targetId === existing.id) && edge.policy === 'locked')) return fail(original, 'locked_dependency', [`locked_dependency:${existing.id}`]);
  }
  const existingDependencyIds = new Set(sourceWorkspace.artifactGraph.dependencies.filter(edge => !targetIds.has(edge.targetId)).map(edge => edge.id));
  const existingSignatures = new Set(sourceWorkspace.artifactGraph.dependencies.filter(edge => !targetIds.has(edge.targetId)).map(dependencySignature));
  const generatedDependencyIds = new Set<string>();
  const generatedSignatures = new Set<string>();
  for (const item of generated) {
    for (const edge of item.dependencies) {
      if (generatedDependencyIds.has(edge.id) || existingDependencyIds.has(edge.id)) return fail(original, 'dependency_id_collision', [`dependency_id_collision:${edge.id}`]);
      if (generatedSignatures.has(dependencySignature(edge)) || existingSignatures.has(dependencySignature(edge))) return fail(original, 'dependency_id_collision', [`dependency_duplicate:${dependencySignature(edge)}`]);
      generatedDependencyIds.add(edge.id); generatedSignatures.add(dependencySignature(edge));
    }
  }

  const replaced = new Set<string>();
  candidate.artifactGraph.artifacts = candidate.artifactGraph.artifacts.filter(artifact => {
    if (!targetIds.has(artifact.id)) return true;
    replaced.add(artifact.id);
    return false;
  });
  candidate.artifactGraph.dependencies = candidate.artifactGraph.dependencies.filter(edge => !targetIds.has(edge.targetId));
  for (const item of generated) {
    candidate.artifactGraph.artifacts.push(structuredClone(item.artifact));
    candidate.artifactGraph.dependencies.push(...structuredClone(item.dependencies));
  }
  const graphIssues = validateDesignArtifactGraph(candidate.artifactGraph);
  if (graphIssues.length) return fail(original, 'artifact_graph_invalid', graphIssues);
  const source = {
    projectId: original.projectId,
    revision: original.workspace.revision,
    contentHash: original.contentHash,
    architectureDocumentId: original.architecture.documentId,
    interiorDocumentId: original.interior.documentId,
    architectureDocumentHash: hashArchitectureInteriorEvidenceV2(original.architecture.document),
    interiorDocumentHash: hashArchitectureInteriorEvidenceV2(original.interior.document),
  };
  const artifacts = generated.map(item => item.derived);
  const bundleWithoutHash = { schema: ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA, source, artifactGraph: candidate.artifactGraph, artifacts, bundleHash: '' };
  const bundleHash = hashArchitectureInteriorEvidenceV2(bundleWithoutHash);
  const bundle: ArchitectureInteriorArtifactBundle = { ...bundleWithoutHash, bundleHash };
  return { committed: true, schema: ARCHITECTURE_INTERIOR_ARTIFACT_TRANSACTION_SCHEMA, bundle };
}
