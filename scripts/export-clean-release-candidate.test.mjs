import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { exportCleanReleaseCandidate, verifyReleaseCandidateManifest } from './export-clean-release-candidate.mjs';

const temporaryRoots = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestRows = rows => createHash('sha256')
  .update(rows.map(row => `${row.path}\0${row.bytes}\0${row.sha256}`).join('\n'))
  .digest('hex');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-clean-rc-'));
  temporaryRoots.push(root);
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  return { root, source };
}

function addFile(source, relative, contents) {
  const absolute = path.join(source, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const bytes = Buffer.from(contents);
  fs.writeFileSync(absolute, bytes);
  return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
}

function writeSupplementalEvidence(source, baselinePath, overrides = {}) {
  const baselineBytes = fs.readFileSync(baselinePath);
  const relative = 'docs/evidence/release/commercialization-readiness-full-product-current.json';
  const report = {
    schema: 'nexyfab.commercialization-readiness.v4',
    evaluatedReleaseBaseline: {
      path: 'docs/evidence/release/commercial-release-baseline-current.json',
      bytes: baselineBytes.length,
      sha256: sha256(baselineBytes),
    },
    generatedAt: '2026-08-22T00:01:00.000Z',
    privateBeta: { eligible: false },
    commercialGa: { eligible: false },
    ...overrides,
  };
  const absolute = path.join(source, ...relative.split('/'));
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  return { report, path: absolute };
}

function makeBaseline(source, overrides = {}) {
  const rows = {
    deployable: [addFile(source, 'app/main.txt', 'runtime')],
    documentation: [addFile(source, 'docs/readme.md', '# release')],
    evidence: [addFile(source, 'docs/evidence/proof.json', '{"ok":true}\n')],
    protected: [{ path: 'data/secret.db', bytes: 12, sha256: '0'.repeat(64) }],
    temporary: [{ path: '.tmp/cache.log', bytes: 11, sha256: '1'.repeat(64) }],
    ...overrides,
  };
  const summary = Object.fromEntries(Object.entries(rows).map(([group, values]) => [group, {
    files: values.length,
    bytes: values.reduce((total, row) => total + row.bytes, 0),
    sha256: digestRows(values),
  }]));
  const baseline = {
    schema: 'nexyfab.commercial-release-baseline.v1',
    generatedAt: '2026-08-22T00:00:00.000Z',
    release: { branch: 'release/test', head: 'test-head', baselineStatus: 'candidate_uncommitted', workingTreeChanges: 1 },
    policy: { protectedNeverDeploy: true, referenceEvidenceExcludedFromRuntime: true, excludedRuntimeRoots: ['.tmp', 'node_modules'] },
    summary,
    groups: rows,
  };
  const baselinePath = path.join(source, 'docs/evidence/release/commercial-release-baseline-current.json');
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  const supplemental = writeSupplementalEvidence(source, baselinePath);
  return { baseline, baselinePath, supplemental };
}

afterEach(() => {
  while (temporaryRoots.length) fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

test('exports only selected groups with exact bytes and a fail-closed manifest', () => {
  const { root, source } = makeRoot();
  const { baselinePath } = makeBaseline(source);
  const baselineBytes = fs.readFileSync(baselinePath);
  const output = path.join(root, 'release-candidate');
  const result = exportCleanReleaseCandidate({ sourceRoot: source, outputDir: output, generatedAt: '2026-08-22T01:00:00.000Z' });

  assert.equal(result.manifest.schema, 'nexyfab.clean-release-candidate-snapshot.v1');
  assert.equal(result.manifest.status, 'SNAPSHOT_ONLY');
  assert.equal(result.manifest.releaseReady, false);
  assert.equal(result.manifest.deploymentAuthorization, 'NO_DEPLOY');
  assert.deepEqual(
    {
      path: result.manifest.baseline.path,
      bytes: result.manifest.baseline.bytes,
      sha256: result.manifest.baseline.sha256,
    },
    {
      path: 'docs/evidence/release/commercial-release-baseline-current.json',
      bytes: baselineBytes.length,
      sha256: sha256(baselineBytes),
    },
  );
  assert.equal(result.manifest.integrity.trustedSignature, false);
  assert.equal(result.manifest.integrity.releaseAuthorization, false);
  assert.equal(result.manifest.supplementalEvidence.artifacts[0].schema, 'nexyfab.commercialization-readiness.v4');
  assert.deepEqual(
    result.manifest.supplementalEvidence.artifacts[0].evaluatedReleaseBaseline,
    {
      path: 'docs/evidence/release/commercial-release-baseline-current.json',
      bytes: baselineBytes.length,
      sha256: sha256(baselineBytes),
    },
  );
  assert.equal(verifyReleaseCandidateManifest(result.manifest), true);
  assert.equal(result.manifest.included.files, 4);
  assert.equal(result.manifest.included.baselineSelected.files, 3);
  assert.equal(result.manifest.included.supplemental.files, 1);
  assert.ok(fs.existsSync(path.join(output, 'app/main.txt')));
  assert.ok(fs.existsSync(path.join(output, 'docs/readme.md')));
  assert.ok(fs.existsSync(path.join(output, 'docs/evidence/proof.json')));
  assert.ok(fs.existsSync(path.join(output, 'docs/evidence/release/commercialization-readiness-full-product-current.json')));
  assert.equal(fs.existsSync(path.join(output, 'data/secret.db')), false);
  assert.equal(fs.existsSync(path.join(output, '.tmp/cache.log')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'RC-SNAPSHOT-MANIFEST.json'), 'utf8')), result.manifest);
});

test('rejects payload tampering even when the manifest remains valid JSON', () => {
  const { root, source } = makeRoot();
  makeBaseline(source);
  const result = exportCleanReleaseCandidate({ sourceRoot: source, outputDir: path.join(root, 'release-candidate') });
  const tampered = structuredClone(result.manifest);
  tampered.generatedAt = '2026-08-22T02:00:00.000Z';
  assert.throws(() => verifyReleaseCandidateManifest(tampered), /manifest_self_hash_mismatch/);
});

test('rejects a tampered supplemental report schema before creating the destination', () => {
  const { root, source } = makeRoot();
  const { baselinePath } = makeBaseline(source);
  writeSupplementalEvidence(source, baselinePath, { schema: 'nexyfab.commercialization-readiness.v3' });
  const output = path.join(root, 'release-candidate');
  assert.throws(
    () => exportCleanReleaseCandidate({ sourceRoot: source, outputDir: output }),
    /supplemental_report_schema_invalid/,
  );
  assert.equal(fs.existsSync(output), false);
});

test('rejects a supplemental report evaluated against a stale baseline', () => {
  const { root, source } = makeRoot();
  const { baselinePath } = makeBaseline(source);
  writeSupplementalEvidence(source, baselinePath, {
    evaluatedReleaseBaseline: {
      path: 'docs/evidence/release/commercial-release-baseline-current.json',
      bytes: fs.statSync(baselinePath).size,
      sha256: 'f'.repeat(64),
    },
  });
  assert.throws(
    () => exportCleanReleaseCandidate({ sourceRoot: source, outputDir: path.join(root, 'release-candidate') }),
    /supplemental_report_stale_baseline_binding/,
  );
});

test('rejects an unsafe supplemental evidence path', () => {
  const { root, source } = makeRoot();
  makeBaseline(source);
  assert.throws(
    () => exportCleanReleaseCandidate({
      sourceRoot: source,
      supplementalEvidencePath: '../outside-report.json',
      outputDir: path.join(root, 'release-candidate'),
    }),
    /unsafe_supplemental_evidence_path/,
  );
});

test('rejects a safe-path substitute for the designated supplemental report', () => {
  const { root, source } = makeRoot();
  const { supplemental } = makeBaseline(source);
  const substitute = path.join(source, 'docs/evidence/release/substitute-full-product.json');
  fs.copyFileSync(supplemental.path, substitute);
  assert.throws(
    () => exportCleanReleaseCandidate({
      sourceRoot: source,
      supplementalEvidencePath: 'docs/evidence/release/substitute-full-product.json',
      outputDir: path.join(root, 'release-candidate'),
    }),
    /supplemental_report_path_invalid/,
  );
});

test('rejects an unsafe baseline path before trusting its self-hash', () => {
  const { root, source } = makeRoot();
  makeBaseline(source);
  const result = exportCleanReleaseCandidate({ sourceRoot: source, outputDir: path.join(root, 'release-candidate') });
  const tampered = structuredClone(result.manifest);
  tampered.baseline.path = '../substituted-baseline.json';
  assert.throws(() => verifyReleaseCandidateManifest(tampered), /unsafe_baseline_path/);
});

test('rejects a substituted baseline binding even with an unchanged self-hashed payload', () => {
  const { root, source } = makeRoot();
  const { baselinePath } = makeBaseline(source);
  const baselineBytes = fs.readFileSync(baselinePath);
  const expectedBaselineBinding = {
    path: 'docs/evidence/release/commercial-release-baseline-current.json',
    bytes: baselineBytes.length,
    sha256: sha256(baselineBytes),
  };
  const result = exportCleanReleaseCandidate({ sourceRoot: source, outputDir: path.join(root, 'release-candidate') });
  assert.throws(
    () => verifyReleaseCandidateManifest(result.manifest, {
      expectedBaselineBinding: { ...expectedBaselineBinding, sha256: 'f'.repeat(64) },
    }),
    /manifest_baseline_binding_mismatch/,
  );
});

test('rejects an existing destination, including an otherwise empty directory', () => {
  const { root, source } = makeRoot();
  makeBaseline(source);
  const output = path.join(root, 'release-candidate');
  fs.mkdirSync(output);
  assert.throws(() => exportCleanReleaseCandidate({ sourceRoot: source, outputDir: output }), /destination_already_exists/);
  assert.equal(fs.readdirSync(output).length, 0);
});

test('rejects source hash/size drift before creating the destination', () => {
  const { root, source } = makeRoot();
  const { baseline } = makeBaseline(source);
  baseline.groups.deployable[0].sha256 = 'f'.repeat(64);
  baseline.summary.deployable.sha256 = digestRows(baseline.groups.deployable);
  fs.writeFileSync(path.join(source, 'docs/evidence/release/commercial-release-baseline-current.json'), `${JSON.stringify(baseline)}\n`);
  const output = path.join(root, 'release-candidate');
  assert.throws(() => exportCleanReleaseCandidate({ sourceRoot: source, outputDir: output }), /source_exact_bytes_or_sha_mismatch/);
  assert.equal(fs.existsSync(output), false);
});

test('rejects traversal records even when their summary is internally consistent', () => {
  const { root, source } = makeRoot();
  const { baseline } = makeBaseline(source);
  baseline.groups.deployable[0] = { path: '../outside.txt', bytes: 1, sha256: '0'.repeat(64) };
  baseline.summary.deployable = { files: 1, bytes: 1, sha256: digestRows(baseline.groups.deployable) };
  fs.writeFileSync(path.join(source, 'docs/evidence/release/commercial-release-baseline-current.json'), `${JSON.stringify(baseline)}\n`);
  assert.throws(() => exportCleanReleaseCandidate({ sourceRoot: source, outputDir: path.join(root, 'release-candidate') }), /unsafe_baseline_path/);
});

test('rejects a baseline that labels a generated artifact as deployable', () => {
  const { root, source } = makeRoot();
  const generated = addFile(source, 'build_log.txt', 'build output');
  const { baseline } = makeBaseline(source, { deployable: [generated] });
  fs.writeFileSync(path.join(source, 'docs/evidence/release/commercial-release-baseline-current.json'), `${JSON.stringify(baseline)}\n`);
  assert.throws(
    () => exportCleanReleaseCandidate({ sourceRoot: source, outputDir: path.join(root, 'release-candidate') }),
    /baseline_group_classification_mismatch:build_log\.txt,deployable,temporary/,
  );
});

test('rejects a symlink in a selected source path when the platform permits symlinks', t => {
  const { root, source } = makeRoot();
  const outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, 'outside');
  const linked = path.join(source, 'app', 'linked.txt');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  try {
    fs.symlinkSync(outside, linked, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error?.code)) return t.skip('symlink creation unavailable');
    throw error;
  }
  makeBaseline(source, {
    deployable: [{ path: 'app/linked.txt', bytes: 7, sha256: sha256(Buffer.from('outside')) }],
  });
  assert.throws(() => exportCleanReleaseCandidate({ sourceRoot: source, outputDir: path.join(root, 'release-candidate') }), /source_symlink_or_junction_rejected/);
});
