import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import {
  validatePipingPlantRelease,
  verifyPipingPlantReadback,
  type PipingPlantParserReadbackV1,
  type PipingPlantReleaseInputV1,
} from './pipingPlantReleaseContract';
import {
  validateHvacDuctRouteRelease,
  verifyHvacDuctRouteReadback,
  type HvacDuctRouteReleaseInputV1,
  type HvacParserReadbackV1,
} from './hvacDuctRouteReleaseContract';
import {
  validateCableTrayConduitRelease,
  verifyCableTrayConduitReadback,
  type CableRouteParserReadbackV1,
  type CableTrayConduitReleaseInputV1,
} from './cableTrayConduitRouteReleaseContract';

export const MEP_FABRICATION_QUALIFICATION_SCHEMA = 'nexyfab.mep-fabrication-qualification.v1' as const;
export const MEP_REVIEWER_ROLES = ['independent_parser_cad_reviewer', 'field_manufacturing_reviewer'] as const;
export type MepReviewerRole = (typeof MEP_REVIEWER_ROLES)[number];
export type MepTrack = 'piping' | 'hvac' | 'cable';
export type MepRelease = PipingPlantReleaseInputV1 | HvacDuctRouteReleaseInputV1 | CableTrayConduitReleaseInputV1;
export type MepReadback = PipingPlantParserReadbackV1 | HvacParserReadbackV1 | CableRouteParserReadbackV1;

export const MEP_REQUIRED_AXES: Readonly<Record<MepTrack, readonly string[]>> = Object.freeze({
  piping: ['piping_spec_catalog', 'slope_support', 'spool_isometric', 'stress_surge', 'nde_hydrotest', 'fabrication'],
  hvac: ['flow_pressure', 'support_clearance', 'native_ifc_cam', 'tab_field'],
  cable: ['topology_fill_bend', 'support_grounding', 'erc_inspection', 'as_built'],
});

const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_FRESHNESS_MS = 90 * 24 * 60 * 60 * 1000;

export type QualificationEvidenceReceipt = {
  evidenceId: string;
  track: MepTrack;
  axis: string;
  artifactId: string;
  sha256: string;
  bytes: number;
  revision: number;
  targetHash: string;
  capturedAt: string;
  expiresAt: string;
};

export type IndependentReviewerAttestation = {
  attestationId: string;
  track: MepTrack;
  role: MepReviewerRole;
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

export type TrustedMepReviewer = {
  keyId: string;
  publicKeyPem: string;
  roles: readonly MepReviewerRole[];
};

export type MepQualificationInput = {
  track: MepTrack;
  release: MepRelease;
  readback: MepReadback | null | undefined;
  sourceArtifacts: { primary: Uint8Array; raw?: Uint8Array };
  evidence: readonly QualificationEvidenceReceipt[];
  evidenceArtifacts: Readonly<Record<string, Uint8Array>>;
  trustedReviewers: Readonly<Record<string, TrustedMepReviewer>>;
  attestations: {
    parserCad: IndependentReviewerAttestation;
    fieldManufacturing: IndependentReviewerAttestation;
  };
  now?: string;
  maxFreshnessMs?: number;
};

export type MepQualificationResult = {
  schema: typeof MEP_FABRICATION_QUALIFICATION_SCHEMA;
  track: MepTrack;
  targetHash: string;
  revision: number;
  status: 'QUALIFIED' | 'HOLD';
  qualified: boolean;
  internalValidation: { valid: boolean; issues: readonly string[] };
  internalReadback: { valid: boolean; issues: readonly string[] };
  independentAttestation: { valid: boolean; issues: readonly string[]; roles: readonly MepReviewerRole[] };
  evidence: { valid: boolean; issues: readonly string[]; axes: readonly string[] };
  blockers: readonly string[];
};

function canonicalNormalized(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical_nonfinite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalNormalized).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalNormalized(record[key])}`).join(',')}}`;
  }
  throw new Error('canonical_unsupported');
}

function canonical(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('canonical_unsupported');
  return canonicalNormalized(JSON.parse(serialized) as unknown);
}

function evidenceTargetBindings(evidence: readonly QualificationEvidenceReceipt[]): unknown[] {
  return [...evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)).map(({ targetHash: _targetHash, ...binding }) => binding);
}

export function canonicalMepQualificationTarget(track: MepTrack, release: MepRelease, evidence: readonly QualificationEvidenceReceipt[] = [], readback?: MepReadback | null): string {
  const readbackSha256 = readback ? createHash('sha256').update(canonical(readback), 'utf8').digest('hex') : null;
  return canonical({ schema: MEP_FABRICATION_QUALIFICATION_SCHEMA, purpose: 'target', track, release, readbackSha256, evidence: evidenceTargetBindings(evidence) });
}

export function hashMepQualificationTarget(track: MepTrack, release: MepRelease, evidence: readonly QualificationEvidenceReceipt[] = [], readback?: MepReadback | null): string {
  return createHash('sha256').update(canonicalMepQualificationTarget(track, release, evidence, readback), 'utf8').digest('hex');
}

function attestationPayload(attestation: IndependentReviewerAttestation): string {
  const { signatureBase64: _signature, publicKeyPem: _publicKey, ...unsigned } = attestation;
  return canonical({ schema: MEP_FABRICATION_QUALIFICATION_SCHEMA, purpose: 'independent-attestation', ...unsigned });
}

export function canonicalMepAttestationPayload(attestation: IndependentReviewerAttestation): string {
  return attestationPayload(attestation);
}

function validId(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 256; }
function validHash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function unique(values: readonly string[]): boolean { return values.length === new Set(values).size; }
function dateMs(value: unknown): number | null { if (typeof value !== 'string') return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean { return unique(actual) && actual.length === expected.length && expected.every(value => actual.includes(value)); }
function reviewerKey(value: unknown): { key: KeyObject; fingerprint: string } | null {
  try {
    const key = createPublicKey(value as string);
    if (key.asymmetricKeyType !== 'ed25519') return null;
    const fingerprint = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
    return { key, fingerprint };
  } catch { return null; }
}

function releaseForTrack(track: MepTrack, release: MepRelease): boolean {
  return Boolean(release && typeof release === 'object') && ((track === 'piping' && release.schema === 'nexyfab.piping-plant-release.v1')
    || (track === 'hvac' && release.schema === 'nexyfab.hvac-duct-route-release.v1')
    || (track === 'cable' && release.schema === 'nexyfab.cable-tray-conduit-release.v1'));
}

function sourceRevisionAndHashes(track: MepTrack, release: MepRelease): { revision: number; source: Record<string, unknown>; output: Record<string, unknown> } {
  if (track === 'piping') {
    const value = release as PipingPlantReleaseInputV1;
    return { revision: value.revision, source: { projectId: value.source.projectId, modelId: value.source.modelId, brepSha256: value.source.brepSha256, contentHash: value.source.contentHash, revisionSha256: value.source.revisionSha256, revision: value.source.revision }, output: { revision: value.output.revision, bytes: value.output.bytes, sha256: value.output.sha256 } };
  }
  if (track === 'hvac') {
    const value = release as HvacDuctRouteReleaseInputV1;
    return { revision: value.revision, source: { workspaceId: value.source.workspaceId, modelId: value.source.modelId, modelSha256: value.source.modelSha256, contentHash: value.source.contentHash, rawArtifactSha256: value.source.rawArtifactSha256, revisionSha256: value.source.revisionSha256, revision: value.source.revision }, output: { revision: value.output.revision, bytes: value.output.bytes, sha256: value.output.sha256 } };
  }
  const value = release as CableTrayConduitReleaseInputV1;
  return { revision: value.revision, source: { workspaceId: value.source.workspaceId, modelId: value.source.modelId, modelSha256: value.source.modelSha256, contentHash: value.source.contentHash, rawArtifactSha256: value.source.rawArtifactSha256, revisionSha256: value.source.revisionSha256, revision: value.source.revision }, output: { revision: value.output.revision, bytes: value.output.bytes, sha256: value.output.sha256 } };
}

function internalChecks(track: MepTrack, release: MepRelease, supplied: MepReadback | null | undefined): { validation: { valid: boolean; issues: string[] }; readback: { valid: boolean; issues: string[] } } {
  try {
    if (track === 'piping') {
      const value = release as PipingPlantReleaseInputV1;
      const validation = validatePipingPlantRelease(value);
      if (!supplied) return { validation, readback: { valid: false, issues: ['readback_missing'] } };
      return { validation, readback: verifyPipingPlantReadback(value, supplied as PipingPlantParserReadbackV1) };
    }
    if (track === 'hvac') {
      const value = release as HvacDuctRouteReleaseInputV1;
      const validation = validateHvacDuctRouteRelease(value);
      if (!supplied) return { validation, readback: { valid: false, issues: ['readback_missing'] } };
      return { validation, readback: verifyHvacDuctRouteReadback(value, supplied as HvacParserReadbackV1) };
    }
    const value = release as CableTrayConduitReleaseInputV1;
    const validation = validateCableTrayConduitRelease(value);
    if (!supplied) return { validation, readback: { valid: false, issues: ['readback_missing'] } };
    return { validation, readback: verifyCableTrayConduitReadback(value, supplied as CableRouteParserReadbackV1) };
  } catch (error) {
    return { validation: { valid: false, issues: [`internal_validation_exception:${String(error)}`] }, readback: { valid: false, issues: ['internal_readback_exception'] } };
  }
}

function verifySourceArtifacts(track: MepTrack, release: MepRelease, artifacts: MepQualificationInput['sourceArtifacts'] | null | undefined): string[] {
  const issues: string[] = [];
  const primary = artifacts?.primary;
  if (!(primary instanceof Uint8Array)) return ['source_primary_artifact_missing'];
  const primaryHash = createHash('sha256').update(primary).digest('hex');
  if (track === 'piping') {
    const source = (release as PipingPlantReleaseInputV1).source;
    if (primary.byteLength !== source.brepBytes || primaryHash !== source.brepSha256) issues.push('source_primary_artifact_mismatch');
    return issues;
  }
  const source = track === 'hvac'
    ? (release as HvacDuctRouteReleaseInputV1).source
    : (release as CableTrayConduitReleaseInputV1).source;
  if (primaryHash !== source.modelSha256) issues.push('source_primary_artifact_mismatch');
  const raw = artifacts?.raw;
  if (!(raw instanceof Uint8Array)) issues.push('source_raw_artifact_missing');
  else if (createHash('sha256').update(raw).digest('hex') !== source.rawArtifactSha256) issues.push('source_raw_artifact_mismatch');
  return issues;
}

function releaseReservedHashes(track: MepTrack, release: MepRelease): Set<string> {
  const outputHash = (release as MepRelease).output.sha256;
  if (track === 'piping') {
    const source = (release as PipingPlantReleaseInputV1).source;
    return new Set([source.brepSha256, source.contentHash, source.revisionSha256, outputHash]);
  }
  const source = track === 'hvac'
    ? (release as HvacDuctRouteReleaseInputV1).source
    : (release as CableTrayConduitReleaseInputV1).source;
  return new Set([source.modelSha256, source.rawArtifactSha256, source.contentHash, source.revisionSha256, outputHash]);
}

function validFreshness(issuedAt: unknown, expiresAt: unknown, now: number, maxFreshnessMs: number): boolean {
  const issued = dateMs(issuedAt); const expires = dateMs(expiresAt);
  return issued !== null && expires !== null && issued <= now && now <= expires && expires > issued && expires - issued <= maxFreshnessMs;
}

function verifyAttestation(attestation: IndependentReviewerAttestation | null | undefined, expectedRole: MepReviewerRole, track: MepTrack, targetHash: string, revision: number, evidence: Map<string, QualificationEvidenceReceipt>, trustedReviewers: Readonly<Record<string, TrustedMepReviewer>>, now: number, maxFreshnessMs: number): string[] {
  const issues: string[] = [];
  if (!attestation || typeof attestation !== 'object') return [`${expectedRole}:attestation_missing`];
  if (!Array.isArray(attestation.axes) || attestation.axes.length > 64 || !Array.isArray(attestation.evidenceIds) || attestation.evidenceIds.length > 64) return [`${expectedRole}:attestation_collection_invalid`];
  if (!validId(attestation.attestationId) || !validId(attestation.reviewerId) || !validId(attestation.keyId)) issues.push(`${expectedRole}:identity_invalid`);
  if (attestation.track !== track) issues.push(`${expectedRole}:cross_track`);
  if (attestation.role !== expectedRole) issues.push(`${expectedRole}:cross_role`);
  if (attestation.targetHash !== targetHash) issues.push(`${expectedRole}:target_hash_mismatch`);
  if (attestation.revision !== revision) issues.push(`${expectedRole}:stale_revision`);
  if (!validFreshness(attestation.issuedAt, attestation.expiresAt, now, maxFreshnessMs)) issues.push(`${expectedRole}:stale_or_invalid_freshness`);
  const required = MEP_REQUIRED_AXES[track];
  if (!Array.isArray(attestation.axes) || !exactStringSet(attestation.axes, required)) issues.push(`${expectedRole}:axes_incomplete`);
  const expectedEvidenceIds = [...evidence.keys()];
  if (!Array.isArray(attestation.evidenceIds) || !exactStringSet(attestation.evidenceIds, expectedEvidenceIds)) issues.push(`${expectedRole}:evidence_set_mismatch`);
  const linkedAxes = new Set<string>();
  for (const evidenceId of Array.isArray(attestation.evidenceIds) ? attestation.evidenceIds : []) {
    const item = evidence.get(evidenceId);
    if (!item) { issues.push(`${expectedRole}:evidence_reference_missing:${evidenceId}`); continue; }
    linkedAxes.add(item.axis);
  }
  if (required.some(axis => !linkedAxes.has(axis))) issues.push(`${expectedRole}:evidence_axes_incomplete`);
  const registration = trustedReviewers[attestation.reviewerId];
  const attestedKey = reviewerKey(attestation.publicKeyPem);
  const registeredKey = reviewerKey(registration?.publicKeyPem);
  if (!registration || registration.keyId !== attestation.keyId || !registration.roles.includes(expectedRole)
    || !attestedKey || !registeredKey || attestedKey.fingerprint !== registeredKey.fingerprint
    || attestation.keyId !== attestedKey.fingerprint || registration.keyId !== registeredKey.fingerprint) issues.push(`${expectedRole}:reviewer_not_trusted_for_role`);
  if (typeof attestation.publicKeyPem !== 'string' || typeof attestation.signatureBase64 !== 'string') issues.push(`${expectedRole}:signature_fields_invalid`);
  else {
    try {
      const verified = Boolean(registeredKey) && verifySignature(null, Buffer.from(attestationPayload(attestation), 'utf8'), registeredKey!.key, Buffer.from(attestation.signatureBase64, 'base64'));
      if (!verified) issues.push(`${expectedRole}:signature_invalid`);
    } catch { issues.push(`${expectedRole}:signature_invalid`); }
  }
  return issues;
}

function verifyEvidence(items: readonly QualificationEvidenceReceipt[], artifacts: Readonly<Record<string, Uint8Array>>, track: MepTrack, targetHash: string, revision: number, now: number, maxFreshnessMs: number, reservedHashes: ReadonlySet<string>): { issues: string[]; axes: string[]; map: Map<string, QualificationEvidenceReceipt> } {
  const issues: string[] = []; const axes = new Set<string>(); const map = new Map<string, QualificationEvidenceReceipt>(); const artifactIds = new Set<string>(); const artifactHashes = new Set<string>(); const required = MEP_REQUIRED_AXES[track];
  if (!Array.isArray(items) || items.length === 0 || items.length > 64) return { issues: ['evidence_collection_invalid'], axes: [], map };
  for (const item of items) {
    if (!item || typeof item !== 'object') { issues.push('evidence_item_invalid'); continue; }
    if (!validId(item.evidenceId) || map.has(item.evidenceId)) issues.push(`evidence_id_invalid_or_duplicate:${item?.evidenceId}`);
    if (item.track !== track) issues.push(`evidence_cross_track:${item?.evidenceId}`);
    if (!required.includes(item.axis)) issues.push(`evidence_axis_invalid:${item?.axis}`);
    if (!validId(item.artifactId) || !validHash(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) issues.push(`evidence_artifact_invalid:${item?.evidenceId}`);
    if (artifactIds.has(item.artifactId)) issues.push(`evidence_artifact_id_reused:${item.artifactId}`); else artifactIds.add(item.artifactId);
    if (artifactHashes.has(item.sha256)) issues.push(`evidence_artifact_hash_reused:${item.sha256}`); else artifactHashes.add(item.sha256);
    if (reservedHashes.has(item.sha256)) issues.push(`evidence_artifact_hash_reuses_source_or_output:${item.sha256}`);
    const bytes = artifacts?.[item.artifactId];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== item.bytes || createHash('sha256').update(bytes ?? new Uint8Array()).digest('hex') !== item.sha256) issues.push(`evidence_artifact_bytes_mismatch:${item.artifactId}`);
    if (item.revision !== revision || item.targetHash !== targetHash) issues.push(`evidence_target_or_revision_mismatch:${item?.evidenceId}`);
    if (!validFreshness(item.capturedAt, item.expiresAt, now, maxFreshnessMs)) issues.push(`evidence_stale_or_invalid_freshness:${item?.evidenceId}`);
    map.set(item.evidenceId, item);
    if (axes.has(item.axis)) issues.push(`evidence_axis_duplicate:${item.axis}`);
    axes.add(item.axis);
  }
  for (const axis of required) if (!axes.has(axis)) issues.push(`evidence_axis_missing:${axis}`);
  return { issues, axes: [...axes].sort(), map };
}

export function qualifyMepFabrication(input: MepQualificationInput | null | undefined, verificationNow: string | Date = new Date()): MepQualificationResult {
  if (!input || typeof input !== 'object') {
    return {
      schema: MEP_FABRICATION_QUALIFICATION_SCHEMA, track: 'piping', targetHash: '0'.repeat(64), revision: -1,
      status: 'HOLD', qualified: false,
      internalValidation: { valid: false, issues: ['input_missing'] }, internalReadback: { valid: false, issues: ['input_missing'] },
      independentAttestation: { valid: false, issues: ['attestation_missing'], roles: [...MEP_REVIEWER_ROLES] },
      evidence: { valid: false, issues: ['evidence_missing'], axes: [] }, blockers: ['input_missing'],
    };
  }
  const blockers: string[] = [];
  const now = verificationNow instanceof Date ? verificationNow.getTime() : dateMs(verificationNow);
  const maxFreshnessMs = Number.isSafeInteger(input.maxFreshnessMs) && (input.maxFreshnessMs ?? 0) > 0 ? Math.min(input.maxFreshnessMs!, MAX_FRESHNESS_MS) : MAX_FRESHNESS_MS;
  if (now === null || !Number.isFinite(now)) blockers.push('qualification_clock_invalid');
  const supportedTrack = input.track === 'piping' || input.track === 'hvac' || input.track === 'cable';
  if (!supportedTrack || !releaseForTrack(input.track, input.release)) blockers.push('track_release_mismatch');
  const evidenceCollectionValid = Array.isArray(input.evidence) && input.evidence.length > 0 && input.evidence.length <= 64;
  if (!evidenceCollectionValid) blockers.push('evidence_collection_invalid');
  let targetHash = '0'.repeat(64); let revision = -1; let sourceOutputValid = true;
  try {
    if (!evidenceCollectionValid) throw new Error('evidence_collection_invalid');
    targetHash = hashMepQualificationTarget(input.track, input.release, input.evidence, input.readback);
    const binding = sourceRevisionAndHashes(input.track, input.release);
    revision = binding.revision;
    if (!Number.isSafeInteger(revision) || revision < 0 || binding.output.revision !== revision || !validHash(String(binding.output.sha256)) || !validHash(String(binding.source.contentHash)) || !validHash(String(binding.source.revisionSha256))) { sourceOutputValid = false; blockers.push('revision_source_output_sha_binding_invalid'); }
  } catch { sourceOutputValid = false; blockers.push('target_hash_generation_failed'); }
  if (!sourceOutputValid) blockers.push('source_or_output_evidence_invalid');
  const internal = internalChecks(input.track, input.release, input.readback);
  let sourceArtifactIssues: string[] = [];
  try { sourceArtifactIssues = verifySourceArtifacts(input.track, input.release, input.sourceArtifacts); }
  catch { sourceArtifactIssues = ['source_artifact_verification_exception']; }
  blockers.push(...sourceArtifactIssues);
  if (!internal.validation.valid) blockers.push(...internal.validation.issues.map(issue => `internal_validation:${issue}`));
  if (!internal.readback.valid) blockers.push(...internal.readback.issues.map(issue => `internal_readback:${issue}`));
  let releaseTargetHash = '0'.repeat(64);
  let reservedHashes = new Set<string>();
  try { releaseTargetHash = hashMepQualificationTarget(input.track, input.release); reservedHashes = releaseReservedHashes(input.track, input.release); }
  catch { blockers.push('release_evidence_target_generation_failed'); }
  const evidence = supportedTrack
    ? verifyEvidence(input.evidence, input.evidenceArtifacts, input.track, releaseTargetHash, revision, now ?? Number.NaN, maxFreshnessMs, reservedHashes)
    : { issues: ['evidence_track_invalid'], axes: [] as string[], map: new Map<string, QualificationEvidenceReceipt>() };
  blockers.push(...evidence.issues);
  const attestations = input.attestations;
  const attestationIssues = now === null || !attestations ? ['attestation_missing'] : [
    ...verifyAttestation(attestations.parserCad, 'independent_parser_cad_reviewer', input.track, targetHash, revision, evidence.map, input.trustedReviewers ?? {}, now, maxFreshnessMs),
    ...verifyAttestation(attestations.fieldManufacturing, 'field_manufacturing_reviewer', input.track, targetHash, revision, evidence.map, input.trustedReviewers ?? {}, now, maxFreshnessMs),
  ];
  if (attestations?.parserCad && attestations?.fieldManufacturing) {
    const parserKey = reviewerKey(attestations.parserCad.publicKeyPem);
    const fieldKey = reviewerKey(attestations.fieldManufacturing.publicKeyPem);
    if (attestations.parserCad.keyId === attestations.fieldManufacturing.keyId || (parserKey && fieldKey && parserKey.fingerprint === fieldKey.fingerprint)) attestationIssues.push('attestation_keys_must_be_distinct');
    if (attestations.parserCad.reviewerId === attestations.fieldManufacturing.reviewerId) attestationIssues.push('attestation_reviewers_must_be_distinct');
    if (attestations.parserCad.attestationId === attestations.fieldManufacturing.attestationId) attestationIssues.push('attestation_replay_duplicate_id');
  }
  blockers.push(...attestationIssues);
  const uniqueBlockers = [...new Set(blockers)];
  const qualified = uniqueBlockers.length === 0;
  return {
    schema: MEP_FABRICATION_QUALIFICATION_SCHEMA,
    track: input.track,
    targetHash,
    revision,
    status: qualified ? 'QUALIFIED' : 'HOLD',
    qualified,
    internalValidation: { valid: internal.validation.valid, issues: internal.validation.issues },
    internalReadback: { valid: internal.readback.valid, issues: internal.readback.issues },
    independentAttestation: { valid: attestationIssues.length === 0, issues: attestationIssues, roles: [...MEP_REVIEWER_ROLES] },
    evidence: { valid: evidence.issues.length === 0, issues: evidence.issues, axes: evidence.axes },
    blockers: uniqueBlockers,
  };
}
