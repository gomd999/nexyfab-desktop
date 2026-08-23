#!/usr/bin/env node
import { collectChangedPaths, currentBranch, getScope, readRegistry, resolveOwnership } from './workspace-registry.mjs';

const registry = readRegistry();
const scope = getScope(registry, process.argv[2]);
const branch = currentBranch();
const changedPaths = collectChangedPaths(registry);
const ownership = changedPaths.map(file => resolveOwnership(file, registry));
const sharedViolations = ownership.filter(item => item.shared).map(item => item.file);
const foreignViolations = ownership
  .filter(item => !item.shared && item.owner !== scope.id)
  .map(item => ({ file: item.file, owner: item.owner }));
const result = {
  ok: branch === scope.branch && sharedViolations.length === 0 && foreignViolations.length === 0,
  scope: scope.id,
  expectedBranch: scope.branch,
  branch,
  changedFiles: changedPaths.length,
  sharedViolations,
  foreignViolations,
  checks: scope.checks,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
