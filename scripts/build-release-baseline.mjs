#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_OUTPUT = 'docs/evidence/release/commercial-release-baseline-current.json';
const MUTABLE_CURRENT_RECEIPTS = [
  'docs/evidence/release/commercial-release-baseline-current.json',
  'docs/evidence/release/commercialization-readiness-current.json',
  'docs/evidence/release/commercialization-readiness-full-product-current.json',
];

const normalize = value => value.replaceAll('\\', '/').replace(/^\.\//, '');
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const digestRows = rows => createHash('sha256')
  .update(rows.map(row => `${row.path}\0${row.bytes}\0${row.sha256}`).join('\n'))
  .digest('hex');

const startsWithAny = (value, prefixes) => prefixes.some(prefix => value === prefix || value.startsWith(`${prefix}/`));
const ROOT_GENERATED_ARTIFACTS = new Set([
  '_eslint_tmp.json',
  'build_log.txt',
  'eslint-stats.json',
  'lint.txt',
  'patch_context.txt',
  'temp.html',
  'tmp.txt',
]);
const QUARANTINED_HISTORICAL_EVIDENCE = new Set([
  'docs/evidence/cad-independent/local/mechanical-single-part-candidates-260813/receipt.json',
  'docs/evidence/cad-independent/local/mechanical-single-part-candidates-260813/receipt.sha256',
]);

export function classifyReleasePath(input) {
  const value = normalize(input);
  const lower = value.toLowerCase();

  if (
    (/^\.env(?:\.|$)/i.test(value) && lower !== '.env.example')
    || /(?:^|\/)[^/]+\.(?:db|db-shm|db-wal|sqlite|sqlite-shm|sqlite-wal)$/i.test(value)
    || startsWithAny(lower, ['data', 'backups', '.codex-runtime'])
    || /^validation-reports\/closed-beta-integrity-/i.test(value)
  ) return 'protected';

  if (QUARANTINED_HISTORICAL_EVIDENCE.has(lower)
    || ROOT_GENERATED_ARTIFACTS.has(lower) || startsWithAny(lower, [
    '.git', '.next', '.tmp', '.runtime-wp20', 'node_modules', 'out', 'out2',
    'src-tauri/target', 'src-tauri/gen', '.claude', '.vercel', 'coverage',
    'playwright-report', 'test-results', 'adminlink', 'artifacts',
  ]) || /^\.tmp(?:[-_].+)?$/i.test(value) || /(?:^|\/)[^/]+\.(?:log|zip)$/i.test(value)) return 'temporary';

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
    ...MUTABLE_CURRENT_RECEIPTS.map(value => `:(exclude)${value}`),
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

export function readReleaseWorkingTreeChanges() {
  const exclusions = [
    ':(exclude).tmp/**', ':(exclude).runtime-wp20/**', ':(exclude).next/**',
    ':(exclude)node_modules/**', ':(exclude)out/**', ':(exclude)out2/**',
    ':(exclude)src-tauri/target/**', ':(exclude)src-tauri/gen/**',
    ':(exclude).claude/**', ':(exclude)playwright-report/**',
    ':(exclude)test-results/**', ':(exclude)coverage/**',
    ...MUTABLE_CURRENT_RECEIPTS.map(value => `:(exclude)${value}`),
  ];
  return [...new Set([
    ...readGitPaths(['diff', '--name-only', '-z', '--', '.', ...exclusions]),
    ...readGitPaths(['diff', '--cached', '--name-only', '-z', '--', '.', ...exclusions]),
    ...readGitPaths(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...exclusions]),
  ])].sort();
}

export const RAILWAY_DOCS_EVIDENCE_POLICY = Object.freeze([
  'docs/**',
  '!docs/evidence/',
  'docs/evidence/**',
  '!docs/evidence/release/',
  'docs/evidence/release/**',
  '!docs/evidence/release/commercial-i18n-release-receipt.json',
  '!docs/evidence/release/seven-day-operations-receipt.json',
  '!docs/evidence/release/commercial-precision-runtime-evidence.json',
  '!docs/evidence/operations/',
  'docs/evidence/operations/**',
  '!docs/evidence/operations/**/*.json',
]);

export function verifyRailwayIgnoreLines(lines) {
  const ignore = lines.map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const required = [
    'node_modules', '.next', '.git', '.env.local', '.env', '*.log', '*.db', '*.zip',
    'data', 'scripts/knowledge-crawler', 'validation-reports', 'test-results',
    '.tmp', '/.codex-runtime', '/artifacts', '/backups', 'src-tauri',
    // occt-worker is source for the browser worker copied into public/ by
    // scripts/copy-occt.js; it must remain in the Docker build context.
    'occt-collab-worker', 'out', 'out2', '.claude',
  ];
  const missing = required.filter(item => !ignore.includes(item));
  const allowedDocsNegations = new Set(RAILWAY_DOCS_EVIDENCE_POLICY.filter(rule => rule.startsWith('!')));
  const unexpectedDocsNegations = ignore.filter(rule => rule.startsWith('!docs') && !allowedDocsNegations.has(rule));
  let previousIndex = -1;
  const docsPolicyIssues = [];
  for (const rule of RAILWAY_DOCS_EVIDENCE_POLICY) {
    const index = ignore.indexOf(rule);
    if (index < 0) docsPolicyIssues.push(`missing:${rule}`);
    else if (index <= previousIndex) docsPolicyIssues.push(`out_of_order:${rule}`);
    previousIndex = index;
  }
  if (unexpectedDocsNegations.length) {
    docsPolicyIssues.push(...unexpectedDocsNegations.map(rule => `unexpected_negation:${rule}`));
  }
  if (missing.length || docsPolicyIssues.length) {
    throw new Error([
      ...(missing.length ? [`required_entries_missing:${missing.join(',')}`] : []),
      ...(docsPolicyIssues.length ? [`docs_policy_invalid:${docsPolicyIssues.join(',')}`] : []),
    ].join(';'));
  }
  return {
    requiredEntries: required.length + RAILWAY_DOCS_EVIDENCE_POLICY.length,
    missing: [],
    docsEvidencePolicy: {
      mode: 'deny-by-default-exact-evidence-exceptions',
      rules: [...RAILWAY_DOCS_EVIDENCE_POLICY],
      unexpectedNegations: [],
    },
  };
}

function verifyRailwayIgnore() {
  const result = verifyRailwayIgnoreLines(fs.readFileSync(path.join(ROOT, '.railwayignore'), 'utf8').split(/\r?\n/));
  return { path: '.railwayignore', ...result };
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
        '_eslint_tmp.json', 'build_log.txt', 'eslint-stats.json', 'lint.txt',
        'patch_context.txt', 'temp.html', 'tmp.txt',
      ],
      quarantinedHistoricalEvidence: [...QUARANTINED_HISTORICAL_EVIDENCE],
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
      environment: process.env.RELEASE_ENVIRONMENT ?? null,
      service: process.env.RELEASE_SERVICE ?? null,
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
