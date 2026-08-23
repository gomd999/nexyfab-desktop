import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlatformArchitecture } from './validate-platform-architecture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('platform manifests cover every checked-in route, service, data owner, domain, and contract boundary', () => {
  const result = validatePlatformArchitecture(root);
  assert.deepEqual(result.issues, []);
  assert.equal(result.status, 'PASS');
  assert.ok(result.counts.services >= 10);
  assert.equal(result.counts.domains, 6);
  assert.equal(result.counts.contractPackages, 4);
});
