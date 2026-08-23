#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RECEIPT_SCHEMA = 'nexyfab.windows-agent-sidecar-readiness.v1';
export const MANIFEST_SCHEMA = 'nexyfab.windows-agent-sidecar-sha256.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_BINDING_PATHS = [
  'scripts/build-agent-sidecar.mjs',
  'scripts/agent-sidecar/windows-sea-readiness.mjs',
  'scripts/drawing-to-3d/agent-sidecar-entry.mjs',
  'scripts/drawing-to-3d/installer-core-agent-server.mjs',
  'scripts/drawing-to-3d/capability-surface-manifest.mjs',
];

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

export function receiptSha256(receipt) {
  const unsigned = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptSha256'));
  return sha256(JSON.stringify(stable(unsigned)));
}

function safeFileBinding(root, relativePath) {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, relativePath);
  const contained = relative(absoluteRoot, absolute);
  if (!contained || contained.startsWith('..') || isAbsolute(contained)) throw new Error(`unsafe source binding: ${relativePath}`);
  if (!existsSync(absolute)) return { path: relativePath.replaceAll('\\', '/'), bytes: null, sha256: null };
  if (lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) throw new Error(`unsafe source binding: ${relativePath}`);
  const realRoot = realpathSync(absoluteRoot);
  const realFile = realpathSync(absolute);
  const realContained = relative(realRoot, realFile);
  if (!realContained || realContained.startsWith('..') || isAbsolute(realContained)) throw new Error(`unsafe source binding: ${relativePath}`);
  const bytes = readFileSync(absolute);
  return { path: relativePath.replaceAll('\\', '/'), bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function hostTriple(platform, arch) {
  return ({
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
  })[`${platform}-${arch}`] ?? null;
}

function commandOutput(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    error: result.error?.code ?? null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

export function probeWindowsSeaToolchain({ root = scriptRoot, runBundleCheck = false } = {}) {
  const help = commandOutput(process.execPath, ['--help']);
  const helpText = `${help.stdout}\n${help.stderr}`;
  const postjectCandidates = [
    join(root, 'node_modules', '.bin', 'postject.cmd'),
    join(root, 'node_modules', 'postject', 'dist', 'cli.js'),
  ];
  const postjectPath = postjectCandidates.find(candidate => existsSync(candidate)) ?? null;
  const bundle = runBundleCheck
    ? commandOutput(process.execPath, [join(root, 'scripts', 'build-agent-sidecar.mjs'), '--check'], { cwd: root, timeout: 30_000, maxBuffer: 20_000_000 })
    : { ok: false, status: null, error: null, stdout: '', stderr: 'not run' };
  let bundleArtifact = null;
  if (bundle.ok) {
    try {
      const output = JSON.parse(bundle.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
      const relativeBundle = relative(resolve(root), resolve(output.bundle)).replaceAll('\\', '/');
      if (relativeBundle.startsWith('.tmp/agent-sidecar/')) bundleArtifact = safeFileBinding(root, relativeBundle);
    } catch { bundleArtifact = null; }
  }
  const signTool = process.platform === 'win32' ? commandOutput('where.exe', ['signtool.exe']) : { ok: false, stdout: '' };
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    targetTriple: hostTriple(process.platform, process.arch),
    nativeBuildSea: help.ok && helpText.includes('--build-sea'),
    legacySeaConfig: help.ok && helpText.includes('--experimental-sea-config'),
    postjectPath,
    signtoolPath: signTool.ok ? signTool.stdout.trim().split(/\r?\n/)[0] : null,
    bundleCheck: { ran: runBundleCheck, ok: bundle.ok, status: bundle.status, error: bundle.error, artifact: bundleArtifact },
  };
}

function bindingMatches(root, binding) {
  if (!binding || !Number.isInteger(binding.bytes) || binding.bytes <= 0 || !SHA256.test(String(binding.sha256 ?? ''))) return false;
  try {
    const actual = safeFileBinding(root, binding.path);
    return actual.bytes === binding.bytes && actual.sha256 === binding.sha256;
  } catch {
    return false;
  }
}

export function verifyBinaryManifest({ binaryDir, manifest }) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || manifest.unsigned !== true) return { ok: false, error: 'manifest_invalid' };
  const name = manifest.file?.name;
  if (typeof name !== 'string' || basename(name) !== name || !name.toLowerCase().endsWith('.exe')) return { ok: false, error: 'manifest_path_invalid' };
  const root = resolve(binaryDir);
  const binary = resolve(root, name);
  const contained = relative(root, binary);
  if (!contained || contained.startsWith('..') || isAbsolute(contained)) return { ok: false, error: 'manifest_path_invalid' };
  if (!existsSync(binary) || !statSync(binary).isFile()) return { ok: false, error: 'binary_missing' };
  if (lstatSync(binary).isSymbolicLink()) return { ok: false, error: 'manifest_path_invalid' };
  const realRoot = realpathSync(root);
  const realBinary = realpathSync(binary);
  const realContained = relative(realRoot, realBinary);
  if (!realContained || realContained.startsWith('..') || isAbsolute(realContained)) return { ok: false, error: 'manifest_path_invalid' };
  const bytes = readFileSync(binary);
  if (bytes.byteLength < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return { ok: false, error: 'binary_not_pe' };
  if (manifest.file.bytes !== bytes.byteLength || !SHA256.test(String(manifest.file.sha256 ?? '')) || sha256(bytes) !== manifest.file.sha256) {
    return { ok: false, error: 'binary_tampered' };
  }
  return { ok: true, sha256: manifest.file.sha256, bytes: bytes.byteLength };
}

export function buildReadinessReceipt({ root = scriptRoot, probes, generatedAt = new Date().toISOString() }) {
  const actual = probes ?? probeWindowsSeaToolchain({ root });
  const targetTriple = actual.targetTriple;
  const binaryName = targetTriple ? `nexyfab-agent-gateway-${targetTriple}.exe` : null;
  const binaryDir = join(root, 'src-tauri', 'binaries');
  const binaryPath = binaryName ? join(binaryDir, binaryName) : null;
  const manifestPath = binaryPath ? `${binaryPath}.sha256.json` : null;
  let manifest = null;
  if (manifestPath && existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { manifest = null; }
  }
  const manifestCheck = manifest ? verifyBinaryManifest({ binaryDir, manifest }) : { ok: false, error: 'manifest_missing' };
  const bundleSmokePassed = actual.bundleCheck?.ok === true && bindingMatches(root, actual.bundleCheck.artifact);
  const sourceBindings = SOURCE_BINDING_PATHS.map(path => safeFileBinding(root, path));
  const blockers = [];
  if (actual.platform !== 'win32' || !targetTriple) blockers.push('windows_host_required');
  if (!actual.nativeBuildSea && !(actual.legacySeaConfig && actual.postjectPath)) blockers.push('sea_injection_toolchain_missing');
  if (!bundleSmokePassed) blockers.push('source_bundle_smoke_not_passed');
  if (sourceBindings.some(binding => !bindingMatches(root, binding))) blockers.push('source_binding_invalid');
  if (!binaryPath || !existsSync(binaryPath)) blockers.push('unsigned_windows_sea_missing');
  if (!manifestCheck.ok) blockers.push(`sha256_${manifestCheck.error}`);
  blockers.push('sea_mcp_cli_parity_smoke_not_run', 'authenticode_signature_missing', 'installer_execution_evidence_missing');

  const receipt = {
    schema: RECEIPT_SCHEMA,
    generatedAt,
    status: 'HOLD',
    releaseEligible: false,
    host: {
      nodeVersion: actual.nodeVersion,
      platform: actual.platform,
      arch: actual.arch,
      targetTriple,
    },
    toolchain: {
      nativeBuildSea: actual.nativeBuildSea === true,
      legacySeaConfig: actual.legacySeaConfig === true,
      postjectInstalled: typeof actual.postjectPath === 'string',
      signtoolInstalled: typeof actual.signtoolPath === 'string',
    },
    evidence: {
      sourceBundleSmoke: bundleSmokePassed ? 'PASS' : 'NOT_RUN_OR_FAIL',
      sourceBundleArtifact: bundleSmokePassed ? actual.bundleCheck.artifact : null,
      unsignedSeaCreated: binaryPath && existsSync(binaryPath) ? 'OBSERVED' : 'NOT_OBSERVED',
      sha256ManifestAndTamperCheck: manifestCheck.ok ? 'PASS' : 'NOT_RUN_OR_FAIL',
      seaMcpCliParitySmoke: 'NOT_RUN',
      authenticodeSignature: 'NOT_RUN',
      installerExecution: 'NOT_RUN',
    },
    expectedArtifacts: {
      binary: binaryPath ? relative(root, binaryPath).replaceAll('\\', '/') : null,
      sha256Manifest: manifestPath ? relative(root, manifestPath).replaceAll('\\', '/') : null,
    },
    blockers: [...new Set(blockers)],
    sourceBindings,
  };
  return { ...receipt, receiptSha256: receiptSha256(receipt) };
}

export function verifyReadinessReceipt(receipt, { root = scriptRoot } = {}) {
  const errors = [];
  if (receipt?.schema !== RECEIPT_SCHEMA || receipt?.status !== 'HOLD' || receipt?.releaseEligible !== false) errors.push('receipt_contract_invalid');
  if (!SHA256.test(String(receipt?.receiptSha256 ?? '')) || receiptSha256(receipt) !== receipt.receiptSha256) errors.push('receipt_hash_mismatch');
  const bindingPaths = (receipt?.sourceBindings ?? []).map(binding => binding?.path);
  if (JSON.stringify(bindingPaths) !== JSON.stringify(SOURCE_BINDING_PATHS)) errors.push('source_binding_set_invalid');
  for (const binding of receipt?.sourceBindings ?? []) {
    if (!bindingMatches(root, binding)) errors.push(`source_binding_mismatch:${binding.path}`);
  }
  if (receipt?.evidence?.sourceBundleSmoke === 'PASS' && !bindingMatches(root, receipt.evidence.sourceBundleArtifact)) {
    errors.push('source_bundle_artifact_mismatch');
  }
  if (receipt?.evidence?.authenticodeSignature !== 'NOT_RUN' || receipt?.evidence?.installerExecution !== 'NOT_RUN') errors.push('unsubstantiated_release_claim');
  const requiredBlockers = [
    ...(receipt?.evidence?.sourceBundleSmoke === 'PASS' ? [] : ['source_bundle_smoke_not_passed']),
    ...(receipt?.evidence?.unsignedSeaCreated === 'OBSERVED' ? [] : ['unsigned_windows_sea_missing']),
    ...(receipt?.evidence?.sha256ManifestAndTamperCheck === 'PASS' ? [] : ['sha256_manifest_missing']),
    ...(receipt?.evidence?.seaMcpCliParitySmoke === 'PASS' ? [] : ['sea_mcp_cli_parity_smoke_not_run']),
    'authenticode_signature_missing',
    'installer_execution_evidence_missing',
  ];
  const blockerSet = new Set(receipt?.blockers ?? []);
  if (requiredBlockers.some(blocker => !blockerSet.has(blocker))) errors.push('required_blocker_missing');
  return { ok: errors.length === 0, errors };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const receipt = buildReadinessReceipt({ probes: probeWindowsSeaToolchain({ runBundleCheck: process.argv.includes('--run-bundle-check') }) });
  console.log(JSON.stringify(receipt, null, 2));
  if (process.argv.includes('--require-release-ready')) process.exitCode = 1;
}
