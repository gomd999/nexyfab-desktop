#!/usr/bin/env node
import { collectChangedPaths, currentBranch, getScope, readRegistry, resolveOwnership } from './workspace-registry.mjs';
import { executeScopeChecks, notRunScopeChecks } from './workspace-guardrails.mjs';

const registry = readRegistry();
const scope = getScope(registry, process.argv[2]);
const branch = currentBranch();
const changedPaths = collectChangedPaths(registry);
const ownership = changedPaths.map(file => resolveOwnership(file, registry));
const sharedViolations = ownership.filter(item => item.shared).map(item => item.file);
const foreignViolations = ownership
  .filter(item => !item.shared && item.owner !== scope.id)
  .map(item => ({ file: item.file, owner: item.owner }));
const structuralOk = branch === scope.branch && sharedViolations.length === 0 && foreignViolations.length === 0;
const checkResults = structuralOk
  ? executeScopeChecks(scope.checks)
  : notRunScopeChecks(scope.checks, 'scope_preflight_failed');
const result = {
  ok: structuralOk && checkResults.every(check => check.status === 'PASS'),
  scope: scope.id,
  expectedBranch: scope.branch,
  branch,
  changedFiles: changedPaths.length,
  sharedViolations,
  foreignViolations,
  structuralOk,
  checks: checkResults,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
