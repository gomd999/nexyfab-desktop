import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildReleaseBaseline,
  classifyReleasePath,
  RAILWAY_DOCS_EVIDENCE_POLICY,
  verifyRailwayIgnoreLines,
} from './build-release-baseline.mjs';

const requiredRailwayIgnoreRules = [
  'node_modules', '.next', '.git', '.env.local', '.env', '*.log', '*.db', '*.zip',
  'data', 'scripts/knowledge-crawler', 'validation-reports', 'test-results',
  '.tmp', '/.codex-runtime', '/artifacts', '/backups', 'src-tauri',
  'occt-collab-worker', 'out', 'out2', '.claude',
];

test('classifies protected and runtime-excluded release paths fail-closed', () => {
  assert.equal(classifyReleasePath('.env.production'), 'protected');
  assert.equal(classifyReleasePath('.env.example'), 'deployable');
  assert.equal(classifyReleasePath('data/nexyfab.db'), 'protected');
  assert.equal(classifyReleasePath('validation-reports/closed-beta-integrity-final.json'), 'protected');
  assert.equal(classifyReleasePath('.tmp/runtime.bin'), 'temporary');
  assert.equal(classifyReleasePath('.tmp-language-hits.txt'), 'temporary');
  assert.equal(classifyReleasePath('.codex-runtime/browser-verification.sqlite'), 'protected');
  assert.equal(classifyReleasePath('.codex-runtime/browser-verification.sqlite-wal'), 'protected');
  assert.equal(classifyReleasePath('artifacts/local-run/output.step'), 'temporary');
  for (const generated of [
    '_eslint_tmp.json',
    'build_log.txt',
    'eslint-stats.json',
    'lint.txt',
    'patch_context.txt',
    'temp.html',
    'tmp.txt',
  ]) assert.equal(classifyReleasePath(generated), 'temporary');
  const historicalEvidenceRoot = 'docs/evidence/cad-independent/local/mechanical-single-part-candidates-260813';
  assert.equal(classifyReleasePath(`${historicalEvidenceRoot}/receipt.json`), 'temporary');
  assert.equal(classifyReleasePath(`${historicalEvidenceRoot}/receipt.sha256`), 'temporary');
  assert.equal(classifyReleasePath(`${historicalEvidenceRoot}/STALE.json`), 'evidence');
  assert.equal(classifyReleasePath('docs/evidence/release/audit.json'), 'evidence');
  assert.equal(classifyReleasePath('docs/ACTIVE_EXECUTION_MASTER.md'), 'documentation');
  assert.equal(classifyReleasePath('src/app/page.tsx'), 'deployable');
});

test('builds deterministic category hashes without exposing file contents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-release-baseline-'));
  try {
    const files = ['src/app.ts', '.env.local', 'docs/plan.md', 'artifacts/local-run/output.step'];
    for (const file of files) {
      const absolute = path.join(root, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `fixture:${file}`, 'utf8');
    }
    const baseline = buildReleaseBaseline({ files, root, metadata: { branch: 'release/test' } });
    assert.equal(baseline.summary.deployable.files, 1);
    assert.equal(baseline.summary.protected.files, 1);
    assert.equal(baseline.summary.documentation.files, 1);
    assert.equal(baseline.summary.temporary.files, 1);
    assert.equal(baseline.groups.protected[0].path, '.env.local');
    assert.equal('content' in baseline.groups.protected[0], false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quarantines the stale historical receipt while retaining its STALE marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-release-stale-evidence-'));
  const evidenceRoot = 'docs/evidence/cad-independent/local/mechanical-single-part-candidates-260813';
  const files = [
    `${evidenceRoot}/receipt.json`,
    `${evidenceRoot}/receipt.sha256`,
    `${evidenceRoot}/STALE.json`,
  ];
  try {
    for (const file of files) {
      const absolute = path.join(root, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `fixture:${file}`, 'utf8');
    }

    const baseline = buildReleaseBaseline({ files, root });
    assert.deepEqual(baseline.groups.temporary.map(row => row.path), files.slice(0, 2));
    assert.deepEqual(baseline.groups.evidence.map(row => row.path), [files[2]]);
    assert.deepEqual(baseline.policy.quarantinedHistoricalEvidence, files.slice(0, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts only the ordered deny-by-default Railway docs evidence policy', () => {
  const rules = [...requiredRailwayIgnoreRules, ...RAILWAY_DOCS_EVIDENCE_POLICY];
  const result = verifyRailwayIgnoreLines(rules);
  assert.equal(result.docsEvidencePolicy.mode, 'deny-by-default-exact-evidence-exceptions');
  assert.deepEqual(result.docsEvidencePolicy.rules, RAILWAY_DOCS_EVIDENCE_POLICY);
  assert.throws(
    () => verifyRailwayIgnoreLines([...rules, '!docs']),
    /unexpected_negation:!docs/,
  );
  assert.throws(
    () => verifyRailwayIgnoreLines([
      ...requiredRailwayIgnoreRules,
      ...RAILWAY_DOCS_EVIDENCE_POLICY.slice(1),
      RAILWAY_DOCS_EVIDENCE_POLICY[0],
    ]),
    /out_of_order/,
  );
  assert.throws(
    () => verifyRailwayIgnoreLines(rules.filter(rule => !rule.endsWith('commercial-precision-runtime-evidence.json'))),
    /commercial-precision-runtime-evidence/,
  );
});

test('current receipts are excluded from cleanliness and their own baseline hash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-release-receipts-'));
  const script = fileURLToPath(new URL('./build-release-baseline.mjs', import.meta.url));
  try {
    fs.mkdirSync(path.join(root, 'docs/evidence/release'), { recursive: true });
    fs.writeFileSync(path.join(root, '.railwayignore'), [
      ...requiredRailwayIgnoreRules,
      ...RAILWAY_DOCS_EVIDENCE_POLICY,
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(root, 'app.js'), 'release-code', 'utf8');
    for (const name of [
      'commercial-release-baseline-current.json',
      'commercialization-readiness-current.json',
      'commercialization-readiness-full-product-current.json',
    ]) {
      fs.writeFileSync(path.join(root, 'docs/evidence/release', name), '{"old":true}\n', 'utf8');
    }
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'release-test@nexyfab.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'NexyFab Release Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
    fs.writeFileSync(path.join(root, 'docs/evidence/release/commercialization-readiness-current.json'), '{"new":true}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'docs/evidence/release/commercialization-readiness-full-product-current.json'), '{"new":true}\n', 'utf8');

    execFileSync(process.execPath, [script], { cwd: root, stdio: 'ignore' });
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'docs/evidence/release/commercial-release-baseline-current.json'), 'utf8'));
    assert.equal(receipt.release.baselineStatus, 'committed');
    assert.equal(receipt.release.workingTreeChanges, 0);
    assert.equal(receipt.groups.evidence.some(row => row.path.endsWith('-current.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
