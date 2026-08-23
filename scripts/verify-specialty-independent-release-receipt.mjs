#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SPECIALTY_INDEPENDENT_RELEASE_RECEIPT_SCHEMA =
  'nexyfab.specialty-independent-release-receipt.v1';
export const SPECIALTY_RELEASE_CHANNELS = Object.freeze({
  'verified-sheet-metal': { track: 'sheet-metal', schema: 'nexyfab.specialty-manufacturing-qualification.v1' },
  'verified-welded-fabrication': { track: 'welded-fabrication', schema: 'nexyfab.specialty-manufacturing-qualification.v1' },
  'verified-mold-tooling': { track: 'mold-tooling', schema: 'nexyfab.specialty-manufacturing-qualification.v1' },
  'verified-piping': { track: 'piping', schema: 'nexyfab.mep-fabrication-qualification.v1' },
  'verified-hvac': { track: 'hvac', schema: 'nexyfab.mep-fabrication-qualification.v1' },
  'verified-ecad-mcad': { track: 'ecad_mcad', schema: 'nexyfab.ecad-mcad-commercial-evidence.v1' },
});
export const SPECIALTY_RELEASE_REVIEW_ROLES = Object.freeze([
  'independent_release_reviewer',
  'manufacturing_release_reviewer',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const MAX_AGE_MS = 90 * 24 * 60 * 60_000;
const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_EVIDENCE_ARTIFACTS = 128;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function specialtyIndependentReleaseCanonical(value) {
  return canonical(value);
}

export function specialtyIndependentReleaseSha256(value) {
  return crypto.createHash('sha256').update(
    Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonical(value),
  ).digest('hex');
}

export const canonicalJson = specialtyIndependentReleaseCanonical;
export const sha256 = specialtyIndependentReleaseSha256;

export function specialtyIndependentReleaseTarget(receipt) {
  return {
    schema: SPECIALTY_INDEPENDENT_RELEASE_RECEIPT_SCHEMA,
    purpose: 'promotion-target',
    channel: receipt?.channel,
    track: receipt?.track,
    release: receipt?.release,
    generatedAt: receipt?.generatedAt,
    expiresAt: receipt?.expiresAt,
    qualificationArtifact: receipt?.qualificationArtifact,
    evidenceArtifacts: Array.isArray(receipt?.evidenceArtifacts)
      ? [...receipt.evidenceArtifacts].sort((a, b) => String(a?.artifactId).localeCompare(String(b?.artifactId)))
      : receipt?.evidenceArtifacts,
  };
}

export function specialtyIndependentReleaseTargetSha256(receipt) {
  return specialtyIndependentReleaseSha256(specialtyIndependentReleaseTarget(receipt));
}

function unsignedReceipt(receipt) {
  const { receiptSha256: _ignored, ...unsigned } = receipt ?? {};
  return unsigned;
}

export function attachSpecialtyIndependentReleaseReceiptSha256(receipt) {
  return { ...unsignedReceipt(receipt), receiptSha256: specialtyIndependentReleaseSha256(unsignedReceipt(receipt)) };
}

export function specialtyIndependentReviewerPayload(receipt, reviewer) {
  return {
    schema: SPECIALTY_INDEPENDENT_RELEASE_RECEIPT_SCHEMA,
    purpose: 'reviewer-attestation',
    channel: receipt?.channel,
    track: receipt?.track,
    reviewerRole: reviewer?.role,
    reviewerId: reviewer?.reviewerId,
    keyIdSha256: reviewer?.keyIdSha256,
    issuedAt: reviewer?.issuedAt,
    expiresAt: reviewer?.expiresAt,
    targetSha256: reviewer?.targetSha256,
  };
}

function asNow(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return Date.now();
}

function dateMs(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
}

function nonEmpty(value, max = 256) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function safeHash(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function safeGit(value) {
  return typeof value === 'string' && GIT_SHA.test(value);
}

function safeRelativePath(value) {
  if (!nonEmpty(value, 1024) || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  return parts.length > 0 && parts.every(part => part.length > 0 && part !== '.' && part !== '..');
}

function inside(root, absolute) {
  const relative = path.relative(root, absolute);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function realRegularFile(root, relativePath) {
  if (!safeRelativePath(relativePath)) throw new Error('artifact_path_invalid');
  const absolute = path.resolve(root, ...relativePath.replaceAll('\\', '/').split('/'));
  if (!inside(root, absolute)) throw new Error('artifact_path_outside_root');
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error('allowed_root_symlink');
  let cursor = root;
  for (const part of path.relative(root, absolute).split(path.sep)) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('artifact_path_symlink_or_junction');
  }
  const realRoot = fs.realpathSync.native(root);
  const realFile = fs.realpathSync.native(absolute);
  const realRelative = path.relative(realRoot, realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('artifact_realpath_outside_root');
  const stat = fs.statSync(realFile);
  if (!stat.isFile()) throw new Error('artifact_not_regular_file');
  return { absolute, realRoot, realFile, stat };
}

function readStableArtifact(file, label) {
  let descriptor;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    descriptor = fs.openSync(file.absolute, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size !== file.stat.size) throw new Error(`${label}_identity_changed`);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!after.isFile()
      || after.size !== before.size
      || after.size !== bytes.byteLength
      || after.dev !== before.dev
      || after.ino !== before.ino) throw new Error(`${label}_identity_changed`);
    const realAfter = fs.realpathSync.native(file.absolute);
    const relativeAfter = path.relative(file.realRoot, realAfter);
    if (!relativeAfter || relativeAfter.startsWith('..') || path.isAbsolute(relativeAfter)
      || path.normalize(realAfter) !== path.normalize(file.realFile)) throw new Error(`${label}_identity_changed`);
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function verifyArtifact(root, artifact, label, seen, artifactId = null) {
  if (!artifact || typeof artifact !== 'object') throw new Error(`${label}_invalid`);
  if (artifactId !== null && !nonEmpty(artifactId, 256)) throw new Error(`${label}_id_invalid`);
  if (label === 'evidence_artifact' && !nonEmpty(artifact.kind, 128)) throw new Error(`${label}_kind_invalid`);
  if (artifactId !== null && seen.ids.has(artifactId)) throw new Error('artifact_id_duplicate');
  if (!safeRelativePath(artifact.relativePath)) throw new Error(`${label}_path_invalid`);
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.bytes > MAX_FILE_BYTES) throw new Error(`${label}_bytes_invalid`);
  if (!safeHash(artifact.sha256)) throw new Error(`${label}_sha256_invalid`);
  const normalizedPath = artifact.relativePath.replaceAll('\\', '/');
  const pathKey = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
  if (seen.paths.has(pathKey)) throw new Error('artifact_path_duplicate');
  if (seen.hashes.has(artifact.sha256)) throw new Error('artifact_hash_duplicate');
  if (artifactId !== null) seen.ids.add(artifactId);
  seen.paths.add(pathKey);
  seen.hashes.add(artifact.sha256);
  const file = realRegularFile(root, normalizedPath);
  if (file.stat.size !== artifact.bytes) throw new Error(`${label}_bytes_mismatch`);
  const bytes = readStableArtifact(file, label);
  const actualHash = specialtyIndependentReleaseSha256(bytes);
  if (actualHash !== artifact.sha256) throw new Error(`${label}_sha256_mismatch`);
  return { ...file, bytes };
}

function parseQualification(file, expected, blockers) {
  let qualification;
  try {
    qualification = JSON.parse(file.bytes.toString('utf8'));
  } catch {
    blockers.push('qualification_json_invalid');
    return null;
  }
  if (qualification?.schema !== expected.schema) blockers.push('qualification_schema_invalid');
  if (qualification?.track !== expected.track) blockers.push('qualification_track_invalid');
  if (qualification?.status !== 'QUALIFIED' || !Array.isArray(qualification?.blockers) || qualification.blockers.length !== 0) blockers.push('qualification_status_or_blockers_invalid');
  if (expected.schema === 'nexyfab.specialty-manufacturing-qualification.v1') {
    if (qualification?.releaseReady !== true) blockers.push('qualification_release_ready_invalid');
    for (const [name, value] of Object.entries({
      contract: qualification?.contract,
      readback: qualification?.readback,
      externalAxes: qualification?.externalAxes,
    })) if (value?.valid !== true) blockers.push(`qualification_${name}_invalid`);
    if (!Array.isArray(qualification?.externalAxes?.missing) || qualification.externalAxes.missing.length !== 0) blockers.push('qualification_external_axes_missing');
    for (const role of ['independent_parser_cad_reviewer', 'manufacturing_reviewer']) {
      if (qualification?.reviewers?.[role]?.valid !== true) blockers.push(`qualification_reviewer_invalid:${role}`);
    }
  } else if (expected.schema === 'nexyfab.mep-fabrication-qualification.v1') {
    if (qualification?.qualified !== true) blockers.push('qualification_qualified_invalid');
    for (const name of ['internalValidation', 'internalReadback', 'independentAttestation', 'evidence']) {
      if (qualification?.[name]?.valid !== true) blockers.push(`qualification_${name}_invalid`);
    }
  } else {
    if (qualification?.qualified !== true) blockers.push('qualification_qualified_invalid');
    for (const name of ['internalValidation', 'internalReadback', 'artifacts', 'nativeParsers', 'reviewers', 'evidence']) {
      if (qualification?.[name]?.valid !== true) blockers.push(`qualification_${name}_invalid`);
    }
  }
  return qualification;
}

function trustedReviewer(registry, reviewerId) {
  if (registry instanceof Map) return registry.get(reviewerId);
  if (registry && !Array.isArray(registry) && typeof registry === 'object') return registry[reviewerId];
  if (Array.isArray(registry)) return registry.find(item => item?.reviewerId === reviewerId || item?.id === reviewerId);
  return null;
}

function verifyReviewers(receipt, targetHash, trustedReviewers, now, blockers) {
  if (!Array.isArray(receipt?.reviewers) || receipt.reviewers.length !== 2) {
    blockers.push('reviewer_count_invalid');
    return;
  }
  const ids = new Set();
  const keyIds = new Set();
  const roles = new Set();
  for (const reviewer of receipt.reviewers) {
    const role = reviewer?.role;
    if (!SPECIALTY_RELEASE_REVIEW_ROLES.includes(role) || roles.has(role)) blockers.push('reviewer_role_invalid');
    roles.add(role);
    if (!nonEmpty(reviewer?.reviewerId) || ids.has(reviewer.reviewerId)) blockers.push('reviewer_id_invalid_or_reused');
    ids.add(reviewer?.reviewerId);
    let key;
    let keyId;
    try {
      key = crypto.createPublicKey(reviewer?.publicKeyPem);
      keyId = specialtyIndependentReleaseSha256(key.export({ type: 'spki', format: 'der' }));
      if (key.asymmetricKeyType !== 'ed25519') blockers.push('reviewer_ed25519_required');
    } catch {
      blockers.push('reviewer_public_key_invalid');
      continue;
    }
    if (reviewer?.keyIdSha256 !== keyId || keyIds.has(keyId)) blockers.push('reviewer_key_invalid_or_reused');
    keyIds.add(keyId);
    const trusted = trustedReviewer(trustedReviewers, reviewer?.reviewerId);
    const trustedPublicKey = trusted?.publicKeyPem ?? trusted?.publicKey;
    if (!trusted || trustedPublicKey !== reviewer.publicKeyPem || (trusted.keyIdSha256 && trusted.keyIdSha256 !== keyId) || !Array.isArray(trusted.roles) || !trusted.roles.includes(role)) blockers.push('reviewer_not_trusted');
    if (!safeHash(reviewer?.targetSha256) || reviewer.targetSha256 !== targetHash) blockers.push('reviewer_target_invalid');
    const issued = dateMs(reviewer?.issuedAt);
    const expires = dateMs(reviewer?.expiresAt);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + FUTURE_SKEW_MS || expires < now || expires <= issued || expires - issued > MAX_AGE_MS) blockers.push('reviewer_freshness_invalid');
    const encoded = reviewer?.signatureBase64;
    if (typeof encoded !== 'string' || !encoded || !BASE64.test(encoded) || Buffer.from(encoded, 'base64').length === 0) {
      blockers.push('reviewer_signature_encoding_invalid');
    } else {
      try {
        const verified = crypto.verify(null, Buffer.from(specialtyIndependentReleaseCanonical(specialtyIndependentReviewerPayload(receipt, reviewer))), key, Buffer.from(encoded, 'base64'));
        if (!verified) blockers.push('reviewer_signature_invalid');
      } catch {
        blockers.push('reviewer_signature_invalid');
      }
    }
  }
  for (const role of SPECIALTY_RELEASE_REVIEW_ROLES) if (!roles.has(role)) blockers.push(`reviewer_missing:${role}`);
}

function normalizeArguments(allowedRoot, expected, trustedReviewers, now) {
  if (allowedRoot && typeof allowedRoot === 'object' && !Array.isArray(allowedRoot) && Object.prototype.hasOwnProperty.call(allowedRoot, 'allowedRoot')) {
    return {
      allowedRoot: allowedRoot.allowedRoot,
      expected: allowedRoot.expected,
      trustedReviewers: allowedRoot.trustedReviewers,
      now: allowedRoot.now,
    };
  }
  return { allowedRoot, expected, trustedReviewers, now };
}

export function verifySpecialtyIndependentReleaseReceipt(receipt, allowedRoot, expected, trustedReviewers, now = Date.now()) {
  const options = normalizeArguments(allowedRoot, expected, trustedReviewers, now);
  const blockers = [];
  let targetHash;
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('receipt_missing');
    if (receipt.schema !== SPECIALTY_INDEPENDENT_RELEASE_RECEIPT_SCHEMA) blockers.push('receipt_schema_invalid');
    const channel = SPECIALTY_RELEASE_CHANNELS[receipt.channel];
    if (!channel) blockers.push('release_channel_invalid');
    if (channel && receipt.track !== channel.track) blockers.push('release_track_invalid');
    if (!nonEmpty(options.allowedRoot, 4096)) blockers.push('allowed_root_invalid');
    const root = path.resolve(String(options.allowedRoot ?? ''));
    const nowMs = asNow(options.now);
    if (!Number.isFinite(nowMs)) blockers.push('verifier_clock_invalid');
    const generated = dateMs(receipt.generatedAt);
    const expires = dateMs(receipt.expiresAt);
    if (!Number.isFinite(generated) || !Number.isFinite(expires) || generated > nowMs + FUTURE_SKEW_MS || expires < nowMs || expires <= generated || expires - generated > MAX_AGE_MS || nowMs - generated > MAX_AGE_MS) blockers.push('receipt_freshness_invalid');
    const release = receipt.release;
    if (!nonEmpty(release?.buildId) || !nonEmpty(release?.deploymentId) || !safeGit(release?.gitHead)) blockers.push('release_identity_invalid');
    const expectedRelease = options.expected;
    if (!expectedRelease || release?.buildId !== expectedRelease.buildId || release?.deploymentId !== expectedRelease.deploymentId || release?.gitHead !== expectedRelease.gitHead || receipt.channel !== expectedRelease.channel) blockers.push('release_binding_invalid');
    if (!Array.isArray(receipt.evidenceArtifacts) || receipt.evidenceArtifacts.length === 0 || receipt.evidenceArtifacts.length > MAX_EVIDENCE_ARTIFACTS) blockers.push('evidence_artifacts_invalid');
    if (!receipt.qualificationArtifact || typeof receipt.qualificationArtifact !== 'object') blockers.push('qualification_artifact_invalid');
    const seen = { ids: new Set(), paths: new Set(), hashes: new Set() };
    let totalBytes = 0;
    let qualificationFile = null;
    if (!blockers.includes('allowed_root_invalid')) {
      try {
        qualificationFile = verifyArtifact(root, receipt.qualificationArtifact, 'qualification_artifact', seen, 'qualification');
        totalBytes += receipt.qualificationArtifact.bytes;
        for (const artifact of receipt.evidenceArtifacts ?? []) {
          verifyArtifact(root, artifact, 'evidence_artifact', seen, artifact?.artifactId);
          totalBytes += artifact?.bytes ?? 0;
        }
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : 'artifact_verification_failed');
      }
    }
    if (totalBytes > MAX_TOTAL_BYTES) blockers.push('artifact_total_bytes_invalid');
    if (channel && qualificationFile) parseQualification(qualificationFile, channel, blockers);
    targetHash = specialtyIndependentReleaseTargetSha256(receipt);
    if (receipt.reviewers?.some(item => item?.targetSha256 !== targetHash)) blockers.push('target_binding_invalid');
    if (!safeHash(receipt.receiptSha256) || specialtyIndependentReleaseSha256(unsignedReceipt(receipt)) !== receipt.receiptSha256) blockers.push('receipt_sha256_invalid');
    if (channel && Number.isFinite(nowMs)) verifyReviewers(receipt, targetHash, options.trustedReviewers, nowMs, blockers);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : 'receipt_verification_exception');
  }
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)].sort(), targetSha256: targetHash ?? null, receiptSha256: receipt?.receiptSha256 ?? null };
}

export const specialtyIndependentReleaseReceiptEligible = verifySpecialtyIndependentReleaseReceipt;

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.stderr.write('This module exposes a verifier; use it from a receipt gate or test fixture.\n');
  process.exitCode = 2;
}
