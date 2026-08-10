import type { DomainAccuracyAssertionResult } from './domainAccuracyEvidence';
import type { DomainEvidenceAxis } from './domainProfile';
import { evaluateArtifactRelease } from './designArtifactGraph';
import { landscapeReleaseReadiness, validateLandscapeDocument, type LandscapeDocument } from './landscapeDocument';
import { hashCadPayload, validateCadWorkspaceEnvelope, type CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';

export type LandscapeEvidenceStatus = 'pass' | 'fail' | 'not_run';
export interface BoundLandscapeEvidence<T> { workspaceRevision: number; modelContentHash: string; contentHash: string; payload: T }
export interface LandscapeAxisEvidence { status: LandscapeEvidenceStatus; expected: number; checked: number; issues: string[]; artifactHashes: string[] }
export interface LandscapeTerrainAuthorityEvidence extends LandscapeAxisEvidence {
  civilDocumentId: string; civilDocumentContentHash: string; civilRevision: number; surfaceId: string; surfaceContentHash: string;
  coordinateSystemId: string; epsg: number; horizontalDatum: string; verticalDatum: string; units: 'm'; federatedValidationIssues: string[];
}
export interface LandscapeDeliverableEvidence extends LandscapeAxisEvidence {
  requiredDrawings: number; verifiedDrawings: number; expectedScheduleRows: number; verifiedScheduleRows: number;
  expectedQuantityItems: number; verifiedQuantityItems: number;
}
export interface LandscapeReleaseCertificateInput {
  workspace: CadWorkspaceEnvelopeInput;
  terrainAuthority?: BoundLandscapeEvidence<LandscapeTerrainAuthorityEvidence>;
  grading?: BoundLandscapeEvidence<LandscapeAxisEvidence>;
  surfaceFlow?: BoundLandscapeEvidence<LandscapeAxisEvidence>;
  matureClearance?: BoundLandscapeEvidence<LandscapeAxisEvidence>;
  irrigation?: BoundLandscapeEvidence<LandscapeAxisEvidence>;
  deliverables?: BoundLandscapeEvidence<LandscapeDeliverableEvidence>;
  repair?: BoundLandscapeEvidence<LandscapeAxisEvidence>;
}
export interface LandscapeReleaseCertificate { schema: 'nexyfab.landscape-release-certificate.v1'; workspaceRevision: number; modelContentHash: string; status: LandscapeEvidenceStatus; releaseReady: boolean; assertions: DomainAccuracyAssertionResult[]; issues: string[] }

const SHA256 = /^[a-f0-9]{64}$/;
const rank: Record<LandscapeEvidenceStatus, number> = { pass: 0, not_run: 1, fail: 2 };
function bind<T>(name: string, value: BoundLandscapeEvidence<T> | undefined, workspace: CadWorkspaceEnvelopeInput) {
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.`, payload: undefined };
  const issues = [
    ...(value.workspaceRevision === workspace.workspace.revision ? [] : ['workspace_revision_mismatch']),
    ...(value.modelContentHash === workspace.geometry.contentHash ? [] : ['model_content_hash_mismatch']),
    ...(SHA256.test(value.contentHash) && value.contentHash === hashCadPayload(value.payload) ? [] : ['payload_hash_mismatch']),
  ];
  return issues.length ? { status: 'fail' as const, reason: `${name}: ${issues.join(',')}`, payload: undefined }
    : { status: 'pass' as const, reason: `${name}: exact workspace revision/model/payload binding passed.`, payload: value.payload };
}
function explicit(name: string, bound: ReturnType<typeof bind>, value: LandscapeAxisEvidence | undefined, extra = true) {
  if (bound.status !== 'pass') return bound;
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.` };
  const valid = Number.isSafeInteger(value.expected) && value.expected > 0 && value.checked === value.expected
    && value.artifactHashes.length > 0 && value.artifactHashes.every(hash => SHA256.test(hash)) && extra;
  return { status: (valid ? value.status : 'fail') as LandscapeEvidenceStatus, reason: `${name}: ${valid ? `${value.checked}/${value.expected}` : 'invalid_structured_evidence'}${value.issues.length ? `,${value.issues.join(',')}` : ''}` };
}
function merge(values: DomainAccuracyAssertionResult[]) {
  const grouped = new Map<DomainEvidenceAxis, DomainAccuracyAssertionResult[]>();
  for (const value of values) grouped.set(value.axis, [...(grouped.get(value.axis) ?? []), value]);
  return [...grouped.entries()].map(([axis, items]) => ({ axis, status: items.reduce<LandscapeEvidenceStatus>((worst, item) => rank[item.status] > rank[worst] ? item.status : worst, 'pass'), reason: items.map(item => item.reason).join(' | ') }));
}

/** Fail-closed 20-axis landscape release boundary, pinned to an authoritative civil terrain revision. */
export function buildLandscapeReleaseCertificate(input: LandscapeReleaseCertificateInput): LandscapeReleaseCertificate {
  const workspaceIssues = validateCadWorkspaceEnvelope(input.workspace);
  if (input.workspace.workspace.domain !== 'landscape') workspaceIssues.push('workspace_domain_not_landscape');
  const document = input.workspace.semanticDocument.payload as LandscapeDocument;
  const documentIssues = workspaceIssues.length ? [] : validateLandscapeDocument(document);
  const baseStatus: LandscapeEvidenceStatus = workspaceIssues.length || documentIssues.length ? 'fail' : 'pass';
  const baseReason = baseStatus === 'pass' ? 'workspace: landscape semantics, exact geometry, relations, provenance and revision are valid.' : `workspace: ${[...workspaceIssues, ...documentIssues].join(',')}`;
  const readiness = baseStatus === 'pass' ? landscapeReleaseReadiness(document) : undefined;
  const derived = (ok: boolean, reason: string) => baseStatus === 'pass' ? { status: (ok ? 'pass' : 'not_run') as LandscapeEvidenceStatus, reason } : { status: baseStatus, reason: baseReason };

  const terrainBound = bind('terrain_authority', input.terrainAuthority, input.workspace), terrain = terrainBound.payload;
  const terrainValid = !!terrain && terrain.civilDocumentId === document.terrain.civilDocumentId && terrain.civilRevision === document.terrain.civilRevision
    && terrain.surfaceId === document.terrain.surfaceId && terrain.coordinateSystemId === document.coordinateSystemId && terrain.epsg > 0
    && terrain.units === 'm' && !!terrain.horizontalDatum.trim() && !!terrain.verticalDatum.trim()
    && SHA256.test(terrain.civilDocumentContentHash) && SHA256.test(terrain.surfaceContentHash) && terrain.federatedValidationIssues.length === 0;
  const terrainResult = explicit('terrain_authority', terrainBound, terrain, terrainValid);
  const gradingBound = bind('terrain_grading', input.grading, input.workspace), grading = explicit('terrain_grading', gradingBound, gradingBound.payload);
  const flowBound = bind('surface_flow', input.surfaceFlow, input.workspace), flow = explicit('surface_flow', flowBound, flowBound.payload, !!readiness?.drainage);
  const clearanceBound = bind('mature_clearance', input.matureClearance, input.workspace), clearance = explicit('mature_clearance', clearanceBound, clearanceBound.payload, document.plants.length > 0);
  const irrigationBound = bind('irrigation', input.irrigation, input.workspace), irrigation = explicit('irrigation', irrigationBound, irrigationBound.payload, !!readiness?.irrigation_capacity);
  const repairBound = bind('repair', input.repair, input.workspace), repair = explicit('repair', repairBound, repairBound.payload);
  const deliverableBound = bind('deliverables', input.deliverables, input.workspace), deliverable = deliverableBound.payload;
  const deliverableValid = !!deliverable && deliverable.requiredDrawings > 0 && deliverable.requiredDrawings === deliverable.verifiedDrawings
    && deliverable.expectedScheduleRows > 0 && deliverable.expectedScheduleRows === deliverable.verifiedScheduleRows
    && deliverable.expectedQuantityItems > 0 && deliverable.expectedQuantityItems === deliverable.verifiedQuantityItems;
  const deliverables = explicit('deliverables', deliverableBound, deliverable, deliverableValid);
  const graph = evaluateArtifactRelease(input.workspace.artifactGraph, ['model', 'drawing', 'quantity']);
  const output = { status: (baseStatus !== 'pass' ? baseStatus : graph.releaseReady ? 'pass' : 'fail') as LandscapeEvidenceStatus, reason: graph.releaseReady ? 'artifact_graph: model/drawing/quantity artifacts are current and verified.' : `artifact_graph: ${[...graph.graphIssues, ...graph.missingKinds.map(item => `missing:${item}`), ...graph.staleArtifactIds.map(item => `stale:${item}`), ...graph.unverifiedArtifactIds.map(item => `unverified:${item}`)].join(',')}` };
  const a = (axis: DomainEvidenceAxis, result: { status: LandscapeEvidenceStatus; reason: string }) => ({ axis, ...result });
  const values: DomainAccuracyAssertionResult[] = [
    a('requirements', { status: baseStatus, reason: baseReason }), a('coordinate_units', terrainResult),
    a('semantic_objects', { status: baseStatus, reason: baseReason }), a('geometry', { status: baseStatus, reason: baseReason }),
    a('relationships', terrainResult), a('provenance', { status: baseStatus, reason: baseReason }), a('revision_integrity', terrainResult), a('output_consistency', output),
    a('existing_conditions', terrainResult), a('terrain_grading', grading), a('surface_flow', flow),
    a('planting_data', derived(!!readiness?.plant_provenance, `plants:${document.plants.length}/sources:${document.sourceEvidence.length}`)),
    a('mature_clearance', clearance), a('soil_volume', derived(!!readiness?.soil_volume, `soil_volumes:${document.soilVolumes.length}`)),
    a('hardscape', derived(document.hardscapes.length > 0, `hardscapes:${document.hardscapes.length}`)), a('irrigation', irrigation),
    a('schedules_quantities', deliverables), a('maintenance', derived(!!readiness?.maintenance_access, `maintenance_zones:${document.maintenanceZones.length}`)),
    a('drawing_consistency', deliverables), a('repair', repair),
  ];
  const assertions = merge(values), issues = [...workspaceIssues, ...documentIssues, ...assertions.filter(item => item.status !== 'pass').map(item => `${item.axis}:${item.status}`)];
  const status: LandscapeEvidenceStatus = assertions.length !== 20 ? 'fail' : assertions.some(item => item.status === 'fail') ? 'fail' : assertions.some(item => item.status === 'not_run') ? 'not_run' : 'pass';
  return { schema: 'nexyfab.landscape-release-certificate.v1', workspaceRevision: input.workspace.workspace.revision, modelContentHash: input.workspace.geometry.contentHash, status, releaseReady: status === 'pass', assertions, issues };
}
