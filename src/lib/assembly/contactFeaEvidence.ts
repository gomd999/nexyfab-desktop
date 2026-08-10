import type { DesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import {
  commitArtifactRegeneration,
  validateDesignArtifactGraph,
  type ArtifactInputBinding,
  type DesignArtifactGraph,
} from '@/lib/ai/designArtifactGraph';

export const CONTACT_FEA_EVIDENCE_SCHEMA = 'nexyfab.contact-fea-evidence.v1' as const;

export interface PersistentBrepFaceEvidence {
  persistentFaceId: string;
  occtEntityId: number;
  geometryHash: string;
  surfaceType: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'bspline';
  areaMm2: number;
}

export interface BrepOccurrenceEvidence {
  occurrenceId: string;
  bodyId: string;
  shapeHash: string;
  transformHash: string;
  faces: PersistentBrepFaceEvidence[];
}

export interface BrepFaceReference {
  occurrenceId: string;
  persistentFaceId: string;
  geometryHash: string;
}

export interface BrepContactPatchEvidence {
  source: 'occt_section_extrema';
  geometryHash: string;
  areaMm2: number;
  minimumGapMm: number;
  maximumGapMm: number;
  maximumPenetrationMm: number;
  normal: [number, number, number];
  samplingToleranceMm: number;
}

export interface AssemblyContactEvidence {
  id: string;
  faceA: BrepFaceReference;
  faceB: BrepFaceReference;
  behavior: 'bonded' | 'frictionless' | 'frictional';
  frictionCoefficient: number;
  patch: BrepContactPatchEvidence;
}

export interface FastenerClampEvidence {
  id: string;
  occurrenceId: string;
  standardDesignation: string;
  axis: [number, number, number];
  nominalPreloadN: number;
  proofLoadN: number;
  preloadEvidenceHash: string;
  clampContactIds: string[];
}

export interface ContactFeaBoundaryCondition {
  id: string;
  kind: 'fixed' | 'force' | 'pressure' | 'gravity' | 'preload';
  occurrenceId: string;
  persistentFaceId?: string;
  magnitude?: number;
  evidenceHash: string;
}

export interface ContactFeaAnalysisEvidence {
  source: 'server_multibody_contact_fea';
  solverId: string;
  solverVersion: string;
  geometryEvidenceHash: string;
  meshHash: string;
  loadCaseHash: string;
  resultHash: string;
  evidenceHash: string;
  meshMode: 'boundary_conforming_tet' | 'brep_bound_hex';
  grade: 'engineering' | 'certification_candidate';
  converged: boolean;
  nonlinearIterations: number;
  equilibriumResidualRatio: number;
  energyErrorRatio: number;
  maxDisplacementMm: number;
  maxVonMisesMpa: number;
  boundaryConditions: ContactFeaBoundaryCondition[];
  contactResults: Array<{
    contactId: string;
    patchGeometryHash: string;
    activeNodeCount: number;
    maximumPressureMpa: number;
    resultantNormalForceN: number;
  }>;
  fastenerResults: Array<{
    fastenerId: string;
    preloadN: number;
    axialForceN: number;
    utilization: number;
  }>;
}

export interface ContactFeaEvidence {
  schema: typeof CONTACT_FEA_EVIDENCE_SCHEMA;
  projectId: string;
  lineageId: string;
  workspaceRevision: number;
  workspaceDocumentHash: string;
  geometryEvidenceHash: string;
  kernel: { id: 'occt'; version: string; buildHash: string };
  modelArtifact: ArtifactInputBinding;
  simulationArtifactId: string;
  occurrences: BrepOccurrenceEvidence[];
  contacts: AssemblyContactEvidence[];
  fasteners: FastenerClampEvidence[];
  analysis: ContactFeaAnalysisEvidence;
}

export interface ContactFeaVerification {
  integrationVerified: boolean;
  grade: ContactFeaAnalysisEvidence['grade'] | 'not_verified';
  issues: string[];
  contactIds: string[];
  fastenerIds: string[];
  loadPathVerified: boolean;
}

export interface ContactFeaArtifactCommit {
  committed: boolean;
  graph: DesignArtifactGraph;
  verification: ContactFeaVerification;
  issues: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const finite = (value: number) => Number.isFinite(value);
const validHash = (value: string | undefined) => typeof value === 'string' && SHA256.test(value);
const vectorLength = (value: [number, number, number]) => Math.hypot(...value);
const refKey = (occurrenceId: string, faceId: string) => `${occurrenceId}:${faceId}`;

function hasLoadPath(evidence: ContactFeaEvidence): boolean {
  const fixed = new Set(evidence.analysis.boundaryConditions.filter(item => item.kind === 'fixed').map(item => item.occurrenceId));
  const loaded = new Set(evidence.analysis.boundaryConditions.filter(item => item.kind !== 'fixed').map(item => item.occurrenceId));
  if (!fixed.size || !loaded.size) return false;
  const adjacency = new Map(evidence.occurrences.map(item => [item.occurrenceId, new Set<string>()]));
  for (const contact of evidence.contacts) {
    adjacency.get(contact.faceA.occurrenceId)?.add(contact.faceB.occurrenceId);
    adjacency.get(contact.faceB.occurrenceId)?.add(contact.faceA.occurrenceId);
  }
  for (const fastener of evidence.fasteners) {
    const connected = new Set<string>();
    for (const contactId of fastener.clampContactIds) {
      const contact = evidence.contacts.find(item => item.id === contactId);
      if (contact) { connected.add(contact.faceA.occurrenceId); connected.add(contact.faceB.occurrenceId); }
    }
    for (const occurrence of connected) {
      adjacency.get(fastener.occurrenceId)?.add(occurrence);
      adjacency.get(occurrence)?.add(fastener.occurrenceId);
    }
  }
  return [...loaded].every(start => {
    const visited = new Set([start]); const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      if (fixed.has(current)) return true;
      for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    return false;
  });
}

export function verifyContactFeaEvidence(
  evidence: ContactFeaEvidence,
  workspace: DesignWorkspaceRevision,
  graph: DesignArtifactGraph,
): ContactFeaVerification {
  const issues: string[] = [];
  if (evidence.schema !== CONTACT_FEA_EVIDENCE_SCHEMA || !evidence.projectId.trim() || !evidence.lineageId.trim()
    || !Number.isSafeInteger(evidence.workspaceRevision) || evidence.workspaceRevision < 0
    || !validHash(evidence.workspaceDocumentHash) || !validHash(evidence.geometryEvidenceHash)) issues.push('invalid_evidence_header');
  if (evidence.projectId !== workspace.projectId || evidence.lineageId !== workspace.lineageId
    || evidence.workspaceRevision !== workspace.revision || evidence.workspaceDocumentHash !== workspace.documentHash) issues.push('workspace_revision_binding_mismatch');
  if (evidence.projectId !== graph.projectId || validateDesignArtifactGraph(graph).filter(issue => !issue.startsWith('current_artifact_binding_mismatch:') && !issue.startsWith('current_artifact_depends_on_noncurrent:')).length) issues.push('invalid_artifact_graph_binding');
  if (evidence.kernel.id !== 'occt' || !evidence.kernel.version.trim() || !validHash(evidence.kernel.buildHash)) issues.push('unverified_brep_kernel');

  const model = graph.artifacts.find(item => item.id === evidence.modelArtifact.artifactId && item.kind === 'model');
  if (!model || model.revision !== evidence.modelArtifact.revision || model.contentHash !== evidence.modelArtifact.contentHash
    || model.state !== 'current' || model.verification.status !== 'passed') issues.push('model_artifact_binding_mismatch');
  if (!graph.artifacts.some(item => item.id === evidence.simulationArtifactId && item.kind === 'simulation')) issues.push('simulation_artifact_missing');

  const occurrenceIds = new Set<string>();
  const faces = new Map<string, PersistentBrepFaceEvidence>();
  for (const occurrence of evidence.occurrences) {
    if (!occurrence.occurrenceId.trim() || !occurrence.bodyId.trim() || occurrenceIds.has(occurrence.occurrenceId)
      || !validHash(occurrence.shapeHash) || !validHash(occurrence.transformHash) || !occurrence.faces.length) issues.push(`invalid_occurrence:${occurrence.occurrenceId}`);
    occurrenceIds.add(occurrence.occurrenceId);
    for (const face of occurrence.faces) {
      const key = refKey(occurrence.occurrenceId, face.persistentFaceId);
      if (!face.persistentFaceId.trim() || faces.has(key) || !Number.isSafeInteger(face.occtEntityId) || face.occtEntityId <= 0
        || !validHash(face.geometryHash) || !finite(face.areaMm2) || face.areaMm2 <= 0) issues.push(`invalid_brep_face:${key}`);
      faces.set(key, face);
    }
  }

  const contactIds = new Set<string>();
  for (const contact of evidence.contacts) {
    const faceA = faces.get(refKey(contact.faceA.occurrenceId, contact.faceA.persistentFaceId));
    const faceB = faces.get(refKey(contact.faceB.occurrenceId, contact.faceB.persistentFaceId));
    if (!contact.id.trim() || contactIds.has(contact.id) || contact.faceA.occurrenceId === contact.faceB.occurrenceId) issues.push(`invalid_contact:${contact.id}`);
    if (!faceA || faceA.geometryHash !== contact.faceA.geometryHash || !faceB || faceB.geometryHash !== contact.faceB.geometryHash) issues.push(`contact_face_binding_mismatch:${contact.id}`);
    const patch = contact.patch;
    if (patch.source !== 'occt_section_extrema' || !validHash(patch.geometryHash)
      || !finite(patch.areaMm2) || patch.areaMm2 <= 0
      || ![patch.minimumGapMm, patch.maximumGapMm, patch.maximumPenetrationMm, patch.samplingToleranceMm].every(finite)
      || patch.minimumGapMm > patch.maximumGapMm || patch.maximumPenetrationMm < 0 || patch.samplingToleranceMm <= 0
      || Math.abs(vectorLength(patch.normal) - 1) > 1e-6) issues.push(`invalid_brep_contact_patch:${contact.id}`);
    if (!finite(contact.frictionCoefficient) || contact.frictionCoefficient < 0 || contact.frictionCoefficient > 2
      || (contact.behavior === 'frictionless' && contact.frictionCoefficient !== 0)
      || (contact.behavior === 'frictional' && contact.frictionCoefficient <= 0)) issues.push(`invalid_contact_behavior:${contact.id}`);
    contactIds.add(contact.id);
  }
  if (!contactIds.size) issues.push('brep_contact_required');

  const fastenerIds = new Set<string>();
  for (const fastener of evidence.fasteners) {
    if (!fastener.id.trim() || fastenerIds.has(fastener.id) || !occurrenceIds.has(fastener.occurrenceId)
      || !fastener.standardDesignation.trim() || Math.abs(vectorLength(fastener.axis) - 1) > 1e-6
      || !finite(fastener.nominalPreloadN) || !finite(fastener.proofLoadN) || fastener.nominalPreloadN <= 0
      || fastener.proofLoadN <= 0 || fastener.nominalPreloadN > fastener.proofLoadN
      || !validHash(fastener.preloadEvidenceHash) || !fastener.clampContactIds.length
      || fastener.clampContactIds.some(id => !contactIds.has(id))) issues.push(`invalid_fastener:${fastener.id}`);
    fastenerIds.add(fastener.id);
  }

  const analysis = evidence.analysis;
  if (analysis.source !== 'server_multibody_contact_fea' || !analysis.solverId.trim() || !analysis.solverVersion.trim()
    || analysis.geometryEvidenceHash !== evidence.geometryEvidenceHash
    || ![analysis.meshHash, analysis.loadCaseHash, analysis.resultHash, analysis.evidenceHash].every(validHash)
    || !['boundary_conforming_tet', 'brep_bound_hex'].includes(analysis.meshMode)
    || !['engineering', 'certification_candidate'].includes(analysis.grade)
    || !analysis.converged || !Number.isSafeInteger(analysis.nonlinearIterations) || analysis.nonlinearIterations <= 0
    || ![analysis.equilibriumResidualRatio, analysis.energyErrorRatio, analysis.maxDisplacementMm, analysis.maxVonMisesMpa].every(finite)
    || analysis.equilibriumResidualRatio < 0 || analysis.equilibriumResidualRatio > 1e-3
    || analysis.energyErrorRatio < 0 || analysis.energyErrorRatio > 0.05
    || analysis.maxDisplacementMm < 0 || analysis.maxVonMisesMpa < 0) issues.push('invalid_or_unconverged_multibody_analysis');
  const resultContacts = new Set(analysis.contactResults.map(item => item.contactId));
  if (resultContacts.size !== contactIds.size || [...contactIds].some(id => !resultContacts.has(id))) issues.push('contact_result_coverage_mismatch');
  for (const result of analysis.contactResults) {
    const contact = evidence.contacts.find(item => item.id === result.contactId);
    if (!contact || result.patchGeometryHash !== contact.patch.geometryHash || !Number.isSafeInteger(result.activeNodeCount)
      || result.activeNodeCount <= 0 || !finite(result.maximumPressureMpa) || result.maximumPressureMpa < 0
      || !finite(result.resultantNormalForceN) || result.resultantNormalForceN < 0) issues.push(`invalid_contact_result:${result.contactId}`);
  }
  const resultFasteners = new Set(analysis.fastenerResults.map(item => item.fastenerId));
  if (resultFasteners.size !== fastenerIds.size || [...fastenerIds].some(id => !resultFasteners.has(id))) issues.push('fastener_result_coverage_mismatch');
  for (const result of analysis.fastenerResults) {
    const fastener = evidence.fasteners.find(item => item.id === result.fastenerId);
    if (!fastener || ![result.preloadN, result.axialForceN, result.utilization].every(finite)
      || result.preloadN <= 0 || Math.abs(result.preloadN - fastener.nominalPreloadN) > Math.max(1, fastener.nominalPreloadN * 1e-6)
      || result.axialForceN < 0 || result.utilization < 0 || result.utilization > 1) issues.push(`invalid_fastener_result:${result.fastenerId}`);
  }
  for (const condition of analysis.boundaryConditions) {
    if (!condition.id.trim() || !occurrenceIds.has(condition.occurrenceId) || !validHash(condition.evidenceHash)
      || (condition.persistentFaceId !== undefined && !faces.has(refKey(condition.occurrenceId, condition.persistentFaceId)))
      || (condition.magnitude !== undefined && !finite(condition.magnitude))) issues.push(`invalid_boundary_condition:${condition.id}`);
  }
  const loadPathVerified = hasLoadPath(evidence);
  if (!loadPathVerified) issues.push('fixed_to_load_contact_path_missing');
  return {
    integrationVerified: issues.length === 0,
    grade: issues.length === 0 ? analysis.grade : 'not_verified',
    issues: [...new Set(issues)],
    contactIds: [...contactIds].sort(),
    fastenerIds: [...fastenerIds].sort(),
    loadPathVerified,
  };
}

export function commitContactFeaSimulation(
  evidence: ContactFeaEvidence,
  workspace: DesignWorkspaceRevision,
  graph: DesignArtifactGraph,
): ContactFeaArtifactCommit {
  const verification = verifyContactFeaEvidence(evidence, workspace, graph);
  if (!verification.integrationVerified) return { committed: false, graph, verification, issues: verification.issues };
  const simulation = graph.artifacts.find(item => item.id === evidence.simulationArtifactId);
  if (!simulation || simulation.state === 'current') return { committed: false, graph, verification, issues: ['simulation_artifact_not_stale'] };
  const expectedInputs = graph.dependencies
    .filter(edge => edge.targetId === simulation.id && edge.policy !== 'notify')
    .map(edge => graph.artifacts.find(item => item.id === edge.sourceId))
    .filter((item): item is NonNullable<typeof item> => !!item)
    .map(item => ({ artifactId: item.id, revision: item.revision, contentHash: item.contentHash }));
  const commit = commitArtifactRegeneration(graph, graph.revision, [{
    artifactId: simulation.id,
    expectedRevision: simulation.revision,
    contentHash: evidence.analysis.resultHash,
    inputs: expectedInputs,
    verification: { status: 'passed', verifierId: evidence.analysis.solverId, evidenceHash: evidence.analysis.evidenceHash, issues: [] },
  }]);
  return { committed: commit.committed, graph: commit.graph, verification, issues: commit.issues };
}
