import assert from 'node:assert/strict';
import test from 'node:test';

import { platformQualityCommands } from './run-platform-quality.mjs';

test('platform quality plan covers services, workers, containers, contracts, and policy gates', () => {
  const plan = platformQualityCommands().map((command) => command.args.join(' ')).join('\n');

  for (const requiredPath of [
    'apps/core-api/test/server.test.mjs',
    'collab-worker/server.test.js',
    'services/openscad-worker/server.test.mjs',
    'containers/fea/src/executor.test.ts',
    'src/lib/fea-jobs/contracts.test.ts',
    'packages/job-contracts/src/commercialPrecisionExecution.test.ts',
    'workers/job-orchestrator/src/core.test.ts',
    'scripts/platform/validate-platform-architecture.mjs',
    'scripts/platform/verify-slice-rollback-evidence.mjs',
  ]) {
    assert.match(plan, new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
