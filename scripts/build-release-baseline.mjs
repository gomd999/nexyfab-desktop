#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_OUTPUT = 'docs/evidence/release/commercial-release-baseline-current.json';

const normalize = value => value.replaceAll('\\', '/').replace(/^\.\//, '');
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const digestRows = rows => createHash('sha256')
  .update(rows.map(row => `${row.path}\0${row.bytes}\0${row.sha256}`).join('\n'))
  .digest('hex');

const startsWithAny = (value, prefixes) => prefixes.some(prefix => value === prefix || value.startsWith(`${prefix}/`));

export function classifyReleasePath(input) {
  const value = normalize(input);
  const lower = value.toLowerCase();

  if (
    (/^\.env(?:\.|$)/i.test(value) && lower !== '.env.example')
    || /(?:^|\/)[^/]+\.(?:db|db-shm|db-wal)$/i.test(value)
    || startsWithAny(lower, ['data', 'backups'])
    || /^validation-reports\/closed-beta-integrity-/i.test(value)
  ) return 'protected';

  if (startsWithAny(lower, [
    '.git', '.next', '.tmp', '.runtime-wp20', 'node_modules', 'out', 'out2',
    'src-tauri/target', 'src-tauri/gen', '.claude', '.vercel', 'coverage',
    'playwright-report', 'test-results', 'adminlink',
  ]) || /(?:^|\/)[^/]+\.(?:log|zip)$/i.test(value)) return 'temporary';

  if (
    startsWithAny(lower, ['docs/evidence', 'validation-reports', 'scripts/knowledge-crawler'])
    || /(?:^|\/)_(?:[^/]+)\.(?:png|mjs|json)$/i.test(value)
  ) return 'evidence';

  if (startsWithAny(lower, ['docs', 'security'])) return 'documentation';
  return 'deployable';
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

function readGitFiles() {
  return readGitPaths([
    'ls-files', '-co', '--exclude-standard', '-z', '--', '.',
    ':(exclude).tmp/**', ':(exclude).runtime-wp20/**', ':(exclude).next/**',
    ':(exclude)node_modules/**', ':(exclude)out/**', ':(exclude)out2/**',
    ':(exclude)src-tauri/target/**', ':(exclude)src-tauri/gen/**',
    ':(exclude).claude/**', ':(exclude)playwright-report/**',
    ':(exclude)test-results/**', ':(exclude)coverage/**',
  ]);
}

function readGitPaths(args) {
  return git(args)
    .split('\0')
    .filter(Boolean)
    .map(normalize)
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort();
}

function readReleaseWorkingTreeChanges() {
  const exclusions = [
    ':(exclude).tmp/**', ':(exclude).runtime-wp20/**', ':(exclude).next/**',
    ':(exclude)node_modules/**', ':(exclude)out/**', ':(exclude)out2/**',
    ':(exclude)src-tauri/target/**', ':(exclude)src-tauri/gen/**',
    ':(exclude).claude/**', ':(exclude)playwright-report/**',
    ':(exclude)test-results/**', ':(exclude)coverage/**',
  ];
  return [...new Set([
    ...readGitPaths(['diff', '--name-only', '-z', '--', '.', ...exclusions]),
    ...readGitPaths(['diff', '--cached', '--name-only', '-z', '--', '.', ...exclusions]),
    ...readGitPaths(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...exclusions]),
  ])].sort();
}

function verifyRailwayIgnore() {
  const ignore = fs.readFileSync(path.join(ROOT, '.railwayignore'), 'utf8')
    .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const required = [
    'node_modules', '.next', '.git', '.env.local', '.env', '*.log', '*.db', '*.zip',
    'data', 'docs', 'scripts/knowledge-crawler', 'validation-reports', 'test-results',
    '.tmp', 'src-tauri', 'occt-collab-worker', 'occt-worker', 'out', 'out2', '.claude',
  ];
  const missing = required.filter(item => !ignore.includes(item));
  if (missing.length) throw new Error(`railwayignore_required_entries_missing:${missing.join(',')}`);
  return { path: '.railwayignore', requiredEntries: required.length, missing: [] };
}

export function buildReleaseBaseline({ files, root = ROOT, metadata = {} }) {
  const groups = { deployable: [], documentation: [], evidence: [], protected: [], temporary: [] };
  for (const relative of files) {
    const absolute = path.resolve(root, relative);
    const withinRoot = path.relative(root, absolute);
    if (!withinRoot || withinRoot.startsWith('..') || path.isAbsolute(withinRoot)) throw new Error(`unsafe_release_path:${relative}`);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const row = { path: normalize(relative), bytes: fs.statSync(absolute).size, sha256: sha256(absolute) };
    groups[classifyReleasePath(relative)].push(row);
  }

  for (const rows of Object.values(groups)) rows.sort((a, b) => a.path.localeCompare(b.path));
  const protectedInDeployable = groups.deployable.filter(row => classifyReleasePath(row.path) === 'protected');
  if (protectedInDeployable.length) throw new Error(`protected_file_marked_deployable:${protectedInDeployable[0].path}`);

  const summarize = rows => ({ files: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), sha256: digestRows(rows) });
  return {
    schema: 'nexyfab.commercial-release-baseline.v1',
    generatedAt: new Date().toISOString(),
    release: metadata,
    policy: {
      protectedNeverDeploy: true,
      referenceEvidenceExcludedFromRuntime: true,
      closedBetaMutationAllowed: false,
      originalCopyrightAssetsImmutable: true,
      excludedRuntimeRoots: [
        '.tmp', '.runtime-wp20', '.next', 'node_modules', 'out', 'out2',
        'src-tauri/target', 'src-tauri/gen', '.claude', 'playwright-report',
        'test-results', 'coverage',
      ],
    },
    summary: Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, summarize(rows)])),
    groups,
  };
}

function valueAfter(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)))) {
  const branch = git(['branch', '--show-current']).trim();
  const head = git(['rev-parse', 'HEAD']).trim();
  const changedFiles = readReleaseWorkingTreeChanges();
  const output = path.resolve(valueAfter('--out', DEFAULT_OUTPUT));
  const railwayIgnore = verifyRailwayIgnore();
  const manifest = buildReleaseBaseline({
    files: readGitFiles(),
    metadata: {
      branch,
      head,
      baselineStatus: changedFiles.length === 0 ? 'committed' : 'candidate_uncommitted',
      workingTreeChanges: changedFiles.length,
      deploymentId: process.env.RELEASE_DEPLOYMENT_ID ?? null,
      buildId: process.env.RELEASE_BUILD_ID ?? null,
      rollbackDeploymentId: process.env.RELEASE_ROLLBACK_DEPLOYMENT_ID ?? null,
      dockerImageDigest: process.env.RELEASE_DOCKER_IMAGE_DIGEST ?? null,
      dbSchemaVersion: process.env.RELEASE_DB_SCHEMA_VERSION ?? null,
    },
  });
  const changeGroups = { deployable: [], documentation: [], evidence: [], protected: [], temporary: [] };
  for (const changedFile of changedFiles) changeGroups[classifyReleasePath(changedFile)].push(changedFile);
  manifest.workingTree = {
    groups: changeGroups,
    summary: Object.fromEntries(Object.entries(changeGroups).map(([group, paths]) => [group, paths.length])),
    releaseCommitAllowed: changeGroups.protected.length === 0 && changeGroups.temporary.length === 0,
  };
  manifest.release.railwayIgnore = railwayIgnore;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, release: manifest.release, summary: manifest.summary }, null, 2));
}
