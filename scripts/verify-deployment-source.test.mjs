import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  forbiddenEnvironmentModuleImports,
  ignoredByFile,
  verifyDeploymentSource,
} from './verify-deployment-source.mjs';
import { RELEASE_HEALTH_EVIDENCE } from './package-release-health-evidence.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-deployment-source-'));
  for (const file of ['package.json', 'package-lock.json', 'Dockerfile', 'railway.toml']) {
    writeFileSync(path.join(root, file), `${file}\n`);
  }
  writeFileSync(path.join(root, '.dockerignore'), 'node_modules\n.env\n');
  writeFileSync(path.join(root, '.railwayignore'), [
    'docs/**',
    '!docs/evidence/',
    'docs/evidence/**',
    '!docs/evidence/release/',
    'docs/evidence/release/**',
    ...RELEASE_HEALTH_EVIDENCE.map(entry => `!${entry.relativePath}`),
    '',
  ].join('\n'));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'scripts', 'safe.mjs'), "const value = process.env.JWT_SECRET;\nexport default value;\n");
  for (const entry of RELEASE_HEALTH_EVIDENCE) {
    const file = path.join(root, ...entry.relativePath.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ schema: entry.schema, status: 'HOLD' })}\n`);
  }
  git(root, 'init', '--quiet');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=NexyFab Test', '-c', 'user.email=test@nexyfab.invalid', 'commit', '--quiet', '-m', 'fixture');
  return root;
}

test('Railway ignore evaluation honors the final exact receipt exception', () => {
  const source = 'docs/**\n!docs/evidence/\ndocs/evidence/**\n!docs/evidence/release/\ndocs/evidence/release/**\n!docs/evidence/release/required.json\n';
  assert.equal(ignoredByFile(source, 'docs/evidence/release/required.json'), false);
  assert.equal(ignoredByFile(source, 'docs/evidence/release/missing.json'), true);
  assert.equal(ignoredByFile('*.json\n!safe.json\n*.json\n', 'safe.json'), true);
});

test('AST scan rejects static environment-file module edges but permits runtime environment reads', () => {
  assert.deepEqual(forbiddenEnvironmentModuleImports('safe.mjs', 'const key = process.env.OPENAI_API_KEY;'), []);
  assert.equal(forbiddenEnvironmentModuleImports('bad.mjs', "import '../../../../.env' with { type: 'text' };\n").length, 1);
  assert.equal(forbiddenEnvironmentModuleImports('bad.cjs', "require.resolve('../.env.production');\n").length, 1);
  assert.equal(forbiddenEnvironmentModuleImports('bad.ts', "export { value } from './.env.local';\n").length, 1);
});

test('accepts an exact clean Git root with tracked, included release-health evidence', async () => {
  const root = fixture();
  try {
    const head = git(root, 'rev-parse', 'HEAD');
    const result = await verifyDeploymentSource({ sourceRoot: root, expectedBuildId: head });
    assert.equal(result.status, 'PASS');
    assert.equal(result.gitHead, head);
    assert.equal(result.clean, true);
    assert.equal(result.releaseHealthEvidence.length, RELEASE_HEALTH_EVIDENCE.length);
    assert.equal(result.repositoryExternalEnvironmentModuleImports, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires the deployment source to equal the canonical integration ref', async () => {
  const root = fixture();
  try {
    const canonicalHead = git(root, 'rev-parse', 'HEAD');
    git(root, 'branch', 'integration/nexyfab', canonicalHead);
    const accepted = await verifyDeploymentSource({
      sourceRoot: root,
      expectedBuildId: canonicalHead,
      requiredRef: 'integration/nexyfab',
    });
    assert.equal(accepted.canonicalHead, canonicalHead);

    writeFileSync(path.join(root, 'scripts', 'safe.mjs'), 'export default "new release-only fix";\n');
    git(root, 'add', 'scripts/safe.mjs');
    git(root, '-c', 'user.name=NexyFab Test', '-c', 'user.email=test@nexyfab.invalid', 'commit', '--quiet', '-m', 'release only');
    await assert.rejects(
      verifyDeploymentSource({
        sourceRoot: root,
        expectedBuildId: git(root, 'rev-parse', 'HEAD'),
        requiredRef: 'integration/nexyfab',
      }),
      /deployment_source_not_canonical_ref/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed on dirty source, mismatched HEAD, omitted evidence, and static .env imports', async () => {
  const dirty = fixture();
  const mismatch = fixture();
  const omitted = fixture();
  const envImport = fixture();
  try {
    const dirtyHead = git(dirty, 'rev-parse', 'HEAD');
    writeFileSync(path.join(dirty, 'untracked.txt'), 'not deployable\n');
    await assert.rejects(
      verifyDeploymentSource({ sourceRoot: dirty, expectedBuildId: dirtyHead }),
      /deployment_source_worktree_not_clean/,
    );

    await assert.rejects(
      verifyDeploymentSource({ sourceRoot: mismatch, expectedBuildId: 'a'.repeat(40) }),
      /deployment_source_head_mismatch/,
    );

    const omittedReceipt = RELEASE_HEALTH_EVIDENCE.at(-1).relativePath;
    const omittedIgnore = readFileSync(path.join(omitted, '.railwayignore'), 'utf8')
      .replace(`!${omittedReceipt}\n`, '');
    writeFileSync(path.join(omitted, '.railwayignore'), omittedIgnore);
    git(omitted, 'add', '.railwayignore');
    git(omitted, '-c', 'user.name=NexyFab Test', '-c', 'user.email=test@nexyfab.invalid', 'commit', '--quiet', '-m', 'omit receipt');
    await assert.rejects(
      verifyDeploymentSource({ sourceRoot: omitted, expectedBuildId: git(omitted, 'rev-parse', 'HEAD') }),
      /deployment_source_release_evidence_excluded_by_railwayignore/,
    );

    writeFileSync(path.join(envImport, 'scripts', 'bad.mjs'), "import '../../../../.env';\n");
    git(envImport, 'add', 'scripts/bad.mjs');
    git(envImport, '-c', 'user.name=NexyFab Test', '-c', 'user.email=test@nexyfab.invalid', 'commit', '--quiet', '-m', 'bad env import');
    await assert.rejects(
      verifyDeploymentSource({ sourceRoot: envImport, expectedBuildId: git(envImport, 'rev-parse', 'HEAD') }),
      /deployment_source_forbidden_environment_module_import.*scripts\/bad\.mjs:1:1/,
    );
  } finally {
    for (const root of [dirty, mismatch, omitted, envImport]) rmSync(root, { recursive: true, force: true });
  }
});
