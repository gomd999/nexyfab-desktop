import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateScadSource } from './server.mjs';

test('accepts deterministic geometry and trusted BOSL2 includes', () => {
  assert.equal(validateScadSource('include <BOSL2/std.scad>\ncube([1,2,3]);').ok, true);
});

test('blocks external file and untrusted include access', () => {
  assert.equal(validateScadSource('import("/etc/passwd");').ok, false);
  assert.equal(validateScadSource('include </tmp/secret.scad>').ok, false);
  assert.equal(validateScadSource('surface(file="secret.dat");').ok, false);
});

test('direct execution invokes main on the current platform', () => {
  const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [serverPath], {
    encoding: 'utf8',
    env: { ...process.env, REDIS_URL: '', OPENSCAD_WORKER_ISOLATED: '1' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REDIS_URL is required/);
});
