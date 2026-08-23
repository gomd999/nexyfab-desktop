#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachReceiptSha256, canonicalJson, SHA256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

export const LARGE_UPLOAD_STAGING_RECEIPT_SCHEMA = 'nexyfab.large-upload-staging-readiness.v1';
export const LARGE_UPLOAD_STAGING_OBSERVATION_SCHEMA = 'nexyfab.large-upload-staging-observations.v2';
export const LARGE_UPLOAD_TRUSTED_COLLECTORS_SCHEMA = 'nexyfab.large-upload-trusted-collectors.v1';
export const LARGE_UPLOAD_MIN_BYTES = 64 * 1024 * 1024;
export const LARGE_UPLOAD_MAX_AGE_MS = 24 * 60 * 60_000;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const ALLOWED_SUCCESS = new Set([200, 201, 204]);
const ARTIFACT_KEYS = Object.freeze([
  'sourceFile', 'roundtripReadbackFile', 'resumeReadbackFile',
  'roundtripResponse', 'resumeResponse', 'abortResponse',
  'workerSamples', 'runtimeLimit', 'stagingIsolation',
]);

function fresh(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp <= now + 5 * 60_000
    && timestamp >= now - LARGE_UPLOAD_MAX_AGE_MS;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizedTarget(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function releaseBinding(value) {
  const gitHead = value?.gitHead ?? value?.head;
  const deploymentId = value?.deploymentId ?? value?.productionDeploymentId;
  if (!nonEmpty(value?.buildId) || !nonEmpty(deploymentId) || !GIT_SHA.test(String(gitHead ?? ''))) return null;
  return { buildId: value.buildId.trim(), deploymentId: deploymentId.trim(), gitHead: gitHead.trim() };
}

function withinRun(value, observation, { allowUntilSigned = false } = {}) {
  const timestamp = Date.parse(value);
  const started = Date.parse(observation?.startedAt);
  const completed = Date.parse(allowUntilSigned ? observation?.attestation?.signedAt : observation?.completedAt);
  return Number.isFinite(timestamp) && Number.isFinite(started) && Number.isFinite(completed)
    && timestamp >= started && timestamp <= completed;
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeExistingFile(root, file) {
  if (!nonEmpty(file) || path.isAbsolute(file)) throw new Error('unsafe_input_path');
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, file);
  if (!pathInside(resolvedRoot, absolute)) throw new Error('unsafe_input_path');
  const realRoot = fs.realpathSync.native(resolvedRoot);
  let cursor = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('input_symlink_not_allowed');
  }
  const realFile = fs.realpathSync.native(absolute);
  if (!pathInside(realRoot, realFile) || !fs.statSync(realFile).isFile()) throw new Error('unsafe_input_path');
  return { absolute: realFile, relative: path.relative(resolvedRoot, absolute).replaceAll('\\', '/'), realFile };
}

function safeOutputFile(root, file) {
  if (!nonEmpty(file) || path.isAbsolute(file)) throw new Error('unsafe_output_path');
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, file);
  if (!pathInside(resolvedRoot, absolute)) throw new Error('unsafe_output_path');
  const realRoot = fs.realpathSync.native(resolvedRoot);
  let cursor = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, path.dirname(absolute)).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('output_parent_symlink_not_allowed');
  }
  let existing = path.dirname(absolute);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const realExisting = fs.realpathSync.native(existing);
  if (realExisting !== realRoot && !pathInside(realRoot, realExisting)) throw new Error('unsafe_output_path');
  if (fs.existsSync(absolute)) {
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('output_symlink_not_allowed');
    if (fs.statSync(absolute).nlink > 1) throw new Error('output_hardlink_not_allowed');
  }
  return absolute;
}

function streamedFileBinding(root, file) {
  const safe = safeExistingFile(root, file);
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(safe.absolute, 'r');
  let bytes = 0;
  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      bytes += read;
      digest.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { path: safe.relative, bytes, sha256: digest.digest('hex') };
}

export function largeUploadFileBinding(root, file) {
  return streamedFileBinding(root, file);
}

function readJsonArtifact(root, file) {
  const binding = streamedFileBinding(root, file);
  const safe = safeExistingFile(root, file);
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(safe.absolute)));
  return { binding, document };
}

function sourceBindingsValid(root, bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) return false;
  const paths = new Set();
  const realFiles = new Set();
  const fileIdentities = new Set();
  try {
    return bindings.every(binding => {
      if (!nonEmpty(binding?.path) || !positiveInteger(binding?.bytes)
        || !SHA256.test(String(binding?.sha256 ?? '')) || paths.has(binding.path)) return false;
      const safe = safeExistingFile(root, binding.path);
      const stat = fs.statSync(safe.realFile, { bigint: true });
      const identity = `${stat.dev}:${stat.ino}`;
      if (realFiles.has(safe.realFile) || fileIdentities.has(identity)) return false;
      paths.add(binding.path);
      realFiles.add(safe.realFile);
      fileIdentities.add(identity);
      return canonicalJson(streamedFileBinding(root, binding.path)) === canonicalJson(binding);
    });
  } catch {
    return false;
  }
}

function unsignedObservation(observation) {
  const copy = structuredClone(observation ?? {});
  if (copy.attestation) delete copy.attestation.signatureBase64;
  return copy;
}

export function largeUploadCollectorAttestationPayload(observation, artifactBindings) {
  return canonicalJson({
    schema: 'nexyfab.large-upload-staging-collector-attestation.v1',
    observation: unsignedObservation(observation),
    artifactBindings: [...(artifactBindings ?? [])].sort((left, right) => left.path.localeCompare(right.path)),
  });
}

function loadPackage(root, observationPath, trustedCollectorsPath) {
  const blockers = [];
  let observationRecord;
  try { observationRecord = readJsonArtifact(root, observationPath); } catch { throw new Error('observation_invalid_or_unsafe'); }
  const observation = observationRecord.document;
  const records = { observation: observationRecord };
  if (observation?.status !== 'COMPLETED') return { observation, records, blockers };
  if (!nonEmpty(trustedCollectorsPath)) blockers.push('trusted_collectors_missing');
  else {
    try { records.trustedCollectors = readJsonArtifact(root, trustedCollectorsPath); } catch { blockers.push('trusted_collectors_invalid_or_unsafe'); }
  }
  for (const key of ARTIFACT_KEYS) {
    const file = observation?.artifacts?.[key];
    if (!nonEmpty(file)) {
      blockers.push(`artifact_missing:${key}`);
      continue;
    }
    try {
      records[key] = ['sourceFile', 'roundtripReadbackFile', 'resumeReadbackFile'].includes(key)
        ? { binding: streamedFileBinding(root, file), document: null }
        : readJsonArtifact(root, file);
    } catch {
      blockers.push(`artifact_invalid_or_unsafe:${key}`);
    }
  }
  const bindings = Object.values(records).map(record => record.binding);
  if (new Set(bindings.map(binding => binding.path)).size !== bindings.length) blockers.push('artifact_paths_not_unique');
  return { observation, records, blockers };
}

function operationIdentity(document) {
  return nonEmpty(document?.requestId)
    && SHA256.test(String(document?.uploadIdFingerprint ?? ''))
    && SHA256.test(String(document?.objectKeyFingerprint ?? ''));
}

function commonOperation(document, observation, schema) {
  return document?.schema === schema
    && document?.runId === observation?.runId
    && document?.target === normalizedTarget(observation?.target)
    && document?.evidenceDeploymentId === observation?.evidenceDeploymentId
    && operationIdentity(document)
    && withinRun(document?.capturedAt, observation);
}

function roundtripOk(document, observation, source, readback) {
  return commonOperation(document, observation, 'nexyfab.large-upload-roundtrip-response.v1')
    && ALLOWED_SUCCESS.has(document?.completeHttpStatus) && document?.readbackHttpStatus === 200
    && Number.isInteger(document?.partCount) && document.partCount >= 2
    && document?.uploadedBytes === source?.bytes && document?.readbackBytes === readback?.bytes
    && source?.bytes === readback?.bytes && source?.sha256 === readback?.sha256
    && document?.sourceSha256 === source?.sha256 && document?.readbackSha256 === readback?.sha256
    && nonEmpty(document?.etag);
}

function resumeOk(document, observation, source, readback) {
  return commonOperation(document, observation, 'nexyfab.large-upload-resume-response.v1')
    && ALLOWED_SUCCESS.has(document?.completeHttpStatus) && document?.readbackHttpStatus === 200
    && positiveInteger(document?.interruptedAtBytes) && document.interruptedAtBytes < source?.bytes
    && document?.resumedFromBytes === document.interruptedAtBytes
    && document?.completedBytes === source?.bytes && document?.readbackBytes === readback?.bytes
    && source?.bytes === readback?.bytes && source?.sha256 === readback?.sha256
    && document?.sourceSha256 === source?.sha256 && document?.readbackSha256 === readback?.sha256
    && Number.isInteger(document?.partsBeforeInterruption) && document.partsBeforeInterruption >= 1
    && Number.isInteger(document?.partsAfterResume) && document.partsAfterResume >= 1
    && nonEmpty(document?.etag);
}

function abortOk(document, observation) {
  return commonOperation(document, observation, 'nexyfab.large-upload-abort-response.v1')
    && ALLOWED_SUCCESS.has(document?.abortHttpStatus)
    && positiveInteger(document?.uploadedBeforeAbortBytes)
    && document?.headAfterAbortHttpStatus === 404
    && document?.objectExistsAfterAbort === false
    && document?.listedPartsAfterAbort === 0
    && nonEmpty(document?.headRequestId) && nonEmpty(document?.listPartsRequestId);
}

function allOperationIdsUnique(documents) {
  if (documents.some(document => !operationIdentity(document))) return false;
  return ['requestId', 'uploadIdFingerprint', 'objectKeyFingerprint'].every(key => {
    const values = documents.map(document => document[key]);
    return new Set(values).size === values.length;
  });
}

function workerStatus(samples, limit, observation) {
  const items = samples?.samples;
  const valid = samples?.schema === 'nexyfab.large-upload-worker-samples.v1'
    && limit?.schema === 'nexyfab.large-upload-runtime-limit.v1'
    && samples?.runId === observation?.runId && limit?.runId === observation?.runId
    && samples?.service === limit?.service
    && samples?.evidenceDeploymentId === observation?.evidenceDeploymentId
    && limit?.evidenceDeploymentId === observation?.evidenceDeploymentId
    && limit?.source === 'platform-runtime-config-export'
    && withinRun(limit?.capturedAt, observation, { allowUntilSigned: true })
    && positiveInteger(limit?.limitBytes)
    && Array.isArray(items) && items.length >= 2
    && items.every(item => positiveInteger(item?.rssBytes) && positiveInteger(item?.heapUsedBytes)
      && item.heapUsedBytes <= item.rssBytes && withinRun(item?.capturedAt, observation));
  const peakBytes = valid ? Math.max(...items.map(item => item.rssBytes)) : null;
  return { valid, peakBytes, limitBytes: positiveInteger(limit?.limitBytes) ? limit.limitBytes : null, ok: valid && peakBytes <= limit.limitBytes };
}

function trustedCollectorStatus(observation, records, artifactBindings, expectedRelease, now) {
  const allowlist = records.trustedCollectors?.document;
  const collector = Array.isArray(allowlist?.collectors)
    ? allowlist.collectors.find(item => item?.id === observation?.attestation?.collectorId)
    : null;
  const target = normalizedTarget(observation?.target);
  const binding = releaseBinding(expectedRelease);
  const signedAt = observation?.attestation?.signedAt;
  const signedTimestamp = Date.parse(signedAt);
  const completedTimestamp = Date.parse(observation?.completedAt);
  const base = allowlist?.schema === LARGE_UPLOAD_TRUSTED_COLLECTORS_SCHEMA
    && collector && nonEmpty(collector.publicKeyPem)
    && Array.isArray(collector.allowedOrigins) && collector.allowedOrigins.includes(target)
    && fresh(signedAt, now)
    && Number.isFinite(signedTimestamp) && Number.isFinite(completedTimestamp)
    && signedTimestamp >= completedTimestamp && signedTimestamp <= completedTimestamp + 15 * 60_000
    && binding !== null;
  if (!base || !nonEmpty(observation?.attestation?.signatureBase64)) return { ok: false, collector: null, targetAllowed: false };
  try {
    const signatureOk = crypto.verify(
      null,
      Buffer.from(largeUploadCollectorAttestationPayload(observation, artifactBindings)),
      collector.publicKeyPem,
      Buffer.from(observation.attestation.signatureBase64, 'base64'),
    );
    const keySha256 = crypto.createHash('sha256')
      .update(crypto.createPublicKey(collector.publicKeyPem).export({ type: 'spki', format: 'der' }))
      .digest('hex');
    return { ok: signatureOk, collector: { id: collector.id, publicKeySha256: keySha256 }, targetAllowed: true };
  } catch {
    return { ok: false, collector: null, targetAllowed: true };
  }
}

function isolationOk(document, observation, expectedRelease) {
  const release = releaseBinding(expectedRelease);
  return document?.schema === 'nexyfab.large-upload-staging-isolation.v1'
    && document?.runId === observation?.runId
    && document?.environment === 'staging'
    && document?.target === normalizedTarget(observation?.target)
    && document?.productionDeploymentId === release?.deploymentId
    && document?.evidenceDeploymentId === observation?.evidenceDeploymentId
    && document.evidenceDeploymentId !== document.productionDeploymentId
    && nonEmpty(document?.productionEnvironmentId) && nonEmpty(document?.stagingEnvironmentId)
    && document.productionEnvironmentId !== document.stagingEnvironmentId
    && document?.objectStorageBucketFingerprint === observation?.storage?.bucketFingerprint
    && document?.databaseIsolated === true && document?.objectStorageIsolated === true
    && withinRun(document?.capturedAt, observation, { allowUntilSigned: true });
}

function deriveReceipt({ root, pkg, expectedRelease, generatedAt, now, observationPath, trustedCollectorsPath }) {
  const { observation, records } = pkg;
  const blockers = [...pkg.blockers];
  const release = releaseBinding(expectedRelease);
  const observedRelease = releaseBinding(observation?.release);
  const completedAt = observation?.completedAt ?? observation?.capturedAt;
  const started = Date.parse(observation?.startedAt);
  const generated = Date.parse(generatedAt);
  const completed = Date.parse(completedAt);
  const allRecordsPresent = ARTIFACT_KEYS.every(key => records[key]) && records.trustedCollectors;
  const artifactBindings = ARTIFACT_KEYS.flatMap(key => records[key]?.binding ? [records[key].binding] : []);
  const source = records.sourceFile?.binding;
  const roundtripReadback = records.roundtripReadbackFile?.binding;
  const resumeReadback = records.resumeReadbackFile?.binding;
  const roundtrip = records.roundtripResponse?.document;
  const resume = records.resumeResponse?.document;
  const abort = records.abortResponse?.document;
  const operations = [roundtrip, resume, abort];
  const roundtripVerified = allRecordsPresent && positiveInteger(source?.bytes) && source.bytes >= LARGE_UPLOAD_MIN_BYTES
    && roundtripOk(roundtrip, observation, source, roundtripReadback);
  const resumeVerified = allRecordsPresent && positiveInteger(source?.bytes) && source.bytes >= LARGE_UPLOAD_MIN_BYTES
    && resumeOk(resume, observation, source, resumeReadback);
  const abortVerified = allRecordsPresent && abortOk(abort, observation);
  const operationsUnique = allRecordsPresent && allOperationIdsUnique(operations);
  const memory = workerStatus(records.workerSamples?.document, records.runtimeLimit?.document, observation);
  const collector = trustedCollectorStatus(observation, records, artifactBindings, expectedRelease, now);
  const isolationVerified = allRecordsPresent && collector.targetAllowed
    && isolationOk(records.stagingIsolation?.document, observation, expectedRelease);

  if (observation?.schema !== LARGE_UPLOAD_STAGING_OBSERVATION_SCHEMA) blockers.push('observation_schema_invalid');
  if (observation?.captureMode !== 'external-staging-object-storage-probe') blockers.push('external_capture_mode_missing');
  if (observation?.status !== 'COMPLETED') blockers.push('observation_not_completed');
  if (observation?.environment !== 'staging' || !normalizedTarget(observation?.target)) blockers.push('isolated_staging_target_invalid');
  if (!release || !observedRelease || canonicalJson(release) !== canonicalJson(observedRelease)
    || !nonEmpty(observation?.evidenceDeploymentId) || observation.evidenceDeploymentId === release?.deploymentId) blockers.push('release_binding_mismatch');
  if (!fresh(completedAt, now) || !Number.isFinite(started) || started > completed || !Number.isFinite(generated)
    || generated < completed || generated > completed + 15 * 60_000) blockers.push('capture_freshness_invalid');
  if (!(observation?.storage?.backend === 'object-storage' && nonEmpty(observation.storage.provider)
    && SHA256.test(String(observation.storage.bucketFingerprint ?? '')))) blockers.push('object_storage_identity_invalid');
  if (!(positiveInteger(source?.bytes) && source.bytes >= LARGE_UPLOAD_MIN_BYTES)) blockers.push('large_upload_source_invalid');
  if (!roundtripVerified || !resumeVerified || !abortVerified) blockers.push('large_upload_roundtrip_resume_abort_hash_not_verified');
  if (!operationsUnique) blockers.push('operation_identifiers_not_unique');
  if (!memory.ok) blockers.push('large_upload_worker_memory_not_verified');
  if (!collector.ok) blockers.push('trusted_collector_attestation_invalid');
  if (!isolationVerified) blockers.push('staging_isolation_evidence_invalid');

  const sourceBindings = Object.values(records).map(record => record.binding);
  if (!sourceBindingsValidForDerivation(sourceBindings) || !sourceBindingsValid(root, sourceBindings)) blockers.push('source_bindings_invalid');
  const ok = blockers.length === 0;
  return attachReceiptSha256({
    schema: LARGE_UPLOAD_STAGING_RECEIPT_SCHEMA,
    generatedAt,
    capturedAt: completedAt ?? null,
    ok,
    status: ok ? 'PASS' : 'HOLD',
    releaseEligible: ok,
    environment: observation?.environment ?? null,
    target: normalizedTarget(observation?.target),
    evidenceDeploymentId: observation?.evidenceDeploymentId ?? null,
    release,
    upload: {
      objectStorageRoundtrip: roundtripVerified ? 'PASS' : 'NOT_RUN_OR_FAIL',
      multipartResume: resumeVerified ? 'PASS' : 'NOT_RUN_OR_FAIL',
      abortCleanup: abortVerified ? 'PASS' : 'NOT_RUN_OR_FAIL',
      sha256Readback: roundtripVerified && resumeVerified ? 'PASS' : 'NOT_RUN_OR_FAIL',
      uploadedBytes: positiveInteger(source?.bytes) ? source.bytes : null,
      resumedBytes: resumeVerified ? resume.completedBytes : null,
      readbackBytes: roundtripVerified ? roundtripReadback.bytes : null,
      sourceSha256: SHA256.test(String(source?.sha256 ?? '')) ? source.sha256 : null,
      readbackSha256: roundtripVerified ? roundtripReadback.sha256 : null,
      abortedObjectAbsent: abortVerified ? true : null,
    },
    workerMemory: {
      status: memory.ok ? 'PASS' : memory.valid ? 'FAIL' : 'NOT_RUN',
      runtimeLimitObserved: memory.valid,
      peakRssMb: positiveInteger(memory.peakBytes) ? Math.ceil(memory.peakBytes / (1024 * 1024)) : null,
      limitMb: positiveInteger(memory.limitBytes) ? Math.ceil(memory.limitBytes / (1024 * 1024)) : null,
      sampleCount: Array.isArray(records.workerSamples?.document?.samples) ? records.workerSamples.document.samples.length : 0,
    },
    attestation: collector.collector,
    sourceBindings,
    blockers: [...new Set(blockers)],
    inputs: { observationPath, trustedCollectorsPath: trustedCollectorsPath ?? null },
    derivation: {
      observationSchema: LARGE_UPLOAD_STAGING_OBSERVATION_SCHEMA,
      minimumUploadBytes: LARGE_UPLOAD_MIN_BYTES,
      callerPassFlagsTrusted: false,
      actualPayloadAndReadbacksBound: true,
      providerArtifactsBound: true,
      runtimeLimitSeparatelyBound: true,
    },
  });
}

function sourceBindingsValidForDerivation(bindings) {
  return Array.isArray(bindings) && bindings.length > 0
    && new Set(bindings.map(binding => binding?.path)).size === bindings.length
    && bindings.every(binding => nonEmpty(binding?.path) && positiveInteger(binding?.bytes)
      && SHA256.test(String(binding?.sha256 ?? '')));
}

export function buildLargeUploadStagingReadinessReceipt({
  root = process.cwd(), observationPath, trustedCollectorsPath = null,
  expectedRelease, generatedAt = new Date().toISOString(), now = Date.now(),
} = {}) {
  if (!nonEmpty(observationPath)) throw new Error('observation_path_required');
  const pkg = loadPackage(root, observationPath, trustedCollectorsPath);
  return deriveReceipt({ root, pkg, expectedRelease, generatedAt, now, observationPath, trustedCollectorsPath });
}

export function largeUploadStagingReceiptStatus(receipt, expectedRelease, { root = process.cwd(), now = Date.now() } = {}) {
  const blockers = [];
  let derivedReceiptBlockers = [];
  if (!receipt || typeof receipt !== 'object') return {
    ok: false,
    blockers: ['receipt_missing', 'large_upload_roundtrip_resume_abort_hash_not_verified', 'large_upload_worker_memory_not_verified'],
  };
  if (receipt.schema !== LARGE_UPLOAD_STAGING_RECEIPT_SCHEMA) blockers.push('schema_invalid');
  if (!verifyReceiptSha256(receipt)) blockers.push('receipt_hash_invalid');
  if (!fresh(receipt.generatedAt, now)) blockers.push('receipt_stale_or_time_invalid');
  if (!sourceBindingsValid(root, receipt.sourceBindings)) blockers.push('source_bindings_invalid');
  if (blockers.length === 0) {
    try {
      const rebuilt = buildLargeUploadStagingReadinessReceipt({
        root,
        observationPath: receipt?.inputs?.observationPath,
        trustedCollectorsPath: receipt?.inputs?.trustedCollectorsPath,
        expectedRelease,
        generatedAt: receipt.generatedAt,
        now,
      });
      if (canonicalJson(rebuilt) !== canonicalJson(receipt)) blockers.push('receipt_not_derived_from_bound_artifacts');
      else derivedReceiptBlockers = Array.isArray(rebuilt.blockers) ? rebuilt.blockers : [];
    } catch {
      blockers.push('bound_artifacts_invalid');
    }
  }
  if (receipt.ok !== true || receipt.status !== 'PASS' || receipt.releaseEligible !== true) blockers.push('pass_claim_missing');
  if (!Array.isArray(receipt.blockers) || receipt.blockers.length !== 0) blockers.push('receipt_blockers_present');
  return { ok: blockers.length === 0, blockers: [...new Set([...blockers, ...derivedReceiptBlockers])] };
}

export function verifyLargeUploadStagingReadinessReceipt(receipt, expectedRelease, options) {
  return largeUploadStagingReceiptStatus(receipt, expectedRelease, options).ok;
}

function option(args, name, fallback = null) {
  const inline = args.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

export function main(args = process.argv.slice(2)) {
  const root = path.resolve(option(args, 'root', process.cwd()));
  const observationPath = option(args, 'observation');
  const trustedCollectorsPath = option(args, 'trusted-collectors');
  const releasePath = option(args, 'release');
  const output = option(args, 'out', 'docs/evidence/release/large-upload-staging-readiness-receipt.json');
  if (!observationPath || !releasePath) throw new Error('observation_and_release_paths_required');
  const releaseFile = safeExistingFile(root, releasePath);
  const expectedRelease = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(releaseFile.absolute)));
  const receipt = buildLargeUploadStagingReadinessReceipt({
    root, observationPath, trustedCollectorsPath, expectedRelease,
    generatedAt: option(args, 'generated-at', new Date().toISOString()),
  });
  const outputPath = safeOutputFile(root, output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: receipt.ok, status: receipt.status, output: outputPath, blockers: receipt.blockers })}\n`);
  return receipt.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    process.stderr.write(`[large-upload-staging-receipt] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
