#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachReceiptSha256, canonicalJson, SHA256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

export const AGENT_MCP_CLI_LOCAL_READINESS_SCHEMA = 'nexyfab.agent-mcp-cli-local-readiness.v1';
export const DEFAULT_AGENT_MCP_CLI_LOCAL_RECEIPT = 'docs/evidence/local/agent-mcp-cli-readiness-current.json';
// Keep the raw command results beside the receipt so an exported RC can
// independently re-verify every binding. `.tmp` is intentionally excluded
// from clean release snapshots and therefore cannot be an evidence authority.
export const DEFAULT_AGENT_MCP_CLI_RESULT_DIR = 'docs/evidence/local/agent-mcp-cli-runtime-current';

const VITEST_FILES = Object.freeze([
  'scripts/agent-mcp-cli-runtime-parity.test.ts',
  'scripts/mcp-stdio-transport.test.ts',
  'scripts/drawing-to-3d/agent-mcp-server.test.ts',
  'scripts/drawing-to-3d/capability-surface-manifest.test.ts',
  'scripts/drawing-to-3d/cad-v1-mcp.test.ts',
  'scripts/drawing-to-3d/downloadable-mcp.test.ts',
  'scripts/drawing-to-3d/mcp-package-publish.test.ts',
  'scripts/drawing-to-3d/mcp-honesty.test.ts',
  'scripts/cli/nexyfab.test.ts',
]);

export const AGENT_MCP_CLI_COMMAND_SPECS = Object.freeze([
  Object.freeze({
    id: 'focused_mcp_cli_parity',
    args: ['node_modules/vitest/vitest.mjs', 'run', ...VITEST_FILES, '--reporter=dot'],
    timeoutMs: 120_000,
  }),
  Object.freeze({
    id: 'cli_offline_subprocess_roundtrip',
    args: ['--test', 'scripts/cli/nexyfab.roundtrip.test.mjs'],
    timeoutMs: 30_000,
  }),
  Object.freeze({
    id: 'agent_sidecar_source_bundle_check',
    args: ['scripts/build-agent-sidecar.mjs', '--check'],
    timeoutMs: 60_000,
  }),
  Object.freeze({
    id: 'windows_sea_fail_closed_contract',
    args: [
      '--test',
      'scripts/agent-sidecar/windows-sea-readiness.test.mjs',
      'scripts/agent-sidecar/windows-sea-release-evidence.test.mjs',
    ],
    timeoutMs: 60_000,
  }),
]);

export const AGENT_MCP_CLI_SOURCE_PATHS = Object.freeze([
  'package.json',
  'scripts/build-agent-mcp-cli-local-readiness.mjs',
  'scripts/build-agent-sidecar.mjs',
  'scripts/agent-sidecar/windows-sea-readiness.mjs',
  'scripts/agent-sidecar/windows-sea-release-evidence.mjs',
  'scripts/drawing-to-3d/capability-surface-manifest.mjs',
  'scripts/drawing-to-3d/agent-mcp-server.mjs',
  'scripts/drawing-to-3d/installer-core-agent-server.mjs',
  'scripts/cli/nexyfab.mjs',
  'public/downloads/nexyfab-mcp.mjs',
  ...VITEST_FILES,
  'scripts/cli/nexyfab.roundtrip.test.mjs',
  'scripts/agent-sidecar/windows-sea-readiness.test.mjs',
  'scripts/agent-sidecar/windows-sea-release-evidence.test.mjs',
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeExistingFile(root, file) {
  if (!nonEmpty(file) || path.isAbsolute(file)) throw new Error('unsafe_source_path');
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, file);
  if (!inside(resolvedRoot, absolute)) throw new Error('unsafe_source_path');
  const realRoot = fs.realpathSync.native(resolvedRoot);
  let cursor = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('source_symlink_not_allowed');
  }
  const realFile = fs.realpathSync.native(absolute);
  if (!inside(realRoot, realFile) || !fs.statSync(realFile).isFile()) throw new Error('unsafe_source_path');
  return { absolute: realFile, relative: path.relative(resolvedRoot, absolute).replaceAll('\\', '/') };
}

function safeOutput(root, file) {
  if (!nonEmpty(file) || path.isAbsolute(file)) throw new Error('unsafe_output_path');
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, file);
  if (!inside(resolvedRoot, absolute)) throw new Error('unsafe_output_path');
  let cursor = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, path.dirname(absolute)).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('output_parent_symlink_not_allowed');
  }
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) throw new Error('output_symlink_not_allowed');
  return absolute;
}

function fileBinding(root, file) {
  const safe = safeExistingFile(root, file);
  const bytes = fs.readFileSync(safe.absolute);
  return {
    path: safe.relative,
    bytes: bytes.byteLength,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function bindingsValid(root, bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) return false;
  const seen = new Set();
  try {
    return bindings.every(binding => {
      if (!nonEmpty(binding?.path) || seen.has(binding.path)
        || !Number.isSafeInteger(binding?.bytes) || binding.bytes <= 0
        || !SHA256.test(String(binding?.sha256 ?? ''))) return false;
      seen.add(binding.path);
      return canonicalJson(fileBinding(root, binding.path)) === canonicalJson(binding);
    });
  } catch {
    return false;
  }
}

function defaultRunner(root, spec) {
  const result = spawnSync(process.execPath, [...spec.args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    timeout: spec.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    exitCode: result.status,
    signal: result.signal,
    error: result.error ? String(result.error.message ?? result.error) : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function commandPassed(result) {
  return result?.exitCode === 0 && result?.signal === null && result?.error === null;
}

function writeCommandArtifact(root, outputDir, spec, result, generatedAt) {
  const relative = `${outputDir.replaceAll('\\', '/')}/${spec.id}.json`;
  const absolute = safeOutput(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const artifact = {
    schema: 'nexyfab.agent-mcp-cli-local-command-result.v1',
    generatedAt,
    id: spec.id,
    command: { executable: 'node', args: [...spec.args], timeoutMs: spec.timeoutMs },
    exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
    signal: result?.signal ?? null,
    error: result?.error ?? null,
    stdout: typeof result?.stdout === 'string' ? result.stdout : '',
    stderr: typeof result?.stderr === 'string' ? result.stderr : '',
  };
  fs.writeFileSync(absolute, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return { artifact, binding: fileBinding(root, relative) };
}

function readExternalSeaReceipt(root, externalReceiptPath) {
  try {
    const safe = safeExistingFile(root, externalReceiptPath);
    return JSON.parse(fs.readFileSync(safe.absolute, 'utf8'));
  } catch {
    return null;
  }
}

export function buildAgentMcpCliLocalReadiness({
  root = process.cwd(),
  outputDir = DEFAULT_AGENT_MCP_CLI_RESULT_DIR,
  receiptPath = DEFAULT_AGENT_MCP_CLI_LOCAL_RECEIPT,
  sourcePaths = AGENT_MCP_CLI_SOURCE_PATHS,
  externalReceiptPath = 'docs/evidence/release/windows-agent-sidecar-release-receipt.json',
  generatedAt = new Date().toISOString(),
  runner = defaultRunner,
  write = true,
} = {}) {
  const sourceInventory = [...new Set(sourcePaths)];
  const receiptAbsolute = safeOutput(root, receiptPath);
  for (const spec of AGENT_MCP_CLI_COMMAND_SPECS) {
    safeOutput(root, `${outputDir.replaceAll('\\', '/')}/${spec.id}.json`);
  }
  const commandRecords = AGENT_MCP_CLI_COMMAND_SPECS.map(spec => {
    let result;
    try { result = runner(path.resolve(root), spec); } catch (error) {
      result = { exitCode: null, signal: null, error: error instanceof Error ? error.message : String(error), stdout: '', stderr: '' };
    }
    return writeCommandArtifact(root, outputDir, spec, result, generatedAt);
  });
  const blockers = commandRecords
    .filter(record => !commandPassed(record.artifact))
    .map(record => `local_command_failed:${record.artifact.id}`);
  const sourceBindings = [];
  for (const sourcePath of sourceInventory) {
    try { sourceBindings.push(fileBinding(root, sourcePath)); } catch { blockers.push(`source_binding_missing:${sourcePath}`); }
  }
  let externalReceiptBinding = null;
  try {
    externalReceiptBinding = fileBinding(root, externalReceiptPath);
    if (!sourceBindings.some(binding => binding.path === externalReceiptBinding.path)) sourceBindings.push(externalReceiptBinding);
  } catch { /* External SEA evidence is intentionally not a local-readiness prerequisite. */ }
  sourceBindings.push(...commandRecords.map(record => record.binding));
  const externalReceipt = readExternalSeaReceipt(root, externalReceiptPath);
  const localReady = blockers.length === 0;
  const receipt = attachReceiptSha256({
    schema: AGENT_MCP_CLI_LOCAL_READINESS_SCHEMA,
    generatedAt,
    status: localReady ? 'PASS_LOCAL' : 'HOLD',
    localReady,
    commercialReleaseEligible: false,
    commandResults: commandRecords.map(record => ({
      id: record.artifact.id,
      status: commandPassed(record.artifact) ? 'PASSED_LOCAL' : 'FAILED_OR_NOT_RUN',
      evidence: record.binding,
    })),
    capabilityBoundary: {
      testedLocalMcpCliParity: localReady,
      certifiesExternalWindowsSea: false,
      certifiesAuthenticode: false,
      certifiesInstallerLifecycle: false,
    },
    sourceInventory,
    externalWindowsSea: {
      status: 'HOLD',
      releaseEligible: false,
      authority: externalReceiptPath,
      evidence: externalReceiptBinding,
      observedReceiptStatus: externalReceipt?.status ?? 'MISSING',
      observedReleaseEligible: externalReceipt?.releaseEligible === true,
      observedReceiptSha256: SHA256.test(String(externalReceipt?.receiptSha256 ?? '')) ? externalReceipt.receiptSha256 : null,
      blockers: Array.isArray(externalReceipt?.blockers) ? externalReceipt.blockers : ['external_windows_sea_receipt_missing'],
    },
    sourceBindings,
    blockers,
  });
  if (write) {
    fs.mkdirSync(path.dirname(receiptAbsolute), { recursive: true });
    fs.writeFileSync(receiptAbsolute, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }
  return receipt;
}

export function verifyAgentMcpCliLocalReadiness(receipt, {
  root = process.cwd(),
  requiredSourcePaths = AGENT_MCP_CLI_SOURCE_PATHS,
  externalReceiptPath = 'docs/evidence/release/windows-agent-sidecar-release-receipt.json',
} = {}) {
  try {
    const expectedInventory = [...new Set(requiredSourcePaths)];
    if (receipt?.schema !== AGENT_MCP_CLI_LOCAL_READINESS_SCHEMA
      || !verifyReceiptSha256(receipt)
      || !bindingsValid(root, receipt.sourceBindings)
      || canonicalJson(receipt.sourceInventory) !== canonicalJson(expectedInventory)
      || receipt.commercialReleaseEligible !== false
      || receipt?.externalWindowsSea?.status !== 'HOLD'
      || receipt.externalWindowsSea.releaseEligible !== false
      || receipt.externalWindowsSea.authority !== externalReceiptPath
      || receipt?.capabilityBoundary?.certifiesExternalWindowsSea !== false
      || receipt.capabilityBoundary.certifiesAuthenticode !== false
      || receipt.capabilityBoundary.certifiesInstallerLifecycle !== false
      || !Array.isArray(receipt.commandResults)
      || receipt.commandResults.length !== AGENT_MCP_CLI_COMMAND_SPECS.length) return false;
    const bindingMap = new Map(receipt.sourceBindings.map(binding => [binding.path, binding]));
    const expectedBlockers = [];
    const commandEvidencePaths = new Set();
    const commandStates = AGENT_MCP_CLI_COMMAND_SPECS.map(spec => {
      const summary = receipt.commandResults.find(item => item?.id === spec.id);
      const binding = summary?.evidence;
      if (!binding || canonicalJson(bindingMap.get(binding.path)) !== canonicalJson(binding)) return null;
      commandEvidencePaths.add(binding.path);
      const artifact = JSON.parse(fs.readFileSync(path.resolve(root, binding.path), 'utf8'));
      const structurallyValid = artifact?.schema === 'nexyfab.agent-mcp-cli-local-command-result.v1'
        && artifact.id === spec.id
        && canonicalJson(artifact.command) === canonicalJson({ executable: 'node', args: [...spec.args], timeoutMs: spec.timeoutMs })
        && artifact.generatedAt === receipt.generatedAt;
      if (!structurallyValid) return null;
      const passed = commandPassed(artifact);
      if (summary.status !== (passed ? 'PASSED_LOCAL' : 'FAILED_OR_NOT_RUN')) return null;
      if (!passed) expectedBlockers.push(`local_command_failed:${spec.id}`);
      return passed;
    });
    if (commandStates.includes(null)
      || new Set(receipt.commandResults.map(item => item?.id)).size !== AGENT_MCP_CLI_COMMAND_SPECS.length) return false;

    const expectedSourceBindingPaths = new Set();
    for (const sourcePath of expectedInventory) {
      try {
        const expected = fileBinding(root, sourcePath);
        expectedSourceBindingPaths.add(expected.path);
        if (canonicalJson(bindingMap.get(expected.path)) !== canonicalJson(expected)) return false;
      } catch {
        expectedBlockers.push(`source_binding_missing:${sourcePath}`);
      }
    }
    const expectedBindingPaths = new Set([...expectedSourceBindingPaths, ...commandEvidencePaths]);
    const externalReceipt = readExternalSeaReceipt(root, externalReceiptPath);
    let expectedExternalBinding = null;
    try {
      expectedExternalBinding = fileBinding(root, externalReceiptPath);
      expectedBindingPaths.add(expectedExternalBinding.path);
      if (canonicalJson(bindingMap.get(expectedExternalBinding.path)) !== canonicalJson(expectedExternalBinding)) return false;
    } catch { /* Missing external evidence is represented below and never promoted. */ }
    if (bindingMap.size !== expectedBindingPaths.size
      || [...bindingMap.keys()].some(bindingPath => !expectedBindingPaths.has(bindingPath))) return false;
    const expectedExternal = {
      status: 'HOLD',
      releaseEligible: false,
      authority: externalReceiptPath,
      evidence: expectedExternalBinding,
      observedReceiptStatus: externalReceipt?.status ?? 'MISSING',
      observedReleaseEligible: externalReceipt?.releaseEligible === true,
      observedReceiptSha256: SHA256.test(String(externalReceipt?.receiptSha256 ?? '')) ? externalReceipt.receiptSha256 : null,
      blockers: Array.isArray(externalReceipt?.blockers) ? externalReceipt.blockers : ['external_windows_sea_receipt_missing'],
    };
    if (canonicalJson(receipt.externalWindowsSea) !== canonicalJson(expectedExternal)
      || canonicalJson(receipt.blockers) !== canonicalJson(expectedBlockers)) return false;
    const expectedLocalReady = commandStates.every(Boolean) && expectedBlockers.length === 0;
    return receipt.localReady === expectedLocalReady
      && receipt.status === (expectedLocalReady ? 'PASS_LOCAL' : 'HOLD')
      && receipt.capabilityBoundary.testedLocalMcpCliParity === expectedLocalReady;
  } catch {
    return false;
  }
}

function option(args, name, fallback = null) {
  const inline = args.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

export function main(args = process.argv.slice(2)) {
  const root = path.resolve(option(args, 'root', process.cwd()));
  const receiptPath = option(args, 'out', DEFAULT_AGENT_MCP_CLI_LOCAL_RECEIPT);
  if (args.includes('--check')) {
    const safe = safeExistingFile(root, receiptPath);
    const receipt = JSON.parse(fs.readFileSync(safe.absolute, 'utf8'));
    const integrityOk = verifyAgentMcpCliLocalReadiness(receipt, { root });
    const localReady = integrityOk && receipt.localReady === true && receipt.status === 'PASS_LOCAL';
    process.stdout.write(`${JSON.stringify({ integrityOk, localReady, status: receipt.status, receipt: safe.relative })}\n`);
    return localReady ? 0 : 1;
  }
  const receipt = buildAgentMcpCliLocalReadiness({
    root,
    outputDir: option(args, 'result-dir', DEFAULT_AGENT_MCP_CLI_RESULT_DIR),
    receiptPath,
  });
  process.stdout.write(`${JSON.stringify({
    ok: receipt.localReady,
    status: receipt.status,
    commercialReleaseEligible: receipt.commercialReleaseEligible,
    receipt: receiptPath,
    blockers: receipt.blockers,
  })}\n`);
  return receipt.localReady ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    process.stderr.write(`[agent-mcp-cli-local-readiness] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
