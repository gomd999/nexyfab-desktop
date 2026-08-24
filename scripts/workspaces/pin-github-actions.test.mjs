import assert from 'node:assert/strict';
import test from 'node:test';

import { rewriteActionPins } from './pin-github-actions.mjs';

test('rewrites a floating action reference to the approved immutable SHA', () => {
  const source = 'steps:\n  - uses: actions/checkout@v4\n';
  const result = rewriteActionPins(source, 'fixture.yml');

  assert.equal(result.issues.length, 1);
  assert.match(result.output, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4/);
});

test('accepts the canonical pinned action reference', () => {
  const source = 'steps:\n  - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\n';
  const result = rewriteActionPins(source, 'fixture.yml');

  assert.deepEqual(result.issues, []);
  assert.equal(result.output, source);
});

test('rejects unregistered remote actions', () => {
  const result = rewriteActionPins('steps:\n  - uses: example/action@v1\n', 'fixture.yml');

  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /unregistered action/);
});

test('pins setup-node runtime versions exactly', () => {
  const result = rewriteActionPins("with:\n  node-version: '22'\n", 'fixture.yml');

  assert.equal(result.issues.length, 1);
  assert.equal(result.output, "with:\n  node-version: '22.23.2'\n");
});
