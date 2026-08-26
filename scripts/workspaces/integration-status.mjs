#!/usr/bin/env node
import { branchDivergence, currentBranch, currentHead, readRegistry, runGit } from './workspace-registry.mjs';
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

function branchState(branch) {
  const { baseOnly, targetOnly } = branchDivergence(registry.integrationBranch, branch);
  const directory = worktrees.get(branch) ?? null;
  const dirtyFiles = directory
    ? runGit(['-C', directory, 'status', '--porcelain']).trim().split(/\r?\n/).filter(Boolean).length
    : null;
  return {
    branch,
    worktree: directory,
    dirtyFiles,
    commitsBehindIntegration: baseOnly,
    commitsReadyToIntegrate: targetOnly,
  };
}

const scopes = registry.scopes.map(scope => {
  return {
    id: scope.id,
    ...branchState(scope.branch),
  };
});
const release = branchState(registry.releaseBranch);

const branch = currentBranch();
const allowReady = process.argv.includes('--allow-ready');
const evaluation = evaluateIntegrationState({
  expectedBranch: registry.integrationBranch,
  branch,
  scopes,
  release,
  allowReady,
});
const result = {
  ok: evaluation.ok,
  integrationBranch: registry.integrationBranch,
  branch,
  head: currentHead(),
  mode: allowReady ? 'ALLOW_READY' : 'STRICTLY_INTEGRATED',
  scopes,
  release,
  issues: evaluation.issues,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
