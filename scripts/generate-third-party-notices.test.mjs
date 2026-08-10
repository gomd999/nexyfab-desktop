import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const file = path.join(root, 'src', 'content', 'third-party-notices.generated.json');

test('generated production notices bind the lockfile and critical LGPL components', () => {
  const notices = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(notices.schema, 'nexyfab.third-party-notices.v1');
  assert.equal(notices.packageCount, notices.packages.length);
  assert.ok(notices.packageCount > 100);
  for (const name of ['opencascade.js', 'occt-import-js', '@salusoft89/planegcs']) {
    const item = notices.criticalCopyleft.find(component => component.name === name);
    assert.ok(item, `${name} notice missing`);
    assert.match(item.license, /^LGPL-/i);
    assert.match(item.licenseArtifact.sha256, /^[0-9a-f]{64}$/);
  }
  const buffers = notices.packages.find(component => component.name === 'buffers' && component.version === '0.1.1');
  assert.equal(buffers.license, 'MIT');
  assert.match(buffers.licenseArtifact.sha256, /^[0-9a-f]{64}$/);
  assert.match(buffers.licenseReview.evidenceUrl, /^https:\/\/sources\.debian\.org\//);
  assert.deepEqual(notices.issues, []);
});
