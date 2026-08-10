import type { DomainAccuracyAssertionResult } from './domainAccuracyEvidence';
import type { DomainEvidenceAxis } from './domainProfile';
import { evaluateArtifactRelease } from './designArtifactGraph';
import { validateCivilDocument, type CivilDocument } from './civilDocument';
import { hashCadPayload, validateCadWorkspaceEnvelope, type CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';

export type CivilEvidenceStatus = 'pass' | 'fail' | 'not_run';
export interface BoundCivilEvidence<T> { workspaceRevision: number; modelContentHash: string; contentHash: string; payload: T }
export interface CivilAxisEvidence { status: CivilEvidenceStatus; expected: number; checked: number; issues: string[]; artifactHashes: string[] }
export interface CivilExchangeEvidence extends CivilAxisEvidence { landXmlRoundtrip: boolean; ifcRoundtrip: boolean; crsPreserved: boolean; unitsPreserved: boolean; alignmentPreserved: boolean; profilePreserved: boolean; surfacePreserved: boolean }
export interface CivilDeliverableEvidence extends CivilAxisEvidence { requiredDrawings: number; verifiedDrawings: number; expectedQuantityItems: number; verifiedQuantityItems: number }
export interface CivilReleaseCertificateInput {
  workspace: CadWorkspaceEnvelopeInput;
  earthwork?: BoundCivilEvidence<CivilAxisEvidence>;
  structures?: BoundCivilEvidence<CivilAxisEvidence>;
  exchange?: BoundCivilEvidence<CivilExchangeEvidence>;
  deliverables?: BoundCivilEvidence<CivilDeliverableEvidence>;
  repair?: BoundCivilEvidence<CivilAxisEvidence>;
}
export interface CivilReleaseCertificate { schema: 'nexyfab.civil-release-certificate.v1'; workspaceRevision: number; modelContentHash: string; status: CivilEvidenceStatus; releaseReady: boolean; assertions: DomainAccuracyAssertionResult[]; issues: string[] }

const SHA256 = /^[a-f0-9]{64}$/;
const rank: Record<CivilEvidenceStatus, number> = { pass: 0, not_run: 1, fail: 2 };
function binding<T>(name: string, value: BoundCivilEvidence<T> | undefined, workspace: CadWorkspaceEnvelopeInput) {
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.`, payload: undefined };
  const issues = [
    ...(value.workspaceRevision === workspace.workspace.revision ? [] : ['workspace_revision_mismatch']),
    ...(value.modelContentHash === workspace.geometry.contentHash ? [] : ['model_content_hash_mismatch']),
    ...(SHA256.test(value.contentHash) && value.contentHash === hashCadPayload(value.payload) ? [] : ['payload_hash_mismatch']),
  ];
  return issues.length ? { status: 'fail' as const, reason: `${name}: ${issues.join(',')}`, payload: undefined }
    : { status: 'pass' as const, reason: `${name}: exact revision/model/payload binding passed.`, payload: value.payload };
}
function explicit(name: string, bound: ReturnType<typeof binding>, value: CivilAxisEvidence | undefined, extra = true) {
  if (bound.status !== 'pass') return bound;
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.` };
  const valid = Number.isSafeInteger(value.expected) && value.expected > 0 && value.checked === value.expected
    && value.artifactHashes.length > 0 && value.artifactHashes.every(hash => SHA256.test(hash)) && extra;
  return { status: (valid ? value.status : 'fail') as CivilEvidenceStatus, reason: `${name}: ${valid ? `${value.checked}/${value.expected}` : 'invalid_structured_evidence'}${value.issues.length ? `,${value.issues.join(',')}` : ''}` };
}
function merge(values: DomainAccuracyAssertionResult[]) {
  const grouped = new Map<DomainEvidenceAxis, DomainAccuracyAssertionResult[]>();
  for (const value of values) grouped.set(value.axis, [...(grouped.get(value.axis) ?? []), value]);
  return [...grouped.entries()].map(([axis, items]) => ({ axis, status: items.reduce<CivilEvidenceStatus>((worst, item) => rank[item.status] > rank[worst] ? item.status : worst, 'pass'), reason: items.map(item => item.reason).join(' | ') }));
}
const present = (ok: boolean, reason: string) => ({ status: (ok ? 'pass' : 'not_run') as CivilEvidenceStatus, reason });

/** Fail-closed 22-axis civil/infrastructure release boundary. */
export function buildCivilReleaseCertificate(input: CivilReleaseCertificateInput): CivilReleaseCertificate {
  const workspaceIssues = validateCadWorkspaceEnvelope(input.workspace);
  if (input.workspace.workspace.domain !== 'civil') workspaceIssues.push('workspace_domain_not_civil');
  const document = input.workspace.semanticDocument.payload as CivilDocument;
  const documentIssues = workspaceIssues.length ? [] : validateCivilDocument(document);
  const baseStatus: CivilEvidenceStatus = workspaceIssues.length || documentIssues.length ? 'fail' : 'pass';
  const baseReason = baseStatus === 'pass' ? 'workspace: civil semantics, exact geometry, relations, provenance and revision are valid.' : `workspace: ${[...workspaceIssues, ...documentIssues].join(',')}`;
  const derived = (ok: boolean, reason: string) => baseStatus === 'pass' ? present(ok, reason) : { status: baseStatus, reason: baseReason };

  const earthBound = binding('earthwork', input.earthwork, input.workspace), structuresBound = binding('structures', input.structures, input.workspace);
  const exchangeBound = binding('exchange', input.exchange, input.workspace), deliverableBound = binding('deliverables', input.deliverables, input.workspace), repairBound = binding('repair', input.repair, input.workspace);
  const earthwork = explicit('earthwork', earthBound, earthBound.payload);
  const structures = explicit('structures', structuresBound, structuresBound.payload, document.structures.length > 0);
  const exchangeValue = exchangeBound.payload;
  const exchange = explicit('ifc_landxml_roundtrip', exchangeBound, exchangeValue, !!exchangeValue && exchangeValue.landXmlRoundtrip && exchangeValue.ifcRoundtrip && exchangeValue.crsPreserved && exchangeValue.unitsPreserved && exchangeValue.alignmentPreserved && exchangeValue.profilePreserved && exchangeValue.surfacePreserved);
  const deliverable = deliverableBound.payload;
  const deliverables = explicit('civil_deliverables', deliverableBound, deliverable, !!deliverable && deliverable.requiredDrawings > 0 && deliverable.requiredDrawings === deliverable.verifiedDrawings && deliverable.expectedQuantityItems > 0 && deliverable.expectedQuantityItems === deliverable.verifiedQuantityItems);
  const repair = explicit('repair', repairBound, repairBound.payload);
  const graph = evaluateArtifactRelease(input.workspace.artifactGraph, ['model', 'drawing', 'quantity', 'ifc']);
  const output = { status: (baseStatus !== 'pass' ? baseStatus : graph.releaseReady ? 'pass' : 'fail') as CivilEvidenceStatus, reason: graph.releaseReady ? 'artifact_graph: model/drawing/quantity/exchange artifacts are current and verified.' : `artifact_graph: ${[...graph.graphIssues, ...graph.missingKinds.map(item => `missing:${item}`), ...graph.staleArtifactIds.map(item => `stale:${item}`), ...graph.unverifiedArtifactIds.map(item => `unverified:${item}`)].join(',')}` };
  const a = (axis: DomainEvidenceAxis, result: { status: CivilEvidenceStatus; reason: string }) => ({ axis, ...result });
  const values: DomainAccuracyAssertionResult[] = [
    a('requirements', { status: baseStatus, reason: baseReason }), a('coordinate_units', derived(document.crs.units === 'm' && document.crs.epsg > 0, `crs:${document.crs.epsg}/${document.crs.units}`)),
    a('semantic_objects', { status: baseStatus, reason: baseReason }), a('geometry', { status: baseStatus, reason: baseReason }), a('relationships', { status: baseStatus, reason: baseReason }),
    a('provenance', { status: baseStatus, reason: baseReason }), a('revision_integrity', { status: baseStatus, reason: baseReason }), a('output_consistency', output),
    a('survey_control', derived(document.surveyControls.length >= 2, `survey_controls:${document.surveyControls.length}`)),
    a('surface_quality', derived(document.surfaces.some(surface => surface.kind === 'existing' && surface.triangles.length > 0), `surfaces:${document.surfaces.length}`)),
    a('alignment', derived(document.alignments.length > 0, `alignments:${document.alignments.length}`)), a('profile', derived(document.profiles.length > 0, `profiles:${document.profiles.length}`)),
    a('cross_sections', derived(document.crossSections.length > 0, `cross_sections:${document.crossSections.length}`)), a('corridor', derived(document.corridors.length > 0, `corridors:${document.corridors.length}`)),
    a('earthwork', earthwork), a('drainage', derived(document.drainageNodes.length > 1 && document.drainageLinks.length > 0, `drainage:${document.drainageNodes.length}/${document.drainageLinks.length}`)),
    a('construction_stages', derived(document.stages.length > 0, `stages:${document.stages.length}`)), a('structures', structures), a('ifc_landxml_roundtrip', exchange),
    a('civil_drawings', deliverables), a('quantities', deliverables), a('repair', repair),
  ];
  const assertions = merge(values), issues = [...workspaceIssues, ...documentIssues, ...assertions.filter(item => item.status !== 'pass').map(item => `${item.axis}:${item.status}`)];
  const status: CivilEvidenceStatus = assertions.length !== 22 ? 'fail' : assertions.some(item => item.status === 'fail') ? 'fail' : assertions.some(item => item.status === 'not_run') ? 'not_run' : 'pass';
  return { schema: 'nexyfab.civil-release-certificate.v1', workspaceRevision: input.workspace.workspace.revision, modelContentHash: input.workspace.geometry.contentHash, status, releaseReady: status === 'pass', assertions, issues };
}
