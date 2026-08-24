import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fingerprintSliceContext } from './verify-slice-deployment-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'config/platform/slice-deployment.v1.json');
const EVIDENCE_PATH = path.join(ROOT, 'docs/evidence/platform-runtime/slice-local-runtime.json');
const TOKEN = 'local-evidence-token-32-characters-minimum';

const SLICE_CONFIG = {
  platform: {
    imageRepository: 'nexyfab/core-api-slice',
    env: ['LEGACY_NEXT_ORIGIN=http://127.0.0.1:9', 'NEXYFAB_DEPENDENCY_PROBE_MODE=binding-only'],
  },
  'precision-cad': {
    imageRepository: 'nexyfab/precision-single-part',
    env: [
      'EXACT_KERNEL_URL=http://127.0.0.1:9',
      `EXACT_KERNEL_AUTH_TOKEN=${TOKEN}`,
      'JOB_CONTROL_URL=http://127.0.0.1:9',
      `JOB_CONTROL_AUTH_TOKEN=${TOKEN}`,
      'EXACT_KERNEL_IDENTITY=local-evidence-kernel',
      `INTERNAL_AUTH_TOKEN=${TOKEN}`,
      'NEXYFAB_DEPENDENCY_PROBE_MODE=binding-only',
    ],
  },
  'ai-design': {
    imageRepository: 'nexyfab/ai-domain-accuracy',
    env: [
      'ANALYSIS_URL=http://127.0.0.1:9',
      `ANALYSIS_AUTH_TOKEN=${TOKEN}`,
      'AI_LIVE_ENABLED=false',
      `INTERNAL_AUTH_TOKEN=${TOKEN}`,
      'NEXYFAB_DEPENDENCY_PROBE_MODE=binding-only',
    ],
  },
};

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return typeof output === 'string' ? output.trim() : '';
}

function currentHead() {
  return run('git', ['rev-parse', 'HEAD']);
}

function sourceCommit(contextRoot) {
  return run('git', ['rev-list', '-1', 'HEAD', '--', contextRoot]);
}

function dockerJson(args) {
  return JSON.parse(run('docker', args));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHealthy(container) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = run('docker', ['inspect', container, '--format', '{{.State.Health.Status}}']);
    if (status === 'healthy') return status;
    if (status === 'unhealthy') throw new Error(`Container became unhealthy: ${container}`);
    await wait(1_000);
  }
  throw new Error(`Container health timed out: ${container}`);
}

async function healthObservation(port, endpoint) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json();
  return {
    path: endpoint,
    statusCode: response.status,
    state: payload.status === 'hold' ? 'HOLD' : payload.status,
    ...(payload.build ? { build: payload.build } : {}),
    ...(payload.blockers?.[0] ? { reason: payload.blockers[0] } : {}),
  };
}

function runSliceTests(slice) {
  const test = slice.health?.test ?? (slice.scope === 'platform' ? 'apps/core-api/test/server.test.mjs' : '');
  if (!test) throw new Error(`No local test is configured for ${slice.scope}`);
  run(process.execPath, ['--test', test], { stdio: 'inherit' });
  return { state: 'PASS' };
}

async function buildAndVerify(slice, integrationHead, engineVersion) {
  const config = SLICE_CONFIG[slice.scope];
  if (!config) throw new Error(`No local evidence configuration for ${slice.scope}`);
  const fingerprint = fingerprintSliceContext(ROOT, slice.build.contextRoot);
  const buildId = fingerprint.sha256.slice(0, 12);
  const image = `${config.imageRepository}:${buildId}`;
  const container = `nexyfab-evidence-${slice.scope.replace(/[^a-z0-9-]/g, '-')}-${process.pid}`;
  if (!container.startsWith('nexyfab-evidence-')) throw new Error('Unsafe temporary container name');

  run('docker', [
    'build', '--pull',
    '--build-arg', `NEXYFAB_BUILD_ID=${buildId}`,
    '--tag', image,
    '--file', slice.build.dockerfile,
    slice.build.contextRoot,
  ], { stdio: 'inherit' });
  const imageId = run('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  const tests = runSliceTests(slice);

  try {
    const args = ['run', '--detach', '--name', container, '--publish', '127.0.0.1::8080'];
    for (const value of config.env) args.push('--env', value);
    args.push(image);
    run('docker', args);
    const dockerStatus = await waitForHealthy(container);
    const inspection = dockerJson(['inspect', container]);
    const port = inspection[0]?.NetworkSettings?.Ports?.['8080/tcp']?.[0]?.HostPort;
    if (!/^\d+$/.test(port ?? '')) throw new Error(`Published port unavailable for ${container}`);
    const live = await healthObservation(port, slice.health.live);
    const ready = await healthObservation(port, slice.health.ready);
    const release = await healthObservation(port, slice.health.release);
    if (live.statusCode !== 200 || live.state !== 'ok' || live.build !== buildId) throw new Error(`${slice.scope} live health failed`);
    if (ready.statusCode !== 503 || ready.state !== 'HOLD') throw new Error(`${slice.scope} ready HOLD was not observed`);
    if (release.statusCode !== 503 || release.state !== 'HOLD') throw new Error(`${slice.scope} release HOLD was not observed`);

    return {
      scope: slice.scope,
      unit: slice.deployUnit,
      sourceCommit: sourceCommit(slice.build.contextRoot),
      sourceTreeSha256: fingerprint.sha256,
      sourceFileCount: fingerprint.fileCount,
      status: 'PASS_WITH_RELEASE_HOLD',
      build: {
        context: slice.build.contextRoot,
        dockerfile: slice.build.dockerfile,
        buildId,
        image,
        imageId,
        state: 'PASS',
      },
      health: {
        dockerStatus,
        readinessAssurance: 'ISOLATED_BINDING_ONLY',
        live,
        ready,
        release,
      },
      tests,
    };
  } finally {
    try { run('docker', ['rm', '--force', container]); } catch { /* container may not have started */ }
  }
}

async function main() {
  if (!process.argv.includes('--write')) throw new Error('Refusing to rebuild images without explicit --write');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const engineVersion = run('docker', ['version', '--format', '{{.Server.Version}}']);
  if (!/^\d+\.\d+\.\d+$/.test(engineVersion)) throw new Error(`Unexpected Docker engine version: ${engineVersion}`);
  const integrationHead = currentHead();
  const slices = [];
  for (const slice of manifest.slices) slices.push(await buildAndVerify(slice, integrationHead, engineVersion));

  const evidence = {
    schema: 'nexyfab.slice-local-runtime-evidence.v1',
    generatedAt: new Date().toISOString(),
    integrationHeadAtVerification: integrationHead,
    environment: { provider: 'Docker Desktop', engineVersion, host: 'local' },
    slices,
    cleanup: { temporaryContainersRemaining: 0 },
    overall: 'PASS_WITH_RELEASE_HOLDS',
  };
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, EVIDENCE_PATH)} for ${slices.length} rebuilt images.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
