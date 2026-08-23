import { validateArchitectureDocument, validateInteriorDocument } from './architectureInteriorDocuments';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, validateDesignArtifactGraph } from './designArtifactGraph';
import type { ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_UNITS = new Set(['mm', 'cm', 'm', 'in', 'ft']);
const FRAME_KINDS = new Set(['project', 'site', 'building', 'storey', 'object']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finiteV3(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function validateDomainEvidence(value: unknown, prefix: string): string[] {
  if (!isRecord(value) || !isRecord(value.geometry) || !isRecord(value.semantic) || !Array.isArray(value.provenance)) return [`${prefix}_evidence_missing`];
  const geometry = value.geometry;
  const semantic = value.semantic;
  const verification = geometry.verification;
  const issues: string[] = [];
  if (!['brep', 'surface', 'mesh', 'bim', 'procedural'].includes(String(geometry.representation)) || geometry.units !== 'mm' || !['conceptual', 'exact_brep'].includes(String(geometry.fidelity)) || !SHA256.test(String(geometry.contentHash ?? ''))) issues.push(`${prefix}_geometry_invalid`);
  if (!isRecord(verification) || !['passed', 'failed', 'not_run'].includes(String(verification.status)) || typeof verification.verifierId !== 'string' || !Array.isArray(verification.issues)) issues.push(`${prefix}_verification_invalid`);
  if (typeof semantic.schema !== 'string' || !semantic.schema.trim() || !SHA256.test(String(semantic.contentHash ?? ''))) issues.push(`${prefix}_semantic_invalid`);
  if (value.provenance.some(item => !isRecord(item) || typeof item.sourceId !== 'string' || !item.sourceId.trim() || !['user', 'ai', 'import', 'catalog', 'expert'].includes(String(item.kind)) || !SHA256.test(String(item.contentHash ?? '')))) issues.push(`${prefix}_provenance_invalid`);
  return issues;
}

/**
 * Browser-safe transport validator for a server-owned workspace response.
 * The server remains authoritative for canonical SHA-256 recomputation; this
 * client boundary validates all response structure and cross-revision links
 * without importing the Node-only hashing implementation into the bundle.
 */
export function validateArchitectureInteriorWorkspaceClientEnvelope(value: unknown): string[] {
  if (!isRecord(value)) return ['workspace_invalid'];
  const workspace = value as unknown as ArchitectureInteriorWorkspaceV2;
  const issues: string[] = [];
  if (workspace.schema !== 'nexyfab.architecture-interior-workspace.v2' || typeof workspace.projectId !== 'string' || !workspace.projectId.trim()) issues.push('workspace_header_invalid');
  if (!isRecord(workspace.workspace) || workspace.workspace.projectId !== workspace.projectId || !Number.isSafeInteger(workspace.workspace.revision) || workspace.workspace.revision < 0 || !SHA256.test(String(workspace.workspace.contentHash ?? '')) || workspace.workspace.contentHash !== workspace.contentHash || !['ai_design', 'precision_cad'].includes(String(workspace.workspace.track)) || !['concept', 'exact', 'release'].includes(String(workspace.workspace.maturity))) issues.push('workspace_binding_invalid');
  if (!isRecord(workspace.units) || !SOURCE_UNITS.has(String(workspace.units.sourceUnit)) || workspace.units.geometryUnit !== 'mm' || workspace.units.analysisUnit !== 'SI') issues.push('workspace_units_invalid');
  if (!isRecord(workspace.architecture) || !isRecord(workspace.interior) || !isRecord(workspace.architecture.document) || !isRecord(workspace.interior.document)) return [...new Set([...issues, 'domain_envelope_missing'])];
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  if (architecture.schema !== 'nexyfab.architecture.v1' || interior.schema !== 'nexyfab.interior.v1' || architecture.revision !== workspace.workspace.revision || interior.revision !== workspace.workspace.revision || interior.architectureDocumentId !== workspace.architecture.documentId || workspace.architecture.documentId === workspace.interior.documentId) issues.push('domain_revision_binding_invalid');
  try {
    issues.push(...validateArchitectureDocument(architecture).map((_, index) => `architecture_document_invalid:${index + 1}`));
    issues.push(...validateInteriorDocument(interior, architecture).map((_, index) => `interior_document_invalid:${index + 1}`));
  } catch {
    issues.push('document_validation_failed');
  }
  issues.push(...validateDomainEvidence(workspace.architecture, 'architecture'));
  issues.push(...validateDomainEvidence(workspace.interior, 'interior'));
  if (!Array.isArray(workspace.coordinates)) issues.push('coordinates_invalid');
  else {
    const ids = new Set<string>();
    for (const frame of workspace.coordinates) {
      if (!isRecord(frame) || typeof frame.id !== 'string' || !frame.id.trim() || ids.has(frame.id) || !FRAME_KINDS.has(String(frame.kind)) || !finiteV3(frame.originMm) || !finiteV3(frame.rotationDeg)) issues.push('coordinate_frame_invalid');
      else ids.add(frame.id);
    }
    for (const frame of workspace.coordinates) if (frame.kind !== 'project' && (!frame.parentId || !ids.has(frame.parentId))) issues.push('coordinate_parent_missing');
  }
  if (!isRecord(workspace.artifactGraph) || workspace.artifactGraph.schema !== DESIGN_ARTIFACT_GRAPH_SCHEMA || workspace.artifactGraph.projectId !== workspace.projectId || workspace.artifactGraph.revision !== workspace.workspace.revision) issues.push('artifact_graph_binding_invalid');
  else {
    try { issues.push(...validateDesignArtifactGraph(workspace.artifactGraph).map((_, index) => `artifact_graph_invalid:${index + 1}`)); }
    catch { issues.push('artifact_graph_validation_failed'); }
  }
  return [...new Set(issues)];
}
