import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyReceiptSha256 } from './immutable-receipt-binding.mjs';
import {
  buildLargeUploadStagingReadinessReceipt,
  LARGE_UPLOAD_MIN_BYTES,
  largeUploadCollectorAttestationPayload,
  largeUploadFileBinding,
  largeUploadStagingReceiptStatus,
  main,
  verifyLargeUploadStagingReadinessReceipt,
} from './build-large-upload-staging-readiness-receipt.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-large-upload-bound-'));
const now = Date.now();
const expectedRelease = { buildId: 'build-1', deploymentId: 'production-1', head: 'a'.repeat(40) };
const target = 'https://staging.nexyfab.example';
const evidenceDeploymentId = 'staging-1';
const runId = 'large-upload-run-1';
const completedAt = new Date(now - 2_000).toISOString();
const generatedAt = new Date(now).toISOString();
const trustedKeys = crypto.generateKeyPairSync('ed25519');
const attackerKeys = crypto.generateKeyPairSync('ed25519');
const fingerprint = value => value.repeat(64).slice(0, 64);

function writeJson(relative, value) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return relative.replaceAll('\\', '/');
}

function writeLargeFile(relative) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const fd = fs.openSync(absolute, 'w');
  const chunk = Buffer.alloc(1024 * 1024, 0x5a);
  try {
    for (let offset = 0; offset < LARGE_UPLOAD_MIN_BYTES; offset += chunk.length) fs.writeSync(fd, chunk);
    fs.writeSync(fd, Buffer.from('nexyfab-large-upload-proof'));
  } finally {
    fs.closeSync(fd);
  }
  return relative;
}

const sourceFile = writeLargeFile('binary/source.bin');
const roundtripReadbackFile = 'binary/roundtrip-readback.bin';
const resumeReadbackFile = 'binary/resume-readback.bin';
fs.copyFileSync(path.join(root, sourceFile), path.join(root, roundtripReadbackFile));
fs.copyFileSync(path.join(root, sourceFile), path.join(root, resumeReadbackFile));
const sourceBinding = largeUploadFileBinding(root, sourceFile);

function createEvidence(prefix, {
  mutateObservation = () => {},
  mutateDocuments = () => {},
  signingKey = trustedKeys.privateKey,
  collectorId = 'collector-1',
  readbackOverride = null,
} = {}) {
  const artifacts = {
    sourceFile,
    roundtripReadbackFile: readbackOverride ?? roundtripReadbackFile,
    resumeReadbackFile,
    roundtripResponse: `runs/${prefix}/roundtrip.json`,
    resumeResponse: `runs/${prefix}/resume.json`,
    abortResponse: `runs/${prefix}/abort.json`,
    workerSamples: `runs/${prefix}/worker.json`,
    runtimeLimit: `runs/${prefix}/runtime-limit.json`,
    stagingIsolation: `runs/${prefix}/isolation.json`,
  };
  const common = { runId, target, evidenceDeploymentId, capturedAt: completedAt };
  const documents = {
    roundtripResponse: {
      schema: 'nexyfab.large-upload-roundtrip-response.v1', ...common,
      requestId: `${prefix}-roundtrip-request`, uploadIdFingerprint: fingerprint('1'), objectKeyFingerprint: fingerprint('2'),
      completeHttpStatus: 200, readbackHttpStatus: 200, partCount: 9,
      uploadedBytes: sourceBinding.bytes, readbackBytes: sourceBinding.bytes,
      sourceSha256: sourceBinding.sha256, readbackSha256: sourceBinding.sha256, etag: 'roundtrip-etag',
    },
    resumeResponse: {
      schema: 'nexyfab.large-upload-resume-response.v1', ...common,
      requestId: `${prefix}-resume-request`, uploadIdFingerprint: fingerprint('3'), objectKeyFingerprint: fingerprint('4'),
      completeHttpStatus: 200, readbackHttpStatus: 200, interruptedAtBytes: 16 * 1024 * 1024,
      resumedFromBytes: 16 * 1024 * 1024, completedBytes: sourceBinding.bytes, readbackBytes: sourceBinding.bytes,
      sourceSha256: sourceBinding.sha256, readbackSha256: sourceBinding.sha256,
      partsBeforeInterruption: 2, partsAfterResume: 7, etag: 'resume-etag',
    },
    abortResponse: {
      schema: 'nexyfab.large-upload-abort-response.v1', ...common,
      requestId: `${prefix}-abort-request`, uploadIdFingerprint: fingerprint('5'), objectKeyFingerprint: fingerprint('6'),
      abortHttpStatus: 204, uploadedBeforeAbortBytes: 8 * 1024 * 1024,
      headAfterAbortHttpStatus: 404, headRequestId: `${prefix}-head-request`,
      objectExistsAfterAbort: false, listedPartsAfterAbort: 0, listPartsRequestId: `${prefix}-list-request`,
    },
    workerSamples: {
      schema: 'nexyfab.large-upload-worker-samples.v1', runId, evidenceDeploymentId, service: 'large-upload-worker',
      samples: [
        { capturedAt: new Date(now - 8_000).toISOString(), rssBytes: 310 * 1024 * 1024, heapUsedBytes: 120 * 1024 * 1024 },
        { capturedAt: new Date(now - 3_000).toISOString(), rssBytes: 430 * 1024 * 1024, heapUsedBytes: 180 * 1024 * 1024 },
      ],
    },
    runtimeLimit: {
      schema: 'nexyfab.large-upload-runtime-limit.v1', runId, evidenceDeploymentId,
      service: 'large-upload-worker', source: 'platform-runtime-config-export', capturedAt: completedAt,
      limitBytes: 768 * 1024 * 1024,
    },
    stagingIsolation: {
      schema: 'nexyfab.large-upload-staging-isolation.v1', runId, capturedAt: completedAt,
      environment: 'staging', target, productionDeploymentId: expectedRelease.deploymentId, evidenceDeploymentId,
      productionEnvironmentId: 'production-environment', stagingEnvironmentId: 'staging-environment',
      objectStorageBucketFingerprint: fingerprint('7'), databaseIsolated: true, objectStorageIsolated: true,
    },
  };
  mutateDocuments(documents);
  for (const key of Object.keys(documents)) writeJson(artifacts[key], documents[key]);
  const trustedCollectorsPath = writeJson(`runs/${prefix}/trusted-collectors.json`, {
    schema: 'nexyfab.large-upload-trusted-collectors.v1',
    collectors: [{
      id: 'collector-1',
      publicKeyPem: trustedKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      allowedOrigins: [target],
    }],
  });
  const observation = {
    schema: 'nexyfab.large-upload-staging-observations.v2', status: 'COMPLETED',
    captureMode: 'external-staging-object-storage-probe', runId,
    startedAt: new Date(now - 10_000).toISOString(), completedAt, capturedAt: completedAt,
    environment: 'staging', target,
    release: { buildId: expectedRelease.buildId, productionDeploymentId: expectedRelease.deploymentId, gitHead: expectedRelease.head },
    evidenceDeploymentId,
    storage: { backend: 'object-storage', provider: 'test-s3-compatible', bucketFingerprint: fingerprint('7') },
    artifacts,
    attestation: { collectorId, signedAt: new Date(now - 1_000).toISOString() },
  };
  mutateObservation(observation);
  const artifactBindings = Object.values(artifacts).map(file => largeUploadFileBinding(root, file));
  observation.attestation.signatureBase64 = crypto.sign(
    null,
    Buffer.from(largeUploadCollectorAttestationPayload(observation, artifactBindings)),
    signingKey,
  ).toString('base64');
  const observationPath = writeJson(`runs/${prefix}/observation.json`, observation);
  return { observationPath, trustedCollectorsPath, artifacts };
}

function buildEvidence(fixture) {
  return buildLargeUploadStagingReadinessReceipt({
    root, ...fixture, expectedRelease, generatedAt, now,
  });
}

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('requires actual bound 64MiB payload/readbacks, raw artifacts, and trusted attestation for PASS', () => {
  const receipt = buildEvidence(createEvidence('passing'));
  const identities = receipt.sourceBindings.map(binding => {
    const stat = fs.statSync(path.join(root, binding.path), { bigint: true });
    return `${stat.dev}:${stat.ino}`;
  });
  assert.equal(new Set(identities).size, identities.length, identities.join(','));
  assert.equal(receipt.ok, true, receipt.blockers.join(','));
  assert.equal(receipt.upload.uploadedBytes, sourceBinding.bytes);
  assert.equal(receipt.upload.sourceSha256, sourceBinding.sha256);
  assert.equal(receipt.workerMemory.peakRssMb, 430);
  assert.equal(receipt.sourceBindings.length, 11);
  assert.equal(receipt.derivation.actualPayloadAndReadbacksBound, true);
  for (const binding of receipt.sourceBindings) {
    assert.deepEqual(largeUploadFileBinding(root, binding.path), binding, binding.path);
  }
  const verification = largeUploadStagingReceiptStatus(receipt, expectedRelease, { root, now });
  assert.equal(verification.ok, true, verification.blockers.join(','));
});

test('a hand-authored single JSON and caller PASS fields cannot promote', () => {
  const observationPath = writeJson('runs/single/observation.json', {
    schema: 'nexyfab.large-upload-staging-observations.v2', status: 'COMPLETED', pass: true,
    captureMode: 'external-staging-object-storage-probe', target, environment: 'staging',
    completedAt, release: expectedRelease, evidenceDeploymentId, worker: { runtimeLimitBytes: Number.MAX_SAFE_INTEGER },
  });
  const receipt = buildLargeUploadStagingReadinessReceipt({ root, observationPath, expectedRelease, generatedAt, now });
  assert.equal(receipt.status, 'HOLD');
  assert.ok(receipt.blockers.includes('trusted_collector_attestation_invalid'));
  assert.ok(receipt.blockers.some(value => value.startsWith('artifact_missing:')));
});

test('rejects bound file/log tampering and signer transplant', () => {
  const tamperFixture = createEvidence('tamper');
  const receipt = buildEvidence(tamperFixture);
  fs.appendFileSync(path.join(root, tamperFixture.artifacts.roundtripResponse), ' ');
  assert.equal(verifyLargeUploadStagingReadinessReceipt(receipt, expectedRelease, { root, now }), false);

  const signerReceipt = buildEvidence(createEvidence('signer-transplant', { signingKey: attackerKeys.privateKey }));
  assert.equal(signerReceipt.ok, false);
  assert.ok(signerReceipt.blockers.includes('trusted_collector_attestation_invalid'));
});

test('rejects a hard-linked readback masquerading as an independent downloaded artifact', () => {
  const hardlink = 'binary/hardlinked-readback.bin';
  fs.linkSync(path.join(root, sourceFile), path.join(root, hardlink));
  const receipt = buildEvidence(createEvidence('hardlink', { readbackOverride: hardlink }));
  assert.equal(receipt.ok, false);
  assert.ok(receipt.blockers.includes('source_bindings_invalid'));
});

test('rejects operation fingerprint reuse and caller-inflated runtime limit', () => {
  const reused = buildEvidence(createEvidence('reused-op', {
    mutateDocuments: documents => {
      documents.resumeResponse.uploadIdFingerprint = documents.roundtripResponse.uploadIdFingerprint;
      documents.resumeResponse.objectKeyFingerprint = documents.roundtripResponse.objectKeyFingerprint;
    },
  }));
  assert.equal(reused.ok, false);
  assert.ok(reused.blockers.includes('operation_identifiers_not_unique'));

  const highCallerLimit = buildEvidence(createEvidence('high-limit', {
    mutateObservation: value => { value.worker = { runtimeLimitBytes: Number.MAX_SAFE_INTEGER }; },
    mutateDocuments: documents => { documents.runtimeLimit.limitBytes = 400 * 1024 * 1024; },
  }));
  assert.equal(highCallerLimit.ok, false);
  assert.ok(highCallerLimit.blockers.includes('large_upload_worker_memory_not_verified'));
});

test('rejects unsafe input/output paths before filesystem escape', () => {
  assert.throws(() => buildLargeUploadStagingReadinessReceipt({
    root, observationPath: '../outside.json', expectedRelease, generatedAt, now,
  }), /observation_invalid_or_unsafe/);
  const fixture = createEvidence('safe-cli');
  const releasePath = writeJson('runs/safe-cli/release.json', expectedRelease);
  assert.throws(() => main([
    '--root', root, '--observation', fixture.observationPath, '--trusted-collectors', fixture.trustedCollectorsPath,
    '--release', '../outside-release.json', '--out', 'runs/safe-cli/receipt.json',
  ]), /unsafe_input_path/);
  assert.throws(() => main([
    '--root', root, '--observation', fixture.observationPath, '--trusted-collectors', fixture.trustedCollectorsPath,
    '--release', releasePath, '--out', '../outside-receipt.json', '--generated-at', generatedAt,
  ]), /unsafe_output_path/);
});

test('keeps the checked-in default receipt self-bound and HOLD', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const receipt = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'docs/evidence/release/large-upload-staging-readiness-receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.releaseEligible, false);
  assert.equal(verifyReceiptSha256(receipt), true);
  const status = largeUploadStagingReceiptStatus(receipt, null, { root: repositoryRoot, now: Date.parse(receipt.generatedAt) });
  assert.equal(status.ok, false);
  assert.ok(status.blockers.includes('pass_claim_missing'));
  assert.ok(status.blockers.includes('large_upload_roundtrip_resume_abort_hash_not_verified'));
  assert.ok(status.blockers.includes('large_upload_worker_memory_not_verified'));
  assert.ok(status.blockers.includes('trusted_collector_attestation_invalid'));
});
