import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const checks = [
  {
    id: 'core-api-contract',
    args: ['--test', '--test-isolation=none', 'apps/core-api/test/server.test.mjs'],
  },
  {
    id: 'platform-workers',
    args: [
      'node_modules/vitest/vitest.mjs', 'run',
      'workers/edge-gateway/src/index.test.ts',
      'workers/job-orchestrator/src/core.test.ts',
      'workers/job-orchestrator/src/ledger.test.ts',
      'workers/job-orchestrator/src/commercial.test.ts',
      '--reporter=dot',
    ],
  },
  { id: 'collaboration-relay', args: ['--test', 'collab-worker/server.test.js'] },
  { id: 'openscad-worker', args: ['services/openscad-worker/server.test.mjs'] },
  {
    id: 'fea-worker',
    args: [
      'node_modules/vitest/vitest.mjs', 'run',
      '--config', 'services/fea-worker/vitest.config.mts',
      '--reporter=dot',
    ],
  },
  { id: 'platform-architecture', args: ['scripts/platform/validate-platform-architecture.mjs'] },
  { id: 'route-security-matrix', args: ['scripts/build-route-security-matrix.mjs'] },
  { id: 'versioned-candidate-secret-scan', args: ['scripts/scan-secrets.mjs'] },
];

export function runPlatformQuality() {
  const results = [];
  for (const check of checks) {
    const startedAt = Date.now();
    process.stdout.write(`\n[platform-quality] ${check.id}\n`);
    const result = spawnSync(process.execPath, check.args, {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'inherit',
      windowsHide: true,
    });
    results.push({
      id: check.id,
      status: result.status === 0 && !result.error ? 'PASS' : 'FAIL',
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      durationMs: Date.now() - startedAt,
    });
  }
  const report = {
    schema: 'nexyfab.platform-quality.v1',
    ok: results.every(result => result.status === 'PASS'),
    results,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = runPlatformQuality();
  if (!report.ok) process.exitCode = 1;
}
