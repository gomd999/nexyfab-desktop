import { validateFederatedDomainProject } from './federatedDomainValidation';
import { validateUnifiedDesignProject, type UnifiedDesignProject } from './unifiedDesignProject';
import { hashCadPayload } from '@/lib/cad/workspaceRevisionStore';
import { getDomainProfile } from './domainProfileRegistry';

export type FederatedEvidenceStatus = 'pass' | 'fail' | 'not_run';
export type FederatedReleaseGateId = 'project_integrity' | 'deep_domain_validation' | 'coordinate_transforms' | 'domain_certificates' | 'reference_revision' | 'change_propagation' | 'clash_clearance' | 'quantity_reconciliation' | 'permission_isolation' | 'recovery_performance';
export interface BoundFederatedEvidence<T> { projectRevision: number; projectContentHash: string; contentHash: string; payload: T }
export interface FederatedAxisEvidence { status: FederatedEvidenceStatus; expected: number; checked: number; issues: string[]; artifactHashes: string[] }
export interface FederatedDomainCertificateSummary { domain: 'mechanical' | 'building' | 'civil' | 'landscape' | 'interior'; documentId: string; documentRevision: number; documentContentHash: string; certificateContentHash: string; certificate: { schema: string; workspaceRevision: number; modelContentHash: string; status: FederatedEvidenceStatus; internalReady?: boolean; releaseReady: boolean; assertions: unknown[]; issues: string[] } }
export interface FederatedDomainCertificatesEvidence extends FederatedAxisEvidence { certificates: FederatedDomainCertificateSummary[] }
export interface FederatedCoordinateEvidence extends FederatedAxisEvidence { coordinateSystemIds: string[]; transformPathsChecked: number; unitConversionsChecked: number }
export interface FederatedReferenceEvidence extends FederatedAxisEvidence { referenceCount: number; revisionPinnedCount: number }
export interface FederatedReleaseGate { id: FederatedReleaseGateId; status: FederatedEvidenceStatus; reason: string }
export interface FederatedProjectReleaseCertificateInput {
  project: UnifiedDesignProject; projectContentHash: string;
  coordinates?: BoundFederatedEvidence<FederatedCoordinateEvidence>;
  domainCertificates?: BoundFederatedEvidence<FederatedDomainCertificatesEvidence>;
  references?: BoundFederatedEvidence<FederatedReferenceEvidence>;
  changePropagation?: BoundFederatedEvidence<FederatedAxisEvidence>;
  clashClearance?: BoundFederatedEvidence<FederatedAxisEvidence>;
  quantities?: BoundFederatedEvidence<FederatedAxisEvidence>;
  permissions?: BoundFederatedEvidence<FederatedAxisEvidence>;
  recoveryPerformance?: BoundFederatedEvidence<FederatedAxisEvidence>;
}
export interface FederatedProjectReleaseCertificate { schema: 'nexyfab.federated-project-release-certificate.v1'; projectRevision: number; projectContentHash: string; status: FederatedEvidenceStatus; internalReady: boolean; releaseReady: false; gates: FederatedReleaseGate[]; issues: string[] }

const SHA256 = /^[a-f0-9]{64}$/;
function bind<T>(name: string, value: BoundFederatedEvidence<T> | undefined, project: UnifiedDesignProject, projectContentHash: string) {
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.`, payload: undefined };
  const issues = [...(value.projectRevision === project.revision ? [] : ['project_revision_mismatch']), ...(value.projectContentHash === projectContentHash ? [] : ['project_content_hash_mismatch']), ...(SHA256.test(value.contentHash) && value.contentHash === hashCadPayload(value.payload) ? [] : ['payload_hash_mismatch'])];
  return issues.length ? { status: 'fail' as const, reason: `${name}: ${issues.join(',')}`, payload: undefined } : { status: 'pass' as const, reason: `${name}: exact project revision/content/payload binding passed.`, payload: value.payload };
}
function explicit(name: string, bound: ReturnType<typeof bind>, value: FederatedAxisEvidence | undefined, extra = true) {
  if (bound.status !== 'pass') return bound;
  if (!value) return { status: 'not_run' as const, reason: `${name}: evidence was not supplied.` };
  const valid = Number.isSafeInteger(value.expected) && value.expected > 0 && value.checked === value.expected && value.artifactHashes.length > 0 && value.artifactHashes.every(hash => SHA256.test(hash)) && extra;
  return { status: (valid ? value.status : 'fail') as FederatedEvidenceStatus, reason: `${name}: ${valid ? `${value.checked}/${value.expected}` : 'invalid_structured_evidence'}${value.issues.length ? `,${value.issues.join(',')}` : ''}` };
}

/** Final local federation boundary. It never promotes internal evidence to independent certification. */
export function buildFederatedProjectReleaseCertificate(input: FederatedProjectReleaseCertificateInput): FederatedProjectReleaseCertificate {
  const actualProjectHash = hashCadPayload(input.project), hashValid = SHA256.test(input.projectContentHash) && input.projectContentHash === actualProjectHash;
  const projectIssues = validateUnifiedDesignProject(input.project);
  const profileIssues = input.project.documents.flatMap(document => document.profileId && !getDomainProfile(document.profileId).documentSchemas.includes(document.schema)
    ? [`${document.id}: schema is not allowed by ${document.profileId} profile.`] : []);
  const deepIssues = projectIssues.length ? [] : [...profileIssues, ...validateFederatedDomainProject(input.project)];
  const base = (issues: string[], label: string) => ({ status: (!hashValid || issues.length ? 'fail' : 'pass') as FederatedEvidenceStatus, reason: !hashValid ? `${label}: project_content_hash_mismatch` : issues.length ? `${label}: ${issues.join(',')}` : `${label}: passed.` });
  const coordinateBound = bind('coordinate_transforms', input.coordinates, input.project, input.projectContentHash), coordinates = coordinateBound.payload;
  const coordinateResult = explicit('coordinate_transforms', coordinateBound, coordinates, !!coordinates && coordinates.coordinateSystemIds.length === input.project.coordinateSystems.length && new Set(coordinates.coordinateSystemIds).size === coordinates.coordinateSystemIds.length && input.project.coordinateSystems.every(item => coordinates.coordinateSystemIds.includes(item.id)) && coordinates.transformPathsChecked >= input.project.coordinateSystems.length && coordinates.unitConversionsChecked > 0);
  const certificateBound = bind('domain_certificates', input.domainCertificates, input.project, input.projectContentHash), certificateEvidence = certificateBound.payload;
  const required = ['mechanical', 'building', 'civil', 'landscape', 'interior'] as const;
  const summaries = certificateEvidence?.certificates ?? [], byDomain = new Map(summaries.map(item => [item.domain, item]));
  const certificatesValid = required.every(domain => {
    const summary = byDomain.get(domain), document = input.project.documents.find(item => item.id === summary?.documentId && item.profileId === domain);
    return !!summary && !!document && summary.documentRevision === document.revision && summary.documentContentHash === hashCadPayload(document.payload) && SHA256.test(summary.documentContentHash)
      && SHA256.test(summary.certificateContentHash) && summary.certificateContentHash === hashCadPayload(summary.certificate) && summary.certificate.workspaceRevision === document.revision
      && summary.certificate.schema === `nexyfab.${summary.domain}-release-certificate.v1`
      && (summary.domain === 'mechanical'
        ? summary.certificate.status === 'pass'
        : summary.certificate.internalReady === true && summary.certificate.releaseReady === false && summary.certificate.status === 'pass')
      && summary.certificate.assertions.length > 0;
  }) && summaries.length === required.length && new Set(summaries.map(item => item.domain)).size === required.length;
  const certificateResult = explicit('domain_certificates', certificateBound, certificateEvidence, certificatesValid);
  const referenceBound = bind('reference_revision', input.references, input.project, input.projectContentHash), reference = referenceBound.payload;
  const referenceResult = explicit('reference_revision', referenceBound, reference, !!reference && reference.referenceCount === input.project.references.length && reference.referenceCount > 0 && reference.revisionPinnedCount === reference.referenceCount);
  const named = (name: string, value: BoundFederatedEvidence<FederatedAxisEvidence> | undefined) => { const bound = bind(name, value, input.project, input.projectContentHash); return explicit(name, bound, bound.payload); };
  const gates: FederatedReleaseGate[] = [
    { id: 'project_integrity', ...base(projectIssues, 'project_integrity') }, { id: 'deep_domain_validation', ...base(deepIssues, 'deep_domain_validation') },
    { id: 'coordinate_transforms', ...coordinateResult }, { id: 'domain_certificates', ...certificateResult }, { id: 'reference_revision', ...referenceResult },
    { id: 'change_propagation', ...named('change_propagation', input.changePropagation) }, { id: 'clash_clearance', ...named('clash_clearance', input.clashClearance) },
    { id: 'quantity_reconciliation', ...named('quantity_reconciliation', input.quantities) }, { id: 'permission_isolation', ...named('permission_isolation', input.permissions) },
    { id: 'recovery_performance', ...named('recovery_performance', input.recoveryPerformance) },
  ];
  const status: FederatedEvidenceStatus = gates.some(item => item.status === 'fail') ? 'fail' : gates.some(item => item.status === 'not_run') ? 'not_run' : 'pass';
  return { schema: 'nexyfab.federated-project-release-certificate.v1', projectRevision: input.project.revision, projectContentHash: input.projectContentHash, status, internalReady: status === 'pass', releaseReady: false, gates, issues: [...projectIssues, ...deepIssues, ...gates.filter(item => item.status !== 'pass').map(item => `${item.id}:${item.status}`)] };
}
