import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import {
  type SheetMetalFlatPatternParserReadbackV1,
  type SheetMetalFlatPatternReleaseInputV1,
  validateSheetMetalFlatPatternRelease,
  verifySheetMetalFlatPatternReadback,
} from './sheetMetalFlatPatternReleaseContract';
import {
  type WeldedFabricationParserReadbackV1,
  type WeldedFabricationReleaseInputV1,
  validateWeldedFabricationRelease,
  verifyWeldedFabricationReadback,
} from './weldedFabricationReleaseContract';
import {
  type MoldToolingParserReadbackV1,
  type MoldToolingReleaseInputV1,
  validateMoldToolingRelease,
  verifyMoldToolingReadback,
} from './moldToolingReleaseContract';

export const SPECIALTY_MANUFACTURING_QUALIFICATION_SCHEMA =
  'nexyfab.specialty-manufacturing-qualification.v1' as const;
export const SPECIALTY_MANUFACTURING_REVIEW_SCHEMA =
  'nexyfab.specialty-manufacturing-review.v1' as const;

export type SpecialtyTrack = 'sheet-metal' | 'welded-fabrication' | 'mold-tooling';
export type SpecialtyReviewerRole = 'independent_parser_cad_reviewer' | 'manufacturing_reviewer';

export interface SpecialtyEvidenceArtifactV1 {
  artifactId: string;
  kind: string;
  sha256: string;
  bytes: number;
}

export interface SpecialtyReviewerSignatureV1 {
  reviewerRole: SpecialtyReviewerRole;
  reviewerId: string;
  reviewedAt: string;
  publicKeyPem: string;
  keyIdSha256: string;
  signatureBase64: string;
}

export interface TrustedSpecialtyReviewerV1 {
  keyIdSha256: string;
  publicKeyPem: string;
  roles: readonly SpecialtyReviewerRole[];
}

export interface SpecialtyQualificationVerificationContextV1 {
  sourceBrepBytes: Uint8Array;
  evidenceArtifacts: Readonly<Record<string, Uint8Array>>;
  trustedReviewers: Readonly<Record<string, TrustedSpecialtyReviewerV1>>;
}

export type SpecialtyQualificationInput =
  | {
      track: 'sheet-metal';
      contractInput: SheetMetalFlatPatternReleaseInputV1;
      readback: SheetMetalFlatPatternParserReadbackV1 | null;
      evidence: readonly SpecialtyEvidenceArtifactV1[];
    }
  | {
      track: 'welded-fabrication';
      contractInput: WeldedFabricationReleaseInputV1;
      readback: WeldedFabricationParserReadbackV1 | null;
      evidence: readonly SpecialtyEvidenceArtifactV1[];
    }
  | {
      track: 'mold-tooling';
      contractInput: MoldToolingReleaseInputV1;
      readback: MoldToolingParserReadbackV1 | null;
      evidence: readonly SpecialtyEvidenceArtifactV1[];
    };

export interface SpecialtyReviewPayloadV1 {
  schema: typeof SPECIALTY_MANUFACTURING_REVIEW_SCHEMA;
  track: SpecialtyTrack;
  reviewerRole: SpecialtyReviewerRole;
  reviewerId: string;
  reviewedAt: string;
  targetSha256: string;
  reviewerKeySha256: string;
}

export interface SpecialtyQualificationReceiptV1 {
  schema: typeof SPECIALTY_MANUFACTURING_QUALIFICATION_SCHEMA;
  track: SpecialtyTrack;
  status: 'QUALIFIED' | 'HOLD';
  releaseReady: boolean;
  targetSha256: string;
  target: Record<string, unknown>;
  contract: { valid: boolean; issues: string[] };
  readback: { valid: boolean; issues: string[] };
  externalAxes: { valid: boolean; required: string[]; present: string[]; missing: string[] };
  reviewers: Record<SpecialtyReviewerRole, { valid: boolean; reviewedAt?: string; keyIdSha256?: string }>;
  signatures: readonly SpecialtyReviewerSignatureV1[];
  blockers: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_REVIEW_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const REQUIRED_AXES: Record<SpecialtyTrack, readonly string[]> = {
  'sheet-metal': ['press_brake_tooling', 'material_lot', 'refold_flat_pattern_roundtrip', 'manufacturing_receipt'],
  'welded-fabrication': ['wps', 'nde_fatigue', 'fabrication_receipt'],
  'mold-tooling': ['native_core_cavity', 'cooling_ejector_cam', 'tryout_receipt'],
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function canonical(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('canonical_value_unsupported');
  return stable(JSON.parse(serialized) as unknown);
}

function sourceTarget(input: SpecialtyQualificationInput): Record<string, unknown> {
  if (input.track === 'sheet-metal') {
    const source = input.contractInput.source;
    const output = input.contractInput.output;
    return {
      revision: input.contractInput.revision,
      source: {
        brepPath: source.brepPath,
        brepBytes: source.brepBytes,
        brepSha256: source.brepSha256,
        contentHash: source.contentHash,
        revision: source.revision,
      },
      output: { revision: output.revision, bytes: output.bytes, sha256: output.sha256 },
    };
  }
  if (input.track === 'welded-fabrication') {
    const source = input.contractInput.source;
    const output = input.contractInput.output;
    return {
      revision: input.contractInput.revision,
      source: { assemblyId: source.assemblyId, brepPath: source.brepPath, brepBytes: source.brepBytes, brepSha256: source.brepSha256, contentHash: source.contentHash, revisionSha256: source.revisionSha256, revision: source.revision },
      output: { revision: output.revision, bytes: output.bytes, sha256: output.sha256 },
    };
  }
  const source = input.contractInput.source;
  const output = input.contractInput.output;
  return {
    revision: input.contractInput.revision,
    source: { partId: source.partId, brepPath: source.brepPath, brepBytes: source.brepBytes, brepSha256: source.brepSha256, contentHash: source.contentHash, revisionSha256: source.revisionSha256, revision: source.revision },
    output: { revision: output.revision, bytes: output.bytes, sha256: output.sha256 },
  };
}

export function buildSpecialtyQualificationTarget(input: SpecialtyQualificationInput): Record<string, unknown> {
  const evidence = [...input.evidence]
    .map(item => ({ artifactId: item.artifactId, kind: item.kind, sha256: item.sha256, bytes: item.bytes }))
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId) || left.kind.localeCompare(right.kind));
  return {
    schema: 'nexyfab.specialty-manufacturing-receipt-target.v1',
    track: input.track,
    contractSchema: input.contractInput.schema,
    contractInputSha256: sha256(canonical(input.contractInput)),
    readbackSha256: input.readback ? sha256(canonical(input.readback)) : null,
    revisionBinding: sourceTarget(input),
    evidence,
  };
}

export function specialtyQualificationTargetSha256(input: SpecialtyQualificationInput): string {
  return sha256(canonical(buildSpecialtyQualificationTarget(input)));
}

export function buildSpecialtyReviewerPayload(
  track: SpecialtyTrack,
  role: SpecialtyReviewerRole,
  reviewerId: string,
  reviewedAt: string,
  targetSha256: string,
  reviewerKeySha256: string,
): SpecialtyReviewPayloadV1 {
  return {
    schema: SPECIALTY_MANUFACTURING_REVIEW_SCHEMA,
    track,
    reviewerRole: role,
    reviewerId,
    reviewedAt,
    targetSha256,
    reviewerKeySha256,
  };
}

export function specialtyReviewerPayloadCanonical(payload: SpecialtyReviewPayloadV1): string {
  return canonical(payload);
}

function publicKeyId(publicKey: KeyObject): string {
  return sha256(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
}

function validateEvidence(input: SpecialtyQualificationInput, context: SpecialtyQualificationVerificationContextV1 | null | undefined): { valid: boolean; present: string[]; missing: string[]; issues: string[] } {
  const issues: string[] = [];
  if (!Array.isArray(input.evidence) || input.evidence.length > 64) {
    return { valid: false, present: [], missing: [...REQUIRED_AXES[input.track]], issues: ['evidence_collection_invalid'] };
  }
  const ids = new Set<string>();
  const kinds = new Set<string>();
  const hashes = new Set<string>();
  const reservedHashes = new Set([input.contractInput.source.brepSha256, input.contractInput.output.sha256]);
  for (const artifact of input.evidence) {
    if (!artifact || typeof artifact !== 'object') { issues.push('evidence_artifact_invalid'); continue; }
    if (typeof artifact.artifactId !== 'string' || !artifact.artifactId.trim() || artifact.artifactId.length > 256 || ids.has(artifact.artifactId)) issues.push('evidence_artifact_id_invalid');
    else ids.add(artifact.artifactId);
    if (typeof artifact.kind !== 'string' || !artifact.kind.trim() || artifact.kind.length > 128 || kinds.has(artifact.kind)) issues.push(`evidence_kind_invalid:${String(artifact.kind)}`);
    else kinds.add(artifact.kind);
    if (!SHA256.test(artifact.sha256 ?? '') || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) issues.push(`evidence_hash_or_bytes_invalid:${String(artifact.artifactId)}`);
    if (hashes.has(artifact.sha256)) issues.push(`evidence_hash_reused:${artifact.sha256}`); else hashes.add(artifact.sha256);
    if (reservedHashes.has(artifact.sha256)) issues.push(`evidence_hash_reuses_source_or_output:${artifact.sha256}`);
    const bytes = context?.evidenceArtifacts?.[artifact.artifactId];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== artifact.bytes || createHash('sha256').update(bytes ?? new Uint8Array()).digest('hex') !== artifact.sha256) issues.push(`evidence_artifact_bytes_mismatch:${artifact.artifactId}`);
  }
  const required = REQUIRED_AXES[input.track];
  const present = required.filter(kind => kinds.has(kind));
  const missing = required.filter(kind => !kinds.has(kind));
  return { valid: issues.length === 0 && missing.length === 0, present, missing, issues };
}

function internalChecks(input: SpecialtyQualificationInput): {
  contract: { valid: boolean; issues: string[] };
  readback: { valid: boolean; issues: string[] };
} {
  if (input.track === 'sheet-metal') {
    return {
      contract: validateSheetMetalFlatPatternRelease(input.contractInput),
      readback: verifySheetMetalFlatPatternReadback(input.contractInput, input.readback),
    };
  }
  if (input.track === 'welded-fabrication') {
    return {
      contract: validateWeldedFabricationRelease(input.contractInput),
      readback: verifyWeldedFabricationReadback(input.contractInput, input.readback),
    };
  }
  return {
    contract: validateMoldToolingRelease(input.contractInput),
    readback: verifyMoldToolingReadback(input.contractInput, input.readback),
  };
}

function verifyReview(
  input: SpecialtyQualificationInput,
  targetSha256: string,
  role: SpecialtyReviewerRole,
  signature: SpecialtyReviewerSignatureV1 | undefined,
  trustedReviewers: Readonly<Record<string, TrustedSpecialtyReviewerV1>>,
  nowMs: number,
): { valid: boolean; issues: string[]; reviewedAt?: string; keyIdSha256?: string } {
  const issues: string[] = [];
  if (!input) return { valid: false, issues: ['input_missing'] };
  if (!signature) return { valid: false, issues: [`${role}_signature_missing`] };
  if (typeof signature.reviewerId !== 'string' || !signature.reviewerId.trim()) issues.push(`${role}_reviewer_id_invalid`);
  if (signature.reviewerRole !== role) issues.push(`${role}_role_mismatch`);
  if (!SHA256.test(signature.keyIdSha256)) issues.push(`${role}_key_id_invalid`);
  let key: KeyObject | null = null;
  const registration = trustedReviewers[signature.reviewerId];
  if (!registration || registration.keyIdSha256 !== signature.keyIdSha256 || registration.publicKeyPem !== signature.publicKeyPem || !registration.roles.includes(role)) issues.push(`${role}_reviewer_not_trusted_for_role`);
  try {
    key = registration ? createPublicKey(registration.publicKeyPem) : null;
    if (!key || key.asymmetricKeyType !== 'ed25519') issues.push(`${role}_ed25519_required`);
    if (key && signature.keyIdSha256 !== publicKeyId(key)) issues.push(`${role}_key_id_mismatch`);
  } catch { issues.push(`${role}_public_key_invalid`); }
  const reviewedAtMs = Date.parse(signature.reviewedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(reviewedAtMs) || reviewedAtMs > nowMs + FUTURE_SKEW_MS || nowMs - reviewedAtMs > MAX_REVIEW_AGE_MS) issues.push(`${role}_reviewed_at_stale_or_invalid`);
  const payload = buildSpecialtyReviewerPayload(input.track, role, signature.reviewerId, signature.reviewedAt, targetSha256, signature.keyIdSha256);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature.signatureBase64)) issues.push(`${role}_signature_encoding_invalid`);
  else if (key && !verifySignature(null, Buffer.from(canonical(payload), 'utf8'), key, Buffer.from(signature.signatureBase64, 'base64'))) issues.push(`${role}_signature_invalid`);
  return { valid: issues.length === 0, issues, reviewedAt: signature.reviewedAt, keyIdSha256: signature.keyIdSha256 };
}

export function qualifySpecialtyManufacturing(
  input: SpecialtyQualificationInput | null | undefined,
  signatures: readonly SpecialtyReviewerSignatureV1[] | null | undefined,
  now = new Date(),
  context?: SpecialtyQualificationVerificationContextV1 | null,
): SpecialtyQualificationReceiptV1 {
  const supportedTrack = input?.track === 'sheet-metal' || input?.track === 'welded-fabrication' || input?.track === 'mold-tooling';
  const fallbackTrack: SpecialtyTrack = supportedTrack ? input.track : 'sheet-metal';
  const safeInput = supportedTrack ? input : null;
  let target: Record<string, unknown> = safeInput ? {} : {
    schema: 'nexyfab.specialty-manufacturing-receipt-target.v1', track: fallbackTrack, invalid: true,
  };
  const preflightBlockers: string[] = [];
  const evidenceCollectionValid = Boolean(safeInput && Array.isArray(safeInput.evidence) && safeInput.evidence.length <= 64);
  if (safeInput && !evidenceCollectionValid) {
    preflightBlockers.push('evidence_collection_invalid');
    target = { schema: 'nexyfab.specialty-manufacturing-receipt-target.v1', track: fallbackTrack, invalid: true };
  }
  try { if (safeInput && evidenceCollectionValid) target = buildSpecialtyQualificationTarget(safeInput); }
  catch { target = { schema: 'nexyfab.specialty-manufacturing-receipt-target.v1', track: fallbackTrack, invalid: true }; preflightBlockers.push('qualification_target_generation_failed'); }
  const targetSha256 = sha256(canonical(target));
  let internal = {
    contract: { valid: false, issues: ['input_missing'] },
    readback: { valid: false, issues: ['input_missing'] },
  };
  if (safeInput) {
    try { internal = internalChecks(safeInput); }
    catch { internal = { contract: { valid: false, issues: ['internal_validation_exception'] }, readback: { valid: false, issues: ['internal_readback_exception'] } }; }
  }
  let evidence = { valid: false, present: [] as string[], missing: [...REQUIRED_AXES[fallbackTrack]], issues: ['input_missing'] };
  if (safeInput) {
    try { evidence = validateEvidence(safeInput, context); }
    catch { evidence = { valid: false, present: [], missing: [...REQUIRED_AXES[fallbackTrack]], issues: ['evidence_validation_exception'] }; }
  }
  const sourceBytes = context?.sourceBrepBytes;
  const source = safeInput?.contractInput.source;
  const sourceBytesValid = Boolean(source && sourceBytes instanceof Uint8Array && sourceBytes.byteLength === source.brepBytes
    && createHash('sha256').update(sourceBytes ?? new Uint8Array()).digest('hex') === source.brepSha256);
  const suppliedSignatures = Array.isArray(signatures) ? signatures : [];
  const signatureCollectionTooLarge = suppliedSignatures.length > 16;
  const list = signatureCollectionTooLarge ? [] : suppliedSignatures;
  const parserSignatures = list.filter(item => item?.reviewerRole === 'independent_parser_cad_reviewer');
  const manufacturingSignatures = list.filter(item => item?.reviewerRole === 'manufacturing_reviewer');
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const parser = verifyReview(safeInput!, targetSha256, 'independent_parser_cad_reviewer', parserSignatures[0], context?.trustedReviewers ?? {}, nowMs);
  const manufacturing = verifyReview(safeInput!, targetSha256, 'manufacturing_reviewer', manufacturingSignatures[0], context?.trustedReviewers ?? {}, nowMs);
  const keyIds = [parser.keyIdSha256, manufacturing.keyIdSha256].filter((value): value is string => Boolean(value));
  const duplicateKey = keyIds.length === 2 && keyIds[0] === keyIds[1];
  const blockers = [...preflightBlockers, ...internal.contract.issues, ...internal.readback.issues, ...evidence.issues, ...evidence.missing.map(kind => `external_axis_missing:${kind}`), ...parser.issues, ...manufacturing.issues];
  if (!supportedTrack) blockers.push('track_invalid');
  if (!Number.isFinite(nowMs)) blockers.push('qualification_clock_invalid');
  if (!sourceBytesValid) blockers.push('source_brep_bytes_mismatch');
  if (parserSignatures.length !== 1) blockers.push('independent_parser_cad_signature_count_invalid');
  if (manufacturingSignatures.length !== 1) blockers.push('manufacturing_signature_count_invalid');
  if (list.some(item => item?.reviewerRole !== 'independent_parser_cad_reviewer' && item?.reviewerRole !== 'manufacturing_reviewer')) blockers.push('reviewer_role_invalid');
  if (signatureCollectionTooLarge) blockers.push('reviewer_signature_collection_too_large');
  if (duplicateKey) blockers.push('reviewer_keys_must_be_distinct');
  if (parserSignatures[0]?.reviewerId && parserSignatures[0].reviewerId === manufacturingSignatures[0]?.reviewerId) blockers.push('reviewers_must_be_distinct');
  const uniqueBlockers = [...new Set(blockers)].sort();
  const qualified = Boolean(safeInput && uniqueBlockers.length === 0 && sourceBytesValid && internal.contract.valid && internal.readback.valid && evidence.valid && parser.valid && manufacturing.valid && !duplicateKey && parserSignatures[0]?.reviewerId !== manufacturingSignatures[0]?.reviewerId && parserSignatures.length === 1 && manufacturingSignatures.length === 1);
  return {
    schema: SPECIALTY_MANUFACTURING_QUALIFICATION_SCHEMA,
    track: fallbackTrack,
    status: qualified ? 'QUALIFIED' : 'HOLD',
    releaseReady: qualified,
    targetSha256,
    target,
    contract: internal.contract,
    readback: internal.readback,
    externalAxes: { valid: evidence.valid, required: Array.from(REQUIRED_AXES[fallbackTrack]), present: Array.from(evidence.present), missing: Array.from(evidence.missing) },
    reviewers: {
      independent_parser_cad_reviewer: { valid: parser.valid, reviewedAt: parser.reviewedAt, keyIdSha256: parser.keyIdSha256 },
      manufacturing_reviewer: { valid: manufacturing.valid, reviewedAt: manufacturing.reviewedAt, keyIdSha256: manufacturing.keyIdSha256 },
    },
    signatures: list,
    blockers: uniqueBlockers,
  };
}
