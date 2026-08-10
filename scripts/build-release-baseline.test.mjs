import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildReleaseBaseline, classifyReleasePath } from './build-release-baseline.mjs';

test('classifies protected and runtime-excluded release paths fail-closed', () => {
  assert.equal(classifyReleasePath('.env.production'), 'protected');
  assert.equal(classifyReleasePath('.env.example'), 'deployable');
  assert.equal(classifyReleasePath('data/nexyfab.db'), 'protected');
  assert.equal(classifyReleasePath('validation-reports/closed-beta-integrity-final.json'), 'protected');
  assert.equal(classifyReleasePath('.tmp/runtime.bin'), 'temporary');
  assert.equal(classifyReleasePath('docs/evidence/release/audit.json'), 'evidence');
  assert.equal(classifyReleasePath('docs/ACTIVE_EXECUTION_MASTER.md'), 'documentation');
  assert.equal(classifyReleasePath('src/app/page.tsx'), 'deployable');
});

test('builds deterministic category hashes without exposing file contents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-release-baseline-'));
  try {
    const files = ['src/app.ts', '.env.local', 'docs/plan.md'];
    for (const file of files) {
      const absolute = path.join(root, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `fixture:${file}`, 'utf8');
    }
    const baseline = buildReleaseBaseline({ files, root, metadata: { branch: 'release/test' } });
    assert.equal(baseline.summary.deployable.files, 1);
    assert.equal(baseline.summary.protected.files, 1);
    assert.equal(baseline.summary.documentation.files, 1);
    assert.equal(baseline.groups.protected[0].path, '.env.local');
    assert.equal('content' in baseline.groups.protected[0], false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
