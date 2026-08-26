import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const NODE_TESTS = [
  'apps/core-api/test/server.test.mjs',
  'collab-worker/server.test.js',
  'services/openscad-worker/server.test.mjs',
  'scripts/deploy-railway-verified.test.mjs',
  'scripts/package-release-health-evidence.test.mjs',
  'scripts/platform/verify-ci-migration-contract.test.mjs',
  'scripts/platform/validate-platform-architecture.test.mjs',
  'scripts/platform/evaluate-runtime-placement-readiness.test.mjs',
  'scripts/platform/verify-slice-deployment-readiness.test.mjs',
  'scripts/platform/verify-slice-rollback-evidence.test.mjs',
  'scripts/verify-deployment-source.test.mjs',
];

const VITEST_TESTS = [
  'containers/fea/src/executor.test.ts',
  'containers/ifc-step/src/executor.test.ts',
  'containers/native-fallback/src/router.test.ts',
  'containers/occt-exact/src/executor.test.ts',
  'containers/occt-xcaf/src/server.test.ts',
  'containers/occt-xcaf/src/staticContract.test.ts',
  'containers/occt-xcaf/src/workerClient.test.ts',
  'containers/openscad/src/executor.test.ts',
  'containers/runtime/src/computeService.test.ts',
  'packages/cad-contracts/src/index.test.ts',
  'src/lib/fea-jobs/contracts.test.ts',
  'packages/job-contracts/src/commercialPrecisionExecution.test.ts',
  'src/lib/platform/__tests__/firstRunDesktop.test.ts',
  'src/lib/platform/contracts.test.ts',
  'src/lib/platform/jobOrchestratorClient.test.ts',
  'workers/edge-gateway/src/index.test.ts',
  'workers/job-orchestrator/src/commercial.test.ts',
  'workers/job-orchestrator/src/core.test.ts',
  'workers/job-orchestrator/src/ledger.test.ts',
];

export function platformQualityCommands() {
  return [
    { name: 'Node service and policy tests', args: ['--test', ...NODE_TESTS] },
    { name: 'Platform Vitest suite', args: ['node_modules/vitest/vitest.mjs', 'run', ...VITEST_TESTS, '--reporter=dot'] },
    { name: 'Architecture boundary', args: ['scripts/platform/validate-platform-architecture.mjs'] },
    { name: 'Runtime placement policy', args: ['scripts/platform/evaluate-runtime-placement-readiness.mjs', '--allow-hold'] },
    { name: 'Slice deployment readiness', args: ['scripts/platform/verify-slice-deployment-readiness.mjs', '--check'] },
    { name: 'Slice rollback evidence', args: ['scripts/platform/verify-slice-rollback-evidence.mjs', '--check'] },
  ];
}

function main() {
  const commands = platformQualityCommands();
  if (process.argv.includes('--list')) {
    for (const command of commands) console.log(`${command.name}: node ${command.args.join(' ')}`);
    return;
  }

  for (const command of commands) {
    console.log(`\n[platform-quality] ${command.name}`);
    const result = spawnSync(process.execPath, command.args, { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
