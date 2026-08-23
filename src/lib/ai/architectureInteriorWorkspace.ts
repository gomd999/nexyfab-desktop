import { createHash } from 'node:crypto';
import {
  validateArchitectureDocument,
  validateInteriorDocument,
  type ArchitectureDocument,
  type InteriorDocument,
} from './architectureInteriorDocuments';
import {
  DESIGN_ARTIFACT_GRAPH_SCHEMA,
  evaluateArtifactRelease,
  validateDesignArtifactGraph,
  type DesignArtifactGraph,
} from './designArtifactGraph';

export const ARCHITECTURE_INTERIOR_WORKSPACE_V2_SCHEMA = 'nexyfab.architecture-interior-workspace.v2' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_UNITS = new Set(['mm', 'cm', 'm', 'in', 'ft']);
const FRAME_KINDS = new Set(['project', 'site', 'building', 'storey', 'object']);
type V3 = [number, number, number];

export type WorkspaceUnitsV2 = {
  sourceUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  geometryUnit: 'mm';
  analysisUnit: 'SI';
};

export type WorkspaceTrackV2 = 'ai_design' | 'precision_cad';
export type WorkspaceMaturityV2 = 'concept' | 'exact' | 'release';
export type WorkspaceVerificationV2 = {
  status: 'passed' | 'failed' | 'not_run';
  verifierId: string;
  evidenceHash?: string;
  issues: string[];
};

export type WorkspaceCoordinateFrameV2 = {
  id: string;
  kind: 'project' | 'site' | 'building' | 'storey' | 'object';
  parentId?: string;
  originMm: V3;
  rotationDeg: V3;
  storeyId?: string;
  objectId?: string;
  documentId?: string;
};

export type WorkspaceGeometryEvidenceV2 = {
  representation: 'brep' | 'surface' | 'mesh' | 'bim' | 'procedural';
  units: 'mm';
  fidelity: 'conceptual' | 'exact_brep';
  verification: WorkspaceVerificationV2;
  contentHash: string;
  payload: unknown;
};

export type WorkspaceSemanticEvidenceV2 = {
  schema: string;
  contentHash: string;
  payload: unknown;
};

export type WorkspaceProvenanceV2 = {
  sourceId: string;
  kind: 'user' | 'ai' | 'import' | 'catalog' | 'expert';
  contentHash: string;
};

export type WorkspaceDomainEnvelopeV2<T> = {
  documentId: string;
  document: T;
  geometry: WorkspaceGeometryEvidenceV2;
  semantic: WorkspaceSemanticEvidenceV2;
  provenance: WorkspaceProvenanceV2[];
};

export type ArchitectureInteriorWorkspaceV2 = {
  schema: typeof ARCHITECTURE_INTERIOR_WORKSPACE_V2_SCHEMA;
  projectId: string;
  workspace: { projectId: string; revision: number; contentHash: string; track: WorkspaceTrackV2; maturity: WorkspaceMaturityV2 };
  contentHash: string;
  units: WorkspaceUnitsV2;
  coordinates: WorkspaceCoordinateFrameV2[];
  architecture: WorkspaceDomainEnvelopeV2<ArchitectureDocument>;
  interior: WorkspaceDomainEnvelopeV2<InteriorDocument>;
  artifactGraph: DesignArtifactGraph;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finiteV3(value: unknown): value is V3 {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('workspace_cycle');
    const next = new Set(ancestors).add(value);
    return `[${value.map(item => canonical(item, next)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw new Error('workspace_cycle');
    const next = new Set(ancestors).add(value);
    return `{${Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], next)}`).join(',')}}`;
  }
  return 'null';
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

function safeHashPayload(payload: unknown): string | null {
  try { return hashPayload(payload); } catch { return null; }
}

export function hashArchitectureInteriorEvidenceV2(payload: unknown): string {
  return hashPayload(payload);
}

/** Hash excludes only the two envelope hash fields, so all four evidence layers remain bound. */
export function hashArchitectureInteriorWorkspaceV2(envelope: ArchitectureInteriorWorkspaceV2): string {
  const copy = structuredClone(envelope) as ArchitectureInteriorWorkspaceV2;
  copy.contentHash = '';
  copy.workspace.contentHash = '';
  return hashPayload(copy);
}

function safeDocumentValidation(envelope: ArchitectureInteriorWorkspaceV2): string[] {
  try {
    return [
      ...validateArchitectureDocument(envelope.architecture.document).map((_, index) => `architecture_document_invalid:${index + 1}`),
      ...validateInteriorDocument(envelope.interior.document, envelope.architecture.document).map((_, index) => `interior_document_invalid:${index + 1}`),
    ];
  } catch {
    return ['document_validation_failed'];
  }
}

function validateEvidence(domain: WorkspaceDomainEnvelopeV2<unknown>, prefix: string): string[] {
  const issues: string[] = [];
  if (typeof domain.documentId !== 'string' || !domain.documentId.trim()) issues.push(`${prefix}_document_id_invalid`);
  const geometry = isRecord(domain.geometry) ? domain.geometry : null;
  if (!geometry || geometry.units !== 'mm' || !['brep', 'surface', 'mesh', 'bim', 'procedural'].includes(String(geometry.representation)) || !['conceptual', 'exact_brep'].includes(String(geometry.fidelity)) || !SHA256.test(String(geometry.contentHash)) || geometry.contentHash !== safeHashPayload(geometry.payload)) issues.push(`${prefix}_geometry_invalid`);
  const verification = geometry && isRecord(geometry.verification) ? geometry.verification : null;
  if (!verification || !['passed', 'failed', 'not_run'].includes(String(verification.status)) || typeof verification.verifierId !== 'string' || !verification.verifierId.trim() || !Array.isArray(verification.issues) || verification.issues.some(issue => typeof issue !== 'string' || !issue.trim()) || (verification.evidenceHash !== undefined && !SHA256.test(String(verification.evidenceHash))) || (verification.status === 'passed' && (!SHA256.test(String(verification.evidenceHash)) || verification.issues.length > 0)) || (verification.status !== 'passed' && verification.evidenceHash !== undefined)) issues.push(`${prefix}_geometry_verification_invalid`);
  if (!isRecord(domain.semantic) || typeof domain.semantic.schema !== 'string' || !domain.semantic.schema.trim() || !SHA256.test(String(domain.semantic.contentHash)) || domain.semantic.contentHash !== safeHashPayload(domain.semantic.payload)) issues.push(`${prefix}_semantic_invalid`);
  if (!Array.isArray(domain.provenance) || domain.provenance.length === 0) issues.push(`${prefix}_provenance_invalid`);
  else {
    const ids = new Set<string>();
    for (const item of domain.provenance) {
      if (!isRecord(item) || typeof item.sourceId !== 'string' || !item.sourceId.trim() || ids.has(item.sourceId) || !['user', 'ai', 'import', 'catalog', 'expert'].includes(String(item.kind)) || typeof item.contentHash !== 'string' || !SHA256.test(item.contentHash)) issues.push(`${prefix}_provenance_entry_invalid`);
      if (isRecord(item) && typeof item.sourceId === 'string') ids.add(item.sourceId);
    }
  }
  return issues;
}

function validateCoordinates(envelope: ArchitectureInteriorWorkspaceV2, objectIds: Map<string, string>): string[] {
  const issues: string[] = [];
  const frames = new Map<string, WorkspaceCoordinateFrameV2>();
  for (const frame of envelope.coordinates) {
    if (!isRecord(frame) || typeof frame.id !== 'string' || !frame.id.trim() || frames.has(frame.id) || !FRAME_KINDS.has(String(frame.kind)) || !finiteV3(frame.originMm) || !finiteV3(frame.rotationDeg)) issues.push('coordinate_frame_invalid');
    if (isRecord(frame) && typeof frame.id === 'string') frames.set(frame.id, frame as WorkspaceCoordinateFrameV2);
  }
  const framesByKind = (kind: WorkspaceCoordinateFrameV2['kind']) => [...frames.values()].filter(frame => frame.kind === kind);
  const projectFrames = framesByKind('project');
  const siteFrames = framesByKind('site');
  const buildingFrames = framesByKind('building');
  if (projectFrames.length !== 1) issues.push('coordinate_project_root_invalid');
  if (siteFrames.length !== 1) issues.push('coordinate_site_root_invalid');
  if (buildingFrames.length !== 1) issues.push('coordinate_building_root_invalid');
  const projectFrame = projectFrames[0];
  const siteFrame = siteFrames[0];
  const buildingFrame = buildingFrames[0];
  const storeyFrames = new Map<string, WorkspaceCoordinateFrameV2>();
  const objectFrames = new Map<string, WorkspaceCoordinateFrameV2>();
  for (const frame of frames.values()) {
    if (frame.kind === 'storey') {
      if (!frame.storeyId || storeyFrames.has(frame.storeyId)) issues.push('coordinate_storey_binding_invalid');
      else storeyFrames.set(frame.storeyId, frame);
    }
    if (frame.kind === 'object') {
      if (!frame.objectId || objectFrames.has(frame.objectId) || !objectIds.has(frame.objectId) || objectIds.get(frame.objectId) !== frame.documentId) issues.push('coordinate_object_binding_invalid');
      else objectFrames.set(frame.objectId, frame);
    }
  }
  const storeyIds = new Set(envelope.architecture.document.storeys.map(item => item.id));
  for (const id of storeyIds) if (!storeyFrames.has(id)) issues.push(`coordinate_storey_missing:${id}`);
  for (const id of objectIds.keys()) if (!objectFrames.has(id)) issues.push(`coordinate_object_missing:${id}`);
  for (const frame of frames.values()) {
    if (frame.kind === 'project' && frame.parentId) issues.push('project_coordinate_must_be_root');
    if (frame.kind !== 'project' && (!frame.parentId || !frames.has(frame.parentId))) issues.push('coordinate_parent_missing');
    const visited = new Set<string>();
    let current: WorkspaceCoordinateFrameV2 | undefined = frame;
    while (current) {
      if (visited.has(current.id)) { issues.push('coordinate_cycle'); break; }
      visited.add(current.id);
      current = current.parentId ? frames.get(current.parentId) : undefined;
    }
    if (frame.kind === 'site' && frame.parentId !== projectFrame?.id) issues.push('site_coordinate_parent_invalid');
    if (frame.kind === 'building' && frame.parentId !== siteFrame?.id) issues.push('building_coordinate_parent_invalid');
    if (frame.kind === 'storey' && frame.parentId !== buildingFrame?.id) issues.push('storey_coordinate_parent_invalid');
    if (frame.kind === 'object' && frame.parentId && !['building', ...[...storeyFrames.values()].map(item => item.id)].includes(frame.parentId)) issues.push('object_coordinate_parent_invalid');
  }
  return issues;
}

export function validateArchitectureInteriorWorkspaceV2(value: unknown): string[] {
  if (!isRecord(value)) return ['workspace_invalid'];
  const envelope = value as unknown as ArchitectureInteriorWorkspaceV2;
  const issues: string[] = [];
  if (envelope.schema !== ARCHITECTURE_INTERIOR_WORKSPACE_V2_SCHEMA || typeof envelope.projectId !== 'string' || !envelope.projectId.trim()) issues.push('workspace_header_invalid');
  if (!isRecord(envelope.workspace) || envelope.workspace.projectId !== envelope.projectId || !Number.isSafeInteger(envelope.workspace.revision) || envelope.workspace.revision < 0 || !SHA256.test(envelope.workspace.contentHash) || !SHA256.test(envelope.contentHash) || !['ai_design', 'precision_cad'].includes(String(envelope.workspace.track)) || !['concept', 'exact', 'release'].includes(String(envelope.workspace.maturity))) issues.push('workspace_binding_invalid');
  if (!isRecord(envelope.units) || !SOURCE_UNITS.has(String(envelope.units.sourceUnit)) || envelope.units.geometryUnit !== 'mm' || envelope.units.analysisUnit !== 'SI') issues.push('workspace_units_invalid');
  if (!Array.isArray(envelope.coordinates)) issues.push('coordinates_invalid');
  if (!isRecord(envelope.architecture) || !isRecord(envelope.interior)) issues.push('domain_envelope_missing');
  if (!envelope.artifactGraph || envelope.artifactGraph.schema !== DESIGN_ARTIFACT_GRAPH_SCHEMA) issues.push('artifact_graph_missing');
  if (!Array.isArray(envelope.coordinates) || !isRecord(envelope.architecture) || !isRecord(envelope.interior) || !isRecord(envelope.artifactGraph)) return [...new Set(issues)];
  const architectureDocument = envelope.architecture.document as unknown;
  const interiorDocument = envelope.interior.document as unknown;
  const architectureArrays = ['storeys', 'spaces', 'walls', 'slabs', 'ceilings', 'openings'];
  const interiorArrays = ['lights', 'furniture', 'finishes'];
  if (!isRecord(architectureDocument) || architectureArrays.some(key => !Array.isArray(architectureDocument[key])) || !isRecord(interiorDocument) || interiorArrays.some(key => !Array.isArray(interiorDocument[key]))) return [...new Set([...issues, 'document_shape_invalid'])];
  if (envelope.architecture.documentId === envelope.interior.documentId) issues.push('domain_document_id_collision');
  if (envelope.architecture.document.revision !== envelope.workspace.revision || envelope.interior.document.revision !== envelope.workspace.revision) issues.push('stale_domain_revision');
  if (envelope.interior.document.architectureDocumentId !== envelope.architecture.documentId) issues.push('architecture_document_binding_mismatch');
  if (envelope.interior.document.fieldMeasurement && envelope.interior.document.fieldMeasurement.architectureRevision !== envelope.architecture.document.revision) issues.push('stale_interior_field_measurement');
  if (envelope.artifactGraph.projectId !== envelope.projectId || envelope.artifactGraph.revision !== envelope.workspace.revision) issues.push('artifact_graph_binding_mismatch');
  const objectIds = new Map<string, string>();
  const registerObjects = (documentId: string, ids: string[]) => ids.forEach(id => { if (!id.trim() || objectIds.has(id)) issues.push('duplicate_object_id'); else objectIds.set(id, documentId); });
  registerObjects(envelope.architecture.documentId, [
    ...envelope.architecture.document.storeys, ...envelope.architecture.document.spaces, ...envelope.architecture.document.walls,
    ...envelope.architecture.document.slabs, ...envelope.architecture.document.ceilings, ...envelope.architecture.document.openings,
    ...(envelope.architecture.document.serviceOpenings ?? []), ...(envelope.architecture.document.grids ?? []), ...(envelope.architecture.document.roofs ?? []), ...(envelope.architecture.document.stairs ?? []), ...(envelope.architecture.document.shafts ?? []), ...(envelope.architecture.document.elevators ?? []), ...(envelope.architecture.document.zones ?? []),
  ].map(item => item.id));
  registerObjects(envelope.interior.documentId, [
    ...envelope.interior.document.lights, ...envelope.interior.document.furniture, ...envelope.interior.document.finishes,
    ...(envelope.interior.document.millwork ?? []), ...(envelope.interior.document.ceilingSystems ?? []), ...(envelope.interior.document.acousticZones ?? []),
  ].map(item => item.id));
  issues.push(...safeDocumentValidation(envelope));
  issues.push(...validateEvidence(envelope.architecture as WorkspaceDomainEnvelopeV2<unknown>, 'architecture'));
  issues.push(...validateEvidence(envelope.interior as WorkspaceDomainEnvelopeV2<unknown>, 'interior'));
  const strictGeometry = envelope.workspace.track === 'precision_cad' || envelope.workspace.maturity === 'exact' || envelope.workspace.maturity === 'release';
  for (const [prefix, domain] of [['architecture', envelope.architecture], ['interior', envelope.interior] ] as const) {
    const geometry = domain.geometry;
    const verification = geometry?.verification;
    if (strictGeometry && (geometry?.representation !== 'brep' || geometry?.fidelity !== 'exact_brep' || verification?.status !== 'passed' || !SHA256.test(verification?.evidenceHash ?? ''))) issues.push(`${prefix}_exact_geometry_verification_required`);
    if (strictGeometry && !envelope.artifactGraph.artifacts.some(artifact => artifact.kind === 'model' && artifact.contentHash === geometry?.contentHash && artifact.state === 'current' && artifact.verification.status === 'passed' && SHA256.test(artifact.verification.evidenceHash ?? ''))) issues.push(`${prefix}_geometry_artifact_binding_required`);
    if (envelope.workspace.maturity === 'release' && verification?.status === 'not_run') issues.push(`${prefix}_release_verification_required`);
  }
  if (envelope.workspace.maturity === 'release' && !evaluateArtifactRelease(envelope.artifactGraph).releaseReady) issues.push('artifact_release_required');
  issues.push(...validateCoordinates(envelope, objectIds));
  try {
    issues.push(...validateDesignArtifactGraph(envelope.artifactGraph));
    if (hashArchitectureInteriorWorkspaceV2(envelope) !== envelope.contentHash || envelope.workspace.contentHash !== envelope.contentHash) issues.push('workspace_content_hash_mismatch');
  } catch { issues.push('workspace_hash_invalid'); }
  return [...new Set(issues)];
}
