import {
  validateArchitectureDocument,
  validateInteriorDocument,
  type ArchitectureDocument,
  type InteriorDocument,
} from './architectureInteriorDocuments';
import {
  ARCHITECTURE_INTERIOR_WORKSPACE_V2_SCHEMA,
  hashArchitectureInteriorEvidenceV2,
  hashArchitectureInteriorWorkspaceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
  type WorkspaceCoordinateFrameV2,
} from './architectureInteriorWorkspace';
import type { DesignArtifactGraph, DesignArtifactNode } from './designArtifactGraph';
import type { CompiledArchitectureInteriorConcept } from './architectureInteriorAiDesignProposal';

export const ARCHITECTURE_INTERIOR_AI_CANDIDATE_WORKSPACE_SCHEMA = 'nexyfab.architecture-interior-ai-candidate-workspace.v1' as const;

export type ArchitectureInteriorAiCandidateApprovalBinding = {
  projectId: string;
  proposalId: string;
  proposalHash: string;
  actorId: string;
  scope: 'architecture_interior_concept';
};

export type ArchitectureInteriorAiCandidateWorkspaceInput = {
  candidate: CompiledArchitectureInteriorConcept;
  approval: ArchitectureInteriorAiCandidateApprovalBinding;
};

export type ArchitectureInteriorAiCandidateWorkspaceCode =
  | 'candidate_invalid'
  | 'approval_invalid'
  | 'project_mismatch'
  | 'proposal_mismatch'
  | 'candidate_hash_mismatch'
  | 'candidate_provenance_mismatch'
  | 'candidate_unsafe'
  | 'workspace_exists_not_supported';

export type ArchitectureInteriorAiCandidateWorkspaceResult =
  | { ok: true; workspace: ArchitectureInteriorWorkspaceV2; workspaceSchema: typeof ARCHITECTURE_INTERIOR_AI_CANDIDATE_WORKSPACE_SCHEMA }
  | { ok: false; code: ArchitectureInteriorAiCandidateWorkspaceCode; issues: string[] };

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MAX_COORDINATE_MM = 1_000_000_000;
const MAX_NODES = 20_000;
const FORBIDDEN_TEXT = /(?:https?:\/\/|file:\/\/|[A-Za-z]:\\|(?:^|[^a-z])(?:api[_-]?key|secret|bearer|password|token)(?:[^a-z]|$)|(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9]{8,})/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value) && !FORBIDDEN_TEXT.test(value);
}

function scanCandidate(value: unknown, path = '$', depth = 0, state = { nodes: 0 }): string[] {
  const issues: string[] = [];
  if (++state.nodes > MAX_NODES) return [`${path}:count_limit_exceeded`];
  if (depth > 64) return [`${path}:depth_limit_exceeded`];
  if (typeof value === 'string') {
    if (value.length > 256 || FORBIDDEN_TEXT.test(value)) issues.push(`${path}:unsafe_string`);
    return issues;
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE_MM)) issues.push(`${path}:coordinate_out_of_bounds`);
  if (Array.isArray(value)) value.forEach((item, index) => issues.push(...scanCandidate(item, `${path}[${index}]`, depth + 1, state)));
  else if (isRecord(value)) Object.keys(value).forEach(key => issues.push(...scanCandidate(value[key], `${path}.${key}`, depth + 1, state)));
  return issues;
}

function objectEntries(architecture: ArchitectureDocument, interior: InteriorDocument): Array<{ id: string; documentId: string; storeyId?: string; originMm: [number, number, number] }> {
  const storeyById = new Map(architecture.storeys.map(item => [item.id, item]));
  const spaceById = new Map(architecture.spaces.map(item => [item.id, item]));
  const wallById = new Map(architecture.walls.map(item => [item.id, item]));
  const archId = interior.architectureDocumentId;
  const result: Array<{ id: string; documentId: string; storeyId?: string; originMm: [number, number, number] }> = [];
  const add = (id: string, documentId: string, storeyId: string | undefined, originMm: [number, number, number]) => result.push({ id, documentId, storeyId, originMm });
  for (const storey of architecture.storeys) add(storey.id, archId, storey.id, [0, 0, storey.elevationMm]);
  for (const space of architecture.spaces) add(space.id, archId, space.storeyId, [space.boundaryMm[0]?.[0] ?? 0, space.boundaryMm[0]?.[1] ?? 0, storeyById.get(space.storeyId)?.elevationMm ?? 0]);
  for (const wall of architecture.walls) add(wall.id, archId, wall.storeyId, wall.kind === 'line' ? [wall.startMm[0], wall.startMm[1], storeyById.get(wall.storeyId)?.elevationMm ?? 0] : [wall.centerMm[0], wall.centerMm[1], storeyById.get(wall.storeyId)?.elevationMm ?? 0]);
  for (const slab of architecture.slabs) add(slab.id, archId, slab.storeyId, [slab.boundaryMm[0]?.[0] ?? 0, slab.boundaryMm[0]?.[1] ?? 0, storeyById.get(slab.storeyId)?.elevationMm ?? 0]);
  for (const ceiling of architecture.ceilings) add(ceiling.id, archId, ceiling.storeyId, [ceiling.boundaryMm[0]?.[0] ?? 0, ceiling.boundaryMm[0]?.[1] ?? 0, ceiling.elevationMm]);
  for (const opening of architecture.openings) { const wall = wallById.get(opening.hostWallId); add(opening.id, archId, wall?.storeyId, [...opening.positionMm] as [number, number, number]); }
  for (const opening of architecture.serviceOpenings ?? []) { const wall = wallById.get(opening.hostId); const slab = architecture.slabs.find(item => item.id === opening.hostId); add(opening.id, archId, wall?.storeyId ?? slab?.storeyId, [...opening.centerMm] as [number, number, number]); }
  for (const grid of architecture.grids ?? []) add(grid.id, archId, undefined, [grid.startMm[0], grid.startMm[1], 0]);
  for (const roof of architecture.roofs ?? []) add(roof.id, archId, roof.storeyId, [roof.boundaryMm[0]?.[0] ?? 0, roof.boundaryMm[0]?.[1] ?? 0, roof.baseElevationMm]);
  for (const stair of architecture.stairs ?? []) add(stair.id, archId, stair.fromStoreyId, [...(stair.pathMm[0] ?? [0, 0, 0])] as [number, number, number]);
  for (const shaft of architecture.shafts ?? []) add(shaft.id, archId, shaft.fromStoreyId, [...(shaft.boundaryMm[0] ?? [0, 0]), storeyById.get(shaft.fromStoreyId)?.elevationMm ?? 0] as [number, number, number]);
  for (const elevator of architecture.elevators ?? []) add(elevator.id, archId, elevator.servedStoreyIds[0], [0, 0, storeyById.get(elevator.servedStoreyIds[0] ?? '')?.elevationMm ?? 0]);
  for (const zone of architecture.zones ?? []) { const space = spaceById.get(zone.spaceIds[0] ?? ''); add(zone.id, archId, space?.storeyId, [0, 0, storeyById.get(space?.storeyId ?? '')?.elevationMm ?? 0]); }
  const interiorId = `interior:${hashArchitectureInteriorEvidenceV2(interior).slice(0, 32)}`;
  for (const item of interior.lights) add(item.id, interiorId, spaceById.get(item.spaceId)?.storeyId, [...item.positionMm] as [number, number, number]);
  for (const item of interior.furniture) add(item.id, interiorId, spaceById.get(item.spaceId)?.storeyId, [...item.positionMm] as [number, number, number]);
  for (const item of interior.finishes) add(item.id, interiorId, spaceById.get(item.spaceId)?.storeyId, [0, 0, storeyById.get(spaceById.get(item.spaceId)?.storeyId ?? '')?.elevationMm ?? 0]);
  for (const item of interior.millwork ?? []) add(item.id, interiorId, spaceById.get(item.spaceId)?.storeyId, [...item.positionMm] as [number, number, number]);
  for (const item of interior.ceilingSystems ?? []) add(item.id, interiorId, spaceById.get(item.spaceId)?.storeyId, [0, 0, item.elevationMm]);
  for (const item of interior.acousticZones ?? []) add(item.id, interiorId, spaceById.get(item.spaceId)?.storeyId, [0, 0, storeyById.get(spaceById.get(item.spaceId)?.storeyId ?? '')?.elevationMm ?? 0]);
  return result;
}

function conceptualGeometry(document: ArchitectureDocument | InteriorDocument, domain: 'architecture' | 'interior') {
  const payload = { schema: `nexyfab.${domain}-conceptual-geometry.v1`, source: structuredClone(document) };
  return {
    representation: domain === 'architecture' ? 'bim' as const : 'procedural' as const,
    units: 'mm' as const,
    fidelity: 'conceptual' as const,
    verification: { status: 'not_run' as const, verifierId: 'ai-candidate-concept-gate.v1', issues: ['exact_geometry_verification_not_run', 'code_compliance_not_evaluated'] },
    contentHash: hashArchitectureInteriorEvidenceV2(payload),
    payload,
  };
}

function modelArtifact(id: string, domain: 'architecture' | 'interior', geometryHash: string, binding: { projectId: string; proposalHash: string; revision: number }): DesignArtifactNode {
  const evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.ai-candidate-model-binding.v1', id, domain, geometryHash, binding });
  return { id, kind: 'model', revision: binding.revision, contentHash: geometryHash, state: 'current', inputs: [], verification: { status: 'passed', verifierId: 'ai-candidate-model-schema.v1', evidenceHash, issues: [] }, staleBecause: [] };
}

function failure(code: ArchitectureInteriorAiCandidateWorkspaceCode, ...issues: string[]): ArchitectureInteriorAiCandidateWorkspaceResult {
  return { ok: false, code, issues };
}

export function bootstrapArchitectureInteriorAiCandidateWorkspace(input: ArchitectureInteriorAiCandidateWorkspaceInput): ArchitectureInteriorAiCandidateWorkspaceResult {
  const candidate = input?.candidate;
  const approval = input?.approval;
  if (!candidate || !isRecord(candidate) || !approval || !isRecord(approval)) return failure('candidate_invalid', 'candidate_and_approval_are_required');
  const candidateIssues = scanCandidate(candidate);
  if (candidateIssues.length) return failure('candidate_unsafe', ...candidateIssues.slice(0, 32));
  if (!isSafeId(approval.projectId) || !isSafeId(approval.proposalId) || !isSafeId(approval.actorId) || approval.scope !== 'architecture_interior_concept' || !SHA256.test(approval.proposalHash)) return failure('approval_invalid', 'approval_binding_invalid');
  if (!isRecord(candidate.architecture) || !isRecord(candidate.interior) || !isRecord(candidate.coordinateFrame)
    || !Array.isArray(candidate.coordinateFrame.originMm) || candidate.coordinateFrame.originMm.length !== 3
    || !Array.isArray(candidate.coordinateFrame.rotationDeg) || candidate.coordinateFrame.rotationDeg.length !== 3
    || !isRecord(candidate.hashes) || !isRecord(candidate.provenance)
    || !Array.isArray(candidate.provenance.architecture) || !Array.isArray(candidate.provenance.interior)) {
    return failure('candidate_invalid', 'candidate_binding_shape_invalid');
  }
  if (candidate.hashes?.proposal !== approval.proposalHash) return failure('proposal_mismatch', 'approval_proposal_hash_mismatch');
  if (candidate.interior.architectureDocumentId !== `architecture:${approval.projectId}:${approval.proposalId}`) return failure('project_mismatch', 'compiled_architecture_document_binding_mismatch');
  if (candidate.architecture.revision !== 0 || candidate.interior.revision !== 0) return failure('candidate_invalid', 'candidate_documents_must_start_at_revision_zero');
  if (!SHA256.test(candidate.hashes.architecture) || candidate.hashes.architecture !== hashArchitectureInteriorEvidenceV2(candidate.architecture)) return failure('candidate_hash_mismatch', 'architecture_hash_mismatch');
  if (!SHA256.test(candidate.hashes.interior) || candidate.hashes.interior !== hashArchitectureInteriorEvidenceV2(candidate.interior)) return failure('candidate_hash_mismatch', 'interior_hash_mismatch');
  const expectedSource = `proposal:${approval.proposalHash}`;
  if (!candidate.provenance.architecture.some(item => item?.sourceId === expectedSource && item?.kind === 'ai' && item?.contentHash === approval.proposalHash) || !candidate.provenance.interior.some(item => item?.sourceId === expectedSource && item?.kind === 'ai' && item?.contentHash === approval.proposalHash)) return failure('candidate_provenance_mismatch', 'candidate_provenance_not_bound_to_approved_proposal');
  const documentIssues = [...validateArchitectureDocument(candidate.architecture), ...validateInteriorDocument(candidate.interior, candidate.architecture)];
  if (documentIssues.length) return failure('candidate_invalid', ...documentIssues.slice(0, 32));
  const architectureDocumentId = candidate.interior.architectureDocumentId;
  const interiorDocumentId = `interior:${hashArchitectureInteriorEvidenceV2(candidate.interior).slice(0, 32)}`;
  const entries = objectEntries(candidate.architecture, candidate.interior);
  const seen = new Set<string>();
  if (entries.some(entry => !isSafeId(entry.id) || seen.has(entry.id) || !entry.originMm.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM))) return failure('candidate_invalid', 'object_identity_or_coordinate_invalid');
  entries.forEach(entry => seen.add(entry.id));
  const frameId = candidate.coordinateFrame.id;
  if (!isSafeId(frameId) || !candidate.coordinateFrame.originMm.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM) || !candidate.coordinateFrame.rotationDeg.every(value => Number.isFinite(value) && Math.abs(value) <= 360)) return failure('candidate_invalid', 'coordinate_frame_invalid');
  const storeyFrame = new Map(candidate.architecture.storeys.map(item => [item.id, `${frameId}:storey:${item.id}`]));
  const projectFrame: WorkspaceCoordinateFrameV2 = { id: frameId, kind: 'project', originMm: [...candidate.coordinateFrame.originMm] as [number, number, number], rotationDeg: [...candidate.coordinateFrame.rotationDeg] as [number, number, number] };
  const siteFrame: WorkspaceCoordinateFrameV2 = { id: `${frameId}:site`, kind: 'site', parentId: frameId, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] };
  const buildingFrame: WorkspaceCoordinateFrameV2 = { id: `${frameId}:building`, kind: 'building', parentId: siteFrame.id, originMm: [0, 0, 0], rotationDeg: [0, 0, 0] };
  const coordinates: WorkspaceCoordinateFrameV2[] = [projectFrame, siteFrame, buildingFrame];
  for (const storey of candidate.architecture.storeys) coordinates.push({ id: storeyFrame.get(storey.id)!, kind: 'storey', parentId: buildingFrame.id, storeyId: storey.id, originMm: [0, 0, storey.elevationMm], rotationDeg: [0, 0, 0] });
  for (const entry of entries) {
    const storeyElevation = entry.storeyId === undefined ? 0 : candidate.architecture.storeys.find(storey => storey.id === entry.storeyId)?.elevationMm ?? 0;
    // Storey frames carry their elevation. Child object origins are therefore
    // local to that frame, avoiding a second application of the storey Z.
    const localOrigin: [number, number, number] = [entry.originMm[0], entry.originMm[1], entry.originMm[2] - storeyElevation];
    coordinates.push({ id: `${frameId}:object:${entry.id}`, kind: 'object', parentId: entry.storeyId ? storeyFrame.get(entry.storeyId) : buildingFrame.id, objectId: entry.id, documentId: entry.documentId === architectureDocumentId ? architectureDocumentId : interiorDocumentId, originMm: localOrigin, rotationDeg: [0, 0, 0] });
  }
  const architectureGeometry = conceptualGeometry(candidate.architecture, 'architecture');
  const interiorGeometry = conceptualGeometry(candidate.interior, 'interior');
  const architectureSemanticPayload = { schema: 'nexyfab.architecture.v1.semantic.v2', document: structuredClone(candidate.architecture) };
  const interiorSemanticPayload = { schema: 'nexyfab.interior.v1.semantic.v2', document: structuredClone(candidate.interior) };
  const architectureArtifact = modelArtifact(`model:architecture:${approval.proposalHash.slice(0, 24)}`, 'architecture', architectureGeometry.contentHash, { projectId: approval.projectId, proposalHash: approval.proposalHash, revision: 0 });
  const interiorArtifact = modelArtifact(`model:interior:${approval.proposalHash.slice(0, 24)}`, 'interior', interiorGeometry.contentHash, { projectId: approval.projectId, proposalHash: approval.proposalHash, revision: 0 });
  const artifactGraph: DesignArtifactGraph = { schema: 'nexyfab.design-artifact-graph.v1', projectId: approval.projectId, revision: 0, artifacts: [architectureArtifact, interiorArtifact], dependencies: [] };
  const draft = {
    schema: ARCHITECTURE_INTERIOR_WORKSPACE_V2_SCHEMA,
    projectId: approval.projectId,
    workspace: { projectId: approval.projectId, revision: 0, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const },
    contentHash: '',
    units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const },
    coordinates,
    architecture: { documentId: architectureDocumentId, document: structuredClone(candidate.architecture), geometry: architectureGeometry, semantic: { schema: architectureSemanticPayload.schema, contentHash: hashArchitectureInteriorEvidenceV2(architectureSemanticPayload), payload: architectureSemanticPayload }, provenance: [{ sourceId: expectedSource, kind: 'ai' as const, contentHash: approval.proposalHash }] },
    interior: { documentId: interiorDocumentId, document: structuredClone(candidate.interior), geometry: interiorGeometry, semantic: { schema: interiorSemanticPayload.schema, contentHash: hashArchitectureInteriorEvidenceV2(interiorSemanticPayload), payload: interiorSemanticPayload }, provenance: [{ sourceId: expectedSource, kind: 'ai' as const, contentHash: approval.proposalHash }] },
    artifactGraph,
  } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  const workspace = { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
  const workspaceIssues = validateArchitectureInteriorWorkspaceV2(workspace);
  if (workspaceIssues.length) return failure('candidate_invalid', ...workspaceIssues.slice(0, 32));
  return { ok: true, workspace, workspaceSchema: ARCHITECTURE_INTERIOR_AI_CANDIDATE_WORKSPACE_SCHEMA };
}

export const createArchitectureInteriorAiCandidateWorkspace = bootstrapArchitectureInteriorAiCandidateWorkspace;
