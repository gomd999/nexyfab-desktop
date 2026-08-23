import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { buildCivilReleaseCertificate, type CivilReleaseCertificate, type CivilReleaseCertificateInput } from './civilReleaseCertificate';
import { buildLandscapeReleaseCertificate, type LandscapeReleaseCertificate, type LandscapeReleaseCertificateInput } from './landscapeReleaseCertificate';

export const CIVIL_CONSTRUCTION_LANDSCAPE_COMMERCIAL_SCHEMA = 'nexyfab.civil-construction-landscape-commercial-qualification.v1' as const;
export const CONSTRUCTION_WORK_PACKAGE_RECEIPT_SCHEMA = 'nexyfab.construction-work-package-receipt.v1' as const;
export const COMMERCIAL_REVIEWER_ROLES = ['surveyor', 'independent_civil_field_inspector'] as const;
export type CommercialReviewerRole = (typeof COMMERCIAL_REVIEWER_ROLES)[number];
export type CommercialTrack = 'civil' | 'landscape' | 'construction';
export const COMMERCIAL_REQUIRED_AXES: Readonly<Record<CommercialTrack, readonly string[]>> = Object.freeze({
  civil: ['survey', 'surface', 'alignment_profile', 'cross_section', 'earthwork', 'landxml_native', 'hydraulic', 'quantity', 'field', 'safety'],
  landscape: ['terrain_authority', 'grading', 'planting', 'irrigation', 'catalog', 'quantity', 'field', 'safety'],
  construction: ['work_package', 'survey', 'quantity', 'hydraulic', 'catalog', 'safety', 'field', 'as_built'],
});
export const COMMERCIAL_ARTIFACT_ROLES = ['survey', 'surface', 'alignment_profile', 'cross_section', 'earthwork', 'planting', 'irrigation', 'field', 'quantity', 'hydraulic', 'catalog', 'civil_model', 'landscape_model', 'construction_model', 'as_built', 'safety'] as const;
export type CommercialArtifactRole = (typeof COMMERCIAL_ARTIFACT_ROLES)[number];

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_PARSER_BYTES = 64 * 1024 * 1024;
const MAX_READINESS_BYTES = 2 * 1024 * 1024;
const MAX_FRESHNESS_MS = 90 * 24 * 60 * 60 * 1000;
const INTERNAL_ASSERTION_AXES = Object.freeze({
  civil: ['requirements', 'coordinate_units', 'semantic_objects', 'geometry', 'relationships', 'provenance', 'revision_integrity', 'output_consistency', 'survey_control', 'surface_quality', 'alignment', 'profile', 'cross_sections', 'corridor', 'earthwork', 'drainage', 'construction_stages', 'structures', 'ifc_landxml_roundtrip', 'civil_drawings', 'quantities', 'repair'],
  landscape: ['requirements', 'coordinate_units', 'semantic_objects', 'geometry', 'relationships', 'provenance', 'revision_integrity', 'output_consistency', 'existing_conditions', 'terrain_grading', 'surface_flow', 'planting_data', 'mature_clearance', 'soil_volume', 'hardscape', 'irrigation', 'schedules_quantities', 'maintenance', 'drawing_consistency', 'repair'],
} as const);
const DATE = (value: unknown): number | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export type CommercialCrs = { epsg: number; horizontalDatum: string; verticalDatum: string; units: 'm' };
export type CommercialArtifact = {
  artifactId: string;
  role: CommercialArtifactRole;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  revision: number;
  buildId: string;
  targetHash: string;
  capturedAt: string;
  expiresAt: string;
  external: true;
  sourceSystem: 'Civil3D' | 'OpenRoads' | 'LandXML' | 'OpenPlant' | 'SurveyInstrument' | 'FieldInspection' | 'Contractor' | 'QuantitySystem' | 'HydraulicSolver' | 'Catalog';
};

export type NativeParserReceipt = {
  receiptId: string;
  format: 'landxml' | 'civil3d' | 'openroads' | 'surface' | 'alignment' | 'profile' | 'cross_section' | 'earthwork' | 'grading' | 'planting' | 'irrigation' | 'construction';
  artifactId: string;
  parserId: string;
  parserBinaryBytes: Uint8Array;
  parserBinaryByteLength: number;
  parserBinarySha256: string;
  parserSourceBytes: Uint8Array;
  parserSourceByteLength: number;
  parserSourceSha256: string;
  parserOutputBytes: Uint8Array;
  parserOutputByteLength: number;
  parserOutputSha256: string;
  result: 'verified';
  projectId: string;
  workspaceRevision: number;
  buildId: string;
  targetHash: string;
  issuedAt: string;
  expiresAt: string;
  keyId: string;
  publicKeyPem: string;
  signatureBase64: string;
  externalNative: true;
};
export type TrustedNativeParser = { keyId: string; publicKeyPem: string; roles: readonly ['native_parser'] };

export type CommercialEvidenceReceipt = {
  evidenceId: string;
  track: CommercialTrack;
  axis: string;
  artifactId: string;
  revision: number;
  targetHash: string;
  capturedAt: string;
  expiresAt: string;
};
export type CommercialReviewerAttestation = {
  attestationId: string;
  role: CommercialReviewerRole;
  reviewerId: string;
  keyId: string;
  publicKeyPem: string;
  signatureBase64: string;
  targetHash: string;
  revision: number;
  issuedAt: string;
  expiresAt: string;
  axes: readonly string[];
  evidenceIds: readonly string[];
};
export type TrustedCommercialReviewer = { keyId: string; publicKeyPem: string; roles: readonly CommercialReviewerRole[] };

/**
 * Canonical construction receipt bound to the external work-package source.
 * The receipt hash covers the identity/source material (not targetHash or the
 * self-referential receiptSha256 field); reviewer attestations bind that hash
 * to the final commercial target.
 */
export type ConstructionWorkPackageReceipt = {
  schema: typeof CONSTRUCTION_WORK_PACKAGE_RECEIPT_SCHEMA;
  receiptId: string;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  buildId: string;
  workPackageId: string;
  workspaceContentHash: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  sourceSystem: 'Contractor';
  fieldEvidenceId: string;
  reviewerIds: readonly [string, string];
  targetHash: string;
  receiptSha256: string;
  issuedAt: string;
  expiresAt: string;
};

export type InternalReadiness = { schema: string; status: 'pass' | 'fail' | 'not_run' | 'passed'; internalReady: boolean; releaseReady: false; workspaceRevision: number; modelContentHash: string; assertions?: readonly unknown[]; issues?: readonly string[] };
export type CivilConstructionLandscapeCommercialInput = {
  track: CommercialTrack;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  buildId: string;
  civilModelHash: string;
  civilModelRevision: number;
  civilCrs: CommercialCrs;
  surveyId: string;
  surfaceId: string;
  alignmentId: string;
  profileId: string;
  landscapeTerrainAuthorityHash: string;
  constructionBinding: { workPackageId: string; workspaceRevision: number; workspaceContentHash: string; artifactSha256: string; receiptSha256?: string };
  constructionWorkPackageReceipt?: ConstructionWorkPackageReceipt;
  constructionWorkPackageReceiptBytes?: Uint8Array;
  civilReadiness: InternalReadiness | CivilReleaseCertificate;
  landscapeReadiness: InternalReadiness | LandscapeReleaseCertificate;
  civilReadinessBytes: Uint8Array;
  civilReadinessSha256: string;
  landscapeReadinessBytes: Uint8Array;
  landscapeReadinessSha256: string;
  constructionInternalReceipt?: { artifactSha256: string; workspaceRevision: number; workspaceContentHash: string; releaseReady: false; claim?: string };
  artifacts: readonly CommercialArtifact[];
  nativeParsers: readonly NativeParserReceipt[];
  evidence: readonly CommercialEvidenceReceipt[];
  evidenceArtifacts: Readonly<Record<string, Uint8Array>>;
  trustedNativeParsers: Readonly<Record<string, TrustedNativeParser>>;
  trustedReviewers: Readonly<Record<string, TrustedCommercialReviewer>>;
  attestations: { surveyor: CommercialReviewerAttestation; independentCivilFieldInspector: CommercialReviewerAttestation };
  now?: string;
  maxFreshnessMs?: number;
};
export type CommercialQualificationResult = {
  schema: typeof CIVIL_CONSTRUCTION_LANDSCAPE_COMMERCIAL_SCHEMA;
  track: CommercialTrack;
  targetHash: string;
  revision: number;
  status: 'QUALIFIED' | 'HOLD';
  qualified: boolean;
  internalReadiness: { valid: boolean; issues: readonly string[] };
  nativeParser: { valid: boolean; issues: readonly string[] };
  evidence: { valid: boolean; issues: readonly string[]; axes: readonly string[] };
  attestations: { valid: boolean; issues: readonly string[] };
  blockers: readonly string[];
};
export type CivilConstructionLandscapeVerificationContext = {
  trustedNativeParsers: Readonly<Record<string, TrustedNativeParser>>;
  trustedReviewers: Readonly<Record<string, TrustedCommercialReviewer>>;
};

function trustRegistryIssues(context: CivilConstructionLandscapeVerificationContext | undefined): string[] {
  const issues: string[] = [];
  const parserEntries = Object.entries(context?.trustedNativeParsers ?? {});
  const reviewerEntries = Object.entries(context?.trustedReviewers ?? {});
  if (parserEntries.length === 0 || parserEntries.length > 32) issues.push('trusted_native_parser_registry_invalid');
  if (reviewerEntries.length !== COMMERCIAL_REVIEWER_ROLES.length || reviewerEntries.length > 32) issues.push('trusted_reviewer_registry_invalid');
  const fingerprints = new Set<string>();
  for (const [registryKey, registration] of [...parserEntries, ...reviewerEntries]) {
    const info = keyInfo(registration?.publicKeyPem);
    if (!info || registryKey !== registration?.keyId || registryKey !== info.fingerprint || fingerprints.has(info.fingerprint)) issues.push('trusted_registry_key_alias_or_reuse');
    if (info) fingerprints.add(info.fingerprint);
  }
  return issues;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('canonical_nonfinite'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value) { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`; }
  throw new Error('canonical_unsupported');
}
function hashCanonical(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
function validId(value: unknown): value is string { return typeof value === 'string' && ID.test(value) && value.trim() === value; }
function validHash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function unique(values: readonly string[]): boolean { return values.length === new Set(values).size; }
function exactSet(actual: readonly string[], expected: readonly string[]): boolean { return unique(actual) && actual.length === expected.length && expected.every(item => actual.includes(item)); }
function freshness(from: unknown, until: unknown, now: number, maximum: number): boolean { const start = DATE(from); const end = DATE(until); return start !== null && end !== null && start <= now && now <= end && end > start && end - start <= maximum; }
function keyInfo(value: unknown): { key: KeyObject; fingerprint: string } | null {
  try { const key = createPublicKey(value as string); if (key.asymmetricKeyType !== 'ed25519') return null; return { key, fingerprint: digest(new Uint8Array(key.export({ type: 'spki', format: 'der' }) as Buffer)) }; } catch { return null; }
}
function signedPayload(value: Record<string, unknown>): string {
  const { signatureBase64: _signature, publicKeyPem: _key, parserBinaryBytes: _binary, parserSourceBytes: _source, parserOutputBytes: _output, ...unsigned } = value;
  return canonical({ schema: CIVIL_CONSTRUCTION_LANDSCAPE_COMMERCIAL_SCHEMA, purpose: 'signature', ...unsigned });
}

export function civilReadinessFromCertificate(input: CivilReleaseCertificateInput): InternalReadiness {
  const certificate = buildCivilReleaseCertificate(input);
  return certificate;
}
export function landscapeReadinessFromCertificate(input: LandscapeReleaseCertificateInput): InternalReadiness {
  const certificate = buildLandscapeReleaseCertificate(input);
  return certificate;
}

function targetMaterial(input: CivilConstructionLandscapeCommercialInput): Record<string, unknown> {
  return { schema: CIVIL_CONSTRUCTION_LANDSCAPE_COMMERCIAL_SCHEMA, purpose: 'target', track: input.track, projectId: input.projectId, workspaceId: input.workspaceId, workspaceRevision: input.workspaceRevision, buildId: input.buildId, civilModelHash: input.civilModelHash, civilModelRevision: input.civilModelRevision, civilCrs: input.civilCrs, surveyId: input.surveyId, surfaceId: input.surfaceId, alignmentId: input.alignmentId, profileId: input.profileId, landscapeTerrainAuthorityHash: input.landscapeTerrainAuthorityHash, constructionBinding: input.constructionBinding, civilReadinessSha256: input.civilReadinessSha256, landscapeReadinessSha256: input.landscapeReadinessSha256, artifacts: [...input.artifacts].map(({ bytes: _bytes, targetHash: _target, ...artifact }) => artifact).sort((a, b) => a.artifactId.localeCompare(b.artifactId)), nativeParsers: [...input.nativeParsers].map(({ parserBinaryBytes: _binary, parserSourceBytes: _source, parserOutputBytes: _output, targetHash: _target, signatureBase64: _sig, publicKeyPem: _key, ...receipt }) => receipt).sort((a, b) => a.receiptId.localeCompare(b.receiptId)), evidence: [...input.evidence].map(({ targetHash: _target, ...evidence }) => evidence).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)) };
}
export function canonicalCivilConstructionLandscapeCommercialTarget(input: CivilConstructionLandscapeCommercialInput): string { return canonical(targetMaterial(input)); }
export function hashCivilConstructionLandscapeCommercialTarget(input: CivilConstructionLandscapeCommercialInput): string { return hashCanonical(targetMaterial(input)); }
export function canonicalCommercialAttestationPayload(attestation: CommercialReviewerAttestation): string { return signedPayload(attestation as unknown as Record<string, unknown>); }
export function canonicalNativeParserPayload(receipt: NativeParserReceipt): string { return signedPayload(receipt as unknown as Record<string, unknown>); }

function constructionWorkPackageReceiptMaterial(receipt: ConstructionWorkPackageReceipt): Record<string, unknown> {
  const { schema: _schema, targetHash: _targetHash, receiptSha256: _receiptSha256, ...identity } = receipt;
  return {
    schema: CONSTRUCTION_WORK_PACKAGE_RECEIPT_SCHEMA,
    purpose: 'construction-work-package-receipt',
    ...identity,
  };
}

export function canonicalConstructionWorkPackageReceiptPayload(receipt: ConstructionWorkPackageReceipt): string {
  return canonical(constructionWorkPackageReceiptMaterial(receipt));
}

export function hashConstructionWorkPackageReceipt(receipt: ConstructionWorkPackageReceipt): string {
  return hashCanonical(constructionWorkPackageReceiptMaterial(receipt));
}

/**
 * Verify the canonical construction receipt independently of the broader
 * artifact/parser checks. A receipt is useful only when it points at the
 * external Contractor source artifact, the external FieldInspection evidence,
 * and both already-bound reviewer attestations for this exact target.
 */
export function verifyConstructionWorkPackageReceipt(
  input: CivilConstructionLandscapeCommercialInput,
  targetHash: string,
  now: number,
  max: number,
): string[] {
  if (input.track !== 'construction') return [];
  const issues: string[] = [];
  const receipt = input.constructionWorkPackageReceipt;
  const bytes = input.constructionWorkPackageReceiptBytes;
  if (!receipt) return ['construction_work_package_receipt_missing'];
  if (receipt.schema !== CONSTRUCTION_WORK_PACKAGE_RECEIPT_SCHEMA) issues.push('construction_work_package_receipt_schema_invalid');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_READINESS_BYTES) {
    issues.push('construction_work_package_receipt_bytes_invalid');
  } else {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed = JSON.parse(text) as unknown;
      if (canonical(parsed) !== text || canonical(parsed) !== canonical(receipt)) issues.push('construction_work_package_receipt_canonical_binding_invalid');
    } catch { issues.push('construction_work_package_receipt_canonical_binding_invalid'); }
  }
  if (!validId(receipt.receiptId) || !validId(receipt.projectId) || !validId(receipt.workspaceId) || !validId(receipt.buildId) || !validId(receipt.workPackageId) || !validId(receipt.sourceArtifactId)) issues.push('construction_work_package_receipt_identity_invalid');
  if (receipt.projectId !== input.projectId || receipt.workspaceId !== input.workspaceId || receipt.workspaceRevision !== input.workspaceRevision || receipt.buildId !== input.buildId || receipt.workPackageId !== input.constructionBinding.workPackageId || receipt.workspaceContentHash !== input.constructionBinding.workspaceContentHash) issues.push('construction_work_package_receipt_binding_invalid');
  if (!validHash(receipt.sourceArtifactSha256) || receipt.sourceArtifactSha256 !== input.constructionBinding.artifactSha256) issues.push('construction_work_package_source_hash_invalid');
  if (receipt.sourceSystem !== 'Contractor') issues.push('construction_work_package_source_not_external');
  if (!validHash(receipt.targetHash) || receipt.targetHash !== targetHash) issues.push('construction_work_package_target_hash_invalid');
  if (!validHash(receipt.receiptSha256) || receipt.receiptSha256 !== input.constructionBinding.receiptSha256 || receipt.receiptSha256 !== hashConstructionWorkPackageReceipt(receipt)) issues.push('construction_work_package_receipt_hash_invalid');
  if (!freshness(receipt.issuedAt, receipt.expiresAt, now, max)) issues.push('construction_work_package_receipt_stale');

  const source = input.artifacts.find(item => item?.artifactId === receipt.sourceArtifactId);
  if (!source || source.role !== 'construction_model' || source.external !== true || source.sourceSystem !== 'Contractor' || source.sha256 !== receipt.sourceArtifactSha256) issues.push('construction_work_package_source_artifact_binding_invalid');

  const fieldEvidence = input.evidence.find(item => item?.evidenceId === receipt.fieldEvidenceId);
  const fieldArtifact = fieldEvidence ? input.artifacts.find(item => item?.artifactId === fieldEvidence.artifactId) : undefined;
  if (!fieldEvidence || fieldEvidence.track !== 'construction' || fieldEvidence.axis !== 'field' || !fieldArtifact || fieldArtifact.role !== 'field' || fieldArtifact.external !== true || fieldArtifact.sourceSystem !== 'FieldInspection') issues.push('construction_work_package_field_evidence_binding_invalid');

  const reviewerIds = Array.isArray(receipt.reviewerIds) ? receipt.reviewerIds : [];
  const attestationIds = [input.attestations?.surveyor?.reviewerId, input.attestations?.independentCivilFieldInspector?.reviewerId].filter((value): value is string => typeof value === 'string');
  if (reviewerIds.length !== 2 || !unique(reviewerIds) || !exactSet(reviewerIds, attestationIds)) issues.push('construction_work_package_reviewer_binding_invalid');
  if (!input.attestations?.surveyor?.evidenceIds?.includes(receipt.fieldEvidenceId) || !input.attestations?.independentCivilFieldInspector?.evidenceIds?.includes(receipt.fieldEvidenceId)) issues.push('construction_work_package_field_reviewer_evidence_unbound');
  if (input.attestations?.surveyor?.targetHash !== targetHash || input.attestations?.independentCivilFieldInspector?.targetHash !== targetHash) issues.push('construction_work_package_reviewer_target_invalid');
  return [...new Set(issues)];
}

function verifyArtifacts(input: CivilConstructionLandscapeCommercialInput, targetHash: string, now: number, max: number): { issues: string[]; map: Map<string, CommercialArtifact> } {
  const issues: string[] = []; const map = new Map<string, CommercialArtifact>(); const hashes = new Set<string>();
  const requiredCount = COMMERCIAL_REQUIRED_AXES[input.track].length;
  if (!Array.isArray(input.artifacts) || input.artifacts.length !== requiredCount || input.artifacts.length > 64) return { issues: ['artifact_exact_set_invalid'], map };
  if (input.artifacts.reduce((total, artifact) => total + (artifact?.bytes instanceof Uint8Array ? artifact.bytes.byteLength : 0), 0) > MAX_TOTAL_ARTIFACT_BYTES) issues.push('artifact_total_bytes_exceeded');
  for (const artifact of input.artifacts) {
    if (!artifact || typeof artifact !== 'object') { issues.push('artifact_item_invalid'); continue; }
    if (!validId(artifact.artifactId) || map.has(artifact.artifactId)) issues.push(`artifact_id_invalid_or_reused:${artifact?.artifactId}`);
    if (!COMMERCIAL_ARTIFACT_ROLES.includes(artifact.role)) issues.push(`artifact_role_invalid:${artifact?.artifactId}`);
    if (!(artifact.bytes instanceof Uint8Array) || artifact.bytes.byteLength === 0 || artifact.bytes.byteLength > MAX_BYTES || artifact.byteLength !== artifact.bytes.byteLength || !validHash(artifact.sha256) || digest(artifact.bytes) !== artifact.sha256) issues.push(`artifact_bytes_hash_invalid:${artifact?.artifactId}`);
    const evidenceBytes = input.evidenceArtifacts?.[artifact.artifactId];
    if (!(evidenceBytes instanceof Uint8Array) || evidenceBytes.byteLength !== artifact.byteLength || digest(evidenceBytes) !== artifact.sha256) issues.push(`evidence_artifact_bytes_mismatch:${artifact?.artifactId}`);
    if (hashes.has(artifact.sha256)) issues.push(`artifact_hash_reused:${artifact.sha256}`); else hashes.add(artifact.sha256);
    if (artifact.external !== true || !['Civil3D', 'OpenRoads', 'LandXML', 'OpenPlant', 'SurveyInstrument', 'FieldInspection', 'Contractor', 'QuantitySystem', 'HydraulicSolver', 'Catalog'].includes(artifact.sourceSystem)) issues.push(`artifact_not_external:${artifact?.artifactId}`);
    if (artifact.revision !== input.workspaceRevision || artifact.buildId !== input.buildId || artifact.targetHash !== targetHash) issues.push(`artifact_binding_invalid:${artifact?.artifactId}`);
    if (!freshness(artifact.capturedAt, artifact.expiresAt, now, max)) issues.push(`artifact_stale:${artifact?.artifactId}`);
    map.set(artifact.artifactId, artifact);
  }
  for (const artifactId of Object.keys(input.evidenceArtifacts ?? {})) if (!map.has(artifactId)) issues.push(`undeclared_evidence_artifact:${artifactId}`);
  const sourceSystems = new Set(input.artifacts.map(item => item?.sourceSystem));
  if (!sourceSystems.has('SurveyInstrument')) issues.push('survey_evidence_missing');
  if (!sourceSystems.has('FieldInspection')) issues.push('independent_field_evidence_missing');
  if (input.track === 'construction' && !sourceSystems.has('Contractor')) issues.push('contractor_evidence_missing');
  if (input.track === 'civil' && !([...sourceSystems].some(item => item === 'Civil3D' || item === 'OpenRoads'))) issues.push('civil_native_model_evidence_missing');
  if (input.track === 'landscape' && !([...sourceSystems].some(item => item === 'Civil3D' || item === 'OpenRoads' || item === 'LandXML'))) issues.push('landscape_native_model_evidence_missing');
  if (input.track === 'civil' && map.size && ![...map.values()].some(item => item.role === 'civil_model' && item.sha256 === input.civilModelHash)) issues.push('civil_model_artifact_hash_mismatch');
  if (input.track === 'landscape' && map.size && ![...map.values()].some(item => item.role === 'landscape_model' && item.sha256 === input.landscapeTerrainAuthorityHash)) issues.push('landscape_model_artifact_hash_mismatch');
  if (input.track === 'construction' && map.size && ![...map.values()].some(item => item.role === 'construction_model' && item.sha256 === input.constructionBinding.artifactSha256)) issues.push('construction_model_artifact_hash_mismatch');
  return { issues, map };
}

function verifyNativeParsers(input: CivilConstructionLandscapeCommercialInput, artifacts: Map<string, CommercialArtifact>, targetHash: string, now: number, max: number): string[] {
  const issues: string[] = []; const ids = new Set<string>(); const keys = new Set<string>(); const formats = new Set<string>();
  if (!Array.isArray(input.nativeParsers) || input.nativeParsers.length === 0 || input.nativeParsers.length > 32) return ['native_parser_collection_invalid'];
  if (input.nativeParsers.reduce((total, receipt) => total + (receipt?.parserBinaryBytes instanceof Uint8Array ? receipt.parserBinaryBytes.byteLength : 0) + (receipt?.parserSourceBytes instanceof Uint8Array ? receipt.parserSourceBytes.byteLength : 0) + (receipt?.parserOutputBytes instanceof Uint8Array ? receipt.parserOutputBytes.byteLength : 0), 0) > MAX_TOTAL_PARSER_BYTES) issues.push('native_parser_total_bytes_exceeded');
  for (const receipt of input.nativeParsers) {
    if (!receipt || typeof receipt !== 'object') { issues.push('native_receipt_item_invalid'); continue; }
    if (!validId(receipt.receiptId) || ids.has(receipt.receiptId)) issues.push(`native_receipt_replay:${receipt?.receiptId}`); ids.add(receipt.receiptId);
    if (!artifacts.has(receipt.artifactId)) issues.push(`native_artifact_missing:${receipt?.receiptId}`);
    if (!receipt.externalNative || receipt.format === 'landxml' && receipt.parserId.toLowerCase().includes('json')) issues.push(`native_parser_not_external:${receipt?.receiptId}`);
    if (!(receipt.parserBinaryBytes instanceof Uint8Array) || receipt.parserBinaryBytes.byteLength === 0 || receipt.parserBinaryBytes.byteLength > MAX_BYTES || receipt.parserBinaryByteLength !== receipt.parserBinaryBytes.byteLength || !validHash(receipt.parserBinarySha256) || digest(receipt.parserBinaryBytes) !== receipt.parserBinarySha256) issues.push(`native_binary_invalid:${receipt?.receiptId}`);
    if (!(receipt.parserSourceBytes instanceof Uint8Array) || receipt.parserSourceBytes.byteLength === 0 || receipt.parserSourceBytes.byteLength > MAX_BYTES || receipt.parserSourceByteLength !== receipt.parserSourceBytes.byteLength || !validHash(receipt.parserSourceSha256) || digest(receipt.parserSourceBytes) !== receipt.parserSourceSha256) issues.push(`native_source_invalid:${receipt?.receiptId}`);
    if (!(receipt.parserOutputBytes instanceof Uint8Array) || receipt.parserOutputBytes.byteLength === 0 || receipt.parserOutputBytes.byteLength > MAX_BYTES || receipt.parserOutputByteLength !== receipt.parserOutputBytes.byteLength || !validHash(receipt.parserOutputSha256) || digest(receipt.parserOutputBytes) !== receipt.parserOutputSha256 || receipt.result !== 'verified') issues.push(`native_output_invalid:${receipt?.receiptId}`);
    if (receipt.targetHash !== targetHash || receipt.workspaceRevision !== input.workspaceRevision || receipt.projectId !== input.projectId || receipt.buildId !== input.buildId) issues.push(`native_binding_invalid:${receipt?.receiptId}`);
    if (!freshness(receipt.issuedAt, receipt.expiresAt, now, max)) issues.push(`native_stale:${receipt?.receiptId}`);
    if (keys.has(receipt.keyId)) issues.push(`native_key_reused:${receipt.keyId}`); keys.add(receipt.keyId);
    const registration = input.trustedNativeParsers[receipt.keyId]; const actual = keyInfo(receipt.publicKeyPem); const registered = keyInfo(registration?.publicKeyPem);
    if (!registration || !registration.roles.includes('native_parser') || !actual || !registered || actual.fingerprint !== registered.fingerprint || receipt.keyId !== actual.fingerprint || registration.keyId !== receipt.keyId) issues.push(`native_signer_not_trusted:${receipt?.receiptId}`);
    try { if (!actual || !verifySignature(null, Buffer.from(canonicalNativeParserPayload(receipt), 'utf8'), actual.key, Buffer.from(receipt.signatureBase64, 'base64'))) issues.push(`native_signature_invalid:${receipt?.receiptId}`); } catch { issues.push(`native_signature_invalid:${receipt?.receiptId}`); }
    if (formats.has(receipt.format)) issues.push(`native_format_replay:${receipt.format}`); formats.add(receipt.format);
  }
  if (input.track === 'civil' && ![...input.nativeParsers].some(item => item.format === 'landxml')) issues.push('native_landxml_receipt_missing');
  const requiredFormats: Record<CommercialTrack, readonly NativeParserReceipt['format'][]> = { civil: ['landxml'], landscape: ['grading', 'planting', 'irrigation'], construction: ['construction'] };
  for (const format of requiredFormats[input.track]) if (!formats.has(format)) issues.push(`native_format_receipt_missing:${format}`);
  if (input.nativeParsers.some(item => item.format === 'landxml' && !artifacts.get(item.artifactId)?.sourceSystem.match(/LandXML|Civil3D|OpenRoads/))) issues.push('native_landxml_source_invalid');
  return issues;
}

function verifyEvidence(input: CivilConstructionLandscapeCommercialInput, artifacts: Map<string, CommercialArtifact>, targetHash: string, now: number, max: number): { issues: string[]; axes: string[]; map: Map<string, CommercialEvidenceReceipt> } {
  const issues: string[] = []; const map = new Map<string, CommercialEvidenceReceipt>(); const axes = new Set<string>(); const required = COMMERCIAL_REQUIRED_AXES[input.track]; const artifactRoles = new Set<string>();
  if (!Array.isArray(input.evidence) || input.evidence.length !== required.length) return { issues: ['evidence_exact_set_invalid'], axes: [], map };
  for (const item of input.evidence) {
    if (!item || typeof item !== 'object') { issues.push('evidence_item_invalid'); continue; }
    if (!validId(item.evidenceId) || map.has(item.evidenceId)) issues.push(`evidence_replay:${item?.evidenceId}`);
    if (item.track !== input.track || !required.includes(item.axis) || axes.has(item.axis)) issues.push(`evidence_axis_invalid_or_duplicate:${item?.evidenceId}`);
    const artifact = artifacts.get(item.artifactId); if (!artifact) issues.push(`evidence_artifact_missing:${item?.evidenceId}`); else { if (artifactRoles.has(artifact.role)) issues.push(`evidence_role_reused:${artifact.role}`); artifactRoles.add(artifact.role); }
    if (item.targetHash !== targetHash || item.revision !== input.workspaceRevision || !freshness(item.capturedAt, item.expiresAt, now, max)) issues.push(`evidence_binding_or_freshness_invalid:${item?.evidenceId}`);
    map.set(item.evidenceId, item); axes.add(item.axis);
  }
  for (const axis of required) if (!axes.has(axis)) issues.push(`evidence_axis_missing:${axis}`);
  if (artifactRoles.size !== required.length) issues.push('evidence_artifact_role_set_invalid');
  if (input.track === 'construction' && input.constructionInternalReceipt && !input.artifacts.some(item => item.external && item.sourceSystem === 'Contractor')) issues.push('construction_internal_receipt_cannot_qualify');
  return { issues, axes: [...axes].sort(), map };
}

function verifyAttestation(attestation: CommercialReviewerAttestation | null | undefined, role: CommercialReviewerRole, input: CivilConstructionLandscapeCommercialInput, targetHash: string, evidence: Map<string, CommercialEvidenceReceipt>, now: number, max: number): string[] {
  const issues: string[] = []; if (!attestation) return [`${role}:missing`];
  if (attestation.role !== role) issues.push(`${role}:cross_role`); if (attestation.targetHash !== targetHash || attestation.revision !== input.workspaceRevision) issues.push(`${role}:binding_invalid`); if (!freshness(attestation.issuedAt, attestation.expiresAt, now, max)) issues.push(`${role}:stale`);
  const required = COMMERCIAL_REQUIRED_AXES[input.track]; if (!Array.isArray(attestation.axes) || !exactSet(attestation.axes, required)) issues.push(`${role}:axes_incomplete`);
  const expectedEvidence = [...evidence.keys()].sort(); if (!Array.isArray(attestation.evidenceIds) || !exactSet([...attestation.evidenceIds].sort(), expectedEvidence)) issues.push(`${role}:evidence_set_mismatch`);
  const registration = input.trustedReviewers[attestation.keyId]; const actual = keyInfo(attestation.publicKeyPem); const registered = keyInfo(registration?.publicKeyPem);
  if (!registration || registration.keyId !== attestation.keyId || !registration.roles.includes(role) || !actual || !registered || actual.fingerprint !== registered.fingerprint || attestation.keyId !== actual.fingerprint) issues.push(`${role}:reviewer_not_trusted`);
  try { if (!actual || !verifySignature(null, Buffer.from(canonicalCommercialAttestationPayload(attestation), 'utf8'), actual.key, Buffer.from(attestation.signatureBase64, 'base64'))) issues.push(`${role}:signature_invalid`); } catch { issues.push(`${role}:signature_invalid`); }
  return issues;
}

function readinessIssues(input: CivilConstructionLandscapeCommercialInput): string[] {
  const issues: string[] = [];
  for (const [name, value, bytes, declaredHash, schema, modelHash] of [
    ['civil', input.civilReadiness, input.civilReadinessBytes, input.civilReadinessSha256, 'nexyfab.civil-release-certificate.v1', input.civilModelHash],
    ['landscape', input.landscapeReadiness, input.landscapeReadinessBytes, input.landscapeReadinessSha256, 'nexyfab.landscape-release-certificate.v1', input.landscapeTerrainAuthorityHash],
  ] as const) {
    const assertions = Array.isArray(value?.assertions) ? value.assertions as readonly { axis?: unknown; status?: unknown; reason?: unknown }[] : [];
    const axes = assertions.map(item => item?.axis).filter((axis): axis is string => typeof axis === 'string');
    const assertionsValid = exactSet(axes, INTERNAL_ASSERTION_AXES[name]) && assertions.every(item => item?.status === 'pass' && typeof item?.reason === 'string' && item.reason.length > 0);
    if (!value || value.schema !== schema || value.status !== 'pass' || value.internalReady !== true || value.releaseReady !== false || value.workspaceRevision !== input.workspaceRevision || value.modelContentHash !== modelHash || !assertionsValid || !Array.isArray(value.issues) || value.issues.length !== 0) issues.push(`${name}_internal_readiness_not_passed`);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_READINESS_BYTES || !validHash(declaredHash) || digest(bytes) !== declaredHash) { issues.push(`${name}_readiness_bytes_invalid`); continue; }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); const parsed = JSON.parse(text) as unknown;
      if (canonical(parsed) !== text || canonical(parsed) !== canonical(value)) issues.push(`${name}_readiness_canonical_binding_invalid`);
    } catch { issues.push(`${name}_readiness_canonical_binding_invalid`); }
  }
  return issues;
}

function verifyTrackArtifactRoles(input: CivilConstructionLandscapeCommercialInput, evidence: Map<string, CommercialEvidenceReceipt>, artifacts: Map<string, CommercialArtifact>): string[] {
  const expected: Record<CommercialTrack, Readonly<Record<string, CommercialArtifactRole>>> = {
    civil: { survey: 'survey', surface: 'surface', alignment_profile: 'alignment_profile', cross_section: 'cross_section', earthwork: 'earthwork', landxml_native: 'civil_model', hydraulic: 'hydraulic', quantity: 'quantity', field: 'field', safety: 'safety' },
    landscape: { terrain_authority: 'landscape_model', grading: 'surface', planting: 'planting', irrigation: 'irrigation', catalog: 'catalog', quantity: 'quantity', field: 'field', safety: 'safety' },
    construction: { work_package: 'construction_model', survey: 'survey', quantity: 'quantity', hydraulic: 'hydraulic', catalog: 'catalog', safety: 'safety', field: 'field', as_built: 'as_built' },
  };
  const issues: string[] = []; const usedRoles = new Set<string>();
  for (const axis of COMMERCIAL_REQUIRED_AXES[input.track]) {
    const item = [...evidence.values()].find(value => value.axis === axis); const artifact = item ? artifacts.get(item.artifactId) : undefined; const requiredRole = expected[input.track][axis];
    if (!artifact || artifact.role !== requiredRole) issues.push(`evidence_role_binding_invalid:${axis}`); else if (usedRoles.has(artifact.role)) issues.push(`evidence_role_reused:${artifact.role}`); else usedRoles.add(artifact.role);
  }
  return issues;
}

function qualifyCivilConstructionLandscapeCommercialUnsafe(input: CivilConstructionLandscapeCommercialInput | null | undefined, verificationNow: string | Date = new Date(), context?: CivilConstructionLandscapeVerificationContext): CommercialQualificationResult {
  const fallback = { schema: CIVIL_CONSTRUCTION_LANDSCAPE_COMMERCIAL_SCHEMA, track: input?.track ?? 'civil', targetHash: '0'.repeat(64), revision: input?.workspaceRevision ?? -1, status: 'HOLD' as const, qualified: false, internalReadiness: { valid: false, issues: ['input_missing'] }, nativeParser: { valid: false, issues: ['input_missing'] }, evidence: { valid: false, issues: ['input_missing'], axes: [] }, attestations: { valid: false, issues: ['input_missing'] }, blockers: ['input_missing'] };
  if (!input) return fallback;
  const verifierInput: CivilConstructionLandscapeCommercialInput = { ...input, trustedNativeParsers: context?.trustedNativeParsers ?? {}, trustedReviewers: context?.trustedReviewers ?? {} };
  const blockers: string[] = []; const now = verificationNow instanceof Date ? verificationNow.getTime() : DATE(verificationNow); const max = Number.isSafeInteger(input.maxFreshnessMs) && (input.maxFreshnessMs ?? 0) > 0 ? Math.min(input.maxFreshnessMs!, MAX_FRESHNESS_MS) : MAX_FRESHNESS_MS;
  blockers.push(...trustRegistryIssues(context));
  if (now === null) blockers.push('verification_clock_invalid');
  const supportedTrack = input.track === 'civil' || input.track === 'landscape' || input.track === 'construction';
  if (!supportedTrack) blockers.push('track_invalid');
  if (!validId(input.projectId) || !validId(input.workspaceId) || !validId(input.buildId) || !Number.isSafeInteger(input.workspaceRevision) || input.workspaceRevision < 0 || input.civilModelRevision !== input.workspaceRevision || !validHash(input.civilModelHash) || !validId(input.surveyId) || !validId(input.surfaceId) || !validId(input.alignmentId) || !validId(input.profileId) || !validHash(input.landscapeTerrainAuthorityHash) || !input.civilCrs || !Number.isSafeInteger(input.civilCrs.epsg) || input.civilCrs.epsg <= 0 || !input.civilCrs.horizontalDatum || !input.civilCrs.verticalDatum || input.civilCrs.units !== 'm') blockers.push('project_crs_or_revision_binding_invalid');
  if (!input.constructionBinding || !validId(input.constructionBinding.workPackageId) || input.constructionBinding.workspaceRevision !== input.workspaceRevision || !validHash(input.constructionBinding.workspaceContentHash) || !validHash(input.constructionBinding.artifactSha256) || (input.constructionInternalReceipt && (input.constructionInternalReceipt.releaseReady !== false || input.constructionInternalReceipt.workspaceRevision !== input.workspaceRevision || input.constructionInternalReceipt.workspaceContentHash !== input.constructionBinding.workspaceContentHash))) blockers.push('construction_binding_invalid');
  let targetHash = '0'.repeat(64); try { targetHash = hashCivilConstructionLandscapeCommercialTarget(verifierInput); } catch { blockers.push('target_hash_generation_failed'); }
  const readiness = readinessIssues(verifierInput); blockers.push(...readiness);
  const artifactCheck = now === null ? { issues: ['verification_clock_invalid'], map: new Map<string, CommercialArtifact>() } : verifyArtifacts(verifierInput, targetHash, now, max); blockers.push(...artifactCheck.issues);
  const nativeIssues = now === null ? ['verification_clock_invalid'] : verifyNativeParsers(verifierInput, artifactCheck.map, targetHash, now, max); blockers.push(...nativeIssues);
  const evidence = now === null ? { issues: ['verification_clock_invalid'], axes: [] as string[], map: new Map<string, CommercialEvidenceReceipt>() } : !supportedTrack ? { issues: ['track_invalid'], axes: [] as string[], map: new Map<string, CommercialEvidenceReceipt>() } : verifyEvidence(verifierInput, artifactCheck.map, targetHash, now, max); blockers.push(...evidence.issues);
  if (supportedTrack) blockers.push(...verifyTrackArtifactRoles(verifierInput, evidence.map, artifactCheck.map));
  const constructionReceiptIssues = now === null ? ['verification_clock_invalid'] : verifyConstructionWorkPackageReceipt(verifierInput, targetHash, now, max); blockers.push(...constructionReceiptIssues);
  const attestationIssues = now === null ? ['verification_clock_invalid'] : [...verifyAttestation(input.attestations?.surveyor, 'surveyor', verifierInput, targetHash, evidence.map, now, max), ...verifyAttestation(input.attestations?.independentCivilFieldInspector, 'independent_civil_field_inspector', verifierInput, targetHash, evidence.map, now, max)];
  if (input.attestations?.surveyor?.keyId === input.attestations?.independentCivilFieldInspector?.keyId || input.attestations?.surveyor?.reviewerId === input.attestations?.independentCivilFieldInspector?.reviewerId) attestationIssues.push('reviewer_keys_or_identities_must_be_distinct');
  const parserKeys = new Set(input.nativeParsers?.map(item => item?.keyId));
  if (parserKeys.has(input.attestations?.surveyor?.keyId) || parserKeys.has(input.attestations?.independentCivilFieldInspector?.keyId)) attestationIssues.push('parser_and_reviewer_keys_must_be_distinct');
  blockers.push(...attestationIssues);
  const uniqueBlockers = [...new Set(blockers)]; const qualified = uniqueBlockers.length === 0;
  return { schema: CIVIL_CONSTRUCTION_LANDSCAPE_COMMERCIAL_SCHEMA, track: input.track, targetHash, revision: input.workspaceRevision, status: qualified ? 'QUALIFIED' : 'HOLD', qualified, internalReadiness: { valid: readiness.length === 0, issues: readiness }, nativeParser: { valid: nativeIssues.length === 0, issues: nativeIssues }, evidence: { valid: evidence.issues.length === 0, issues: evidence.issues, axes: evidence.axes }, attestations: { valid: attestationIssues.length === 0, issues: attestationIssues }, blockers: uniqueBlockers };
}

export function qualifyCivilConstructionLandscapeCommercial(input: CivilConstructionLandscapeCommercialInput | null | undefined, verificationNow: string | Date = new Date(), context?: CivilConstructionLandscapeVerificationContext): CommercialQualificationResult {
  try {
    return qualifyCivilConstructionLandscapeCommercialUnsafe(input, verificationNow, context);
  } catch {
    return {
      schema: CIVIL_CONSTRUCTION_LANDSCAPE_COMMERCIAL_SCHEMA,
      track: input?.track === 'landscape' || input?.track === 'construction' ? input.track : 'civil',
      targetHash: '0'.repeat(64),
      revision: Number.isSafeInteger(input?.workspaceRevision) ? input!.workspaceRevision : -1,
      status: 'HOLD',
      qualified: false,
      internalReadiness: { valid: false, issues: ['malformed_input'] },
      nativeParser: { valid: false, issues: ['malformed_input'] },
      evidence: { valid: false, issues: ['malformed_input'], axes: [] },
      attestations: { valid: false, issues: ['malformed_input'] },
      blockers: ['malformed_input'],
    };
  }
}
