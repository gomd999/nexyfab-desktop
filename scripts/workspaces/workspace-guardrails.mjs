import { spawnSync } from 'node:child_process';

const forbiddenShellSyntax = /[|&;<>()`$]/;
const supportedToken = /^[A-Za-z0-9_./:@=+,-]+$/;

export function parseCheckCommand(command) {
  const value = String(command ?? '').trim();
  if (!value || forbiddenShellSyntax.test(value)) {
    throw new Error(`workspace_check_command_unsafe:${value || 'empty'}`);
  }
  const tokens = value.split(/\s+/);
  if (tokens.some(token => !supportedToken.test(token))) {
    throw new Error(`workspace_check_command_unsupported:${value}`);
  }
  return { executable: tokens[0], args: tokens.slice(1) };
}

export function resolveCheckInvocation(parsed, runtime = {}) {
  const platform = runtime.platform ?? process.platform;
  const npmExecPath = runtime.npmExecPath ?? process.env.npm_execpath;
  const nodeExecPath = runtime.nodeExecPath ?? process.execPath;
  if (platform === 'win32' && ['npm', 'npx'].includes(parsed.executable)) {
    if (!npmExecPath) throw new Error('workspace_check_npm_execpath_missing');
    const cliPath = parsed.executable === 'npx'
      ? npmExecPath.replace(/npm-cli\.js$/i, 'npx-cli.js')
      : npmExecPath;
    return { executable: nodeExecPath, args: [cliPath, ...parsed.args] };
  }
  return parsed;
}

export function runCheckCommand(command, options = {}) {
  const parsed = parseCheckCommand(command);
  const invocation = resolveCheckInvocation(parsed);
  return spawnSync(invocation.executable, invocation.args, {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: options.stdio ?? 'inherit',
    maxBuffer: 128 * 1024 * 1024,
  });
}

export function executeScopeChecks(commands, options = {}) {
  const runner = options.runner ?? ((command) => runCheckCommand(command, options));
  return commands.map(command => {
    const startedAt = Date.now();
    const execution = runner(command);
    const exitCode = Number.isInteger(execution?.status) ? execution.status : null;
    const passed = !execution?.error && exitCode === 0;
    return {
      command,
      status: passed ? 'PASS' : 'FAIL',
      exitCode,
      signal: execution?.signal ?? null,
      error: execution?.error?.message ?? null,
      durationMs: Date.now() - startedAt,
    };
  });
}

export function notRunScopeChecks(commands, reason) {
  return commands.map(command => ({
    command,
    status: 'NOT_RUN',
    reason,
    exitCode: null,
    signal: null,
    error: null,
    durationMs: 0,
  }));
}

export function classifyBranchRelation({ baseOnly, targetOnly }) {
  if (!Number.isSafeInteger(baseOnly) || baseOnly < 0 || !Number.isSafeInteger(targetOnly) || targetOnly < 0) {
    throw new Error('workspace_branch_relation_invalid');
  }
  if (baseOnly === 0 && targetOnly === 0) return 'IN_SYNC';
  if (baseOnly > 0 && targetOnly === 0) return 'BEHIND';
  if (baseOnly === 0 && targetOnly > 0) return 'AHEAD';
  return 'DIVERGED';
}

export function evaluateIntegrationState({ expectedBranch, branch, scopes, release = null, allowReady = false }) {
  const issues = [];
  if (branch !== expectedBranch) {
    issues.push({ code: 'integration_branch_mismatch', expected: expectedBranch, actual: branch });
  }
  for (const scope of scopes) {
    if (!scope.worktree) issues.push({ code: 'scope_worktree_missing', scope: scope.id });
    if (scope.dirtyFiles === null) {
      // The missing-worktree issue above is the actionable root cause.
    } else if (scope.dirtyFiles > 0) {
      issues.push({ code: 'scope_worktree_dirty', scope: scope.id, dirtyFiles: scope.dirtyFiles });
    }
    if (scope.commitsBehindIntegration > 0) {
      issues.push({ code: 'scope_behind_integration', scope: scope.id, commits: scope.commitsBehindIntegration });
    }
    if (!allowReady && scope.commitsReadyToIntegrate > 0) {
      issues.push({ code: 'scope_not_integrated', scope: scope.id, commits: scope.commitsReadyToIntegrate });
    }
  }
  if (release) {
    if (!release.worktree) issues.push({ code: 'release_worktree_missing', branch: release.branch });
    if (release.dirtyFiles === null) {
      // The missing-worktree issue above is the actionable root cause.
    } else if (release.dirtyFiles > 0) {
      issues.push({ code: 'release_worktree_dirty', branch: release.branch, dirtyFiles: release.dirtyFiles });
    }
    if (release.commitsBehindIntegration > 0) {
      issues.push({ code: 'release_behind_integration', branch: release.branch, commits: release.commitsBehindIntegration });
    }
    if (release.commitsReadyToIntegrate > 0) {
      issues.push({ code: 'release_ahead_of_integration', branch: release.branch, commits: release.commitsReadyToIntegrate });
    }
  }
  return { ok: issues.length === 0, issues };
}
