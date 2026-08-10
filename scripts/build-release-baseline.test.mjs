import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

test('current receipts are excluded from cleanliness and their own baseline hash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-release-receipts-'));
  const script = fileURLToPath(new URL('./build-release-baseline.mjs', import.meta.url));
  try {
    fs.mkdirSync(path.join(root, 'docs/evidence/release'), { recursive: true });
    fs.writeFileSync(path.join(root, '.railwayignore'), [
      'node_modules', '.next', '.git', '.env.local', '.env', '*.log', '*.db', '*.zip',
      'data', 'docs', 'scripts/knowledge-crawler', 'validation-reports', 'test-results',
      '.tmp', 'src-tauri', 'occt-collab-worker', 'occt-worker', 'out', 'out2', '.claude',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(root, 'app.js'), 'release-code', 'utf8');
    for (const name of ['commercial-release-baseline-current.json', 'commercialization-readiness-current.json']) {
      fs.writeFileSync(path.join(root, 'docs/evidence/release', name), '{"old":true}\n', 'utf8');
    }
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'release-test@nexyfab.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'NexyFab Release Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
    fs.writeFileSync(path.join(root, 'docs/evidence/release/commercialization-readiness-current.json'), '{"new":true}\n', 'utf8');

    execFileSync(process.execPath, [script], { cwd: root, stdio: 'ignore' });
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'docs/evidence/release/commercial-release-baseline-current.json'), 'utf8'));
    assert.equal(receipt.release.baselineStatus, 'committed');
    assert.equal(receipt.release.workingTreeChanges, 0);
    assert.equal(receipt.groups.evidence.some(row => row.path.endsWith('-current.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
