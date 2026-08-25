#!/usr/bin/env node
/**
 * Fail-closed verification for the exact source directory uploaded by
 * `railway up`. This runs before a verified deployment so an incomplete CLI
 * snapshot cannot reach the remote Docker builder.
 */
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { validateReleaseHealthEvidenceSource } from './package-release-health-evidence.mjs';

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const REQUIRED_BUILD_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'Dockerfile',
  '.dockerignore',
  '.railwayignore',
  'railway.toml',
]);

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function fail(code, detail = '') {
  throw new Error(`${code}${detail ? `:${detail}` : ''}`);
}

function normalize(value) {
  return value.replaceAll('\\', '/');
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function git(root, args) {
  return run('git', args, root);
}

function regularTrackedFile(root, relativePath, tracked) {
  if (!tracked.has(relativePath)) fail('deployment_source_required_file_untracked', relativePath);
  const absolute = path.join(root, ...relativePath.split('/'));
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error?.code === 'ENOENT') fail('deployment_source_required_file_missing', relativePath);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('deployment_source_required_file_not_regular', relativePath);
  return absolute;
}

function globRegex(pattern) {
  let output = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        output += '.*';
        index += 1;
      } else output += '[^/]*';
    } else if (char === '?') output += '[^/]';
    else output += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${output}$`);
}

export function ignoredByFile(source, relativePath) {
  const target = normalize(relativePath).replace(/^\/+/, '');
  let ignored = false;
  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const negated = trimmed.startsWith('!');
    let pattern = normalize(negated ? trimmed.slice(1) : trimmed).replace(/^\/+/, '');
    if (!pattern) continue;
    if (pattern.endsWith('/')) pattern += '**';
    const matches = pattern.includes('/')
      ? globRegex(pattern).test(target)
      : target.split('/').some(component => globRegex(pattern).test(component));
    if (matches) ignored = !negated;
  }
  return ignored;
}

function scriptKind(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function moduleSpecifier(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isImportEqualsDeclaration(node)
    && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression
    && ts.isStringLiteralLike(node.moduleReference.expression)) {
    return node.moduleReference.expression.text;
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0 || !ts.isStringLiteralLike(node.arguments[0])) return null;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0].text;
  if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return node.arguments[0].text;
  if (ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'require'
    && node.expression.name.text === 'resolve') return node.arguments[0].text;
  return null;
}

function isEnvironmentFileSpecifier(value) {
  const normalized = normalize(value).split(/[?#]/, 1)[0];
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return basename === '.env' || basename.startsWith('.env.');
}

export function forbiddenEnvironmentModuleImports(relativePath, source) {
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, scriptKind(relativePath));
  const findings = [];
  function visit(node) {
    const specifier = moduleSpecifier(node);
    if (specifier && isEnvironmentFileSpecifier(specifier)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push({ file: normalize(relativePath), line: line + 1, column: character + 1, specifier });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

export async function verifyDeploymentSource({ sourceRoot = process.cwd(), expectedBuildId = '' } = {}) {
  if (!expectedBuildId) fail('deployment_source_expected_build_id_required');
  const requestedRoot = path.resolve(sourceRoot);
  let root;
  try {
    root = realpathSync.native(requestedRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') fail('deployment_source_root_missing', requestedRoot);
    throw error;
  }

  const gitRoot = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  if (!samePath(root, gitRoot)) fail('deployment_source_must_be_git_root', `${root},${gitRoot}`);
  const gitHead = (await git(root, ['rev-parse', 'HEAD'])).trim().toLowerCase();
  if (gitHead !== expectedBuildId.trim().toLowerCase()) {
    fail('deployment_source_head_mismatch', `expected=${expectedBuildId},actual=${gitHead}`);
  }

  const status = (await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])).trim();
  if (status) {
    const paths = status.split(/\r?\n/).slice(0, 20).map(line => line.slice(3)).join(',');
    fail('deployment_source_worktree_not_clean', paths);
  }

  const tracked = new Set((await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean).map(normalize));
  for (const relativePath of REQUIRED_BUILD_FILES) regularTrackedFile(root, relativePath, tracked);

  const railwayIgnore = readFileSync(path.join(root, '.railwayignore'), 'utf8');
  const dockerIgnore = readFileSync(path.join(root, '.dockerignore'), 'utf8');
  const releaseHealth = validateReleaseHealthEvidenceSource({ projectRoot: root, sourceRoot: root });
  for (const file of releaseHealth.files) {
    regularTrackedFile(root, file.relativePath, tracked);
    if (ignoredByFile(railwayIgnore, file.relativePath)) {
      fail('deployment_source_release_evidence_excluded_by_railwayignore', file.relativePath);
    }
    if (ignoredByFile(dockerIgnore, file.relativePath)) {
      fail('deployment_source_release_evidence_excluded_by_dockerignore', file.relativePath);
    }
  }

  const findings = [];
  let scannedFiles = 0;
  for (const relativePath of tracked) {
    if (!SOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
    const absolute = path.join(root, ...relativePath.split('/'));
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    scannedFiles += 1;
    findings.push(...forbiddenEnvironmentModuleImports(relativePath, readFileSync(absolute, 'utf8')));
  }
  if (findings.length) {
    const detail = findings.slice(0, 20).map(item => `${item.file}:${item.line}:${item.column}:${item.specifier}`).join(',');
    fail('deployment_source_forbidden_environment_module_import', detail);
  }

  return {
    schema: 'nexyfab.deployment-source-preflight.v1',
    status: 'PASS',
    sourceRoot: root,
    gitHead,
    clean: true,
    trackedFiles: tracked.size,
    scannedSourceFiles: scannedFiles,
    releaseHealthEvidence: releaseHealth.receipts,
    releaseHealthSourceFiles: releaseHealth.files.map(file => ({
      path: file.relativePath,
      bytes: file.bytes,
      sha256: file.sha256,
    })),
    repositoryExternalEnvironmentModuleImports: 0,
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  verifyDeploymentSource({
    sourceRoot: arg('source', '.'),
    expectedBuildId: arg('expected-build-id', process.env.NEXYFAB_EXPECTED_BUILD_ID || ''),
  }).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    console.error(`[deployment-source-preflight] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
