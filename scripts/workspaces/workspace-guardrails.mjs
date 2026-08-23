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

export function runCheckCommand(command, options = {}) {
  const parsed = parseCheckCommand(command);
  const executable = process.platform === 'win32' && ['npm', 'npx'].includes(parsed.executable)
    ? `${parsed.executable}.cmd`
    : parsed.executable;
  return spawnSync(executable, parsed.args, {
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

export function evaluateIntegrationState({ expectedBranch, branch, scopes, allowReady = false }) {
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
  return { ok: issues.length === 0, issues };
}
