#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const service = arg('service', 'nexyfab.com');
const environment = arg('environment', 'production');
const site = arg('site', 'https://nexyfab.com');
const expectedBuildId = arg('expected-build-id', process.env.NEXYFAB_EXPECTED_BUILD_ID || '');
const timeoutMs = Number(arg('timeout-ms', '1200000'));
const sourcePath = arg('source', '.');
const pathAsRoot = process.argv.includes('--path-as-root');
const verifyOnly = process.argv.includes('--verify-only');
const windowsRailwayCli = process.platform === 'win32' && process.env.APPDATA
  ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.js')
  : '';
const railwayCommand = windowsRailwayCli && existsSync(windowsRailwayCli) ? process.execPath : 'railway';
const railwayPrefixArgs = windowsRailwayCli && existsSync(windowsRailwayCli) ? [windowsRailwayCli] : [];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, shell: false, ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; if (options.stream) process.stdout.write(chunk); });
    child.stderr?.on('data', chunk => { stderr += chunk; if (options.stream) process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stderr || stdout}`)));
  });
}

function runRailway(args, options = {}) {
  return run(railwayCommand, [...railwayPrefixArgs, ...args], options);
}

function deploymentRows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['deployments', 'items', 'data']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function deploymentId(row) {
  return row?.id || row?.deploymentId || row?.deployment?.id;
}

function deploymentStatus(row) {
  return String(row?.status || row?.latestStatus || row?.deployment?.status || '').toUpperCase();
}

async function list() {
  const result = await runRailway(['deployment', 'list', '--service', service, '--environment', environment, '--limit', '20', '--json']);
  return deploymentRows(JSON.parse(result.stdout));
}

async function healthCheck() {
  if (!site || site === 'none') return;
  const url = `${site.replace(/\/$/, '')}/api/health/live`;
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`health check ${url} returned ${response.status}`);
  const body = await response.json();
  if (body?.ok === false || body?.status === 'error') throw new Error(`health check reports failure: ${JSON.stringify(body)}`);
  const liveBuildId = String(body?.buildId || body?.build || body?.release || '');
  if (expectedBuildId && liveBuildId !== expectedBuildId) {
    throw new Error(`live build ID mismatch: expected=${expectedBuildId} actual=${liveBuildId || '(missing)'}`);
  }
  console.log(JSON.stringify({ event: 'health-verified', url, liveBuildId: liveBuildId || null }));
}

const before = await list();
const beforeIds = new Set(before.map(deploymentId).filter(Boolean));

if (!verifyOnly) {
  const upArgs = ['up', sourcePath, '--detach', '--json', '--service', service, '--environment', environment, '--message', `verified deploy ${new Date().toISOString()}`];
  if (pathAsRoot) upArgs.splice(2, 0, '--path-as-root');
  await runRailway(upArgs, { stream: true });
}

const deadline = Date.now() + timeoutMs;
let targetId = verifyOnly ? deploymentId(before[0]) : null;
while (Date.now() < deadline) {
  const rows = await list();
  if (!targetId) targetId = deploymentId(rows.find(row => !beforeIds.has(deploymentId(row))));
  const target = rows.find(row => deploymentId(row) === targetId);
  const status = deploymentStatus(target);
  console.log(JSON.stringify({ event: 'deployment-status', service, deploymentId: targetId, status: status || 'PENDING' }));
  if (['FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
    if (targetId) await runRailway(['logs', targetId, '--service', service, '--environment', environment, '--lines', '200']).then(result => process.stderr.write(result.stdout)).catch(() => undefined);
    throw new Error(`deployment ${targetId ?? '(unknown)'} ended in ${status}`);
  }
  if (['SUCCESS', 'ACTIVE'].includes(status)) {
    await healthCheck();
    console.log(JSON.stringify({ event: 'deployment-verified', service, deploymentId: targetId, status }));
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
throw new Error(`deployment verification timed out after ${timeoutMs}ms (deployment=${targetId ?? 'unknown'})`);
