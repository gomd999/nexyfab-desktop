import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRollbackResponses } from './verify-rollback-target.mjs';

const healthy = {
  live: { status: 'ok', build: 'abc123' },
  ready: { status: 'ok', db: { status: 'ok', backend: 'postgres' } },
  occt: { ok: true, mode: 'wasm', wasm: { sha256: 'a'.repeat(64), sizeBytes: 65_000_000 } },
};

test('rollback verifier accepts matching healthy release', () => {
  assert.deepEqual(evaluateRollbackResponses(healthy, 'abc123'), []);
});

test('rollback verifier rejects wrong build, unavailable DB and stub OCCT', () => {
  const issues = evaluateRollbackResponses({
    live: { status: 'ok', build: 'old' },
    ready: { status: 'error', db: { status: 'error' } },
    occt: { ok: false, mode: 'stub', wasm: { sha256: null } },
  }, 'expected');
  assert.ok(issues.some(issue => issue.includes('build mismatch')));
  assert.ok(issues.some(issue => issue.includes('database')));
  assert.ok(issues.some(issue => issue.includes('real wasm')));
  assert.ok(issues.some(issue => issue.includes('sha256')));
});
