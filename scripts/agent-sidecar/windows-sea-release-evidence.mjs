#!/usr/bin/env node
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import {
  closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, statSync, truncateSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachReceiptSha256, verifyReceiptSha256 } from '../immutable-receipt-binding.mjs';
import { verifyReadinessReceipt } from './windows-sea-readiness.mjs';

export const RELEASE_RECEIPT_SCHEMA = 'nexyfab.windows-agent-sidecar-release.v1';
export const RELEASE_MANIFEST_SCHEMA = 'nexyfab.windows-agent-sidecar-sha256.v1';
export const PARITY_EVIDENCE_SCHEMA = 'nexyfab.windows-agent-sidecar-parity-evidence.v1';
export const SIGNING_EVIDENCE_SCHEMA = 'nexyfab.windows-agent-sidecar-authenticode-evidence.v1';
export const AUTHENTICODE_RESULT_SCHEMA = 'nexyfab.windows-authenticode-machine-result.v1';
export const INSTALLER_EVIDENCE_SCHEMA = 'nexyfab.windows-agent-sidecar-installer-vm-evidence.v1';
export const VM_PROVIDER_ATTESTATION_SCHEMA = 'nexyfab.windows-vm-provider-attestation.v1';
export const VM_STAGE_OBSERVATION_SCHEMA = 'nexyfab.windows-installer-stage-observation.v1';
export const RELEASE_ATTESTATION_SCHEMA = 'nexyfab.windows-agent-sidecar-trusted-ci-attestation.v1';
export const DEFAULT_RELEASE_RECEIPT = 'docs/evidence/release/windows-agent-sidecar-release-receipt.json';
export const DEFAULT_READINESS_RECEIPT = 'docs/evidence/agent-sidecar/windows-sea-readiness-260823.json';
export const RELEASE_SOURCE_PATHS = Object.freeze([
  'scripts/build-agent-sidecar.mjs',
  'scripts/agent-sidecar/windows-sea-readiness.mjs',
  'scripts/agent-sidecar/windows-sea-release-evidence.mjs',
  'scripts/drawing-to-3d/agent-sidecar-entry.mjs',
  'scripts/drawing-to-3d/installer-core-agent-server.mjs',
  'scripts/drawing-to-3d/capability-surface-manifest.mjs',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const INSTALLER_STAGES = Object.freeze(['install', 'upgrade', 'rollback', 'uninstall']);
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.replaceAll('\\', '/');

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
const canonicalHash = value => value === undefined ? null : hash(Buffer.from(canonicalJson(value), 'utf8'));

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\0')) return null;
  const normalized = slash(value);
  if (normalized.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return normalized;
}

function contained(root, candidate) {
  const inside = relative(root, candidate);
  return Boolean(inside) && !inside.startsWith('..') && !isAbsolute(inside);
}

function pathComponentsAreReal(root, normalized) {
  const parts = normalized.split('/');
  let current = resolve(root);
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    if (!existsSync(current)) return false;
    const info = lstatSync(current);
    if (info.isSymbolicLink()) return false;
    if (index < parts.length - 1 && !info.isDirectory()) return false;
  }
  return true;
}

function resolveRegularFile(root, relativePath) {
  const normalized = safeRelativePath(relativePath);
  if (!normalized || !pathComponentsAreReal(root, normalized)) return null;
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, ...normalized.split('/'));
  if (!contained(absoluteRoot, absolute) || !existsSync(absolute)) return null;
  try {
    if (!statSync(absolute).isFile()) return null;
    const realRoot = realpathSync(absoluteRoot);
    const realFile = realpathSync(absolute);
    return contained(realRoot, realFile) ? realFile : null;
  } catch { return null; }
}

function readRegularFile(root, relativePath) {
  const absolute = resolveRegularFile(root, relativePath);
  if (!absolute) return null;
  let descriptor;
  try {
    descriptor = openSync(absolute, 'r');
    const before = fstatSync(descriptor);
    if (!before.isFile()) return null;
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || after.size !== bytes.byteLength) return null;
    return bytes;
  } catch { return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export function fileBinding(root, relativePath) {
  const normalized = safeRelativePath(relativePath);
  const bytes = normalized && readRegularFile(root, normalized);
  return bytes ? { path: normalized, bytes: bytes.byteLength, sha256: hash(bytes) } : null;
}

function readBoundFile(root, binding) {
  if (!binding || !Number.isInteger(binding.bytes) || binding.bytes <= 0
    || !SHA256.test(String(binding.sha256 ?? ''))) return null;
  const normalized = safeRelativePath(binding.path);
  const bytes = normalized && readRegularFile(root, normalized);
  return bytes && bytes.byteLength === binding.bytes && hash(bytes) === binding.sha256 ? bytes : null;
}

export function localBindingVerified(root, binding) { return Boolean(readBoundFile(root, binding)); }
function sameBinding(left, right) {
  return left?.path === right?.path && left?.bytes === right?.bytes && left?.sha256 === right?.sha256;
}

function jsonFromBytes(bytes) {
  if (!bytes || bytes.byteLength > MAX_JSON_BYTES) return null;
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}
function readBoundJson(root, binding) { return jsonFromBytes(readBoundFile(root, binding)); }

function releaseBindingMatches(release, expectedRelease) {
  const expectedHead = expectedRelease?.head ?? expectedRelease?.gitHead;
  return typeof release?.buildId === 'string' && release.buildId.length > 0
    && typeof release?.deploymentId === 'string' && release.deploymentId.length > 0
    && GIT_OID.test(String(release?.gitHead ?? ''))
    && (!expectedRelease || (release.buildId === expectedRelease.buildId
      && release.deploymentId === expectedRelease.deploymentId && release.gitHead === expectedHead));
}
function fresh(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now + 5 * 60_000 && timestamp >= now - MAX_AGE_MS;
}

function peDetails(root, binding) {
  if (!binding?.path?.toLowerCase().endsWith('.exe')) return null;
  const bytes = readBoundFile(root, binding);
  if (!bytes || bytes.length < 256 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null;
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset < 0x40 || peOffset + 24 > bytes.length
    || bytes.toString('binary', peOffset, peOffset + 4) !== 'PE\0\0') return null;
  const optionalOffset = peOffset + 24;
  const optionalSize = bytes.readUInt16LE(peOffset + 20);
  if (optionalOffset + optionalSize > bytes.length) return null;
  const magic = bytes.readUInt16LE(optionalOffset);
  const countOffset = optionalOffset + (magic === 0x20b ? 108 : magic === 0x10b ? 92 : -1);
  const directoryStart = optionalOffset + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1);
  if (countOffset < optionalOffset || directoryStart + 40 > optionalOffset + optionalSize) return null;
  const directoryCount = bytes.readUInt32LE(countOffset);
  const certificateOffset = directoryCount >= 5 ? bytes.readUInt32LE(directoryStart + 32) : 0;
  const certificateBytes = directoryCount >= 5 ? bytes.readUInt32LE(directoryStart + 36) : 0;
  let authenticodeEmbedded = false;
  if (certificateOffset > 0 && certificateOffset % 8 === 0 && certificateBytes >= 10
    && certificateOffset + certificateBytes <= bytes.length) {
    const certificateLength = bytes.readUInt32LE(certificateOffset);
    const revision = bytes.readUInt16LE(certificateOffset + 4);
    const certificateType = bytes.readUInt16LE(certificateOffset + 6);
    authenticodeEmbedded = certificateLength >= 10 && certificateLength <= certificateBytes
      && revision === 0x0200 && certificateType === 0x0002 && bytes[certificateOffset + 8] === 0x30;
  }
  return { bytes: bytes.length, sha256: hash(bytes), authenticodeEmbedded };
}

function manifestVerified(root, manifestBinding, binaryBinding, unsigned) {
  const manifest = readBoundJson(root, manifestBinding);
  return Boolean(manifest && manifest.schema === RELEASE_MANIFEST_SCHEMA && manifest.unsigned === unsigned
    && manifest.file?.name === basename(binaryBinding?.path ?? '')
    && manifest.file?.bytes === binaryBinding?.bytes && manifest.file?.sha256 === binaryBinding?.sha256
    && localBindingVerified(root, binaryBinding));
}
function rawEvidenceBaseVerified(value, schema, release, now) {
  return value?.schema === schema && value?.status === 'PASS' && fresh(value?.generatedAt, now)
    && releaseBindingMatches(value?.release, release);
}

function parseTranscript(root, call, signedBinary) {
  const bytes = readBoundFile(root, call?.transcript);
  if (!bytes) return null;
  let records;
  try {
    records = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim().split(/\r?\n/).map(line => JSON.parse(line));
  } catch { return null; }
  if (records.length !== 4) return null;
  const [request, baseline, sea, exit] = records;
  if (request?.kind !== 'request' || baseline?.kind !== 'baseline_response'
    || sea?.kind !== 'sea_response' || exit?.kind !== 'exit'
    || request.callId !== call.id || request.surface !== call.surface
    || request.executableSha256 !== signedBinary?.sha256 || !['mcp', 'cli'].includes(request.surface)
    || typeof request.operation !== 'string' || !request.operation
    || baseline.callId !== call.id || sea.callId !== call.id || exit.callId !== call.id
    || exit.executableSha256 !== signedBinary?.sha256 || exit.code !== 0
    || baseline.payload === undefined || sea.payload === undefined) return null;
  return {
    inputSha256: canonicalHash(request.payload),
    baselineOutputSha256: canonicalHash(baseline.payload),
    seaOutputSha256: canonicalHash(sea.payload),
    exact: canonicalJson(baseline.payload) === canonicalJson(sea.payload),
  };
}

function parityEvidenceVerified(value, signedBinary, root, release, now) {
  if (!rawEvidenceBaseVerified(value, PARITY_EVIDENCE_SCHEMA, release, now)
    || value.executableSha256 !== signedBinary?.sha256 || value.executableInvoked !== true
    || value.mcpToolsExact !== true || value.cliCommandsExact !== true
    || !Array.isArray(value.representativeCalls) || value.representativeCalls.length < 3) return false;
  const ids = new Set(); const transcriptPaths = new Set(); const surfaces = new Set();
  for (const call of value.representativeCalls) {
    const derived = parseTranscript(root, call, signedBinary);
    if (!call || typeof call.id !== 'string' || !call.id || ids.has(call.id)
      || transcriptPaths.has(call.transcript?.path) || !derived || !derived.exact || call.exact !== derived.exact
      || call.inputSha256 !== derived.inputSha256 || call.baselineOutputSha256 !== derived.baselineOutputSha256
      || call.seaOutputSha256 !== derived.seaOutputSha256) return false;
    ids.add(call.id); transcriptPaths.add(call.transcript.path); surfaces.add(call.surface);
  }
  return surfaces.has('mcp') && surfaces.has('cli');
}

function signingEvidenceVerified(value, unsignedBinary, signedBinary, root, release, now) {
  const raw = readBoundJson(root, value?.rawVerification);
  return rawEvidenceBaseVerified(value, SIGNING_EVIDENCE_SCHEMA, release, now)
    && value.unsignedBinarySha256 === unsignedBinary?.sha256 && value.signedBinarySha256 === signedBinary?.sha256
    && raw?.schema === AUTHENTICODE_RESULT_SCHEMA
    && ['Get-AuthenticodeSignature', 'SignTool'].includes(raw.tool?.name)
    && typeof raw.tool?.version === 'string' && raw.tool.version.length > 0
    && typeof raw.tool?.command === 'string' && raw.tool.command.length > 0
    && raw.exitCode === 0 && raw.peHashAlgorithm === 'sha256'
    && raw.peSha256 === signedBinary?.sha256 && raw.executableSha256 === signedBinary?.sha256
    && raw.signatureStatus === 'Valid' && raw.chain?.trusted === true
    && SHA256.test(String(raw.certificate?.sha256 ?? ''))
    && typeof raw.certificate?.subject === 'string' && raw.certificate.subject.length > 0
    && raw.timestamp?.verified === true && typeof raw.timestamp?.authority === 'string'
    && raw.timestamp.authority.length > 0 && fresh(raw.timestamp.at, now)
    && SHA256.test(String(raw.timestamp?.tokenSha256 ?? '')) && raw.timestamp?.imprintAlgorithm === 'sha256'
    && SHA256.test(String(raw.timestamp?.messageImprint ?? ''))
    && value.authenticodeVerified === true && value.chainTrusted === true
    && value.signatureStatus === raw.signatureStatus && value.certificateSha256 === raw.certificate.sha256
    && value.certificateSubject === raw.certificate.subject && value.timestamp?.verified === true
    && value.timestamp.authority === raw.timestamp.authority && value.timestamp.at === raw.timestamp.at
    && value.timestamp.tokenSha256 === raw.timestamp.tokenSha256
    && value.timestamp.messageImprint === raw.timestamp.messageImprint;
}

function installerEvidenceVerified(value, signedBinary, root, release, now) {
  if (!rawEvidenceBaseVerified(value, INSTALLER_EVIDENCE_SCHEMA, release, now)
    || value.signedBinarySha256 !== signedBinary?.sha256 || value.disposableVm !== true
    || value.uniqueDisposableVm !== true || typeof value.vmId !== 'string' || !value.vmId
    || value.productionMachineTouched !== false) return false;
  const provider = readBoundJson(root, value.providerAttestation);
  if (provider?.schema !== VM_PROVIDER_ATTESTATION_SCHEMA || provider.status !== 'PASS'
    || provider.provider !== value.provider || provider.attestationId !== value.providerAttestationId
    || provider.vmId !== value.vmId || provider.unique !== true || provider.disposable !== true
    || provider.productionMachineTouched !== false || !fresh(provider.generatedAt, now)) return false;
  const createdAt = Date.parse(provider.createdAt); const destroyedAt = Date.parse(provider.destroyedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(destroyedAt) || createdAt >= destroyedAt) return false;
  const logPaths = new Set(); let priorCompleted = createdAt; const observations = {};
  for (const stage of INSTALLER_STAGES) {
    const wrapper = value.lifecycle?.[stage]; const binding = wrapper?.rawLog;
    if (!binding || logPaths.has(binding.path)) return false;
    const observation = readBoundJson(root, binding);
    const started = Date.parse(observation?.startedAt); const completed = Date.parse(observation?.completedAt);
    if (observation?.schema !== VM_STAGE_OBSERVATION_SCHEMA || observation.stage !== stage
      || observation.vmId !== value.vmId || observation.providerAttestationId !== value.providerAttestationId
      || observation.executedBinarySha256 !== signedBinary?.sha256
      || typeof observation.command !== 'string' || !observation.command
      || observation.status !== 'PASS' || observation.exitCode !== 0
      || !Number.isFinite(started) || !Number.isFinite(completed) || started < priorCompleted
      || completed < started || completed > destroyedAt
      || wrapper.status !== observation.status || wrapper.exitCode !== observation.exitCode) return false;
    observations[stage] = observation; priorCompleted = completed; logPaths.add(binding.path);
  }
  return observations.install.versionBefore === null && observations.install.versionAfter === value.installVersion
    && observations.upgrade.versionBefore === value.installVersion && observations.upgrade.versionAfter === value.upgradeVersion
    && observations.rollback.versionBefore === value.upgradeVersion && observations.rollback.versionAfter === value.installVersion
    && observations.rollback.inducedFailure === true && observations.rollback.recoveryVerified === true
    && observations.uninstall.versionBefore === value.installVersion && observations.uninstall.versionAfter === null
    && observations.uninstall.residueCount === 0;
}

function requiredSourceBindingsVerified(root, bindings) {
  if (!Array.isArray(bindings) || bindings.length !== RELEASE_SOURCE_PATHS.length) return false;
  const byPath = new Map(bindings.map(binding => [binding?.path, binding]));
  return byPath.size === RELEASE_SOURCE_PATHS.length
    && RELEASE_SOURCE_PATHS.every(path => localBindingVerified(root, byPath.get(path)));
}

function trustedKeyAllowlistFromEnvironment() {
  try {
    const value = JSON.parse(process.env.WINDOWS_SEA_TRUSTED_ED25519_KEYS ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function attestationVerified(receipt, attestation, root, now, trustedKeyAllowlist) {
  if (attestation?.schema !== RELEASE_ATTESTATION_SCHEMA || attestation.status !== 'PASS'
    || !fresh(attestation.generatedAt, now) || !releaseBindingMatches(attestation.release, receipt.release)
    || typeof attestation.keyId !== 'string' || !attestation.keyId) return false;
  const keyBytes = readBoundFile(root, receipt.rawEvidence?.attestationPublicKey);
  const signature = readBoundFile(root, receipt.rawEvidence?.attestationSignature);
  if (!keyBytes || !signature || signature.byteLength !== 64) return false;
  let publicKey;
  try {
    publicKey = createPublicKey(keyBytes);
    if (publicKey.asymmetricKeyType !== 'ed25519') return false;
  } catch { return false; }
  const fingerprint = hash(publicKey.export({ type: 'spki', format: 'der' }));
  const allowlist = trustedKeyAllowlist ?? trustedKeyAllowlistFromEnvironment();
  if (allowlist?.[attestation.keyId] !== fingerprint
    || !verifySignature(null, Buffer.from(canonicalJson(attestation), 'utf8'), publicKey, signature)) return false;
  if (attestation.runner?.trusted !== true || attestation.runner?.environment !== 'release'
    || !['provider', 'identity', 'workflow', 'runId', 'repository'].every(key => typeof attestation.runner?.[key] === 'string' && attestation.runner[key])
    || attestation.source?.gitHead !== receipt.release?.gitHead || attestation.source?.gitTreeVerified !== true
    || !GIT_OID.test(String(attestation.source?.gitTreeOid ?? ''))
    || attestation.source?.treeSha256 !== canonicalHash(receipt.sourceBindings)
    || attestation.artifacts?.unsignedPeSha256 !== receipt.artifacts?.unsignedBinary?.sha256
    || attestation.artifacts?.signedPeSha256 !== receipt.artifacts?.signedBinary?.sha256) return false;
  for (const name of ['readinessReceipt', 'parity', 'signing', 'installer']) {
    if (!sameBinding(attestation.evidence?.[name], receipt.rawEvidence?.[name])) return false;
  }
  const signing = readBoundJson(root, receipt.rawEvidence?.signing);
  const installer = readBoundJson(root, receipt.rawEvidence?.installer);
  const parity = readBoundJson(root, receipt.rawEvidence?.parity);
  return attestation.authenticode?.peSha256 === receipt.artifacts?.signedBinary?.sha256
    && attestation.authenticode?.certificateSha256 === signing?.certificateSha256
    && attestation.authenticode?.timestampTokenSha256 === signing?.timestamp?.tokenSha256
    && attestation.authenticode?.timestampMessageImprint === signing?.timestamp?.messageImprint
    && attestation.parity?.callsSha256 === canonicalHash(parity?.representativeCalls)
    && attestation.vm?.provider === installer?.provider
    && attestation.vm?.providerAttestationId === installer?.providerAttestationId
    && attestation.vm?.vmId === installer?.vmId;
}

export function verifyWindowsSeaReleaseReceipt(receipt, expectedRelease, {
  root = scriptRoot, now = Date.now(), trustedKeyAllowlist,
} = {}) {
  const blockers = [];
  if (!receipt || typeof receipt !== 'object') blockers.push('receipt_missing');
  if (receipt?.schema !== RELEASE_RECEIPT_SCHEMA) blockers.push('schema_invalid');
  if (receipt?.ok !== true || receipt?.status !== 'PASS' || receipt?.releaseEligible !== true) blockers.push('pass_claim_missing');
  if (!fresh(receipt?.generatedAt, now)) blockers.push('receipt_stale_or_time_invalid');
  if (!releaseBindingMatches(receipt?.release, expectedRelease)) blockers.push('release_binding_mismatch');
  if (!verifyReceiptSha256(receipt)) blockers.push('receipt_hash_invalid');
  if (!requiredSourceBindingsVerified(root, receipt?.sourceBindings)) blockers.push('source_bindings_invalid');
  if (!Array.isArray(receipt?.blockers) || receipt.blockers.length !== 0) blockers.push('receipt_blockers_present');

  const unsignedBinary = receipt?.artifacts?.unsignedBinary; const signedBinary = receipt?.artifacts?.signedBinary;
  const unsignedPe = peDetails(root, unsignedBinary); const signedPe = peDetails(root, signedBinary);
  if (!unsignedPe || unsignedPe.authenticodeEmbedded) blockers.push('sea_unsigned_binary_invalid');
  if (!signedPe || !signedPe.authenticodeEmbedded || signedBinary?.sha256 === unsignedBinary?.sha256) blockers.push('sea_signed_binary_invalid');
  if (!manifestVerified(root, receipt?.artifacts?.unsignedSha256Manifest, unsignedBinary, true)
    || !manifestVerified(root, receipt?.artifacts?.signedSha256Manifest, signedBinary, false)) blockers.push('sea_manifest_binding_invalid');
  if (!sameBinding(receipt?.artifacts?.binary, signedBinary)
    || !sameBinding(receipt?.artifacts?.sha256Manifest, receipt?.artifacts?.signedSha256Manifest)) blockers.push('sea_compatibility_artifact_binding_invalid');
  if (!(receipt?.evidence?.unsignedSeaCreated === 'PASS' && receipt?.evidence?.signedSeaCreated === 'PASS'
    && receipt?.evidence?.sha256ManifestAndTamperCheck === 'PASS')) blockers.push('sea_reproducible_artifact_not_verified');

  const readiness = readBoundJson(root, receipt?.rawEvidence?.readinessReceipt);
  if (!readiness || !verifyReadinessReceipt(readiness, { root }).ok || !fresh(readiness.generatedAt, now)
    || readiness.evidence?.sourceBundleSmoke !== 'PASS') blockers.push('sea_readiness_receipt_invalid');
  const parity = readBoundJson(root, receipt?.rawEvidence?.parity);
  if (!parityEvidenceVerified(parity, signedBinary, root, receipt?.release, now)
    || !(receipt?.parity?.status === 'PASS' && receipt.parity.executableInvoked === true
      && receipt.parity.mcpToolsExact === true && receipt.parity.cliCommandsExact === true
      && receipt.parity.representativeToolCalls === parity?.representativeCalls?.length
      && receipt.parity.representativeToolCalls >= 3)) blockers.push('sea_mcp_cli_parity_not_verified');
  const signing = readBoundJson(root, receipt?.rawEvidence?.signing);
  if (!signingEvidenceVerified(signing, unsignedBinary, signedBinary, root, receipt?.release, now)
    || !(receipt?.signing?.status === 'PASS' && receipt.signing.authenticodeVerified === true
      && receipt.signing.certificateSha256 === signing?.certificateSha256
      && receipt.signing.timestampAuthority === signing?.timestamp?.authority
      && receipt.signing.timestampAt === signing?.timestamp?.at)) blockers.push('authenticode_not_verified');
  const installer = readBoundJson(root, receipt?.rawEvidence?.installer);
  if (!installerEvidenceVerified(installer, signedBinary, root, receipt?.release, now)
    || !(receipt?.installer?.status === 'PASS' && receipt.installer.disposableVm === true
      && INSTALLER_STAGES.every(stage => receipt.installer[stage] === 'PASS'))) blockers.push('installer_lifecycle_not_verified');
  const attestation = readBoundJson(root, receipt?.rawEvidence?.attestation);
  if (!attestationVerified(receipt, attestation, root, now, trustedKeyAllowlist)) blockers.push('trusted_release_attestation_invalid');
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}

function optionalBinding(root, value) { return value ? fileBinding(root, value) : null; }
function optionalJson(root, binding) { return binding ? readBoundJson(root, binding) : null; }

export function buildWindowsSeaReleaseReceipt({
  root = scriptRoot, generatedAt = new Date().toISOString(), release = null,
  evidencePaths = {}, now = Date.now(), trustedKeyAllowlist,
} = {}) {
  const sourceBindings = RELEASE_SOURCE_PATHS.map(path => fileBinding(root, path)).filter(Boolean);
  const readinessReceipt = optionalBinding(root, evidencePaths.readinessReceipt ?? DEFAULT_READINESS_RECEIPT);
  const unsignedBinary = optionalBinding(root, evidencePaths.unsignedBinary);
  const unsignedSha256Manifest = optionalBinding(root, evidencePaths.unsignedManifest);
  const signedBinary = optionalBinding(root, evidencePaths.signedBinary);
  const signedSha256Manifest = optionalBinding(root, evidencePaths.signedManifest);
  const parityBinding = optionalBinding(root, evidencePaths.parity);
  const signingBinding = optionalBinding(root, evidencePaths.signing);
  const installerBinding = optionalBinding(root, evidencePaths.installer);
  const attestationBinding = optionalBinding(root, evidencePaths.attestation);
  const attestationSignature = optionalBinding(root, evidencePaths.attestationSignature);
  const attestationPublicKey = optionalBinding(root, evidencePaths.attestationPublicKey);
  const parity = optionalJson(root, parityBinding); const signing = optionalJson(root, signingBinding);
  const installer = optionalJson(root, installerBinding);
  const candidate = {
    schema: RELEASE_RECEIPT_SCHEMA, generatedAt, ok: true, status: 'PASS', releaseEligible: true, release,
    artifacts: { unsignedBinary, unsignedSha256Manifest, signedBinary, signedSha256Manifest, binary: signedBinary, sha256Manifest: signedSha256Manifest },
    evidence: {
      unsignedSeaCreated: unsignedBinary ? 'PASS' : 'NOT_RUN', signedSeaCreated: signedBinary ? 'PASS' : 'NOT_RUN',
      sha256ManifestAndTamperCheck: unsignedSha256Manifest && signedSha256Manifest ? 'PASS' : 'NOT_RUN',
    },
    parity: parity ? {
      status: parity.status, executableInvoked: parity.executableInvoked === true,
      mcpToolsExact: parity.mcpToolsExact === true, cliCommandsExact: parity.cliCommandsExact === true,
      representativeToolCalls: Array.isArray(parity.representativeCalls) ? parity.representativeCalls.length : 0,
    } : { status: 'NOT_RUN', executableInvoked: false, mcpToolsExact: false, cliCommandsExact: false, representativeToolCalls: 0 },
    signing: signing ? {
      status: signing.status, authenticodeVerified: signing.authenticodeVerified === true,
      certificateSha256: signing.certificateSha256 ?? null,
      timestampAuthority: signing.timestamp?.authority ?? null, timestampAt: signing.timestamp?.at ?? null,
    } : { status: 'NOT_RUN', authenticodeVerified: false, certificateSha256: null, timestampAuthority: null, timestampAt: null },
    installer: installer ? {
      status: installer.status, disposableVm: installer.disposableVm === true,
      ...Object.fromEntries(INSTALLER_STAGES.map(stage => [stage, installer.lifecycle?.[stage]?.status ?? 'NOT_RUN'])),
    } : { status: 'NOT_RUN', disposableVm: false, install: 'NOT_RUN', upgrade: 'NOT_RUN', uninstall: 'NOT_RUN', rollback: 'NOT_RUN' },
    rawEvidence: {
      readinessReceipt, parity: parityBinding, signing: signingBinding, installer: installerBinding,
      attestation: attestationBinding, attestationSignature, attestationPublicKey,
    },
    sourceBindings, blockers: [],
  };
  let receipt = attachReceiptSha256(candidate);
  const verification = verifyWindowsSeaReleaseReceipt(receipt, release, { root, now, trustedKeyAllowlist });
  if (!verification.ok) receipt = attachReceiptSha256({ ...candidate, ok: false, status: 'HOLD', releaseEligible: false, blockers: verification.blockers });
  return receipt;
}

function valueAfter(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function readRelease(root, baselinePath) {
  try {
    const release = JSON.parse(readFileSync(resolve(root, baselinePath), 'utf8')).release;
    return release ? { buildId: release.buildId ?? null, deploymentId: release.deploymentId ?? null, gitHead: release.head ?? release.gitHead ?? null } : null;
  } catch { return null; }
}

function safeWriteReceipt(root, relativePath, receipt) {
  const normalized = safeRelativePath(relativePath);
  if (!normalized) throw new Error('unsafe_output_path');
  const absoluteRoot = resolve(root); const realRoot = realpathSync(absoluteRoot);
  const parts = normalized.split('/'); let parent = absoluteRoot;
  for (const part of parts.slice(0, -1)) {
    parent = resolve(parent, part);
    if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
    const info = lstatSync(parent);
    if (info.isSymbolicLink() || !info.isDirectory() || !contained(realRoot, realpathSync(parent))) throw new Error('unsafe_output_parent');
  }
  const absolute = resolve(parent, parts.at(-1));
  const data = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'); let descriptor;
  try {
    if (existsSync(absolute)) {
      const info = lstatSync(absolute);
      if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw new Error('unsafe_output_target');
      descriptor = openSync(absolute, 'r+');
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.nlink !== 1) throw new Error('unsafe_output_target');
      writeFileSync(descriptor, data); truncateSync(descriptor, data.byteLength);
    } else {
      descriptor = openSync(absolute, 'wx', 0o600); writeFileSync(descriptor, data);
    }
    fsyncSync(descriptor);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = process.cwd(); const output = valueAfter('--out') ?? DEFAULT_RELEASE_RECEIPT;
  const receipt = buildWindowsSeaReleaseReceipt({
    root,
    release: readRelease(root, valueAfter('--release-baseline') ?? 'docs/evidence/release/commercial-release-baseline-current.json'),
    evidencePaths: {
      readinessReceipt: valueAfter('--readiness') ?? DEFAULT_READINESS_RECEIPT,
      unsignedBinary: valueAfter('--unsigned-binary'), unsignedManifest: valueAfter('--unsigned-manifest'),
      signedBinary: valueAfter('--signed-binary'), signedManifest: valueAfter('--signed-manifest'),
      parity: valueAfter('--parity'), signing: valueAfter('--signing'), installer: valueAfter('--installer'),
      attestation: valueAfter('--attestation'), attestationSignature: valueAfter('--attestation-signature'),
      attestationPublicKey: valueAfter('--attestation-public-key'),
    },
  });
  if (process.argv.includes('--write')) safeWriteReceipt(root, output, receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes('--require-release-ready') && receipt.releaseEligible !== true) process.exitCode = 1;
}
