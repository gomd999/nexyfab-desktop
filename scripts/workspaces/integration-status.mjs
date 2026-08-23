#!/usr/bin/env node
import { currentBranch, currentHead, readRegistry, runGit } from './workspace-registry.mjs';

const registry = readRegistry();
const worktreeOutput = runGit(['worktree', 'list', '--porcelain']);
const worktrees = new Map();
let worktreePath = null;
for (const line of worktreeOutput.split(/\r?\n/)) {
  if (line.startsWith('worktree ')) worktreePath = line.slice('worktree '.length);
  if (line.startsWith('branch ') && worktreePath) {
    worktrees.set(line.slice('branch refs/heads/'.length), worktreePath);
  }
  if (line === '') worktreePath = null;
}

const scopes = registry.scopes.map(scope => {
  const [integrationOnly, scopeOnly] = runGit([
    'rev-list',
    '--left-right',
    '--count',
    `${registry.integrationBranch}...${scope.branch}`,
  ]).trim().split(/\s+/).map(Number);
  const directory = worktrees.get(scope.branch) ?? null;
  const dirtyFiles = directory
    ? runGit(['-C', directory, 'status', '--porcelain']).trim().split(/\r?\n/).filter(Boolean).length
    : null;
  return {
    id: scope.id,
    branch: scope.branch,
    worktree: directory,
    dirtyFiles,
    commitsBehindIntegration: integrationOnly,
    commitsReadyToIntegrate: scopeOnly,
  };
});

console.log(JSON.stringify({
  ok: currentBranch() === registry.integrationBranch,
  integrationBranch: registry.integrationBranch,
  branch: currentBranch(),
  head: currentHead(),
  scopes,
}, null, 2));
