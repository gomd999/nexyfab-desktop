import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { FULL_PRODUCT_GATE_OUTPUT, runFullProductCommercializationReport } from './run-full-product-commercialization-report.mjs';

test('fixes the full-product scope, channel, and output across platforms', () => {
  let invocation;
  const status = runFullProductCommercializationReport({
    root: process.cwd(),
    parentEnv: {
      NEXYFAB_RELEASE_CHANNEL: 'mechanical-core',
      NEXYFAB_PRODUCT_RELEASE_SCOPE: 'web',
      COMMERCIALIZATION_GATE_OUTPUT: 'unsafe.json',
      PRESERVED: 'yes',
    },
    spawn: (file, args, options) => {
      invocation = { file, args, options };
      return { status: 1, signal: null, error: null };
    },
  });
  assert.equal(status, 1);
  assert.equal(invocation.file, process.execPath);
  assert.deepEqual(invocation.args, [path.resolve('scripts/commercialization-readiness-gate.mjs')]);
  assert.equal(invocation.options.env.NEXYFAB_RELEASE_CHANNEL, 'platform');
  assert.equal(invocation.options.env.NEXYFAB_PRODUCT_RELEASE_SCOPE, 'full-product');
  assert.equal(invocation.options.env.COMMERCIALIZATION_GATE_OUTPUT, FULL_PRODUCT_GATE_OUTPUT);
  assert.equal(invocation.options.env.PRESERVED, 'yes');
  assert.equal(invocation.options.stdio, 'inherit');
  assert.equal(invocation.options.windowsHide, true);
});

test('propagates success, failure, signal, and spawn errors', () => {
  assert.equal(runFullProductCommercializationReport({ spawn: () => ({ status: 0 }) }), 0);
  assert.equal(runFullProductCommercializationReport({ spawn: () => ({ status: 7 }) }), 7);
  assert.equal(runFullProductCommercializationReport({ spawn: () => ({ status: null, signal: 'SIGTERM' }) }), 2);
  assert.throws(() => runFullProductCommercializationReport({ spawn: () => ({ error: new Error('spawn failed') }) }), /spawn failed/);
});
