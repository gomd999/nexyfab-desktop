#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyBranchRelation } from './workspace-guardrails.mjs';
import { branchDivergence, readRegistry, runGit } from './workspace-registry.mjs';

export function syncIssues(states, { allowFastForward = false } = {}) {
  const issues = [];
  for (const state of states) {
    if (!state.worktree) {
      issues.push({ code: 'workspace_sync_worktree_missing', target: state.id, branch: state.branch });
      continue;
    }
    if (state.dirtyFiles > 0) {
      issues.push({ code: 'workspace_sync_worktree_dirty', target: state.id, branch: state.branch, dirtyFiles: state.dirtyFiles });
    }
    if (state.relation === 'BEHIND' && !allowFastForward) {
      issues.push({ code: 'workspace_sync_target_behind', target: state.id, branch: state.branch, commits: state.baseOnly });
    } else if (state.relation === 'AHEAD') {
      issues.push({
        code: state.kind === 'release' ? 'workspace_sync_release_ahead' : 'workspace_sync_scope_ready_to_integrate',
        target: state.id,
        branch: state.branch,
        commits: state.targetOnly,
      });
    } else if (state.relation === 'DIVERGED') {
      issues.push({
        code: 'workspace_sync_target_diverged', target: state.id, branch: state.branch,
        integrationCommits: state.baseOnly, targetCommits: state.targetOnly,
      });
    }
  }
  return issues;
}

function worktreeMap() {
  const output = runGit(['worktree', 'list', '--porcelain']);
  const result = new Map();
  let directory = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) directory = line.slice('worktree '.length);
    if (line.startsWith('branch ') && directory) result.set(line.slice('branch refs/heads/'.length), directory);
    if (line === '') directory = null;
  }
  return result;
}

function stateFor(definition, integrationBranch, worktrees) {
  const { baseOnly, targetOnly } = branchDivergence(integrationBranch, definition.branch);
  const worktree = worktrees.get(definition.branch) ?? null;
  const dirtyFiles = worktree
    ? runGit(['-C', worktree, 'status', '--porcelain']).trim().split(/\r?\n/).filter(Boolean).length
    : null;
  return {
    ...definition,
    worktree,
    dirtyFiles,
    baseOnly,
    targetOnly,
    relation: classifyBranchRelation({ baseOnly, targetOnly }),
  };
}

function targetDefinitions(registry, requested) {
  const definitions = [
    ...registry.scopes.map(scope => ({ id: scope.id, kind: 'scope', branch: scope.branch })),
    { id: 'release', kind: 'release', branch: registry.releaseBranch },
  ];
  if (requested.length === 0 || requested.includes('all')) return definitions;
  const known = new Set(definitions.map(item => item.id));
  const unknown = requested.filter(item => !known.has(item));
  if (unknown.length) throw new Error(`workspace_sync_target_unknown:${unknown.join(',')}`);
  return definitions.filter(item => requested.includes(item.id));
}

export function parseSyncArguments(args) {
  const allowedOptions = new Set(['--apply', '--check']);
  const unknownOptions = args.filter(argument => argument.startsWith('--') && !allowedOptions.has(argument));
  if (unknownOptions.length) throw new Error(`workspace_sync_argument_unknown:${unknownOptions.join(',')}`);
  if (args.includes('--apply') && args.includes('--check')) throw new Error('workspace_sync_mode_conflict');
  return {
    apply: args.includes('--apply'),
    targets: args.filter(argument => !argument.startsWith('--')),
  };
}

async function main() {
  const registry = readRegistry();
  const parsed = parseSyncArguments(process.argv.slice(2));
  const definitions = targetDefinitions(registry, parsed.targets);
  let worktrees = worktreeMap();
  const before = definitions.map(definition => stateFor(definition, registry.integrationBranch, worktrees));
  const preflightIssues = syncIssues(before, { allowFastForward: parsed.apply });
  const actions = [];

  if (parsed.apply && preflightIssues.length === 0) {
    for (const state of before) {
      if (state.relation !== 'BEHIND') continue;
      runGit(['-C', state.worktree, 'merge', '--ff-only', registry.integrationBranch]);
      actions.push({ target: state.id, branch: state.branch, action: 'FAST_FORWARD', fromBehindBy: state.baseOnly });
    }
  }

  worktrees = worktreeMap();
  const after = definitions.map(definition => stateFor(definition, registry.integrationBranch, worktrees));
  const issues = parsed.apply && preflightIssues.length > 0 ? preflightIssues : syncIssues(after);
  const result = {
    ok: issues.length === 0,
    schema: 'nexyfab.workspace-sync.v1',
    mode: parsed.apply ? 'APPLY_FAST_FORWARD_ONLY' : 'CHECK',
    integrationBranch: registry.integrationBranch,
    releaseBranch: registry.releaseBranch,
    targets: after,
    actions,
    issues,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch(error => {
  console.error(`[workspace-sync] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
