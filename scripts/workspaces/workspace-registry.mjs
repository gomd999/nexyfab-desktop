import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCheckCommand } from './workspace-guardrails.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, '../..');
export const registryPath = path.join(repositoryRoot, 'workspaces', 'registry.json');

export function normalizePath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

export function globToRegExp(pattern) {
  const source = normalizePath(pattern);
  let expression = '^';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '*') {
      const isDouble = source[index + 1] === '*';
      if (isDouble) {
        index += 1;
        if (source[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`);
}

export function matchesPattern(file, pattern) {
  return globToRegExp(pattern).test(normalizePath(file));
}

export function readRegistry() {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  validateRegistry(registry);
  return registry;
}

export function validateRegistry(registry) {
  if (registry?.schema !== 'nexyfab.workspace-registry.v1') throw new Error('workspace_registry_schema_invalid');
  if (!Array.isArray(registry.scopes) || registry.scopes.length !== 3) throw new Error('workspace_registry_scope_count_invalid');
  const ids = registry.scopes.map(scope => scope.id);
  if (new Set(ids).size !== ids.length) throw new Error('workspace_registry_scope_id_duplicate');
  if (!ids.includes(registry.defaultOwner)) throw new Error('workspace_registry_default_owner_invalid');
  for (const scope of registry.scopes) {
    if (!scope.id || !scope.branch || !scope.worktreeDirectory || !Array.isArray(scope.ownedPaths)) {
      throw new Error(`workspace_scope_invalid:${scope.id ?? 'unknown'}`);
    }
    if (!Array.isArray(scope.checks) || scope.checks.length === 0) {
      throw new Error(`workspace_scope_checks_invalid:${scope.id}`);
    }
    for (const command of scope.checks) parseCheckCommand(command);
    if (scope.releaseGates !== undefined && !Array.isArray(scope.releaseGates)) {
      throw new Error(`workspace_scope_release_gates_invalid:${scope.id}`);
    }
    for (const command of scope.releaseGates ?? []) parseCheckCommand(command);
  }
}

export function getScope(registry, scopeId) {
  const scope = registry.scopes.find(candidate => candidate.id === scopeId);
  if (!scope) throw new Error(`workspace_scope_unknown:${scopeId}`);
  return scope;
}

export function resolveOwnership(file, registry) {
  const normalized = normalizePath(file);
  const shared = registry.sharedPaths.some(pattern => matchesPattern(normalized, pattern));
  const explicitOwners = registry.scopes
    .filter(scope => scope.ownedPaths.some(pattern => matchesPattern(normalized, pattern)))
    .map(scope => scope.id);
  return {
    file: normalized,
    shared,
    explicitOwners,
    owner: shared ? null : explicitOwners[0] ?? registry.defaultOwner,
  };
}

export function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return '';
    throw new Error(result.error?.message ?? `git_exit:${result.status}:${String(result.stderr).trim()}`);
  }
  return result.stdout;
}

export function parseNul(value) {
  return String(value).split('\0').map(normalizePath).filter(Boolean);
}

export function currentBranch() {
  return runGit(['branch', '--show-current']).trim();
}

export function currentHead() {
  return runGit(['rev-parse', 'HEAD']).trim();
}

export function collectChangedPaths(registry) {
  const paths = new Set();
  const add = values => values.forEach(value => paths.add(value));
  add(parseNul(runGit(['diff', '--name-only', '-z', `${registry.integrationBranch}...HEAD`], { allowFailure: true })));
  add(parseNul(runGit(['diff', '--name-only', '-z'])));
  add(parseNul(runGit(['diff', '--cached', '--name-only', '-z'])));
  add(parseNul(runGit(['ls-files', '--others', '--exclude-standard', '-z'])));
  return [...paths].sort();
}

export function workspaceDirectory(scope) {
  return path.join(repositoryRoot, 'workspaces', scope.id);
}
