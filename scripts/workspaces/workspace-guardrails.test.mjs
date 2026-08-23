import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateIntegrationState,
  executeScopeChecks,
  notRunScopeChecks,
  parseCheckCommand,
  resolveCheckInvocation,
} from './workspace-guardrails.mjs';

test('workspace checks reject shell syntax instead of passing it to a shell', () => {
  assert.deepEqual(parseCheckCommand('npm run typecheck'), {
    executable: 'npm',
    args: ['run', 'typecheck'],
  });
  assert.throws(() => parseCheckCommand('npm run typecheck && echo unsafe'), /command_unsafe/);
  assert.throws(() => parseCheckCommand(''), /command_unsafe/);
});

test('Windows npm checks execute the current npm CLI through Node without a shell', () => {
  assert.deepEqual(resolveCheckInvocation(parseCheckCommand('npm run typecheck'), {
    platform: 'win32',
    npmExecPath: 'C:/npm/bin/npm-cli.js',
    nodeExecPath: 'C:/node/node.exe',
  }), {
    executable: 'C:/node/node.exe',
    args: ['C:/npm/bin/npm-cli.js', 'run', 'typecheck'],
  });
  assert.throws(() => resolveCheckInvocation(parseCheckCommand('npm run typecheck'), {
    platform: 'win32', npmExecPath: '', nodeExecPath: 'node.exe',
  }), /npm_execpath_missing/);
});

test('scope checks report every command and fail closed', () => {
  const calls = [];
  const results = executeScopeChecks(['npm run first', 'npm run second'], {
    runner(command) {
      calls.push(command);
      return { status: command.endsWith('first') ? 0 : 2, signal: null };
    },
  });
  assert.deepEqual(calls, ['npm run first', 'npm run second']);
  assert.deepEqual(results.map(result => result.status), ['PASS', 'FAIL']);
  assert.equal(results[1].exitCode, 2);
});

test('scope checks remain visibly not-run when structural preflight fails', () => {
  assert.deepEqual(notRunScopeChecks(['npm run typecheck'], 'scope_preflight_failed'), [{
    command: 'npm run typecheck',
    status: 'NOT_RUN',
    reason: 'scope_preflight_failed',
    exitCode: null,
    signal: null,
    error: null,
    durationMs: 0,
  }]);
});

test('integration state rejects missing, dirty, behind, and unmerged scope worktrees', () => {
  const evaluation = evaluateIntegrationState({
    expectedBranch: 'integration/nexyfab',
    branch: 'integration/nexyfab',
    scopes: [
      { id: 'platform', worktree: null, dirtyFiles: null, commitsBehindIntegration: 0, commitsReadyToIntegrate: 0 },
      { id: 'precision-cad', worktree: 'precision', dirtyFiles: 2, commitsBehindIntegration: 1, commitsReadyToIntegrate: 0 },
      { id: 'ai-design', worktree: 'ai', dirtyFiles: 0, commitsBehindIntegration: 0, commitsReadyToIntegrate: 3 },
    ],
  });
  assert.equal(evaluation.ok, false);
  assert.deepEqual(evaluation.issues.map(issue => issue.code), [
    'scope_worktree_missing',
    'scope_worktree_dirty',
    'scope_behind_integration',
    'scope_not_integrated',
  ]);
});

test('allow-ready mode permits clean ahead branches but still rejects drift', () => {
  const evaluation = evaluateIntegrationState({
    expectedBranch: 'integration/nexyfab',
    branch: 'integration/nexyfab',
    allowReady: true,
    scopes: [
      { id: 'platform', worktree: 'platform', dirtyFiles: 0, commitsBehindIntegration: 0, commitsReadyToIntegrate: 2 },
    ],
  });
  assert.deepEqual(evaluation, { ok: true, issues: [] });
});
