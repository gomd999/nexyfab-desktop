#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  buildDevEnvironment,
  getDevProfile,
  publicDevProfile,
  readDevProfiles,
} from './dev-profile.mjs';
import { branchDivergence, currentBranch, readRegistry } from './workspace-registry.mjs';

const args = process.argv.slice(2);
const scopeId = args.find(argument => !argument.startsWith('--'));
const printOnly = args.includes('--print');
const inheritDatabase = args.includes('--inherit-database');
const allowedArguments = new Set([scopeId, '--print', '--inherit-database']);
const unknown = args.filter(argument => !allowedArguments.has(argument));
if (unknown.length > 0) throw new Error(`workspace_dev_argument_unknown:${unknown.join(',')}`);

const profile = getDevProfile(readDevProfiles(), scopeId);
const branch = currentBranch();
if (branch !== profile.branch) throw new Error(`workspace_dev_branch_mismatch:${profile.branch}:${branch}`);
const registry = readRegistry();
const divergence = branchDivergence(registry.integrationBranch, profile.branch);
if (divergence.baseOnly > 0) {
  throw new Error(`workspace_dev_scope_behind_integration:${scopeId}:${divergence.baseOnly}:run_workspace_sync_first`);
}

const resolved = buildDevEnvironment(profile, { inheritDatabase });
const publicProfile = publicDevProfile(profile, resolved, { inheritDatabase });
process.stdout.write(`${JSON.stringify(publicProfile, null, 2)}\n`);
if (printOnly) process.exit(0);

fs.mkdirSync(resolved.stateDirectory, { recursive: true });
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) throw new Error('workspace_dev_npm_execpath_missing');
const child = spawn(process.execPath, [npmExecPath, 'run', 'dev', '--', '--port', String(profile.port), '--hostname', '127.0.0.1'], {
  cwd: process.cwd(),
  env: resolved.environment,
  stdio: 'inherit',
  windowsHide: true,
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', error => {
  throw error;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
