import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  buildBuildingReleaseCertificate,
  type BuildingReleaseCertificate,
  type BuildingReleaseCertificateInput,
} from './buildingReleaseCertificate';
import {
  buildInteriorReleaseCertificate,
  type InteriorReleaseCertificate,
  type InteriorReleaseCertificateInput,
} from './interiorReleaseCertificate';
import type { CadWorkspaceEnvelopeInput } from '@/lib/cad/workspaceRevisionStore';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_CERTIFICATE_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_PARSER_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACTS = 16;
const MAX_REVIEW_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export type CommercialDiscipline = 'building' | 'interior';
export type CommercialArtifactRole = 'step' | 'ifc' | 'drawing' | 'quantity' | 'rcp' | 'elevation' | 'section' | 'field' | 'catalog';
export type CommercialExecutionMode = 'fixture' | 'runtime';
export type CommercialReviewerRole = 'native_parser' | 'architect' | 'independent_cad_bim_reviewer';

export const COMMERCIAL_ARTIFACT_ROLES: readonly CommercialArtifactRole[] = [
  'step', 'ifc', 'drawing', 'quantity', 'rcp', 'elevation', 'section', 'field', 'catalog',
];

export interface CommercialWorkspaceIdentity {
  workspaceId: string;
  revision: number;
  modelContentHash: string;
  /** A stable host/document identity, not a display label. */
  hostIdentity: string;
}

export interface CommercialArtifact {
  artifactId: string;
  role: CommercialArtifactRole;
  bytes: Uint8Array;
  sha256: string;
  size: number;
  revision: number;
  buildId: string;
  evidenceOrigin: 'external' | 'fixture';
}

export interface TrustedCommercialIdentity {
  reviewerId: string;
  role: CommercialReviewerRole;
  publicKeyPem: string;
  fingerprintSha256: string;
}

export interface CommercialParserReceipt {
  reviewerId: string;
  role: 'native_parser';
  keyFingerprintSha256: string;
  parserBinaryBytes: Uint8Array;
  parserBinarySha256: string;
  parserSourceBytes: Uint8Array;
  parserSourceBytesSha256: string;
  parserId: string;
  nativeFormat: 'step-ifc-drawing-set';
  externalNative: true;
  parsedArtifactRoles: readonly CommercialArtifactRole[];
  parserOutputBytes: Uint8Array;
  parserOutputSha256: string;
  parserOutputSize: number;
  result: 'verified';
  artifactManifestSha256: string;
  revision: number;
  buildId: string;
  targetSha256: string;
  signatureBase64: string;
}

export interface CommercialReviewerApproval {
  reviewerId: string;
  role: 'architect' | 'independent_cad_bim_reviewer';
  keyFingerprintSha256: string;
  reviewedAt: string;
  targetSha256: string;
  artifactManifestSha256: string;
  artifactRoles: readonly CommercialArtifactRole[];
  signatureBase64: string;
}

export interface CommercialDisciplineInput<C, I> {
  workspace: CadWorkspaceEnvelopeInput;
  identity: CommercialWorkspaceIdentity;
  internalInput: I;
  certificate: C;
  certificateBytes: Uint8Array;
  certificateSha256: string;
  artifacts: readonly CommercialArtifact[];
  parserReceipt: CommercialParserReceipt;
  approvals: readonly CommercialReviewerApproval[];
}

export interface ArchitectureInteriorCommercialQualificationInput {
  mode: CommercialExecutionMode;
  building: CommercialDisciplineInput<BuildingReleaseCertificate, BuildingReleaseCertificateInput>;
  interior: CommercialDisciplineInput<InteriorReleaseCertificate, InteriorReleaseCertificateInput>;
  trustedRegistry: readonly TrustedCommercialIdentity[];
}

export interface ArchitectureInteriorCommercialVerificationContext {
  mode: CommercialExecutionMode;
  trustedRegistry: readonly TrustedCommercialIdentity[];
}

export interface CommercialDisciplineResult {
  discipline: CommercialDiscipline;
  status: 'QUALIFIED' | 'HOLD';
  releaseReady: boolean;
  targetSha256: string;
  blockers: string[];
  runtimeEvidenceBoundary: {
    externalEvidenceRequired: boolean;
    externalEvidencePresent: boolean;
  };
}

export interface ArchitectureInteriorCommercialQualificationResult {
  schema: 'nexyfab.architecture-interior-commercial-qualification.v1';
  status: 'QUALIFIED' | 'HOLD';
  releaseReady: boolean;
  building: CommercialDisciplineResult;
  interior: CommercialDisciplineResult;
  blockers: string[];
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non_canonical_number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  throw new Error('non_canonical_value');
}

function digestBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function canonicalBytes(value: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(canonicalize(value), 'utf8'));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeBytes(value: unknown, max: number): value is Uint8Array {
  return value instanceof Uint8Array && value.length > 0 && value.length <= max;
}

function validSha(value: string): boolean { return SHA256.test(value); }

function publicKeyFingerprint(publicKeyPem: string): string | undefined {
  try {
    return digestBytes(new Uint8Array(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })));
  } catch { return undefined; }
}

function registryIssues(registry: readonly TrustedCommercialIdentity[] | null | undefined): string[] {
  if (!Array.isArray(registry) || registry.length === 0 || registry.length > 32) return ['trust_registry_collection_invalid'];
  const issues: string[] = [], ids = new Set<string>(), fingerprints = new Set<string>();
  for (const identity of registry) {
    if (!identity || typeof identity !== 'object' || !identity.reviewerId?.trim() || !['native_parser', 'architect', 'independent_cad_bim_reviewer'].includes(identity.role) || !validSha(identity.fingerprintSha256) || publicKeyFingerprint(identity.publicKeyPem) !== identity.fingerprintSha256) { issues.push('trust_registry_identity_invalid'); continue; }
    if (ids.has(identity.reviewerId) || fingerprints.has(identity.fingerprintSha256)) issues.push('trust_registry_identity_or_key_reused');
    ids.add(identity.reviewerId); fingerprints.add(identity.fingerprintSha256);
  }
  return [...new Set(issues)];
}

function signaturePayload(input: {
  discipline: CommercialDiscipline;
  targetSha256: string;
  reviewerId: string;
  role: CommercialReviewerRole;
  keyFingerprintSha256: string;
  reviewedAt?: string;
  artifactManifestSha256?: string;
  artifactRoles?: readonly CommercialArtifactRole[];
}): Uint8Array {
  return canonicalBytes(input);
}

function verifySignature(identity: TrustedCommercialIdentity | undefined, payload: Uint8Array, signatureBase64: string): boolean {
  if (!identity || !signatureBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)) return false;
  try { return verify(null, Buffer.from(payload), createPublicKey(identity.publicKeyPem), Buffer.from(signatureBase64, 'base64')); } catch { return false; }
}

function internalCertificateMatches<C, I>(
  discipline: CommercialDiscipline,
  input: CommercialDisciplineInput<C, I>,
  rebuilt: C,
): string[] {
  const blockers: string[] = [];
  if (!input.internalInput || !input.certificate) blockers.push(`${discipline}:synthetic_or_missing_internal_certificate`);
  if (canonicalize(input.certificate) !== canonicalize(rebuilt)) blockers.push(`${discipline}:internal_readiness_certificate_mismatch`);
  const certificateBytes = input.certificateBytes;
  if (!safeBytes(certificateBytes, MAX_CERTIFICATE_BYTES)) blockers.push(`${discipline}:certificate_bytes_invalid_or_oversized`);
  else {
    if (digestBytes(certificateBytes) !== input.certificateSha256 || !validSha(input.certificateSha256)) blockers.push(`${discipline}:certificate_sha256_mismatch`);
    try {
      const parsed: unknown = JSON.parse(Buffer.from(certificateBytes).toString('utf8'));
      if (canonicalize(parsed) !== canonicalize(input.certificate) || !equalBytes(canonicalBytes(parsed), certificateBytes)) blockers.push(`${discipline}:certificate_not_canonical`);
    } catch { blockers.push(`${discipline}:certificate_json_invalid`); }
  }
  const certificate = input.certificate as { internalReady?: boolean; releaseReady?: boolean; status?: string };
  if (certificate.internalReady !== true || certificate.releaseReady !== false || certificate.status !== 'pass') blockers.push(`${discipline}:internal_certificate_not_ready_or_hold_boundary_invalid`);
  return blockers;
}

function validateArtifacts(
  discipline: CommercialDiscipline,
  input: CommercialDisciplineInput<unknown, unknown>,
  mode: CommercialExecutionMode,
): { blockers: string[]; manifestSha256?: string; externalEvidencePresent: boolean } {
  const blockers: string[] = [];
  const artifacts = input.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length !== COMMERCIAL_ARTIFACT_ROLES.length || artifacts.length > MAX_ARTIFACTS) blockers.push(`${discipline}:exact_artifact_set_required`);
  const seenRoles = new Set<string>(), seenIds = new Set<string>(), seenHashes = new Set<string>();
  let externalEvidencePresent = artifacts.length === COMMERCIAL_ARTIFACT_ROLES.length;
  const buildIds = new Set<string>();
  for (const artifact of artifacts ?? []) {
    if (!artifact || typeof artifact !== 'object') { blockers.push(`${discipline}:malformed_artifact`); continue; }
    if (seenRoles.has(artifact.role)) blockers.push(`${discipline}:duplicate_artifact_role:${artifact.role}`); seenRoles.add(artifact.role);
    if (seenIds.has(artifact.artifactId)) blockers.push(`${discipline}:duplicate_artifact_id`); seenIds.add(artifact.artifactId);
    if (seenHashes.has(artifact.sha256)) blockers.push(`${discipline}:artifact_hash_reused`); seenHashes.add(artifact.sha256);
    if (!COMMERCIAL_ARTIFACT_ROLES.includes(artifact.role) || !artifact.artifactId?.trim() || !artifact.buildId?.trim()) blockers.push(`${discipline}:artifact_identity_invalid`);
    else buildIds.add(artifact.buildId);
    if (!safeBytes(artifact.bytes, MAX_ARTIFACT_BYTES) || artifact.size !== artifact.bytes.length || digestBytes(artifact.bytes) !== artifact.sha256 || !validSha(artifact.sha256)) blockers.push(`${discipline}:artifact_bytes_or_hash_invalid:${artifact.role}`);
    if (artifact.revision !== input.identity.revision) blockers.push(`${discipline}:artifact_revision_mismatch:${artifact.role}`);
    if (artifact.evidenceOrigin !== 'external') externalEvidencePresent = false;
  }
  for (const role of COMMERCIAL_ARTIFACT_ROLES) if (!seenRoles.has(role)) blockers.push(`${discipline}:missing_artifact_role:${role}`);
  if (buildIds.size !== 1) blockers.push(`${discipline}:artifact_build_id_set_invalid`);
  if (mode === 'runtime' && !(artifacts ?? []).every(artifact => artifact.evidenceOrigin === 'external')) blockers.push(`${discipline}:runtime_external_evidence_required`);
  return { blockers, manifestSha256: blockers.length ? undefined : commercialArtifactManifestSha256(artifacts), externalEvidencePresent };
}

export function commercialArtifactManifestSha256(artifacts: readonly CommercialArtifact[]): string {
  const manifest = artifacts.map(artifact => ({ artifactId: artifact.artifactId, role: artifact.role, sha256: artifact.sha256, size: artifact.size, revision: artifact.revision, buildId: artifact.buildId, evidenceOrigin: artifact.evidenceOrigin })).sort((left, right) => left.role.localeCompare(right.role));
  return digestBytes(canonicalBytes(manifest));
}

export function commercialTargetSha256(
  discipline: CommercialDiscipline,
  identity: CommercialWorkspaceIdentity,
  certificateSha256: string,
  artifactManifestSha256: string,
  parserBindingSha256: string,
): string {
  return digestBytes(canonicalBytes({ schema: 'nexyfab.architecture-interior-commercial-target.v1', discipline, workspaceId: identity.workspaceId, revision: identity.revision, modelContentHash: identity.modelContentHash, hostIdentity: identity.hostIdentity, certificateSha256, artifactManifestSha256, parserBindingSha256 }));
}

export function commercialParserBindingSha256(parser: CommercialParserReceipt): string {
  return digestBytes(canonicalBytes({ reviewerId: parser.reviewerId, role: parser.role, keyFingerprintSha256: parser.keyFingerprintSha256, parserId: parser.parserId, nativeFormat: parser.nativeFormat, externalNative: parser.externalNative, parsedArtifactRoles: [...parser.parsedArtifactRoles].sort(), parserBinarySha256: parser.parserBinarySha256, parserSourceBytesSha256: parser.parserSourceBytesSha256, parserOutputSha256: parser.parserOutputSha256, parserOutputSize: parser.parserOutputSize, result: parser.result, artifactManifestSha256: parser.artifactManifestSha256, revision: parser.revision, buildId: parser.buildId }));
}

function validateDiscipline(
  discipline: CommercialDiscipline,
  input: CommercialDisciplineInput<BuildingReleaseCertificate | InteriorReleaseCertificate, BuildingReleaseCertificateInput | InteriorReleaseCertificateInput>,
  registry: readonly TrustedCommercialIdentity[],
  mode: CommercialExecutionMode,
  now: Date,
  preflightIssues: readonly string[] = [],
): CommercialDisciplineResult {
  const blockers: string[] = [...preflightIssues.map(issue => `${discipline}:${issue}`)];
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) blockers.push(`${discipline}:verification_clock_invalid`);
  if (mode !== 'fixture' && mode !== 'runtime') blockers.push(`${discipline}:execution_mode_invalid`);
  const identity = input.identity;
  if (!identity.workspaceId?.trim() || !Number.isSafeInteger(identity.revision) || identity.revision < 0 || !validSha(identity.modelContentHash) || !identity.hostIdentity?.trim()) blockers.push(`${discipline}:workspace_identity_invalid`);
  if (input.workspace.workspace.projectId !== identity.workspaceId || input.workspace.workspace.revision !== identity.revision || input.workspace.geometry.contentHash !== identity.modelContentHash) blockers.push(`${discipline}:workspace_identity_not_bound`);
  if (input.workspace.workspace.domain !== discipline) blockers.push(`${discipline}:workspace_domain_mismatch`);
  const certificate = input.certificate;
  if (certificate.workspaceRevision !== identity.revision || certificate.modelContentHash !== identity.modelContentHash) blockers.push(`${discipline}:certificate_workspace_binding_mismatch`);
  let rebuilt: BuildingReleaseCertificate | InteriorReleaseCertificate;
  try { rebuilt = discipline === 'building' ? buildBuildingReleaseCertificate(input.internalInput as BuildingReleaseCertificateInput) : buildInteriorReleaseCertificate(input.internalInput as InteriorReleaseCertificateInput); } catch { blockers.push(`${discipline}:internal_certificate_rebuild_failed`); rebuilt = certificate; }
  blockers.push(...internalCertificateMatches(discipline, input, rebuilt));
  if (discipline === 'interior') {
    const hostId = (input.internalInput as InteriorReleaseCertificateInput | undefined)?.hostAuthority?.payload.architectureDocumentId;
    if (!hostId || identity.hostIdentity !== hostId) blockers.push('interior:architecture_host_identity_not_bound');
  }
  const artifactCheck = validateArtifacts(discipline, input as CommercialDisciplineInput<unknown, unknown>, mode);
  blockers.push(...artifactCheck.blockers);
  const parser = input.parserReceipt;
  let parserBindingSha256 = 'invalid';
  try { parserBindingSha256 = commercialParserBindingSha256(parser); } catch { blockers.push(`${discipline}:parser_binding_generation_failed`); }
  const targetSha256 = commercialTargetSha256(discipline, identity, input.certificateSha256, artifactCheck.manifestSha256 ?? 'invalid', parserBindingSha256);
  const parserIdentity = registry.find(item => item.reviewerId === parser.reviewerId);
  if (parser.role !== 'native_parser' || !parserIdentity || parserIdentity.role !== 'native_parser' || parserIdentity.fingerprintSha256 !== parser.keyFingerprintSha256 || publicKeyFingerprint(parserIdentity.publicKeyPem) !== parser.keyFingerprintSha256) blockers.push(`${discipline}:parser_trust_registry_mismatch`);
  if (!safeBytes(parser.parserBinaryBytes, MAX_PARSER_BYTES) || !safeBytes(parser.parserSourceBytes, MAX_PARSER_BYTES) || !safeBytes(parser.parserOutputBytes, MAX_PARSER_BYTES) || digestBytes(parser.parserBinaryBytes) !== parser.parserBinarySha256 || digestBytes(parser.parserSourceBytes) !== parser.parserSourceBytesSha256 || digestBytes(parser.parserOutputBytes) !== parser.parserOutputSha256 || parser.parserOutputSize !== parser.parserOutputBytes.length || !validSha(parser.parserBinarySha256) || !validSha(parser.parserSourceBytesSha256) || !validSha(parser.parserOutputSha256)) blockers.push(`${discipline}:parser_source_binary_or_output_hash_invalid`);
  if (!parser.parserId?.trim() || parser.parserId.toLowerCase().includes('internal') || parser.parserId.toLowerCase().includes('json') || parser.nativeFormat !== 'step-ifc-drawing-set' || parser.externalNative !== true || parser.result !== 'verified' || !Array.isArray(parser.parsedArtifactRoles) || parser.parsedArtifactRoles.length !== COMMERCIAL_ARTIFACT_ROLES.length || new Set(parser.parsedArtifactRoles).size !== COMMERCIAL_ARTIFACT_ROLES.length || COMMERCIAL_ARTIFACT_ROLES.some(role => !parser.parsedArtifactRoles.includes(role))) blockers.push(`${discipline}:native_parser_semantics_invalid`);
  const artifactBuildIds = new Set(input.artifacts.map(item => item?.buildId));
  if (parser.artifactManifestSha256 !== artifactCheck.manifestSha256 || parser.revision !== identity.revision || artifactBuildIds.size !== 1 || !artifactBuildIds.has(parser.buildId) || parser.targetSha256 !== targetSha256) blockers.push(`${discipline}:parser_receipt_target_binding_mismatch`);
  if (!verifySignature(parserIdentity, signaturePayload({ discipline, targetSha256, reviewerId: parser.reviewerId, role: parser.role, keyFingerprintSha256: parser.keyFingerprintSha256 }), parser.signatureBase64)) blockers.push(`${discipline}:parser_signature_invalid`);
  const approvals = Array.isArray(input.approvals) ? input.approvals : [];
  if (approvals.length !== 2) blockers.push(`${discipline}:exact_reviewer_set_required`);
  const reviewerIds = new Set<string>(), fingerprints = new Set<string>();
  const requiredRoles: CommercialReviewerRole[] = ['architect', 'independent_cad_bim_reviewer'];
  for (const role of requiredRoles) {
    const approval = approvals.find(item => item.role === role);
    if (!approval) { blockers.push(`${discipline}:missing_reviewer:${role}`); continue; }
    if (approval.artifactManifestSha256 !== artifactCheck.manifestSha256 || !Array.isArray(approval.artifactRoles) || approval.artifactRoles.length !== COMMERCIAL_ARTIFACT_ROLES.length || new Set(approval.artifactRoles).size !== COMMERCIAL_ARTIFACT_ROLES.length || COMMERCIAL_ARTIFACT_ROLES.some(required => !approval.artifactRoles.includes(required))) blockers.push(`${discipline}:reviewer_artifact_set_mismatch:${role}`);
    if (reviewerIds.has(approval.reviewerId) || fingerprints.has(approval.keyFingerprintSha256) || approval.reviewerId === parser.reviewerId || approval.keyFingerprintSha256 === parser.keyFingerprintSha256) blockers.push(`${discipline}:reviewer_identity_reuse_or_self_trust`);
    reviewerIds.add(approval.reviewerId); fingerprints.add(approval.keyFingerprintSha256);
    const trusted = registry.find(item => item.reviewerId === approval.reviewerId);
    if (!trusted || trusted.role !== role || trusted.fingerprintSha256 !== approval.keyFingerprintSha256 || publicKeyFingerprint(trusted.publicKeyPem) !== approval.keyFingerprintSha256) blockers.push(`${discipline}:reviewer_registry_mismatch:${role}`);
    const reviewedAt = Date.parse(approval.reviewedAt);
    if (!Number.isFinite(reviewedAt) || reviewedAt > now.getTime() || now.getTime() - reviewedAt > MAX_REVIEW_AGE_MS) blockers.push(`${discipline}:reviewer_freshness_invalid:${role}`);
    if (approval.targetSha256 !== targetSha256 || !verifySignature(trusted, signaturePayload({ discipline, targetSha256, reviewerId: approval.reviewerId, role: approval.role, keyFingerprintSha256: approval.keyFingerprintSha256, reviewedAt: approval.reviewedAt, artifactManifestSha256: approval.artifactManifestSha256, artifactRoles: [...approval.artifactRoles].sort() }), approval.signatureBase64)) blockers.push(`${discipline}:reviewer_signature_or_target_invalid:${role}`);
  }
  const uniqueBlockers = [...new Set(blockers)];
  return { discipline, status: uniqueBlockers.length ? 'HOLD' : 'QUALIFIED', releaseReady: uniqueBlockers.length === 0, targetSha256, blockers: uniqueBlockers, runtimeEvidenceBoundary: { externalEvidenceRequired: mode === 'runtime', externalEvidencePresent: artifactCheck.externalEvidencePresent } };
}

/**
 * Commercial gate for architecture and interior. Existing release certificates are
 * re-built as internal readiness evidence; they are never treated as the external
 * IFC/DWG/PDF/field evidence required by the runtime boundary.
 */
export function qualifyArchitectureInteriorCommercial(input: ArchitectureInteriorCommercialQualificationInput, now = new Date(), context?: ArchitectureInteriorCommercialVerificationContext): ArchitectureInteriorCommercialQualificationResult {
  const verifierMode = context?.mode ?? 'runtime';
  try {
    const verifierRegistry = context?.trustedRegistry ?? [];
    const preflight = registryIssues(verifierRegistry);
    if (input.mode !== verifierMode) preflight.push('caller_execution_mode_not_authoritative');
    const building = validateDiscipline('building', input.building, verifierRegistry, verifierMode, now, preflight);
    const interior = validateDiscipline('interior', input.interior, verifierRegistry, verifierMode, now, preflight);
    const blockers = [...building.blockers, ...interior.blockers];
    return { schema: 'nexyfab.architecture-interior-commercial-qualification.v1', status: blockers.length ? 'HOLD' : 'QUALIFIED', releaseReady: blockers.length === 0, building, interior, blockers };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'malformed_input';
    const hold = (discipline: CommercialDiscipline): CommercialDisciplineResult => ({ discipline, status: 'HOLD', releaseReady: false, targetSha256: '', blockers: [`malformed_input:${message}`], runtimeEvidenceBoundary: { externalEvidenceRequired: verifierMode === 'runtime', externalEvidencePresent: false } });
    return { schema: 'nexyfab.architecture-interior-commercial-qualification.v1', status: 'HOLD', releaseReady: false, building: hold('building'), interior: hold('interior'), blockers: [`malformed_input:${message}`] };
  }
}

export const buildArchitectureInteriorCommercialQualification = qualifyArchitectureInteriorCommercial;
export const evaluateArchitectureInteriorCommercialQualification = qualifyArchitectureInteriorCommercial;

export function commercialSha256(bytes: Uint8Array): string { return digestBytes(bytes); }
export function commercialCanonicalBytes(value: unknown): Uint8Array { return canonicalBytes(value); }
export function commercialSignaturePayload(input: Parameters<typeof signaturePayload>[0]): Uint8Array { return signaturePayload(input); }
