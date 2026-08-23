#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const drawing = path.join(root, 'scripts', 'drawing-to-3d');
const repoTmp = path.join(root, '.tmp', 'agent-sidecar');
const binaryDir = path.join(root, 'src-tauri', 'binaries');
const args = new Set(process.argv.slice(2));
const mode = args.has('--build') ? 'build' : 'check';

function hostTriple() {
  const rust = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  const line = rust.status === 0 ? rust.stdout.split(/\r?\n/).find((v) => v.startsWith('host:')) : '';
  const triple = line?.slice(5).trim();
  if (triple) return triple;
  const table = { 'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc', 'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin', 'linux-x64': 'x86_64-unknown-linux-gnu', 'linux-arm64': 'aarch64-unknown-linux-gnu' };
  return table[`${process.platform}-${process.arch}`];
}

function hasBuildSea() {
  const result = spawnSync(process.execPath, ['--help'], { encoding: 'utf8' });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.includes('--build-sea');
}

function assertInputs(triple) {
  if (!triple) throw new Error('agent-sidecar target triple could not be determined');
  for (const file of ['agent-sidecar-entry.mjs', 'installer-core-agent-server.mjs', 'std-catalog.json', 'detail-calibration.json']) {
    if (!fs.existsSync(path.join(drawing, file))) throw new Error(`agent-sidecar required file missing: ${file}`);
  }
  if (!fs.existsSync(path.join(root, 'scripts', 'mcp-stdio-transport.mjs'))) throw new Error('agent-sidecar shared MCP transport is missing');
  if (!fs.existsSync(path.join(root, 'node_modules', 'esbuild'))) throw new Error('agent-sidecar requires installed esbuild');
}

async function makeBundle(work) {
  // Source-mode smoke runs beside the generated bundle; SEA mode embeds these
  // same bytes under the manifest names below.
  for (const asset of ['std-catalog.json', 'detail-calibration.json']) fs.copyFileSync(path.join(drawing, asset), path.join(work, asset));
  const { tools: sourceTools } = await import(pathToFileURL(path.join(drawing, 'mcp-server.mjs')).href);
  const installerNames = new Set(['list_domains', 'build_assembly', 'analyze_dfm', 'fab_estimate', 'resolve_constraints', 'render_preview', 'blade_ring', 'loft_part']);
  const installerTools = sourceTools.filter((tool) => installerNames.has(tool.name));
  if (installerTools.length !== installerNames.size) throw new Error('agent-sidecar source schema set is incomplete');
  const bundle = path.join(work, 'agent-gateway.cjs');
  await build({
    entryPoints: [path.join(drawing, 'agent-sidecar-entry.mjs')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    banner: { js: 'globalThis.__dirname = __dirname;' },
    define: { __NEXYFAB_INSTALLER_CORE_TOOLS__: JSON.stringify(installerTools) },
    external: ['./mcp-server.mjs'],
    sourcemap: false,
    logLevel: 'silent',
  });
  return bundle;
}

function runSmoke(bundle) {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_domains', arguments: {} } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_domains', arguments: { unexpected: true } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'build_assembly', arguments: { assembly: { name: 'sidecar-smoke', parts: [{ id: 'box', type: 'box', params: { width: 10, depth: 10, height: 10 }, at: { tx: 0, ty: 0, tz: 0 } }] } } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'render_preview', arguments: { assembly: { name: 'sidecar-smoke', parts: [] }, outDir: path.join(root, '.tmp', 'agent-sidecar-render') } } },
  ];
  const oversized = `{"jsonrpc":"2.0","id":90,"method":"ping","padding":"${'x'.repeat(1_100_000)}"}`;
  const recovery = { jsonrpc: '2.0', id: 6, method: 'ping' };
  const result = spawnSync(process.execPath, [bundle], {
    cwd: root,
    env: { ...process.env, NEXYFAB_AGENT_RUNTIME_PROFILE: 'installer-core', NEXYFAB_AGENT_SCOPE: 'apply', NEXYFAB_PROJECT_ROOT: root },
    input: `${requests.map((v) => JSON.stringify(v)).join('\n')}\n${oversized}\r\n${JSON.stringify(recovery)}\n`,
    encoding: 'utf8', timeout: 20_000, maxBuffer: 20_000_000,
  });
  if (result.status !== 0) throw new Error(`agent-sidecar smoke exited ${result.status}: ${String(result.stderr ?? '').slice(0, 500)}`);
  const responses = String(result.stdout).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const list = responses.find((v) => v.id === 2)?.result?.tools ?? [];
  const names = list.map((v) => v.name).sort();
  const expected = ['analyze_dfm', 'blade_ring', 'build_assembly', 'fab_estimate', 'list_domains', 'loft_part', 'render_preview', 'resolve_constraints'].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('agent-sidecar smoke tool profile mismatch');
  if (list.some((tool) => !tool.inputSchema || (tool.name !== 'list_domains' && Object.keys(tool.inputSchema.properties ?? {}).length === 0))) throw new Error('agent-sidecar smoke found an empty tool schema');
  if (!responses.find((v) => v.id === 3)?.result?.isError) throw new Error('agent-sidecar strict schema validation was bypassed');
  if (responses.find((v) => v.id === 4)?.result?.isError) throw new Error('agent-sidecar representative tool call failed');
  const pathDenial = responses.find((v) => v.id === 5)?.result;
  if (!pathDenial?.isError || !String(pathDenial.content?.[0]?.text ?? '').includes('SCOPE_REQUIRED')) throw new Error('agent-sidecar dynamic export scope policy was bypassed');
  const oversizedResponses = responses.filter((v) => v.id === null && v.error?.message === 'request too large');
  if (oversizedResponses.length !== 1 || !responses.some((v) => v.id === 6 && v.result)) throw new Error('agent-sidecar bounded framing recovery failed');
  if (responses.some((v) => v.id === undefined)) throw new Error('agent-sidecar answered an id-less request');
  const orderedIds = responses.map((v) => v.id).filter((id) => id !== null);
  if (JSON.stringify(orderedIds) !== JSON.stringify([1, 2, 3, 4, 5, 6])) throw new Error('agent-sidecar response ordering changed');

  const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
  const modernRequests = [
    { jsonrpc: '2.0', id: 10, method: 'server/discover', params: { _meta: { ...modernMeta, 'io.modelcontextprotocol/clientInfo': { name: 'sidecar-smoke', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } } },
    { jsonrpc: '2.0', id: 11, method: 'tools/list', params: { _meta: modernMeta } },
    { jsonrpc: '2.0', id: 12, method: 'ping' },
    { jsonrpc: '2.0', id: 13, method: 'ping', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } },
  ];
  const modern = spawnSync(process.execPath, [bundle], { cwd: root, env: { ...process.env, NEXYFAB_AGENT_SCOPE: 'read' }, input: `${modernRequests.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', timeout: 20_000, maxBuffer: 20_000_000 });
  if (modern.status !== 0) throw new Error(`agent-sidecar modern smoke exited ${modern.status}: ${String(modern.stderr ?? '').slice(0, 500)}`);
  const modernResponses = String(modern.stdout).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (modernResponses.find((v) => v.id === 10)?.result?.supportedVersions?.[0] !== '2026-07-28') throw new Error('agent-sidecar modern discovery failed');
  if (modernResponses.find((v) => v.id === 11)?.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name !== 'nexyfab-agent-gateway') throw new Error('agent-sidecar modern result metadata missing');
  if (modernResponses.find((v) => v.id === 12)?.error?.code !== -32602) throw new Error('agent-sidecar modern protocol pinning failed');
  const unsupported = modernResponses.find((v) => v.id === 13);
  if (unsupported?.error?.code !== -32022 || unsupported?.error?.data?.requested !== '2099-01-01' || unsupported?._meta !== undefined) throw new Error('agent-sidecar unsupported protocol error changed');
}

async function main() {
  const triple = hostTriple();
  assertInputs(triple);
  fs.rmSync(repoTmp, { recursive: true, force: true });
  fs.mkdirSync(repoTmp, { recursive: true });
  const bundle = await makeBundle(repoTmp);
  runSmoke(bundle);
  const output = path.join(binaryDir, `nexyfab-agent-gateway-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
  if (mode === 'check') {
    console.log(JSON.stringify({ ok: true, mode, targetTriple: triple, bundle, profile: 'installer-core', assets: ['std-catalog.json', 'detail-calibration.json'], output }));
    return;
  }
  if (!hasBuildSea()) {
    throw new Error('NexyFab agent sidecar requires Node >=25.5 with --build-sea; current Node does not provide --build-sea. No binary was created.');
  }
  fs.mkdirSync(binaryDir, { recursive: true });
  const configPath = path.join(repoTmp, 'sea-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ main: bundle, output, disableExperimentalSEAWarning: true, assets: { 'std-catalog.json': path.join(drawing, 'std-catalog.json'), 'detail-calibration.json': path.join(drawing, 'detail-calibration.json') } }, null, 2));
  const result = spawnSync(process.execPath, ['--build-sea', configPath], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`NexyFab agent sidecar SEA build failed (${result.status})`);
  console.log(JSON.stringify({ ok: true, mode, targetTriple: triple, output, profile: 'installer-core' }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
