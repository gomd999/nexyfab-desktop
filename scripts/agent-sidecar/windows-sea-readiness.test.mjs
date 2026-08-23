import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_SCHEMA,
  buildReadinessReceipt,
  receiptSha256,
  sha256,
  verifyBinaryManifest,
  verifyReadinessReceipt,
} from './windows-sea-readiness.mjs';

const probes = {
  nodeVersion: 'v25.2.1', platform: 'win32', arch: 'x64', targetTriple: 'x86_64-pc-windows-msvc',
  nativeBuildSea: false, legacySeaConfig: true, postjectPath: null, signtoolPath: null,
  bundleCheck: { ran: true, ok: true, status: 0, error: null },
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const boundSources = [
  'scripts/build-agent-sidecar.mjs',
  'scripts/agent-sidecar/windows-sea-readiness.mjs',
  'scripts/drawing-to-3d/agent-sidecar-entry.mjs',
  'scripts/drawing-to-3d/installer-core-agent-server.mjs',
  'scripts/drawing-to-3d/capability-surface-manifest.mjs',
];

function copyBoundSources(root) {
  for (const relative of boundSources) {
    const target = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(repoRoot, ...relative.split('/'))));
  }
}

test('fails closed when SEA injection, binary, signature and installer evidence are absent', () => {
  const root = repoRoot;
  const receipt = buildReadinessReceipt({ root, probes, generatedAt: '2026-08-23T00:00:00.000Z' });
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.releaseEligible, false);
  assert.equal(receipt.evidence.sourceBundleSmoke, 'NOT_RUN_OR_FAIL');
  assert.equal(receipt.evidence.unsignedSeaCreated, 'NOT_OBSERVED');
  assert.equal(receipt.evidence.seaMcpCliParitySmoke, 'NOT_RUN');
  assert.ok(receipt.blockers.includes('sea_injection_toolchain_missing'));
  assert.ok(receipt.blockers.includes('source_bundle_smoke_not_passed'));
  assert.ok(receipt.blockers.includes('authenticode_signature_missing'));
  assert.ok(receipt.blockers.includes('sea_mcp_cli_parity_smoke_not_run'));
  assert.deepEqual(verifyReadinessReceipt(receipt, { root }), { ok: true, errors: [] });
});

test('verifies a contained PE hash manifest and detects binary tampering', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-sidecar-manifest-'));
  const binaryDir = path.join(root, 'binaries');
  mkdirSync(binaryDir);
  const name = 'nexyfab-agent-gateway-x86_64-pc-windows-msvc.exe';
  const binary = path.join(binaryDir, name);
  const original = Buffer.from([0x4d, 0x5a, 0x01, 0x02, 0x03]);
  writeFileSync(binary, original);
  const manifest = { schema: MANIFEST_SCHEMA, unsigned: true, file: { name, bytes: original.byteLength, sha256: sha256(original) } };
  assert.equal(verifyBinaryManifest({ binaryDir, manifest }).ok, true);
  writeFileSync(binary, Buffer.concat([readFileSync(binary), Buffer.from([0x04])]));
  assert.deepEqual(verifyBinaryManifest({ binaryDir, manifest }), { ok: false, error: 'binary_tampered' });
  assert.deepEqual(verifyBinaryManifest({ binaryDir, manifest: { ...manifest, file: { ...manifest.file, name: '../escape.exe' } } }), { ok: false, error: 'manifest_path_invalid' });
});

test('rejects receipt/source tampering and invented signing claims', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-sidecar-receipt-'));
  copyBoundSources(root);
  const receipt = buildReadinessReceipt({ root, probes, generatedAt: '2026-08-23T00:00:00.000Z' });
  const invented = { ...receipt, evidence: { ...receipt.evidence, authenticodeSignature: 'PASS' } };
  invented.receiptSha256 = receiptSha256(invented);
  assert.ok(verifyReadinessReceipt(invented, { root }).errors.includes('unsubstantiated_release_claim'));

  const hiddenBlocker = { ...receipt, blockers: receipt.blockers.filter(value => value !== 'sea_mcp_cli_parity_smoke_not_run') };
  hiddenBlocker.receiptSha256 = receiptSha256(hiddenBlocker);
  assert.ok(verifyReadinessReceipt(hiddenBlocker, { root }).errors.includes('required_blocker_missing'));

  const missingBinding = { ...receipt, sourceBindings: receipt.sourceBindings.slice(1) };
  missingBinding.receiptSha256 = receiptSha256(missingBinding);
  assert.ok(verifyReadinessReceipt(missingBinding, { root }).errors.includes('source_binding_set_invalid'));

  const boundPath = receipt.sourceBindings[0].path;
  const absolute = path.join(root, ...boundPath.split('/'));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, 'tampered after receipt');
  assert.ok(verifyReadinessReceipt(receipt, { root }).errors.some(error => error.startsWith('source_binding_mismatch:')));
});
