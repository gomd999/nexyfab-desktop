import type { CrossDomainVerificationResult } from './crossDomainVerification';
import type { DomainAccuracyAssertionResult } from './domainAccuracyEvidence';
import type { DomainEvidenceAxis } from './domainProfile';
import { evaluateArtifactRelease } from './designArtifactGraph';
import {
  validateArchitectureDocument,
  type ArchitectureDocument,
} from './architectureInteriorDocuments';
import { verifyArchitectureTopology } from './architectureTopologyVerification';
import type { IfcDeepSemanticRoundtripReport } from '@/lib/bim/ifcDeepSemanticRoundtrip';
import {
  hashCadPayload,
  validateCadWorkspaceEnvelope,
  type CadWorkspaceEnvelopeInput,
} from '@/lib/cad/workspaceRevisionStore';

export type BuildingEvidenceStatus = 'pass' | 'fail' | 'not_run';

export interface BoundBuildingEvidence<T> {
  workspaceRevision: number;
  modelContentHash: string;
  contentHash: string;
  payload: T;
}

export interface BuildingSiteCoordinateEvidence {
  status: BuildingEvidenceStatus;
  linearUnit: 'mm';
  angularUnit: 'deg';
  crsId: string;
  verticalDatumId: string;
  projectNorthDeg: number;
  projectToWorld: number[];
  issues: string[];
  artifactHashes: string[];
}

export interface BuildingAxisEvidence {
  status: BuildingEvidenceStatus;
  expected: number;
  checked: number;
  issues: string[];
  artifactHashes: string[];
}

export interface BuildingDeliverableEvidence extends BuildingAxisEvidence {
  requiredDrawings: number;
  verifiedDrawings: number;
  expectedScheduleRows: number;
  verifiedScheduleRows: number;
  expectedQuantityItems: number;
  verifiedQuantityItems: number;
}

export interface BuildingRegistryPolicyEvidence {
  status: 'approved' | 'quarantined';
  usedForRelease: boolean;
  sourceIssueCount: number;
  approvalId?: string;
  issues: string[];
  artifactHashes: string[];
}

export interface BuildingReleaseCertificateInput {
  workspace: CadWorkspaceEnvelopeInput;
  siteCoordinates?: BoundBuildingEvidence<BuildingSiteCoordinateEvidence>;
  crossDomain?: BoundBuildingEvidence<CrossDomainVerificationResult>;
  accessibility?: BoundBuildingEvidence<BuildingAxisEvidence>;
  envelopeContinuity?: BoundBuildingEvidence<BuildingAxisEvidence>;
  ifcRoundtrip?: BoundBuildingEvidence<IfcDeepSemanticRoundtripReport>;
  deliverables?: BoundBuildingEvidence<BuildingDeliverableEvidence>;
  repair?: BoundBuildingEvidence<BuildingAxisEvidence>;
  registryPolicy?: BoundBuildingEvidence<BuildingRegistryPolicyEvidence>;
}

export interface BuildingReleaseCertificate {
  schema: 'nexyfab.building-release-certificate.v1';
  workspaceRevision: number;
  modelContentHash: string;
  status: BuildingEvidenceStatus;
  /** Internal structural/readiness result only; commercial release requires the external qualification contract. */
  internalReady?: boolean;
  releaseReady: false;
  assertions: DomainAccuracyAssertionResult[];
  issues: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const rank: Record<BuildingEvidenceStatus, number> = { pass: 0, not_run: 1, fail: 2 };
const normalized = (value: 'passed' | 'failed' | 'not_run'): BuildingEvidenceStatus =>
  value === 'passed' ? 'pass' : value === 'failed' ? 'fail' : 'not_run';

function bind<T>(name: string, value: BoundBuildingEvidence<T> | undefined, workspace: CadWorkspaceEnvelopeInput) {
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.`, payload: undefined };
  const issues: string[] = [];
  if (value.workspaceRevision !== workspace.workspace.revision) issues.push('workspace_revision_mismatch');
  if (value.modelContentHash !== workspace.geometry.contentHash) issues.push('model_content_hash_mismatch');
  if (!SHA256.test(value.contentHash) || value.contentHash !== hashCadPayload(value.payload)) issues.push('payload_hash_mismatch');
  return issues.length
    ? { status: 'fail' as const, reason: `${name}: ${issues.join(',')}`, payload: undefined }
    : { status: 'pass' as const, reason: `${name}: exact workspace revision and model hash are bound.`, payload: value.payload };
}

function explicit(
  name: string,
  binding: ReturnType<typeof bind>,
  value: BuildingAxisEvidence | undefined,
  extraValid = true,
) {
  if (binding.status !== 'pass') return binding;
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.` };
  const valid = Number.isSafeInteger(value.expected) && value.expected > 0
    && value.checked === value.expected && value.artifactHashes.length > 0
    && value.artifactHashes.every(hash => SHA256.test(hash)) && extraValid;
  return {
    status: (valid ? value.status : 'fail') as BuildingEvidenceStatus,
    reason: `${name}: ${valid ? `${value.checked}/${value.expected}` : 'invalid_structured_evidence'}${value.issues.length ? `,${value.issues.join(',')}` : ''}`,
  };
}

function merge(values: DomainAccuracyAssertionResult[]): DomainAccuracyAssertionResult[] {
  const grouped = new Map<DomainEvidenceAxis, DomainAccuracyAssertionResult[]>();
  for (const value of values) grouped.set(value.axis, [...(grouped.get(value.axis) ?? []), value]);
  return [...grouped.entries()].map(([axis, items]) => ({
    axis,
    status: items.reduce<BuildingEvidenceStatus>((worst, item) => rank[item.status] > rank[worst] ? item.status : worst, 'pass'),
    reason: items.map(item => item.reason).join(' | '),
  }));
}

/** Fail-closed 20-axis release boundary for building/BIM workspaces. */
export function buildBuildingReleaseCertificate(input: BuildingReleaseCertificateInput): BuildingReleaseCertificate {
  const workspaceIssues = validateCadWorkspaceEnvelope(input.workspace);
  if (input.workspace.workspace.domain !== 'building') workspaceIssues.push('workspace_domain_not_building');
  const document = input.workspace.semanticDocument.payload as ArchitectureDocument;
  const documentIssues = workspaceIssues.length ? [] : validateArchitectureDocument(document);
  const workspaceStatus: BuildingEvidenceStatus = workspaceIssues.length || documentIssues.length ? 'fail' : 'pass';
  const workspaceReason = workspaceStatus === 'pass'
    ? 'workspace: exact architecture semantics, geometry, relations, provenance and revision are valid.'
    : `workspace: ${[...workspaceIssues, ...documentIssues].join(',')}`;
  const topology = workspaceStatus === 'pass' ? verifyArchitectureTopology(document) : undefined;

  const siteBinding = bind('site_coordinates', input.siteCoordinates, input.workspace);
  const crossBinding = bind('cross_domain', input.crossDomain, input.workspace);
  const accessibilityBinding = bind('accessibility', input.accessibility, input.workspace);
  const envelopeBinding = bind('envelope_continuity', input.envelopeContinuity, input.workspace);
  const ifcBinding = bind('ifc_roundtrip', input.ifcRoundtrip, input.workspace);
  const deliverableBinding = bind('deliverables', input.deliverables, input.workspace);
  const repairBinding = bind('repair', input.repair, input.workspace);
  const registryBinding = bind('registry_policy', input.registryPolicy, input.workspace);

  const site = siteBinding.payload;
  const siteValid = !!site && site.linearUnit === 'mm' && site.angularUnit === 'deg'
    && site.crsId.trim().length > 0 && site.verticalDatumId.trim().length > 0
    && Number.isFinite(site.projectNorthDeg) && site.projectToWorld.length === 16
    && site.projectToWorld.every(Number.isFinite) && site.artifactHashes.length > 0
    && site.artifactHashes.every(hash => SHA256.test(hash));
  const siteResult = siteBinding.status !== 'pass' ? siteBinding : {
    status: (siteValid ? site!.status : 'fail') as BuildingEvidenceStatus,
    reason: siteValid ? `site_coordinates: ${site!.crsId}/${site!.verticalDatumId}` : 'site_coordinates: invalid_structured_evidence',
  };

  const crossGate = (id: CrossDomainVerificationResult['gates'][number]['id']) => {
    if (crossBinding.status !== 'pass') return crossBinding;
    const gate = crossBinding.payload?.gates.find(item => item.id === id);
    return gate ? { status: normalized(gate.status), reason: `${id}: ${gate.reason}` }
      : { status: 'not_run' as const, reason: `${id}: gate was not supplied.` };
  };
  const topologyGate = (id: 'space-wall-loop' | 'opening-host-range' | 'opening-overlap' | 'opening-vertical-fit') => {
    const gate = topology?.gates.find(item => item.id === id);
    return gate ? { status: normalized(gate.status), reason: `${id}: ${gate.reasons.join(',') || gate.status}` }
      : { status: workspaceStatus, reason: workspaceReason };
  };
  const ifc = ifcBinding.payload;
  const ifcResult = ifcBinding.status !== 'pass' ? ifcBinding : ifc
    ? { status: (ifc.passed ? 'pass' : 'fail') as BuildingEvidenceStatus, reason: `ifc_roundtrip: ${ifc.errors.join(',') || 'deep semantics preserved'}` }
    : { status: 'not_run' as const, reason: 'ifc_roundtrip: evidence was not supplied.' };
  const accessibilityResult = explicit('accessibility', accessibilityBinding, accessibilityBinding.payload);
  const envelopeResult = explicit('envelope_continuity', envelopeBinding, envelopeBinding.payload);
  const repairResult = explicit('repair', repairBinding, repairBinding.payload);
  const deliverables = deliverableBinding.payload;
  const deliverableValid = !!deliverables
    && deliverables.requiredDrawings > 0 && deliverables.requiredDrawings === deliverables.verifiedDrawings
    && deliverables.expectedScheduleRows > 0 && deliverables.expectedScheduleRows === deliverables.verifiedScheduleRows
    && deliverables.expectedQuantityItems > 0 && deliverables.expectedQuantityItems === deliverables.verifiedQuantityItems;
  const deliverableResult = explicit('deliverables', deliverableBinding, deliverables, deliverableValid);

  const registry = registryBinding.payload;
  const registryValid = registryBinding.status === 'pass' && !!registry
    && registry.artifactHashes.length > 0 && registry.artifactHashes.every(hash => SHA256.test(hash))
    && ((registry.status === 'quarantined' && !registry.usedForRelease && registry.sourceIssueCount > 0)
      || (registry.status === 'approved' && registry.usedForRelease && registry.sourceIssueCount === 0 && !!registry.approvalId?.trim()));
  const registryResult = registryBinding.status !== 'pass' ? registryBinding : {
    status: (registryValid ? 'pass' : 'fail') as BuildingEvidenceStatus,
    reason: registryValid
      ? `registry_policy: ${registry!.status}, usedForRelease=${registry!.usedForRelease}`
      : 'registry_policy: unapproved or inconsistent source data was selected for release.',
  };

  const graph = evaluateArtifactRelease(input.workspace.artifactGraph, ['model', 'drawing', 'quantity', 'ifc']);
  const outputResult = {
    status: (workspaceStatus !== 'pass' ? workspaceStatus : graph.releaseReady ? 'pass' : 'fail') as BuildingEvidenceStatus,
    reason: graph.releaseReady ? 'artifact_graph: model, drawing, schedule/quantity and IFC are current and verified.'
      : `artifact_graph: ${[...graph.graphIssues, ...graph.missingKinds.map(value => `missing:${value}`), ...graph.staleArtifactIds.map(value => `stale:${value}`), ...graph.unverifiedArtifactIds.map(value => `unverified:${value}`)].join(',')}`,
  };
  const storeyGridStatus: BuildingEvidenceStatus = workspaceStatus !== 'pass' ? workspaceStatus
    : document.storeys.length > 0 && (document.grids?.length ?? 0) > 0 ? 'pass' : 'not_run';
  const storeyGridReason = storeyGridStatus === 'pass' ? `storeys_grids: ${document.storeys.length}/${document.grids!.length}` : 'storeys_grids: authoritative storey and grid evidence is required.';

  const a = (axis: DomainEvidenceAxis, result: { status: BuildingEvidenceStatus; reason: string }) => ({ axis, ...result });
  const values: DomainAccuracyAssertionResult[] = [
    a('requirements', { status: workspaceStatus, reason: workspaceReason }),
    a('coordinate_units', siteResult),
    a('semantic_objects', { status: workspaceStatus, reason: workspaceReason }),
    a('geometry', { status: workspaceStatus, reason: workspaceReason }),
    a('relationships', { status: workspaceStatus, reason: workspaceReason }),
    a('provenance', { status: workspaceStatus, reason: workspaceReason }),
    a('provenance', registryResult),
    a('revision_integrity', { status: workspaceStatus, reason: workspaceReason }),
    a('output_consistency', outputResult),
    a('site_coordinates', siteResult),
    a('storeys_grids', { status: storeyGridStatus, reason: storeyGridReason }),
    a('space_closure', topologyGate('space-wall-loop')),
    a('space_closure', crossGate('space-boundary')),
    a('hosts_openings', topologyGate('opening-host-range')),
    a('hosts_openings', topologyGate('opening-overlap')),
    a('hosts_openings', topologyGate('opening-vertical-fit')),
    a('egress', crossGate('egress')),
    a('accessibility', accessibilityResult),
    a('envelope_continuity', envelopeResult),
    a('mep_coordination', crossGate('mep-interference')),
    a('ifc_roundtrip', ifcResult),
    a('schedules_quantities', deliverableResult),
    a('drawing_consistency', deliverableResult),
    a('repair', repairResult),
  ];
  const assertions = merge(values);
  const issues = [...workspaceIssues, ...documentIssues, ...assertions.filter(item => item.status !== 'pass').map(item => `${item.axis}:${item.status}`)];
  const status: BuildingEvidenceStatus = assertions.length !== 20 ? 'fail'
    : assertions.some(item => item.status === 'fail') ? 'fail'
      : assertions.some(item => item.status === 'not_run') ? 'not_run' : 'pass';
  return {
    schema: 'nexyfab.building-release-certificate.v1',
    workspaceRevision: input.workspace.workspace.revision,
    modelContentHash: input.workspace.geometry.contentHash,
    status,
    internalReady: status === 'pass',
    releaseReady: false,
    assertions,
    issues,
  };
}
