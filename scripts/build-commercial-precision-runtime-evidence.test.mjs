import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  COMMERCIAL_PRECISION_EVIDENCE_SOURCES,
  COMMERCIAL_PRECISION_EXECUTION_CONTRACT,
  COMMERCIAL_PRECISION_GA_CHECKS,
  COMMERCIAL_PRECISION_MIGRATION_SOURCE,
  COMMERCIAL_PRECISION_MIGRATION_VERSION,
  COMMERCIAL_PRECISION_PRIVATE_BETA_CHECKS,
  COMMERCIAL_PRECISION_RUNTIME_OBSERVATION_SCHEMA,
  COMMERCIAL_PRECISION_TEXT_CANONICALIZATION,
  buildCommercialPrecisionRuntimeEvidenceReceipt,
  signCommercialPrecisionRuntimeObservation,
  verifyCommercialPrecisionRuntimeEvidence,
} from './build-commercial-precision-runtime-evidence.mjs';
import { canonicalJson, sha256 } from './immutable-receipt-binding.mjs';
import { canonicalTextBinding, canonicalTextSha256 } from './canonical-text-binding.mjs';

const secret = 'precision-runtime-evidence-secret-20260825-A!';
const workerKeys = crypto.generateKeyPairSync('ed25519');
const workerPublicKeyPem = workerKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const workerFingerprint = crypto.createHash('sha256')
  .update(workerKeys.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex');
const nativeExecutableSha256 = '8'.repeat(64);
const nativeInvocationSha256 = '9'.repeat(64);
const workerRegistryRaw = JSON.stringify({
  'commercial-worker-1': {
    workerIdentity: 'commercial-worker-1',
    publicKeyPem: workerPublicKeyPem,
    fingerprintSha256: workerFingerprint,
    nativeExecutableSha256,
    nativeInvocationSha256,
  },
});
const expectedRelease = {
  buildId: 'build-1',
  deploymentId: 'production-deployment-1',
  gitHead: '1'.repeat(40),
};

function writeJson(root, relative, value) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.writeFileSync(absolute, bytes);
  return { path: relative, ...canonicalTextBinding(bytes) };
}

function fixture({ environment = 'production', checkOverrides = {}, now = Date.now(), tamperWorkerSignature = false, omitAssertion = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-precision-runtime-'));
  const sourceRoot = path.join(root, 'source');
  const evidenceRoot = path.join(root, 'evidence');
  const migrationBytes = Buffer.from('-- exact commercial Precision migration fixture\n');
  const migrationAbsolute = path.join(sourceRoot, ...COMMERCIAL_PRECISION_MIGRATION_SOURCE.split('/'));
  fs.mkdirSync(path.dirname(migrationAbsolute), { recursive: true });
  fs.writeFileSync(migrationAbsolute, migrationBytes);
  const capturedAt = new Date(now - 60_000).toISOString();
  const release = {
    buildId: expectedRelease.buildId,
    gitHead: expectedRelease.gitHead,
    productionDeploymentId: expectedRelease.deploymentId,
    evidenceDeploymentId: environment === 'production'
      ? expectedRelease.deploymentId
      : 'staging-deployment-1',
  };
  const execution = {
    contract: COMMERCIAL_PRECISION_EXECUTION_CONTRACT,
    jobId: 'canary-job-1',
    executionId: 'canary-execution-1',
    workerIdentity: 'commercial-worker-1',
    workerPublicKeyFingerprint: workerFingerprint,
    nativeExecutableSha256,
    nativeInvocationSha256,
    inputArtifactSha256: 'b'.repeat(64),
  };
  const workerReceipt = {
    schema: COMMERCIAL_PRECISION_EXECUTION_CONTRACT,
    tenantId: 'tenant-1',
    projectId: 'project-1',
    executionId: execution.executionId,
    generationRunId: 'generation-1',
    generationStateRevision: 1,
    generationProgramSha256: 'c'.repeat(64),
    workspaceId: 'workspace-1',
    workspaceRevision: 1,
    workspaceContentHash: 'd'.repeat(64),
    journalVersion: 4,
    leaseGeneration: 2,
    leaseCapabilityHash: 'e'.repeat(64),
    attempt: 2,
    jobId: execution.jobId,
    commandHash: 'f'.repeat(64),
    targetHash: '1'.repeat(64),
    inputArtifactSha256: execution.inputArtifactSha256,
    workerIdentity: execution.workerIdentity,
    workerPublicKeyFingerprint: execution.workerPublicKeyFingerprint,
    nativeExecutableSha256: execution.nativeExecutableSha256,
    nativeInvocationSha256: execution.nativeInvocationSha256,
    status: 'PASS',
    startedAt: new Date(now - 90_000).toISOString(),
    completedAt: capturedAt,
    outputArtifacts: ['model', 'report', 'verification'].map((role, index) => ({
      artifactId: `${role}-artifact`,
      role,
      contentSha256: String(index + 2).repeat(64),
      byteLength: 100 + index,
      objectKey: `private/commercial/${execution.jobId}/${role}`,
    })),
    failureReasons: [],
    signatureBase64: '',
  };
  const unsignedWorkerReceipt = structuredClone(workerReceipt);
  delete unsignedWorkerReceipt.signatureBase64;
  workerReceipt.signatureBase64 = crypto.sign(
    null,
    Buffer.from(canonicalJson({
      schema: workerReceipt.schema,
      purpose: 'worker-receipt',
      receipt: unsignedWorkerReceipt,
    }), 'utf8'),
    workerKeys.privateKey,
  ).toString('base64');
  if (tamperWorkerSignature) {
    const signature = Buffer.from(workerReceipt.signatureBase64, 'base64');
    signature[0] ^= 0xff;
    workerReceipt.signatureBase64 = signature.toString('base64');
  }
  execution.workerReceiptSha256 = sha256(Buffer.from(canonicalJson(workerReceipt), 'utf8'));
  const sourceValues = {
    databaseSnapshot: {
      schema: COMMERCIAL_PRECISION_EVIDENCE_SOURCES.databaseSnapshot,
      status: 'PASS', capturedAt, release,
      jobId: execution.jobId, executionId: execution.executionId,
      assertions: [
        'postgres_migration_checksum_match', 'redis_ping_pass',
        'transactional_outbox_enqueued', 'lease_claim_persisted',
        'signed_callback_persisted', 'authoritative_persistence_committed',
        'workspace_cas_committed',
      ],
    },
    objectStorageManifest: {
      schema: COMMERCIAL_PRECISION_EVIDENCE_SOURCES.objectStorageManifest,
      status: 'PASS', capturedAt, release,
      jobId: execution.jobId, executionId: execution.executionId,
      assertions: [
        'immutable_input_write_readback_hash_match',
        'three_output_commit_readback_hash_match',
      ],
    },
    workerReceipt,
    negativeCampaign: {
      schema: COMMERCIAL_PRECISION_EVIDENCE_SOURCES.negativeCampaign,
      status: 'PASS', capturedAt, release,
      jobId: execution.jobId, executionId: execution.executionId,
      assertions: [
        'wrong_worker_rejected', 'input_substitution_rejected',
        'output_substitution_rejected', 'callback_replay_conflict_rejected',
      ],
    },
    recoveryCampaign: {
      schema: COMMERCIAL_PRECISION_EVIDENCE_SOURCES.recoveryCampaign,
      status: 'PASS', capturedAt, release,
      jobId: execution.jobId, executionId: execution.executionId,
      assertions: [
        'multi_instance_claim_exclusion', 'expired_lease_recovery',
        'crash_after_claim_recovery', 'verified_unknown_no_replay',
        'credential_rotation',
      ],
    },
  };
  if (omitAssertion) {
    for (const document of Object.values(sourceValues)) {
      if (Array.isArray(document?.assertions)) {
        document.assertions = document.assertions.filter(value => value !== omitAssertion);
      }
    }
  }
  const evidence = Object.fromEntries(Object.entries(sourceValues).map(([role, value]) => [
    role,
    writeJson(evidenceRoot, `sources/${role}.json`, value),
  ]));
  const checks = Object.fromEntries([
    ...COMMERCIAL_PRECISION_PRIVATE_BETA_CHECKS,
    ...COMMERCIAL_PRECISION_GA_CHECKS,
  ].map(key => [key, checkOverrides[key] ?? 'PASS']));
  const observation = {
    schema: COMMERCIAL_PRECISION_RUNTIME_OBSERVATION_SCHEMA,
    capturedAt,
    environment,
    release,
    migration: {
      version: COMMERCIAL_PRECISION_MIGRATION_VERSION,
      checksum: canonicalTextSha256(migrationBytes),
      canonicalization: COMMERCIAL_PRECISION_TEXT_CANONICALIZATION,
    },
    execution,
    checks,
    evidence,
    attestation: {
      algorithm: 'hmac-sha256',
      keyId: 'staging-evidence-authority-1',
      signedAt: capturedAt,
    },
  };
  observation.attestation.hmacSha256 = signCommercialPrecisionRuntimeObservation(observation, secret);
  const observationPath = 'commercial-precision-runtime-observation.json';
  writeJson(evidenceRoot, observationPath, observation);
  const build = options => buildCommercialPrecisionRuntimeEvidenceReceipt({
    sourceRoot, evidenceRoot, observationPath, expectedRelease, secret, workerRegistryRaw,
    generatedAt: new Date(now).toISOString(), now, ...options,
  });
  return { root, sourceRoot, evidenceRoot, observationPath, observation, build, now };
}

test('qualifies production only with the complete exact-runtime and durability matrix', () => {
  const value = fixture();
  const receipt = value.build();
  assert.equal(receipt.status, 'COMMERCIAL_GA_PASS');
  assert.equal(receipt.decision.privateBeta.eligible, true);
  assert.equal(receipt.decision.commercialGa.eligible, true);
  assert.deepEqual(receipt.workerTrust, {
    signatureVerified: true,
    workerIdentity: 'commercial-worker-1',
    fingerprintSha256: workerFingerprint,
    nativeExecutableSha256,
    nativeInvocationSha256,
    registrySha256: sha256(JSON.parse(workerRegistryRaw)),
  });
  const verification = verifyCommercialPrecisionRuntimeEvidence(receipt, {
    sourceRoot: value.sourceRoot,
    evidenceRoot: value.evidenceRoot,
    observationPath: value.observationPath,
    expectedRelease,
    workerRegistryRaw,
    secret,
    now: value.now,
  });
  assert.deepEqual(verification.blockers, []);
  assert.equal(verification.receiptVerified, true);
  assert.equal(verification.privateBetaEligible, true);
  assert.equal(verification.commercialGaEligible, true);
});

test('rejects a shape-valid worker receipt whose Ed25519 signature is forged', () => {
  const value = fixture({ tamperWorkerSignature: true });
  const receipt = value.build();
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.workerTrust, null);
  assert.ok(receipt.decision.privateBeta.blockers.includes('evidence_document_invalid:workerReceipt'));
});

test('rejects a valid worker signature when the approved native adapter binding differs', () => {
  const value = fixture();
  const registry = JSON.parse(workerRegistryRaw);
  registry['commercial-worker-1'].nativeExecutableSha256 = '7'.repeat(64);
  const receipt = value.build({ workerRegistryRaw: JSON.stringify(registry) });
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.workerTrust, null);
  assert.ok(receipt.decision.privateBeta.blockers.includes('evidence_document_invalid:workerReceipt'));
});

test('rejects a PASS check that lacks its exact supporting assertion', () => {
  const value = fixture({ omitAssertion: 'workspace_cas_committed' });
  const receipt = value.build();
  assert.equal(receipt.status, 'HOLD');
  assert.ok(receipt.decision.privateBeta.blockers.includes('check_evidence_missing:workspaceCasCommit'));
});

test('allows a complete staging canary to qualify only the private-beta tier', () => {
  const value = fixture({ environment: 'staging' });
  const receipt = value.build();
  assert.equal(receipt.status, 'PRIVATE_BETA_PASS');
  assert.equal(receipt.decision.privateBeta.eligible, true);
  assert.equal(receipt.decision.commercialGa.eligible, false);
  assert.ok(receipt.decision.commercialGa.blockers.includes('production_runtime_not_observed'));
  assert.ok(receipt.decision.commercialGa.blockers.includes('production_deployment_not_observed'));
});

test('keeps GA-only recovery and credential rotation independent from private beta', () => {
  const value = fixture({
    checkOverrides: { credentialRotation: 'NOT_RUN', crashAfterClaimRecovery: 'NOT_RUN' },
  });
  const receipt = value.build();
  assert.equal(receipt.decision.privateBeta.eligible, true);
  assert.equal(receipt.decision.commercialGa.eligible, false);
  assert.ok(receipt.decision.commercialGa.blockers.includes('commercial_ga_check_not_pass:credentialRotation'));
  assert.ok(receipt.decision.commercialGa.blockers.includes('commercial_ga_check_not_pass:crashAfterClaimRecovery'));
});

test('fails closed for a forged attestation, release transplant, and unsafe evidence path', () => {
  const forged = fixture();
  forged.observation.attestation.hmacSha256 = '0'.repeat(64);
  writeJson(forged.evidenceRoot, forged.observationPath, forged.observation);
  assert.ok(forged.build().decision.privateBeta.blockers.includes('runtime_attestation_invalid'));

  const transplanted = fixture();
  transplanted.observation.release.buildId = 'other-build';
  transplanted.observation.attestation.hmacSha256 = signCommercialPrecisionRuntimeObservation(transplanted.observation, secret);
  writeJson(transplanted.evidenceRoot, transplanted.observationPath, transplanted.observation);
  assert.ok(transplanted.build().decision.privateBeta.blockers.includes('release_binding_mismatch'));

  const escaped = fixture();
  escaped.observation.evidence.databaseSnapshot.path = '../database.json';
  escaped.observation.attestation.hmacSha256 = signCommercialPrecisionRuntimeObservation(escaped.observation, secret);
  writeJson(escaped.evidenceRoot, escaped.observationPath, escaped.observation);
  assert.ok(escaped.build().decision.privateBeta.blockers.includes('evidence_unavailable:databaseSnapshot'));
});

test('invalidates a previously derived receipt when a bound runtime artifact changes', () => {
  const value = fixture();
  const receipt = value.build();
  fs.appendFileSync(path.join(value.evidenceRoot, 'sources/databaseSnapshot.json'), 'tamper\n');
  const verification = verifyCommercialPrecisionRuntimeEvidence(receipt, {
    sourceRoot: value.sourceRoot,
    evidenceRoot: value.evidenceRoot,
    observationPath: value.observationPath,
    expectedRelease,
    secret,
    now: value.now,
  });
  assert.equal(verification.receiptVerified, false);
  assert.equal(verification.privateBetaEligible, false);
  assert.equal(verification.commercialGaEligible, false);
  assert.ok(verification.blockers.includes('receipt_derivation_mismatch'));
});

test('verifies the same runtime receipt after all bound text is checked out as CRLF', () => {
  const value = fixture();
  const receipt = value.build();
  const textPaths = [
    path.join(value.sourceRoot, ...COMMERCIAL_PRECISION_MIGRATION_SOURCE.split('/')),
    path.join(value.evidenceRoot, value.observationPath),
    ...Object.keys(COMMERCIAL_PRECISION_EVIDENCE_SOURCES)
      .map(role => path.join(value.evidenceRoot, 'sources', `${role}.json`)),
  ];
  for (const target of textPaths) {
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8')
      .replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  }
  const verification = verifyCommercialPrecisionRuntimeEvidence(receipt, {
    sourceRoot: value.sourceRoot,
    evidenceRoot: value.evidenceRoot,
    observationPath: value.observationPath,
    expectedRelease,
    workerRegistryRaw,
    secret,
    now: value.now,
  });
  assert.equal(verification.receiptVerified, true);
  assert.deepEqual(verification.blockers, []);
});

test('emits an honest HOLD receipt when no runtime observation exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-precision-runtime-hold-'));
  const migration = path.join(root, ...COMMERCIAL_PRECISION_MIGRATION_SOURCE.split('/'));
  fs.mkdirSync(path.dirname(migration), { recursive: true });
  fs.writeFileSync(migration, '-- migration\n');
  const receipt = buildCommercialPrecisionRuntimeEvidenceReceipt({
    sourceRoot: root,
    evidenceRoot: path.join(root, 'missing'),
    expectedRelease,
    secret,
  });
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.decision.privateBeta.eligible, false);
  assert.ok(receipt.decision.privateBeta.blockers.includes('runtime_observation_missing'));
});
