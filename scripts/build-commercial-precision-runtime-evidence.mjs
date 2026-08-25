#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canonicalJson,
  sha256,
} from './immutable-receipt-binding.mjs';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
  canonicalizeText,
} from './canonical-text-binding.mjs';

export const COMMERCIAL_PRECISION_RUNTIME_OBSERVATION_SCHEMA =
  'nexyfab.commercial-precision-runtime-observation.v1';
export const COMMERCIAL_PRECISION_RUNTIME_RECEIPT_SCHEMA =
  'nexyfab.commercial-precision-runtime-evidence.v3';
export const COMMERCIAL_PRECISION_EXECUTION_CONTRACT =
  'nexyfab.precision-cad-commercial-execution.v3';
export const COMMERCIAL_PRECISION_MIGRATION_VERSION = 2026082502;
export const COMMERCIAL_PRECISION_RUNTIME_MAX_AGE_MS = 24 * 60 * 60_000;
export const COMMERCIAL_PRECISION_MIGRATION_SOURCE =
  'src/lib/db-postgres-migration-2026082502.sql';
export const COMMERCIAL_PRECISION_DEFAULT_OBSERVATION =
  'commercial-precision-runtime-observation.json';
export const COMMERCIAL_PRECISION_DEFAULT_RECEIPT =
  'docs/evidence/release/commercial-precision-runtime-evidence.json';
export const COMMERCIAL_PRECISION_TEXT_CANONICALIZATION = TEXT_BINDING_CANONICALIZATION;

export const COMMERCIAL_PRECISION_PRIVATE_BETA_CHECKS = Object.freeze([
  'postgresMigration',
  'redisAvailability',
  'immutableInputWriteReadback',
  'transactionalOutboxEnqueue',
  'leaseClaim',
  'nativeExecution',
  'threeOutputCommitReadback',
  'workerReceiptSignature',
  'signedCallback',
  'authoritativePersistence',
  'workspaceCasCommit',
  'wrongWorkerRejected',
  'inputSubstitutionRejected',
  'outputSubstitutionRejected',
  'callbackReplayRejected',
]);

export const COMMERCIAL_PRECISION_GA_CHECKS = Object.freeze([
  'multiInstanceClaimExclusion',
  'expiredLeaseRecovery',
  'crashAfterClaimRecovery',
  'verifiedUnknownNoReplay',
  'credentialRotation',
]);

export const COMMERCIAL_PRECISION_EVIDENCE_SOURCES = Object.freeze({
  databaseSnapshot: 'nexyfab.commercial-precision-database-snapshot.v1',
  objectStorageManifest: 'nexyfab.commercial-precision-object-storage-manifest.v1',
  workerReceipt: COMMERCIAL_PRECISION_EXECUTION_CONTRACT,
  negativeCampaign: 'nexyfab.commercial-precision-negative-campaign.v1',
  recoveryCampaign: 'nexyfab.commercial-precision-recovery-campaign.v1',
});

export const COMMERCIAL_PRECISION_CHECK_EVIDENCE = Object.freeze({
  postgresMigration: ['databaseSnapshot', 'postgres_migration_checksum_match'],
  redisAvailability: ['databaseSnapshot', 'redis_ping_pass'],
  immutableInputWriteReadback: ['objectStorageManifest', 'immutable_input_write_readback_hash_match'],
  transactionalOutboxEnqueue: ['databaseSnapshot', 'transactional_outbox_enqueued'],
  leaseClaim: ['databaseSnapshot', 'lease_claim_persisted'],
  nativeExecution: ['workerReceipt', null],
  threeOutputCommitReadback: ['objectStorageManifest', 'three_output_commit_readback_hash_match'],
  workerReceiptSignature: ['workerReceipt', null],
  signedCallback: ['databaseSnapshot', 'signed_callback_persisted'],
  authoritativePersistence: ['databaseSnapshot', 'authoritative_persistence_committed'],
  workspaceCasCommit: ['databaseSnapshot', 'workspace_cas_committed'],
  wrongWorkerRejected: ['negativeCampaign', 'wrong_worker_rejected'],
  inputSubstitutionRejected: ['negativeCampaign', 'input_substitution_rejected'],
  outputSubstitutionRejected: ['negativeCampaign', 'output_substitution_rejected'],
  callbackReplayRejected: ['negativeCampaign', 'callback_replay_conflict_rejected'],
  multiInstanceClaimExclusion: ['recoveryCampaign', 'multi_instance_claim_exclusion'],
  expiredLeaseRecovery: ['recoveryCampaign', 'expired_lease_recovery'],
  crashAfterClaimRecovery: ['recoveryCampaign', 'crash_after_claim_recovery'],
  verifiedUnknownNoReplay: ['recoveryCampaign', 'verified_unknown_no_replay'],
  credentialRotation: ['recoveryCampaign', 'credential_rotation'],
});

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STATUS = new Set(['PASS', 'FAIL', 'NOT_RUN']);
const OUTPUT_ROLES = Object.freeze(['model', 'report', 'verification']);
const SUPPORTING_MAX_AGE_MS = 24 * 60 * 60_000;

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function expectedGitHead(release) {
  return release?.gitHead ?? release?.head ?? null;
}

function releaseIdentityValid(release) {
  return typeof release?.buildId === 'string' && release.buildId.trim().length > 0
    && GIT_SHA.test(String(release?.gitHead ?? ''))
    && typeof release?.productionDeploymentId === 'string'
    && release.productionDeploymentId.trim().length > 0
    && typeof release?.evidenceDeploymentId === 'string'
    && release.evidenceDeploymentId.trim().length > 0;
}

function releaseMatchesExpected(release, expectedRelease) {
  if (!expectedRelease) return true;
  return release?.buildId === expectedRelease.buildId
    && release?.gitHead === expectedGitHead(expectedRelease)
    && release?.productionDeploymentId === expectedRelease.deploymentId;
}

function resolveRegularFile(root, relativePath) {
  if (typeof root !== 'string' || !root.trim() || typeof relativePath !== 'string') return null;
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized || normalized === '.' || path.isAbsolute(normalized)
    || normalized.split('/').includes('..')) return null;
  try {
    const resolvedRoot = path.resolve(root);
    if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) return null;
    const absolute = path.resolve(resolvedRoot, ...normalized.split('/'));
    const lexicalRelative = path.relative(resolvedRoot, absolute).replaceAll('\\', '/');
    if (lexicalRelative !== normalized) return null;
    if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink()
      || !fs.statSync(absolute).isFile()) return null;
    const realRoot = fs.realpathSync.native(resolvedRoot);
    const realFile = fs.realpathSync.native(absolute);
    const realRelative = path.relative(realRoot, realFile);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null;
    return realFile;
  } catch {
    return null;
  }
}

function fileBinding(root, relativePath) {
  const absolute = resolveRegularFile(root, relativePath);
  if (!absolute) return null;
  return {
    path: relativePath.replaceAll('\\', '/'),
    ...canonicalTextBinding(fs.readFileSync(absolute)),
  };
}

function readJsonFile(root, relativePath) {
  const absolute = resolveRegularFile(root, relativePath);
  if (!absolute) return null;
  try {
    const text = canonicalizeText(fs.readFileSync(absolute));
    return {
      document: JSON.parse(text),
      binding: {
        path: relativePath.replaceAll('\\', '/'),
        ...canonicalTextBinding(text),
      },
    };
  } catch {
    return null;
  }
}

function strongEvidenceSecret(secret) {
  if (typeof secret !== 'string' || secret.trim() !== secret || Buffer.byteLength(secret) < 32) return false;
  return new Set(secret).size >= 12;
}

function commercialWorkerFingerprint(publicKeyPem) {
  try {
    if (typeof publicKeyPem !== 'string' || /PRIVATE KEY/i.test(publicKeyPem)) return null;
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return null;
    return crypto.createHash('sha256')
      .update(key.export({ type: 'spki', format: 'der' }))
      .digest('hex');
  } catch {
    return null;
  }
}

export function loadCommercialPrecisionWorkerRegistry(raw) {
  if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw, 'utf8') > 64 * 1024) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null;
    const entries = Object.entries(parsed);
    if (entries.length < 1 || entries.length > 16) return null;
    const normalized = {};
    const fingerprints = new Set();
    for (const [identity, worker] of entries.sort(([left], [right]) => left.localeCompare(right))) {
      if (!worker || typeof worker !== 'object' || Array.isArray(worker)
        || Object.keys(worker).sort().join(',') !== 'fingerprintSha256,nativeExecutableSha256,nativeInvocationSha256,publicKeyPem,workerIdentity'
        || !ID.test(identity) || worker.workerIdentity !== identity
        || !SHA256.test(String(worker.fingerprintSha256 ?? ''))
        || !SHA256.test(String(worker.nativeExecutableSha256 ?? ''))
        || !SHA256.test(String(worker.nativeInvocationSha256 ?? ''))
        || commercialWorkerFingerprint(worker.publicKeyPem) !== worker.fingerprintSha256
        || fingerprints.has(worker.fingerprintSha256)) return null;
      fingerprints.add(worker.fingerprintSha256);
      normalized[identity] = {
        workerIdentity: identity,
        publicKeyPem: worker.publicKeyPem,
        fingerprintSha256: worker.fingerprintSha256,
        nativeExecutableSha256: worker.nativeExecutableSha256,
        nativeInvocationSha256: worker.nativeInvocationSha256,
      };
    }
    return Object.freeze(normalized);
  } catch {
    return null;
  }
}

function workerReceiptSignaturePayload(receipt) {
  const unsigned = structuredClone(receipt ?? {});
  delete unsigned.signatureBase64;
  return canonicalJson({
    schema: receipt?.schema,
    purpose: 'worker-receipt',
    receipt: unsigned,
  });
}

function verifiedWorkerTrust(receipt, trustedWorkers) {
  const worker = trustedWorkers?.[receipt?.workerIdentity];
  if (!worker || receipt?.workerPublicKeyFingerprint !== worker.fingerprintSha256
    || receipt?.nativeExecutableSha256 !== worker.nativeExecutableSha256
    || receipt?.nativeInvocationSha256 !== worker.nativeInvocationSha256) return null;
  const signature = typeof receipt?.signatureBase64 === 'string'
    ? Buffer.from(receipt.signatureBase64, 'base64')
    : Buffer.alloc(0);
  if (signature.byteLength !== 64 || signature.toString('base64') !== receipt.signatureBase64) return null;
  try {
    if (!crypto.verify(
      null,
      Buffer.from(workerReceiptSignaturePayload(receipt), 'utf8'),
      worker.publicKeyPem,
      signature,
    )) return null;
  } catch {
    return null;
  }
  return {
    signatureVerified: true,
    workerIdentity: worker.workerIdentity,
    fingerprintSha256: worker.fingerprintSha256,
    nativeExecutableSha256: worker.nativeExecutableSha256,
    nativeInvocationSha256: worker.nativeInvocationSha256,
    registrySha256: sha256(trustedWorkers),
  };
}

export function commercialPrecisionRuntimeAttestationPayload(observation) {
  const value = structuredClone(observation ?? {});
  if (value.attestation && typeof value.attestation === 'object') {
    delete value.attestation.hmacSha256;
  }
  return canonicalJson({
    schema: COMMERCIAL_PRECISION_RUNTIME_OBSERVATION_SCHEMA,
    purpose: 'commercial-precision-runtime-evidence',
    observation: value,
  });
}

export function signCommercialPrecisionRuntimeObservation(observation, secret) {
  if (!strongEvidenceSecret(secret)) throw new Error('commercial_precision_evidence_secret_invalid');
  return crypto.createHmac('sha256', secret)
    .update(commercialPrecisionRuntimeAttestationPayload(observation), 'utf8')
    .digest('hex');
}

function hmacVerified(observation, secret) {
  if (!strongEvidenceSecret(secret) || !SHA256.test(String(observation?.attestation?.hmacSha256 ?? ''))) return false;
  const expected = signCommercialPrecisionRuntimeObservation(observation, secret);
  const actual = String(observation.attestation.hmacSha256);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function attachRuntimeReceiptAttestation(receipt, secret) {
  const unsigned = structuredClone(receipt);
  delete unsigned.receiptSha256;
  delete unsigned.receiptHmacSha256;
  const receiptSha256 = sha256(unsigned);
  const receiptHmacSha256 = strongEvidenceSecret(secret)
    ? crypto.createHmac('sha256', secret)
      .update(canonicalJson({ ...unsigned, receiptSha256 }), 'utf8')
      .digest('hex')
    : null;
  return { ...unsigned, receiptSha256, receiptHmacSha256 };
}

function runtimeReceiptAttestationValid(receipt, secret) {
  if (!strongEvidenceSecret(secret)
    || !SHA256.test(String(receipt?.receiptSha256 ?? ''))
    || !SHA256.test(String(receipt?.receiptHmacSha256 ?? ''))) return false;
  const unsigned = structuredClone(receipt ?? {});
  delete unsigned.receiptSha256;
  delete unsigned.receiptHmacSha256;
  const receiptSha256 = sha256(unsigned);
  if (receiptSha256 !== receipt.receiptSha256) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(canonicalJson({ ...unsigned, receiptSha256 }), 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(receipt.receiptHmacSha256, 'hex'),
  );
}

function supportingTimeValid(value, observationTime) {
  const capturedAt = Date.parse(value);
  return Number.isFinite(capturedAt)
    && capturedAt <= observationTime + 5 * 60_000
    && capturedAt >= observationTime - SUPPORTING_MAX_AGE_MS;
}

function workerReceiptValid(receipt, observation, observationTime, trustedWorkers) {
  const execution = observation?.execution ?? {};
  const outputs = Array.isArray(receipt?.outputArtifacts) ? receipt.outputArtifacts : [];
  const roles = outputs.map(item => item?.role);
  return receipt?.schema === COMMERCIAL_PRECISION_EXECUTION_CONTRACT
    && receipt?.status === 'PASS'
    && receipt?.jobId === execution.jobId
    && receipt?.executionId === execution.executionId
    && receipt?.workerIdentity === execution.workerIdentity
    && receipt?.workerPublicKeyFingerprint === execution.workerPublicKeyFingerprint
    && receipt?.nativeExecutableSha256 === execution.nativeExecutableSha256
    && receipt?.nativeInvocationSha256 === execution.nativeInvocationSha256
    && receipt?.inputArtifactSha256 === execution.inputArtifactSha256
    && SHA256.test(String(execution.workerReceiptSha256 ?? ''))
    && SHA256.test(String(receipt?.workerPublicKeyFingerprint ?? ''))
    && SHA256.test(String(receipt?.nativeExecutableSha256 ?? ''))
    && SHA256.test(String(receipt?.nativeInvocationSha256 ?? ''))
    && SHA256.test(String(receipt?.inputArtifactSha256 ?? ''))
    && verifiedWorkerTrust(receipt, trustedWorkers) !== null
    && supportingTimeValid(receipt?.completedAt, observationTime)
    && outputs.length === OUTPUT_ROLES.length
    && new Set(roles).size === OUTPUT_ROLES.length
    && OUTPUT_ROLES.every(role => roles.includes(role))
    && outputs.every(item => ID.test(String(item?.artifactId ?? ''))
      && SHA256.test(String(item?.contentSha256 ?? ''))
      && Number.isSafeInteger(item?.byteLength) && item.byteLength > 0
      && typeof item?.objectKey === 'string' && item.objectKey.startsWith('private/')
      && !item.objectKey.includes('..') && !item.objectKey.includes('\\'))
    && sha256(Buffer.from(canonicalJson(receipt), 'utf8')) === execution.workerReceiptSha256;
}

function supportingDocumentValid(role, document, observation, observationTime, trustedWorkers) {
  if (role === 'workerReceipt') return workerReceiptValid(document, observation, observationTime, trustedWorkers);
  return document?.schema === COMMERCIAL_PRECISION_EVIDENCE_SOURCES[role]
    && document?.status === 'PASS'
    && document?.jobId === observation?.execution?.jobId
    && document?.executionId === observation?.execution?.executionId
    && sameJson(document?.release, observation?.release)
    && supportingTimeValid(document?.capturedAt, observationTime)
    && Array.isArray(document?.assertions)
    && document.assertions.length > 0
    && document.assertions.every(item => typeof item === 'string' && item.length > 0);
}

function migrationBinding(sourceRoot) {
  return fileBinding(sourceRoot, COMMERCIAL_PRECISION_MIGRATION_SOURCE);
}

function observationShapeBlockers(observation, expectedRelease, sourceMigration, now) {
  const blockers = [];
  const block = value => blockers.push(value);
  const capturedAt = Date.parse(observation?.capturedAt);
  const signedAt = Date.parse(observation?.attestation?.signedAt);
  if (observation?.schema !== COMMERCIAL_PRECISION_RUNTIME_OBSERVATION_SCHEMA) block('observation_schema_invalid');
  if (observation?.environment !== 'staging' && observation?.environment !== 'production') block('environment_invalid');
  if (!releaseIdentityValid(observation?.release)) block('release_identity_invalid');
  if (!releaseMatchesExpected(observation?.release, expectedRelease)) block('release_binding_mismatch');
  if (!Number.isFinite(capturedAt) || capturedAt > now + 5 * 60_000
    || capturedAt < now - COMMERCIAL_PRECISION_RUNTIME_MAX_AGE_MS) block('observation_stale');
  if (observation?.attestation?.algorithm !== 'hmac-sha256'
    || typeof observation?.attestation?.keyId !== 'string'
    || !ID.test(observation.attestation.keyId)
    || !Number.isFinite(signedAt)
    || signedAt > capturedAt + 5 * 60_000
    || signedAt < capturedAt - 5 * 60_000) block('attestation_metadata_invalid');
  if (observation?.execution?.contract !== COMMERCIAL_PRECISION_EXECUTION_CONTRACT) block('execution_contract_invalid');
  for (const key of ['jobId', 'executionId', 'workerIdentity']) {
    if (!ID.test(String(observation?.execution?.[key] ?? ''))) block(`execution_${key}_invalid`);
  }
  for (const key of ['workerPublicKeyFingerprint', 'nativeExecutableSha256', 'nativeInvocationSha256', 'workerReceiptSha256', 'inputArtifactSha256']) {
    if (!SHA256.test(String(observation?.execution?.[key] ?? ''))) block(`execution_${key}_invalid`);
  }
  if (observation?.migration?.version !== COMMERCIAL_PRECISION_MIGRATION_VERSION
    || !SHA256.test(String(observation?.migration?.checksum ?? ''))
    || observation?.migration?.canonicalization !== COMMERCIAL_PRECISION_TEXT_CANONICALIZATION
    || sourceMigration?.canonicalization !== COMMERCIAL_PRECISION_TEXT_CANONICALIZATION
    || observation?.migration?.checksum !== sourceMigration?.sha256) block('migration_binding_invalid');
  const allChecks = [...COMMERCIAL_PRECISION_PRIVATE_BETA_CHECKS, ...COMMERCIAL_PRECISION_GA_CHECKS];
  const checkKeys = observation?.checks && typeof observation.checks === 'object' && !Array.isArray(observation.checks)
    ? Object.keys(observation.checks) : [];
  if (checkKeys.length !== allChecks.length || new Set(checkKeys).size !== allChecks.length
    || allChecks.some(key => !STATUS.has(observation?.checks?.[key]))) block('check_matrix_invalid');
  const evidenceKeys = observation?.evidence && typeof observation.evidence === 'object' && !Array.isArray(observation.evidence)
    ? Object.keys(observation.evidence) : [];
  if (evidenceKeys.length !== Object.keys(COMMERCIAL_PRECISION_EVIDENCE_SOURCES).length
    || new Set(evidenceKeys).size !== evidenceKeys.length
    || Object.keys(COMMERCIAL_PRECISION_EVIDENCE_SOURCES).some(key => !evidenceKeys.includes(key))) {
    block('evidence_manifest_invalid');
  }
  return blockers;
}

function readObservationEvidence(evidenceRoot, observation, observationTime, trustedWorkers) {
  const bindings = {};
  const documents = {};
  const blockers = [];
  const paths = new Set();
  let workerTrust = null;
  for (const role of Object.keys(COMMERCIAL_PRECISION_EVIDENCE_SOURCES)) {
    const claimed = observation?.evidence?.[role];
    const loaded = readJsonFile(evidenceRoot, claimed?.path);
    if (!loaded) {
      blockers.push(`evidence_unavailable:${role}`);
      bindings[role] = null;
      continue;
    }
    bindings[role] = loaded.binding;
    documents[role] = loaded.document;
    if (paths.has(loaded.binding.path)) blockers.push(`evidence_path_reused:${role}`);
    paths.add(loaded.binding.path);
    if (!SHA256.test(String(claimed?.sha256 ?? ''))
      || claimed?.sha256 !== loaded.binding.sha256
      || claimed?.bytes !== loaded.binding.bytes
      || claimed?.canonicalization !== COMMERCIAL_PRECISION_TEXT_CANONICALIZATION
      || loaded.binding.canonicalization !== COMMERCIAL_PRECISION_TEXT_CANONICALIZATION) {
      blockers.push(`evidence_binding_mismatch:${role}`);
    }
    if (!supportingDocumentValid(role, loaded.document, observation, observationTime, trustedWorkers)) {
      blockers.push(`evidence_document_invalid:${role}`);
    }
    if (role === 'workerReceipt') workerTrust = verifiedWorkerTrust(loaded.document, trustedWorkers);
  }
  return { bindings, blockers, documents, workerTrust };
}

function checkEvidenceBlockers(checks, evidence) {
  const blockers = [];
  for (const [check, [role, assertion]] of Object.entries(COMMERCIAL_PRECISION_CHECK_EVIDENCE)) {
    if (checks?.[check] !== 'PASS') continue;
    if (role === 'workerReceipt') {
      if (!evidence.workerTrust?.signatureVerified) blockers.push(`check_evidence_missing:${check}`);
      continue;
    }
    const assertions = evidence.documents?.[role]?.assertions;
    if (!Array.isArray(assertions) || !assertions.includes(assertion)) {
      blockers.push(`check_evidence_missing:${check}`);
    }
  }
  return blockers;
}

function defaultChecks() {
  return Object.fromEntries(
    [...COMMERCIAL_PRECISION_PRIVATE_BETA_CHECKS, ...COMMERCIAL_PRECISION_GA_CHECKS]
      .map(key => [key, 'NOT_RUN']),
  );
}

export function buildCommercialPrecisionRuntimeEvidenceReceipt({
  sourceRoot = process.cwd(),
  evidenceRoot = process.env.NEXYFAB_COMMERCIAL_PRECISION_EVIDENCE_ROOT ?? '',
  observationPath = process.env.COMMERCIAL_PRECISION_RUNTIME_OBSERVATION
    ?? COMMERCIAL_PRECISION_DEFAULT_OBSERVATION,
  expectedRelease = null,
  secret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET,
  workerRegistryRaw = process.env.NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON,
  generatedAt = new Date().toISOString(),
  now = Date.now(),
} = {}) {
  const generated = Date.parse(generatedAt);
  const migrationSource = migrationBinding(sourceRoot);
  const loaded = readJsonFile(evidenceRoot, observationPath);
  const observation = loaded?.document ?? null;
  const observationTime = Date.parse(observation?.capturedAt);
  const trustedWorkers = loadCommercialPrecisionWorkerRegistry(workerRegistryRaw);
  const commonBlockers = [
    ...(!Number.isFinite(generated) || generated > now + 5 * 60_000 ? ['generated_at_invalid'] : []),
    ...(!migrationSource ? ['migration_source_unavailable'] : []),
    ...(!loaded ? ['runtime_observation_missing'] : []),
    ...(observation && !trustedWorkers ? ['worker_registry_invalid'] : []),
    ...(observation ? observationShapeBlockers(observation, expectedRelease, migrationSource, now) : []),
    ...(observation && !hmacVerified(observation, secret) ? ['runtime_attestation_invalid'] : []),
  ];
  const evidence = observation
    ? readObservationEvidence(evidenceRoot, observation, observationTime, trustedWorkers)
    : { bindings: Object.fromEntries(Object.keys(COMMERCIAL_PRECISION_EVIDENCE_SOURCES).map(key => [key, null])), blockers: [], documents: {}, workerTrust: null };
  commonBlockers.push(...evidence.blockers);
  const checks = observation?.checks ?? defaultChecks();
  commonBlockers.push(...checkEvidenceBlockers(checks, evidence));
  const privateBetaBlockers = [
    ...commonBlockers,
    ...COMMERCIAL_PRECISION_PRIVATE_BETA_CHECKS
      .filter(key => checks[key] !== 'PASS')
      .map(key => `private_beta_check_not_pass:${key}`),
  ];
  const commercialGaBlockers = [
    ...privateBetaBlockers,
    ...(observation?.environment === 'production' ? [] : ['production_runtime_not_observed']),
    ...(observation?.release?.evidenceDeploymentId === observation?.release?.productionDeploymentId
      ? [] : ['production_deployment_not_observed']),
    ...COMMERCIAL_PRECISION_GA_CHECKS
      .filter(key => checks[key] !== 'PASS')
      .map(key => `commercial_ga_check_not_pass:${key}`),
  ];
  const privateBetaEligible = privateBetaBlockers.length === 0;
  const commercialGaEligible = commercialGaBlockers.length === 0;
  return attachRuntimeReceiptAttestation({
    schema: COMMERCIAL_PRECISION_RUNTIME_RECEIPT_SCHEMA,
    generatedAt,
    status: commercialGaEligible ? 'COMMERCIAL_GA_PASS' : privateBetaEligible ? 'PRIVATE_BETA_PASS' : 'HOLD',
    release: observation?.release ?? null,
    environment: observation?.environment ?? null,
    execution: observation?.execution ?? null,
    migration: observation?.migration ?? null,
    migrationSource,
    observationBinding: loaded?.binding ?? null,
    evidenceBindings: evidence.bindings,
    workerTrust: evidence.workerTrust,
    checks,
    decision: {
      privateBeta: { eligible: privateBetaEligible, blockers: [...new Set(privateBetaBlockers)] },
      commercialGa: { eligible: commercialGaEligible, blockers: [...new Set(commercialGaBlockers)] },
    },
    claimBoundary: {
      sourceTestsAreRuntimeEvidence: false,
      fixtureWorkerIsCommercialEvidence: false,
      stagingCanQualifyCommercialGa: false,
      productionRequiresSameDeployment: true,
      independentCadOrManufacturingCertified: false,
    },
  }, secret);
}

export function verifyCommercialPrecisionRuntimeEvidence(receipt, options = {}) {
  const blockers = [];
  if (receipt?.schema !== COMMERCIAL_PRECISION_RUNTIME_RECEIPT_SCHEMA) blockers.push('receipt_schema_invalid');
  if (!runtimeReceiptAttestationValid(receipt, options.secret ?? process.env.GENERATION_EVIDENCE_SIGNING_SECRET)) {
    blockers.push('receipt_attestation_invalid');
  }
  const expected = buildCommercialPrecisionRuntimeEvidenceReceipt({
    ...options,
    generatedAt: receipt?.generatedAt,
  });
  if (!sameJson(receipt, expected)) blockers.push('receipt_derivation_mismatch');
  const receiptVerified = blockers.length === 0;
  return {
    receiptVerified,
    privateBetaEligible: receiptVerified && receipt?.decision?.privateBeta?.eligible === true,
    commercialGaEligible: receiptVerified && receipt?.decision?.commercialGa?.eligible === true,
    status: receiptVerified ? receipt.status : 'HOLD',
    receiptSha256: receipt?.receiptSha256 ?? null,
    blockers: [...new Set([
      ...blockers,
      ...(receiptVerified ? receipt?.decision?.commercialGa?.blockers ?? [] : []),
    ])],
  };
}

function main() {
  const receipt = buildCommercialPrecisionRuntimeEvidenceReceipt({
    sourceRoot: process.cwd(),
    expectedRelease: {
      buildId: process.env.RELEASE_BUILD_ID ?? process.env.NEXYFAB_BUILD_ID,
      deploymentId: process.env.RELEASE_DEPLOYMENT_ID ?? process.env.RAILWAY_DEPLOYMENT_ID,
      gitHead: process.env.RELEASE_GIT_HEAD ?? process.env.RAILWAY_GIT_COMMIT_SHA,
    },
  });
  const output = path.resolve(
    process.env.COMMERCIAL_PRECISION_RUNTIME_RECEIPT_OUTPUT
      ?? COMMERCIAL_PRECISION_DEFAULT_RECEIPT,
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    status: receipt.status,
    output,
    privateBeta: receipt.decision.privateBeta,
    commercialGa: receipt.decision.commercialGa,
  })}\n`);
  process.exitCode = process.argv.includes('--require-ga')
    ? (receipt.decision.commercialGa.eligible ? 0 : 1)
    : (receipt.decision.privateBeta.eligible ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    process.stderr.write(`[commercial-precision-runtime-evidence] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
