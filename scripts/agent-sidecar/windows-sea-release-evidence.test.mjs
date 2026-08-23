import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { attachReceiptSha256 } from '../immutable-receipt-binding.mjs';
import { buildReadinessReceipt, sha256 } from './windows-sea-readiness.mjs';
import {
  AUTHENTICODE_RESULT_SCHEMA, INSTALLER_EVIDENCE_SCHEMA, PARITY_EVIDENCE_SCHEMA,
  RELEASE_ATTESTATION_SCHEMA, RELEASE_MANIFEST_SCHEMA, RELEASE_SOURCE_PATHS,
  SIGNING_EVIDENCE_SCHEMA, VM_PROVIDER_ATTESTATION_SCHEMA, VM_STAGE_OBSERVATION_SCHEMA,
  buildWindowsSeaReleaseReceipt, canonicalJson, fileBinding, verifyWindowsSeaReleaseReceipt,
} from './windows-sea-release-evidence.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = [];
const release = { buildId: 'build-1', deploymentId: 'deployment-1', gitHead: '1'.repeat(40) };
const generatedAt = '2026-08-23T00:00:00.000Z';
const now = Date.parse(generatedAt);
const digest = value => sha256(canonicalJson(value));

function write(root, relative, bytes) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  return relative;
}
function writeJson(root, relative, value) { return write(root, relative, `${JSON.stringify(value, null, 2)}\n`); }

function pe({ signed = false, fakeCertificateTable = false, marker = 1 } = {}) {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ', 0, 'ascii'); bytes.writeUInt32LE(0x80, 0x3c); bytes.write('PE\0\0', 0x80, 'binary');
  bytes.writeUInt16LE(0x14c, 0x84); bytes.writeUInt16LE(1, 0x86); bytes.writeUInt16LE(0xe0, 0x94);
  const optional = 0x98;
  bytes.writeUInt16LE(0x10b, optional); bytes.writeUInt32LE(16, optional + 92); bytes[0x40] = marker;
  if (signed || fakeCertificateTable) {
    bytes.writeUInt32LE(480, optional + 128); bytes.writeUInt32LE(32, optional + 132);
    if (fakeCertificateTable) bytes.fill(0x7a, 480, 512);
    else {
      bytes.writeUInt32LE(32, 480); bytes.writeUInt16LE(0x0200, 484); bytes.writeUInt16LE(0x0002, 486);
      bytes[488] = 0x30; bytes[489] = 0x16; bytes.fill(0x42, 490, 512);
    }
  }
  return bytes;
}

function copyReleaseSources(root) {
  for (const relative of RELEASE_SOURCE_PATHS) write(root, relative, fs.readFileSync(path.join(repoRoot, ...relative.split('/'))));
}

function fixture({ parityCalls = 3, fakeCertificateTable = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-windows-sea-release-'));
  roots.push(root); copyReleaseSources(root);
  const bundlePath = write(root, '.tmp/agent-sidecar/agent-gateway.cjs', 'bundled-agent-gateway');
  const unsignedPath = write(root, 'src-tauri/binaries/nexyfab-agent-gateway-x86_64-pc-windows-msvc.exe', pe());
  const unsignedBinding = fileBinding(root, unsignedPath);
  const unsignedManifestPath = writeJson(root, `${unsignedPath}.sha256.json`, {
    schema: RELEASE_MANIFEST_SCHEMA, unsigned: true,
    file: { name: path.basename(unsignedPath), bytes: unsignedBinding.bytes, sha256: unsignedBinding.sha256 },
  });
  const readiness = buildReadinessReceipt({
    root, generatedAt,
    probes: {
      nodeVersion: 'v25.2.1', platform: 'win32', arch: 'x64', targetTriple: 'x86_64-pc-windows-msvc',
      nativeBuildSea: true, legacySeaConfig: false, postjectPath: null, signtoolPath: 'signtool.exe',
      bundleCheck: { ran: true, ok: true, status: 0, error: null, artifact: fileBinding(root, bundlePath) },
    },
  });
  const readinessPath = writeJson(root, 'docs/evidence/agent-sidecar/windows-sea-readiness-260823.json', readiness);
  const signedPath = write(root, 'product-evidence/nexyfab-agent-gateway-signed.exe', pe({ signed: !fakeCertificateTable, fakeCertificateTable, marker: 2 }));
  const signedBinding = fileBinding(root, signedPath);
  const signedManifestPath = writeJson(root, `${signedPath}.sha256.json`, {
    schema: RELEASE_MANIFEST_SCHEMA, unsigned: false,
    file: { name: path.basename(signedPath), bytes: signedBinding.bytes, sha256: signedBinding.sha256 },
  });

  const calls = Array.from({ length: parityCalls }, (_, index) => {
    const surface = index === parityCalls - 1 ? 'cli' : 'mcp'; const id = `${surface}-${index + 1}`;
    const input = { designId: index + 1 }; const output = { ok: true, result: index + 1 };
    const records = [
      { kind: 'request', callId: id, surface, operation: surface === 'mcp' ? 'tools/call' : 'agent inspect', executableSha256: signedBinding.sha256, payload: input },
      { kind: 'baseline_response', callId: id, payload: output },
      { kind: 'sea_response', callId: id, payload: output },
      { kind: 'exit', callId: id, executableSha256: signedBinding.sha256, code: 0 },
    ];
    const transcript = fileBinding(root, write(root, `product-evidence/parity-${index + 1}.jsonl`, `${records.map(JSON.stringify).join('\n')}\n`));
    return { id, surface, inputSha256: digest(input), baselineOutputSha256: digest(output), seaOutputSha256: digest(output), exact: true, transcript };
  });
  const parityPath = writeJson(root, 'product-evidence/parity.json', {
    schema: PARITY_EVIDENCE_SCHEMA, generatedAt, status: 'PASS', release,
    executableSha256: signedBinding.sha256, executableInvoked: true, mcpToolsExact: true, cliCommandsExact: true,
    representativeCalls: calls,
  });

  const certificateSha256 = 'a'.repeat(64); const tokenSha256 = 'b'.repeat(64); const imprint = 'c'.repeat(64);
  const signingResultPath = writeJson(root, 'product-evidence/authenticode-machine-result.json', {
    schema: AUTHENTICODE_RESULT_SCHEMA,
    tool: { name: 'Get-AuthenticodeSignature', version: 'PowerShell 7.5', command: 'Get-AuthenticodeSignature ./agent.exe | ConvertTo-Json' },
    exitCode: 0, peHashAlgorithm: 'sha256', peSha256: signedBinding.sha256, executableSha256: signedBinding.sha256,
    signatureStatus: 'Valid', chain: { trusted: true }, certificate: { sha256: certificateSha256, subject: 'CN=NexyFab Release Test' },
    timestamp: { verified: true, authority: 'NexyFab Test TSA', at: generatedAt, tokenSha256, imprintAlgorithm: 'sha256', messageImprint: imprint },
  });
  const signingPath = writeJson(root, 'product-evidence/signing.json', {
    schema: SIGNING_EVIDENCE_SCHEMA, generatedAt, status: 'PASS', release,
    unsignedBinarySha256: unsignedBinding.sha256, signedBinarySha256: signedBinding.sha256,
    authenticodeVerified: true, chainTrusted: true, signatureStatus: 'Valid',
    certificateSha256, certificateSubject: 'CN=NexyFab Release Test',
    timestamp: { verified: true, authority: 'NexyFab Test TSA', at: generatedAt, tokenSha256, messageImprint: imprint },
    rawVerification: fileBinding(root, signingResultPath),
  });

  const providerPath = writeJson(root, 'product-evidence/vm-provider.json', {
    schema: VM_PROVIDER_ATTESTATION_SCHEMA, generatedAt, status: 'PASS', provider: 'trusted-ci-vm',
    attestationId: 'vm-attestation-1', vmId: 'vm-unique-1', unique: true, disposable: true,
    productionMachineTouched: false, createdAt: '2026-08-22T23:50:00.000Z', destroyedAt: '2026-08-23T00:20:00.000Z',
  });
  const stageSpecs = {
    install: { start: '00:00', end: '00:02', before: null, after: '1.0.0' },
    upgrade: { start: '00:03', end: '00:05', before: '1.0.0', after: '2.0.0' },
    rollback: { start: '00:06', end: '00:08', before: '2.0.0', after: '1.0.0', inducedFailure: true, recoveryVerified: true },
    uninstall: { start: '00:09', end: '00:11', before: '1.0.0', after: null, residueCount: 0 },
  };
  const lifecycle = {};
  for (const [stage, spec] of Object.entries(stageSpecs)) {
    const rawLog = fileBinding(root, writeJson(root, `product-evidence/vm-${stage}.json`, {
      schema: VM_STAGE_OBSERVATION_SCHEMA, stage, vmId: 'vm-unique-1', providerAttestationId: 'vm-attestation-1',
      startedAt: `2026-08-23T${spec.start}:00.000Z`, completedAt: `2026-08-23T${spec.end}:00.000Z`,
      command: `installer.exe ${stage}`, executedBinarySha256: signedBinding.sha256, status: 'PASS', exitCode: 0,
      versionBefore: spec.before, versionAfter: spec.after, ...(spec.inducedFailure ? { inducedFailure: true, recoveryVerified: true } : {}),
      ...(spec.residueCount === 0 ? { residueCount: 0 } : {}),
    }));
    lifecycle[stage] = { status: 'PASS', exitCode: 0, rawLog };
  }
  const installerPath = writeJson(root, 'product-evidence/installer.json', {
    schema: INSTALLER_EVIDENCE_SCHEMA, generatedAt, status: 'PASS', release, signedBinarySha256: signedBinding.sha256,
    disposableVm: true, uniqueDisposableVm: true, vmId: 'vm-unique-1', productionMachineTouched: false,
    provider: 'trusted-ci-vm', providerAttestationId: 'vm-attestation-1', providerAttestation: fileBinding(root, providerPath),
    installVersion: '1.0.0', upgradeVersion: '2.0.0', lifecycle,
  });

  const sourceBindings = RELEASE_SOURCE_PATHS.map(relative => fileBinding(root, relative));
  const evidence = {
    readinessReceipt: fileBinding(root, readinessPath), parity: fileBinding(root, parityPath),
    signing: fileBinding(root, signingPath), installer: fileBinding(root, installerPath),
  };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = 'ci-test-key';
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyPath = write(root, 'product-evidence/ci-release-public.pem', publicKey.export({ type: 'spki', format: 'pem' }));
  const attestation = {
    schema: RELEASE_ATTESTATION_SCHEMA, generatedAt, status: 'PASS', keyId, release,
    runner: { trusted: true, environment: 'release', provider: 'github-actions', identity: 'repo:nexyfab/release', workflow: 'windows-sea-release', runId: 'run-1', repository: 'nexyfab/release' },
    source: { gitHead: release.gitHead, gitTreeVerified: true, gitTreeOid: '2'.repeat(40), treeSha256: digest(sourceBindings) },
    artifacts: { unsignedPeSha256: unsignedBinding.sha256, signedPeSha256: signedBinding.sha256 }, evidence,
    authenticode: { peSha256: signedBinding.sha256, certificateSha256, timestampTokenSha256: tokenSha256, timestampMessageImprint: imprint },
    parity: { callsSha256: digest(calls) },
    vm: { provider: 'trusted-ci-vm', providerAttestationId: 'vm-attestation-1', vmId: 'vm-unique-1' },
  };
  const attestationPath = writeJson(root, 'product-evidence/release-attestation.json', attestation);
  const signaturePath = write(root, 'product-evidence/release-attestation.sig', sign(null, Buffer.from(canonicalJson(attestation)), privateKey));
  const trustedKeyAllowlist = { [keyId]: createHash('sha256').update(publicDer).digest('hex') };
  const evidencePaths = {
    readinessReceipt: readinessPath, unsignedBinary: unsignedPath, unsignedManifest: unsignedManifestPath,
    signedBinary: signedPath, signedManifest: signedManifestPath, parity: parityPath, signing: signingPath,
    installer: installerPath, attestation: attestationPath, attestationSignature: signaturePath,
    attestationPublicKey: publicKeyPath,
  };
  return { root, evidencePaths, trustedKeyAllowlist, signedPath, parityPath, installerPath, attestationPath };
}

test.afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

test('builds a default NOT_RUN/HOLD receipt without inventing release evidence or trust', () => {
  const f = fixture();
  const receipt = buildWindowsSeaReleaseReceipt({ root: f.root, generatedAt, release, evidencePaths: { readinessReceipt: f.evidencePaths.readinessReceipt }, now });
  assert.equal(receipt.status, 'HOLD'); assert.equal(receipt.releaseEligible, false);
  assert.equal(receipt.evidence.signedSeaCreated, 'NOT_RUN'); assert.equal(receipt.parity.status, 'NOT_RUN');
  assert.ok(receipt.blockers.includes('trusted_release_attestation_invalid'));
});

test('accepts a structured packet only with an allowlisted Ed25519 CI attestation', () => {
  const f = fixture();
  const options = { root: f.root, generatedAt, release, evidencePaths: f.evidencePaths, now, trustedKeyAllowlist: f.trustedKeyAllowlist };
  const receipt = buildWindowsSeaReleaseReceipt(options);
  assert.equal(receipt.status, 'PASS', receipt.blockers.join(','));
  assert.deepEqual(verifyWindowsSeaReleaseReceipt(receipt, { ...release, head: release.gitHead }, { root: f.root, now, trustedKeyAllowlist: f.trustedKeyAllowlist }), { ok: true, blockers: [] });
  assert.ok(verifyWindowsSeaReleaseReceipt(receipt, release, { root: f.root, now, trustedKeyAllowlist: {} }).blockers.includes('trusted_release_attestation_invalid'));
});

test('rejects the former claim-only fake certificate table even when the packet is attested', () => {
  const f = fixture({ fakeCertificateTable: true });
  const receipt = buildWindowsSeaReleaseReceipt({ root: f.root, generatedAt, release, evidencePaths: f.evidencePaths, now, trustedKeyAllowlist: f.trustedKeyAllowlist });
  assert.equal(receipt.status, 'HOLD'); assert.ok(receipt.blockers.includes('sea_signed_binary_invalid'));
});

test('re-derives transcript hashes, rejects duplicate transcript and validates VM stage bytes', () => {
  const f = fixture();
  const receipt = buildWindowsSeaReleaseReceipt({ root: f.root, generatedAt, release, evidencePaths: f.evidencePaths, now, trustedKeyAllowlist: f.trustedKeyAllowlist });
  const parity = JSON.parse(fs.readFileSync(path.join(f.root, f.parityPath), 'utf8'));
  parity.representativeCalls[1].transcript = parity.representativeCalls[0].transcript;
  fs.writeFileSync(path.join(f.root, f.parityPath), `${JSON.stringify(parity)}\n`);
  assert.ok(verifyWindowsSeaReleaseReceipt(receipt, release, { root: f.root, now, trustedKeyAllowlist: f.trustedKeyAllowlist }).blockers.includes('sea_mcp_cli_parity_not_verified'));

  const vm = fixture();
  const vmReceipt = buildWindowsSeaReleaseReceipt({ root: vm.root, generatedAt, release, evidencePaths: vm.evidencePaths, now, trustedKeyAllowlist: vm.trustedKeyAllowlist });
  const installer = JSON.parse(fs.readFileSync(path.join(vm.root, vm.installerPath), 'utf8'));
  const rollbackPath = path.join(vm.root, installer.lifecycle.rollback.rawLog.path);
  const rollback = JSON.parse(fs.readFileSync(rollbackPath, 'utf8')); rollback.recoveryVerified = false;
  fs.writeFileSync(rollbackPath, `${JSON.stringify(rollback)}\n`);
  assert.ok(verifyWindowsSeaReleaseReceipt(vmReceipt, release, { root: vm.root, now, trustedKeyAllowlist: vm.trustedKeyAllowlist }).blockers.includes('installer_lifecycle_not_verified'));
});

test('fails closed on attestation tamper, binary tamper, short parity and release transplant', () => {
  const short = fixture({ parityCalls: 2 });
  const shortReceipt = buildWindowsSeaReleaseReceipt({ root: short.root, generatedAt, release, evidencePaths: short.evidencePaths, now, trustedKeyAllowlist: short.trustedKeyAllowlist });
  assert.ok(shortReceipt.blockers.includes('sea_mcp_cli_parity_not_verified'));
  const f = fixture();
  const receipt = buildWindowsSeaReleaseReceipt({ root: f.root, generatedAt, release, evidencePaths: f.evidencePaths, now, trustedKeyAllowlist: f.trustedKeyAllowlist });
  fs.appendFileSync(path.join(f.root, f.signedPath), 'tamper');
  assert.ok(verifyWindowsSeaReleaseReceipt(receipt, release, { root: f.root, now, trustedKeyAllowlist: f.trustedKeyAllowlist }).blockers.includes('sea_signed_binary_invalid'));
  const transplanted = attachReceiptSha256({ ...receipt, release: { ...receipt.release, buildId: 'other-build' } });
  assert.ok(verifyWindowsSeaReleaseReceipt(transplanted, release, { root: f.root, now, trustedKeyAllowlist: f.trustedKeyAllowlist }).blockers.includes('release_binding_mismatch'));
  const a = fixture();
  const aReceipt = buildWindowsSeaReleaseReceipt({ root: a.root, generatedAt, release, evidencePaths: a.evidencePaths, now, trustedKeyAllowlist: a.trustedKeyAllowlist });
  const packet = JSON.parse(fs.readFileSync(path.join(a.root, a.attestationPath), 'utf8')); packet.runner.runId = 'attacker';
  fs.writeFileSync(path.join(a.root, a.attestationPath), `${JSON.stringify(packet)}\n`);
  assert.ok(verifyWindowsSeaReleaseReceipt(aReceipt, release, { root: a.root, now, trustedKeyAllowlist: a.trustedKeyAllowlist }).blockers.includes('trusted_release_attestation_invalid'));
});
