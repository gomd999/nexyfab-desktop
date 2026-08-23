import type { DomainAccuracyAssertionResult } from './domainAccuracyEvidence';
import type { DomainEvidenceAxis } from './domainProfile';
import { evaluateArtifactRelease } from './designArtifactGraph';
import { validateArchitectureDocument, validateInteriorDocument, type ArchitectureDocument, type InteriorDocument } from './architectureInteriorDocuments';
import { hashCadPayload, validateCadWorkspaceEnvelope, type CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';

export type InteriorEvidenceStatus = 'pass' | 'fail' | 'not_run';
export interface BoundInteriorEvidence<T> { workspaceRevision: number; modelContentHash: string; contentHash: string; payload: T }
export interface InteriorAxisEvidence { status: InteriorEvidenceStatus; expected: number; checked: number; issues: string[]; artifactHashes: string[] }
export interface InteriorHostAuthorityEvidence extends InteriorAxisEvidence { architectureDocumentId: string; architectureContentHash: string; coordinateSystemId: string; architecture: ArchitectureDocument; federatedValidationIssues: string[] }
export interface InteriorDeliverableEvidence extends InteriorAxisEvidence { requiredDrawings: number; verifiedDrawings: number; expectedScheduleRows: number; verifiedScheduleRows: number; expectedQuantityItems: number; verifiedQuantityItems: number }
export interface InteriorReleaseCertificateInput {
  workspace: CadWorkspaceEnvelopeInput; hostAuthority?: BoundInteriorEvidence<InteriorHostAuthorityEvidence>;
  spatial?: BoundInteriorEvidence<InteriorAxisEvidence>; ceilingMep?: BoundInteriorEvidence<InteriorAxisEvidence>;
  finishes?: BoundInteriorEvidence<InteriorAxisEvidence>; millwork?: BoundInteriorEvidence<InteriorAxisEvidence>;
  lighting?: BoundInteriorEvidence<InteriorAxisEvidence>; acoustics?: BoundInteriorEvidence<InteriorAxisEvidence>;
  ifcRoundtrip?: BoundInteriorEvidence<InteriorAxisEvidence>; deliverables?: BoundInteriorEvidence<InteriorDeliverableEvidence>; repair?: BoundInteriorEvidence<InteriorAxisEvidence>;
}
export interface InteriorReleaseCertificate { schema: 'nexyfab.interior-release-certificate.v1'; workspaceRevision: number; modelContentHash: string; status: InteriorEvidenceStatus; internalReady: boolean; releaseReady: false; assertions: DomainAccuracyAssertionResult[]; issues: string[] }

const SHA256 = /^[a-f0-9]{64}$/;
const rank: Record<InteriorEvidenceStatus, number> = { pass: 0, not_run: 1, fail: 2 };
function bind<T>(name: string, value: BoundInteriorEvidence<T> | undefined, workspace: CadWorkspaceEnvelopeInput) {
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.`, payload: undefined };
  const issues = [...(value.workspaceRevision === workspace.workspace.revision ? [] : ['workspace_revision_mismatch']), ...(value.modelContentHash === workspace.geometry.contentHash ? [] : ['model_content_hash_mismatch']), ...(SHA256.test(value.contentHash) && value.contentHash === hashCadPayload(value.payload) ? [] : ['payload_hash_mismatch'])];
  return issues.length ? { status: 'fail' as const, reason: `${name}: ${issues.join(',')}`, payload: undefined } : { status: 'pass' as const, reason: `${name}: exact revision/model/payload binding passed.`, payload: value.payload };
}
function explicit(name: string, bound: ReturnType<typeof bind>, value: InteriorAxisEvidence | undefined, extra = true) {
  if (bound.status !== 'pass') return bound;
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.` };
  const valid = Number.isSafeInteger(value.expected) && value.expected > 0 && value.checked === value.expected && value.artifactHashes.length > 0 && value.artifactHashes.every(hash => SHA256.test(hash)) && extra;
  return { status: (valid ? value.status : 'fail') as InteriorEvidenceStatus, reason: `${name}: ${valid ? `${value.checked}/${value.expected}` : 'invalid_structured_evidence'}${value.issues.length ? `,${value.issues.join(',')}` : ''}` };
}
function merge(values: DomainAccuracyAssertionResult[]) { const grouped = new Map<DomainEvidenceAxis, DomainAccuracyAssertionResult[]>(); for (const value of values) grouped.set(value.axis, [...(grouped.get(value.axis) ?? []), value]); return [...grouped.entries()].map(([axis, items]) => ({ axis, status: items.reduce<InteriorEvidenceStatus>((worst, item) => rank[item.status] > rank[worst] ? item.status : worst, 'pass'), reason: items.map(item => item.reason).join(' | ') })); }

/** Fail-closed 25-axis interior release boundary pinned to an exact architecture host revision. */
export function buildInteriorReleaseCertificate(input: InteriorReleaseCertificateInput): InteriorReleaseCertificate {
  const workspaceIssues = validateCadWorkspaceEnvelope(input.workspace); if (input.workspace.workspace.domain !== 'interior') workspaceIssues.push('workspace_domain_not_interior');
  const interior = input.workspace.semanticDocument.payload as InteriorDocument;
  const hostBound = bind('host_authority', input.hostAuthority, input.workspace), host = hostBound.payload;
  const architectureIssues = host ? validateArchitectureDocument(host.architecture) : [];
  const hostValid = !!host && host.architectureDocumentId === interior.architectureDocumentId && SHA256.test(host.architectureContentHash)
    && host.architectureContentHash === hashCadPayload(host.architecture) && !!host.coordinateSystemId.trim() && host.federatedValidationIssues.length === 0 && architectureIssues.length === 0
    && !!interior.fieldMeasurement && interior.fieldMeasurement.architectureRevision === host.architecture.revision;
  const hostResult = explicit('host_authority', hostBound, host, hostValid);
  const documentIssues = workspaceIssues.length || !host ? [] : validateInteriorDocument(interior, host.architecture);
  const baseStatus: InteriorEvidenceStatus = workspaceIssues.length || documentIssues.length ? 'fail' : 'pass';
  const baseReason = baseStatus === 'pass' ? 'workspace: interior semantics, exact geometry, relations, provenance and revision are valid.' : `workspace: ${[...workspaceIssues, ...documentIssues].join(',')}`;
  const gate = (name: string, evidence: BoundInteriorEvidence<InteriorAxisEvidence> | undefined, extra = true) => { const bound = bind(name, evidence, input.workspace); return explicit(name, bound, bound.payload, extra); };
  const spatial = gate('spatial', input.spatial, interior.furniture.length > 0), ceiling = gate('ceiling_mep', input.ceilingMep, (interior.ceilingSystems?.length ?? 0) > 0);
  const finishes = gate('finishes', input.finishes, interior.finishes.length > 0), millwork = gate('millwork', input.millwork, (interior.millwork?.length ?? 0) > 0);
  const lighting = gate('lighting', input.lighting, interior.lights.length > 0), acoustics = gate('acoustics', input.acoustics, (interior.acousticZones?.length ?? 0) > 0);
  const ifc = gate('ifc_roundtrip', input.ifcRoundtrip), repair = gate('repair', input.repair);
  const deliverableBound = bind('deliverables', input.deliverables, input.workspace), deliverable = deliverableBound.payload;
  const deliverables = explicit('deliverables', deliverableBound, deliverable, !!deliverable && deliverable.requiredDrawings > 0 && deliverable.requiredDrawings === deliverable.verifiedDrawings && deliverable.expectedScheduleRows > 0 && deliverable.expectedScheduleRows === deliverable.verifiedScheduleRows && deliverable.expectedQuantityItems > 0 && deliverable.expectedQuantityItems === deliverable.verifiedQuantityItems);
  const graph = evaluateArtifactRelease(input.workspace.artifactGraph, ['model', 'drawing', 'quantity', 'ifc']);
  const output = { status: (baseStatus !== 'pass' ? baseStatus : graph.releaseReady ? 'pass' : 'fail') as InteriorEvidenceStatus, reason: graph.releaseReady ? 'artifact_graph: model/drawing/quantity/IFC artifacts are current and verified.' : `artifact_graph: ${[...graph.graphIssues, ...graph.missingKinds.map(item => `missing:${item}`), ...graph.staleArtifactIds.map(item => `stale:${item}`), ...graph.unverifiedArtifactIds.map(item => `unverified:${item}`)].join(',')}` };
  const a = (axis: DomainEvidenceAxis, result: { status: InteriorEvidenceStatus; reason: string }) => ({ axis, ...result });
  const values: DomainAccuracyAssertionResult[] = [
    a('requirements', { status: baseStatus, reason: baseReason }), a('coordinate_units', hostResult), a('semantic_objects', { status: baseStatus, reason: baseReason }), a('geometry', { status: baseStatus, reason: baseReason }), a('relationships', hostResult), a('provenance', hostResult), a('revision_integrity', hostResult), a('output_consistency', output),
    a('field_measurement', hostResult), a('space_closure', spatial), a('hosts_openings', hostResult), a('circulation', spatial), a('door_swing', spatial), a('egress', spatial), a('accessibility', spatial), a('furniture_clearance', spatial),
    a('ceiling_mep', ceiling), a('finishes', finishes), a('millwork', millwork), a('lighting', lighting), a('acoustics', acoustics), a('schedules_quantities', deliverables), a('drawing_consistency', deliverables), a('ifc_roundtrip', ifc), a('repair', repair),
  ];
  const assertions = merge(values), issues = [...workspaceIssues, ...documentIssues, ...architectureIssues, ...assertions.filter(item => item.status !== 'pass').map(item => `${item.axis}:${item.status}`)];
  const status: InteriorEvidenceStatus = assertions.length !== 25 ? 'fail' : assertions.some(item => item.status === 'fail') ? 'fail' : assertions.some(item => item.status === 'not_run') ? 'not_run' : 'pass';
  return { schema: 'nexyfab.interior-release-certificate.v1', workspaceRevision: input.workspace.workspace.revision, modelContentHash: input.workspace.geometry.contentHash, status, internalReady: status === 'pass', releaseReady: false, assertions, issues };
}
