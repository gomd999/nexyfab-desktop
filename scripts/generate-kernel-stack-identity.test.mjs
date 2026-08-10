import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKernelStackIdentity, checkOrWriteKernelStackIdentity, IDENTITY_SCHEMA } from './generate-kernel-stack-identity.mjs';

test('kernel identity binds exact packages, WASM binaries and policy sources', () => {
  const root = process.cwd();
  const first = buildKernelStackIdentity(root);
  const second = buildKernelStackIdentity(root);
  assert.deepEqual(first, second);
  assert.equal(first.schema, IDENTITY_SCHEMA);
  assert.match(first.identitySha256, /^[0-9a-f]{64}$/);
  assert.equal(first.platformContract.externalCadRequired, false);
  assert.equal(first.platformContract.commercialKernelMode, 'wasm-only-no-stub');
  assert.equal(first.components.length, 4);
  assert.equal(first.artifacts.length, 6);
  assert.equal(first.artifacts.filter(item => item.path.endsWith('.wasm')).length, 3);
});

test('checked-in kernel identity is current', () => {
  assert.equal(checkOrWriteKernelStackIdentity({ root: process.cwd(), write: false }).ok, true);
});
