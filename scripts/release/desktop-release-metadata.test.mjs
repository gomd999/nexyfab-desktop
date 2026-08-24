import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReleasePayload,
  extractChangelogSection,
  resolveReleaseVersion,
} from './desktop-release-metadata.mjs';

test('resolves strict tag and dispatch versions', () => {
  assert.equal(resolveReleaseVersion({ refName: 'v1.2.3', inputVersion: '' }), '1.2.3');
  assert.equal(resolveReleaseVersion({ refName: 'main', inputVersion: '2.0.0-rc.1' }), '2.0.0-rc.1');
});

test('rejects release-version shell and path injection', () => {
  for (const inputVersion of ['1.2.3; touch owned', '../1.2.3', '1.2', '01.2.3']) {
    assert.throws(() => resolveReleaseVersion({ refName: 'main', inputVersion }), /strict SemVer/);
  }
});

test('serializes notes and signatures as data, not JSON syntax', () => {
  const payload = buildReleasePayload({
    version: '1.2.3',
    notes: 'quote: "\nclose: }',
    signatures: { winX64: 'sig"\nvalue' },
  });
  const parsed = JSON.parse(JSON.stringify(payload));

  assert.equal(parsed.notes, 'quote: "\nclose: }');
  assert.equal(parsed.sig_win_x64, 'sig"\nvalue');
});

test('extracts only the requested changelog section', () => {
  const changelog = '# Changes\n\n## [v1.2.3]\n\nSafe notes\n\n## 1.2.2\nOld notes\n';
  assert.equal(extractChangelogSection(changelog, '1.2.3'), 'Safe notes');
});
