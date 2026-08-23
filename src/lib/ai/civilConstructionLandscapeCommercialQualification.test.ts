import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_REQUIRED_AXES,
  canonicalCommercialAttestationPayload,
  canonicalNativeParserPayload,
  hashConstructionWorkPackageReceipt,
  hashCivilConstructionLandscapeCommercialTarget,
  qualifyCivilConstructionLandscapeCommercial,
  verifyConstructionWorkPackageReceipt,
  type CivilConstructionLandscapeCommercialInput,
  type CommercialArtifact,
  type CommercialReviewerAttestation,
  type NativeParserReceipt,
  type TrustedCommercialReviewer,
  type TrustedNativeParser,
  type CivilConstructionLandscapeVerificationContext,
  type ConstructionWorkPackageReceipt,
} from './civilConstructionLandscapeCommercialQualification';

const NOW = '2026-08-22T12:00:00.000Z';
const EXPIRY = '2026-09-01T12:00:00.000Z';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const keyPair = () => generateKeyPairSync('ed25519');
const pem = (key: ReturnType<typeof keyPair>['publicKey']) => key.export({ type: 'spki', format: 'pem' }).toString();
const keyId = (key: ReturnType<typeof keyPair>['publicKey']) => sha(new Uint8Array(key.export({ type: 'spki', format: 'der' }) as Buffer));
const canonical = (value: unknown): string => { if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`; };

function fixture(track: 'civil' | 'landscape' | 'construction' = 'civil'): CivilConstructionLandscapeCommercialInput {
  const revision = 7;
  const rolesByTrack = {
    civil: ['survey', 'surface', 'alignment_profile', 'cross_section', 'earthwork', 'civil_model', 'hydraulic', 'quantity', 'field', 'safety'],
    landscape: ['landscape_model', 'surface', 'planting', 'irrigation', 'catalog', 'quantity', 'field', 'safety'],
    construction: ['construction_model', 'survey', 'quantity', 'hydraulic', 'catalog', 'safety', 'field', 'as_built'],
  } as const;
  const roleByAxis = rolesByTrack[track];
  const artifacts: CommercialArtifact[] = roleByAxis.map((role, index) => {
    const bytes = new TextEncoder().encode(`evidence-${index}`);
    return { artifactId: `artifact-${index}`, role, bytes, byteLength: bytes.byteLength, sha256: sha(bytes), revision, buildId: 'build-7', targetHash: '', capturedAt: NOW, expiresAt: EXPIRY, external: true, sourceSystem: track === 'landscape' && index === 1 ? 'SurveyInstrument' : role === 'civil_model' || role === 'landscape_model' ? 'Civil3D' : role === 'construction_model' || role === 'as_built' ? 'Contractor' : role === 'survey' ? 'SurveyInstrument' : role === 'field' ? 'FieldInspection' : role === 'safety' ? 'Contractor' : role === 'hydraulic' ? 'HydraulicSolver' : role === 'quantity' ? 'QuantitySystem' : role === 'catalog' ? 'Catalog' : 'Civil3D' };
  });
  const formats = track === 'civil' ? ['landxml'] as const : track === 'landscape' ? ['grading', 'planting', 'irrigation'] as const : ['construction'] as const;
  const nativeKeyPairs = formats.map(() => keyPair());
  const nativeParsers: NativeParserReceipt[] = formats.map((format, index) => {
    const parserOutputBytes = new TextEncoder().encode(`native-output-${format}`);
    const parserBinaryBytes = new TextEncoder().encode(`native-binary-${format}`);
    const parserSourceBytes = new TextEncoder().encode(`native-source-${format}`);
    const artifactId = track === 'civil' ? 'artifact-5' : track === 'landscape' ? `artifact-${index + 1}` : 'artifact-0';
    return { receiptId: `${format}-receipt`, format, artifactId, parserId: `external-${format}-native`, parserBinaryBytes, parserBinaryByteLength: parserBinaryBytes.byteLength, parserBinarySha256: sha(parserBinaryBytes), parserSourceBytes, parserSourceByteLength: parserSourceBytes.byteLength, parserSourceSha256: sha(parserSourceBytes), parserOutputBytes, parserOutputByteLength: parserOutputBytes.byteLength, parserOutputSha256: sha(parserOutputBytes), result: 'verified', projectId: 'project-7', workspaceRevision: revision, buildId: 'build-7', targetHash: '', issuedAt: NOW, expiresAt: EXPIRY, keyId: keyId(nativeKeyPairs[index]!.publicKey), publicKeyPem: pem(nativeKeyPairs[index]!.publicKey), signatureBase64: '', externalNative: true };
  });
  const civilModelHash = track === 'civil' ? artifacts[5]!.sha256 : sha(new TextEncoder().encode('civil-model'));
  const landscapeTerrainAuthorityHash = track === 'landscape' ? artifacts[0]!.sha256 : 'b'.repeat(64);
  const civilAxes = ['requirements', 'coordinate_units', 'semantic_objects', 'geometry', 'relationships', 'provenance', 'revision_integrity', 'output_consistency', 'survey_control', 'surface_quality', 'alignment', 'profile', 'cross_sections', 'corridor', 'earthwork', 'drainage', 'construction_stages', 'structures', 'ifc_landxml_roundtrip', 'civil_drawings', 'quantities', 'repair'];
  const landscapeAxes = ['requirements', 'coordinate_units', 'semantic_objects', 'geometry', 'relationships', 'provenance', 'revision_integrity', 'output_consistency', 'existing_conditions', 'terrain_grading', 'surface_flow', 'planting_data', 'mature_clearance', 'soil_volume', 'hardscape', 'irrigation', 'schedules_quantities', 'maintenance', 'drawing_consistency', 'repair'];
  const civilReadiness = { schema: 'nexyfab.civil-release-certificate.v1', status: 'pass' as const, internalReady: true, releaseReady: false as const, workspaceRevision: revision, modelContentHash: civilModelHash, assertions: civilAxes.map(axis => ({ axis, status: 'pass' as const, reason: 'verified' })), issues: [] };
  const landscapeReadiness = { schema: 'nexyfab.landscape-release-certificate.v1', status: 'pass' as const, internalReady: true, releaseReady: false as const, workspaceRevision: revision, modelContentHash: landscapeTerrainAuthorityHash, assertions: landscapeAxes.map(axis => ({ axis, status: 'pass' as const, reason: 'verified' })), issues: [] };
  const civilReadinessBytes = new TextEncoder().encode(canonical(civilReadiness)); const landscapeReadinessBytes = new TextEncoder().encode(canonical(landscapeReadiness));
  const constructionArtifact = track === 'construction' ? artifacts[0]!.sha256 : artifacts[0]!.sha256;
  const input = { track, projectId: 'project-7', workspaceId: 'workspace-7', workspaceRevision: revision, buildId: 'build-7', civilModelHash, civilModelRevision: revision, civilCrs: { epsg: 5186, horizontalDatum: 'GRS80', verticalDatum: 'KVD', units: 'm' as const }, surveyId: 'survey-7', surfaceId: 'surface-7', alignmentId: 'alignment-7', profileId: 'profile-7', landscapeTerrainAuthorityHash, constructionBinding: { workPackageId: 'wp-7', workspaceRevision: revision, workspaceContentHash: 'c'.repeat(64), artifactSha256: constructionArtifact }, civilReadiness, landscapeReadiness, civilReadinessBytes, civilReadinessSha256: sha(civilReadinessBytes), landscapeReadinessBytes, landscapeReadinessSha256: sha(landscapeReadinessBytes), artifacts, nativeParsers, evidence: roleByAxis.map((_role, index) => ({ evidenceId: `evidence-${index}`, track, axis: COMMERCIAL_REQUIRED_AXES[track][index]!, artifactId: `artifact-${index}`, revision, targetHash: '', capturedAt: NOW, expiresAt: EXPIRY })), evidenceArtifacts: Object.fromEntries(artifacts.map(item => [item.artifactId, item.bytes])), trustedNativeParsers: {} as Record<string, TrustedNativeParser>, trustedReviewers: {} as Record<string, TrustedCommercialReviewer>, attestations: {} as never } as CivilConstructionLandscapeCommercialInput;
  const targetHash = hashCivilConstructionLandscapeCommercialTarget(input);
  for (const artifact of artifacts) artifact.targetHash = targetHash;
  nativeParsers.forEach((native, index) => {
    native.targetHash = targetHash;
    native.signatureBase64 = sign(null, Buffer.from(canonicalNativeParserPayload(native), 'utf8'), nativeKeyPairs[index]!.privateKey).toString('base64');
    (input.trustedNativeParsers as Record<string, TrustedNativeParser>)[native.keyId] = { keyId: native.keyId, publicKeyPem: native.publicKeyPem, roles: ['native_parser'] };
  });
  input.evidence.forEach(item => { item.targetHash = targetHash; });
  const reviewerRegistrations: Record<string, TrustedCommercialReviewer> = {};
  const attestations = {} as { surveyor: CommercialReviewerAttestation; independentCivilFieldInspector: CommercialReviewerAttestation };
  for (const role of ['surveyor', 'independent_civil_field_inspector'] as const) {
    const keys = keyPair(); const id = keyId(keys.publicKey); const attestation: CommercialReviewerAttestation = { attestationId: `att-${role}`, role, reviewerId: `reviewer-${role}`, keyId: id, publicKeyPem: pem(keys.publicKey), signatureBase64: '', targetHash, revision, issuedAt: NOW, expiresAt: EXPIRY, axes: [...COMMERCIAL_REQUIRED_AXES[track]], evidenceIds: input.evidence.map(item => item.evidenceId) };
    attestation.signatureBase64 = sign(null, Buffer.from(canonicalCommercialAttestationPayload(attestation), 'utf8'), keys.privateKey).toString('base64');
    reviewerRegistrations[id] = { keyId: id, publicKeyPem: attestation.publicKeyPem, roles: [role] };
    if (role === 'surveyor') attestations.surveyor = attestation; else attestations.independentCivilFieldInspector = attestation;
  }
  input.trustedReviewers = reviewerRegistrations;
  input.attestations = attestations;
  return input;
}

function context(input: CivilConstructionLandscapeCommercialInput): CivilConstructionLandscapeVerificationContext { return { trustedNativeParsers: input.trustedNativeParsers, trustedReviewers: input.trustedReviewers }; }
const qualify = (input: CivilConstructionLandscapeCommercialInput) => qualifyCivilConstructionLandscapeCommercial(input, NOW, context(input));

function constructionReceipt(input: CivilConstructionLandscapeCommercialInput): ConstructionWorkPackageReceipt {
  const source = input.artifacts.find(item => item.role === 'construction_model')!;
  const field = input.evidence.find(item => item.axis === 'field')!;
  const receipt = {
    schema: 'nexyfab.construction-work-package-receipt.v1' as const,
    receiptId: 'construction-receipt-7',
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    workspaceRevision: input.workspaceRevision,
    buildId: input.buildId,
    workPackageId: input.constructionBinding.workPackageId,
    workspaceContentHash: input.constructionBinding.workspaceContentHash,
    sourceArtifactId: source.artifactId,
    sourceArtifactSha256: source.sha256,
    sourceSystem: 'Contractor' as const,
    fieldEvidenceId: field.evidenceId,
    reviewerIds: [input.attestations.surveyor.reviewerId, input.attestations.independentCivilFieldInspector.reviewerId] as [string, string],
    targetHash: hashCivilConstructionLandscapeCommercialTarget(input),
    receiptSha256: '',
    issuedAt: NOW,
    expiresAt: EXPIRY,
  } satisfies ConstructionWorkPackageReceipt;
  receipt.receiptSha256 = hashConstructionWorkPackageReceipt(receipt);
  input.constructionBinding.receiptSha256 = receipt.receiptSha256;
  input.constructionWorkPackageReceipt = receipt;
  input.constructionWorkPackageReceiptBytes = new TextEncoder().encode(canonical(receipt));
  return receipt;
}

describe('civil/construction/landscape commercial qualification', () => {
  it('qualifies only a complete externally bound civil fixture', () => {
    const result = qualify(fixture());
    expect(result.status).toBe('QUALIFIED');
    expect(result.blockers).toEqual([]);
  });

  it('qualifies a complete landscape fixture with all three native formats', () => {
    const result = qualify(fixture('landscape'));
    expect(result.blockers).toEqual([]);
    expect(result.status).toBe('QUALIFIED');
  });

  it('keeps construction on HOLD until canonical work-package receipt bytes can be reconstructed', () => {
    const result = qualify(fixture('construction'));
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toContain('construction_work_package_receipt_missing');
  });

  it('accepts only a canonical receipt bound to contractor source and field evidence', () => {
    const input = fixture('construction');
    const receipt = constructionReceipt(input);
    expect(verifyConstructionWorkPackageReceipt(input, receipt.targetHash, Date.parse(NOW), 90 * 24 * 60 * 60 * 1000)).toEqual([]);
  });

  it('rejects a self-asserted receipt that is not backed by external field evidence', () => {
    const input = fixture('construction');
    const receipt = constructionReceipt(input);
    receipt.fieldEvidenceId = 'evidence-0';
    receipt.receiptSha256 = hashConstructionWorkPackageReceipt(receipt);
    input.constructionBinding.receiptSha256 = receipt.receiptSha256;
    input.constructionWorkPackageReceiptBytes = new TextEncoder().encode(canonical(receipt));
    expect(verifyConstructionWorkPackageReceipt(input, receipt.targetHash, Date.parse(NOW), 90 * 24 * 60 * 60 * 1000)).toContain('construction_work_package_field_evidence_binding_invalid');
  });

  it('does not trust registries supplied by the claimant', () => {
    const input = fixture();
    const result = qualifyCivilConstructionLandscapeCommercial(input, NOW);
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toContain('trusted_native_parser_registry_invalid');
  });

  it('rejects a synthetic one-assertion internal certificate even when canonically rehashed', () => {
    const input = fixture();
    input.civilReadiness = { ...input.civilReadiness, assertions: [{ axis: 'requirements', status: 'pass', reason: 'self-declared' }] };
    input.civilReadinessBytes = new TextEncoder().encode(canonical(input.civilReadiness));
    input.civilReadinessSha256 = sha(input.civilReadinessBytes);
    const result = qualify(input);
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toContain('civil_internal_readiness_not_passed');
  });

  it('fails closed for malformed collections instead of throwing', () => {
    const input = fixture();
    (input as unknown as { artifacts: null }).artifacts = null;
    expect(() => qualify(input)).not.toThrow();
    expect(qualify(input).status).toBe('HOLD');
  });

  it('rejects a missing required landscape native format', () => {
    const input = fixture('landscape');
    input.nativeParsers = input.nativeParsers.filter(item => item.format !== 'irrigation');
    const result = qualify(input);
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toContain('native_format_receipt_missing:irrigation');
  });

  it('rejects internal JSON masquerading as native LandXML', () => {
    const input = fixture();
    input.nativeParsers[0]!.parserId = 'internal-json-parser';
    const result = qualify(input);
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toContain('native_parser_not_external:landxml-receipt');
  });

  it('rejects bytes/hash tampering and stale evidence', () => {
    const input = fixture();
    input.artifacts[0]!.bytes = new TextEncoder().encode('tampered');
    input.evidence[1]!.expiresAt = '2026-08-01T00:00:00.000Z';
    const result = qualify(input);
    expect(result.status).toBe('HOLD');
    expect(result.blockers.some(item => item.includes('artifact_bytes_hash_invalid'))).toBe(true);
    expect(result.blockers.some(item => item.includes('evidence_binding_or_freshness_invalid'))).toBe(true);
  });

  it('rejects reused reviewer identity and internal construction receipt alone', () => {
    const input = fixture();
    input.attestations.independentCivilFieldInspector = { ...input.attestations.surveyor, role: 'independent_civil_field_inspector' };
    input.constructionInternalReceipt = { artifactSha256: input.constructionBinding.artifactSha256, workspaceRevision: input.workspaceRevision, workspaceContentHash: input.constructionBinding.workspaceContentHash, releaseReady: false, claim: 'internal-construction-work-package-verified' };
    const result = qualify(input);
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toContain('reviewer_keys_or_identities_must_be_distinct');
  });
});
