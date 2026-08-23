import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('the named commercial release gate cannot bypass commercialization evidence readiness', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const command = pkg.scripts?.['commercial:release-gate'];

  assert.equal(typeof command, 'string');
  assert.match(command, /(?:^|&&\s*)npm run commercialization:gate(?:\s*&&|$)/);
  assert.ok(
    command.indexOf('tsx scripts/commercial-release-gate.ts') < command.indexOf('npm run commercialization:gate'),
    'configuration/domain checks must complete before evidence readiness',
  );
});
