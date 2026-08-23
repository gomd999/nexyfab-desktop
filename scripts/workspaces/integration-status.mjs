#!/usr/bin/env node
import { currentBranch, currentHead, readRegistry, runGit } from './workspace-registry.mjs';
import { evaluateIntegrationState } from './workspace-guardrails.mjs';

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

const branch = currentBranch();
const allowReady = process.argv.includes('--allow-ready');
const evaluation = evaluateIntegrationState({
  expectedBranch: registry.integrationBranch,
  branch,
  scopes,
  allowReady,
});
const result = {
  ok: evaluation.ok,
  integrationBranch: registry.integrationBranch,
  branch,
  head: currentHead(),
  mode: allowReady ? 'ALLOW_READY' : 'STRICTLY_INTEGRATED',
  scopes,
  issues: evaluation.issues,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
