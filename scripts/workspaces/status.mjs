#!/usr/bin/env node
import { collectChangedPaths, currentBranch, currentHead, getScope, readRegistry, resolveOwnership } from './workspace-registry.mjs';

const registry = readRegistry();
const scope = getScope(registry, process.argv[2]);
const changedPaths = collectChangedPaths(registry);
const classified = changedPaths.map(file => resolveOwnership(file, registry));
console.log(JSON.stringify({
  scope: scope.id,
  expectedBranch: scope.branch,
  branch: currentBranch(),
  head: currentHead(),
  changedFiles: changedPaths.length,
  ownedChanges: classified.filter(item => !item.shared && item.owner === scope.id).map(item => item.file),
  sharedChanges: classified.filter(item => item.shared).map(item => item.file),
  foreignChanges: classified.filter(item => !item.shared && item.owner !== scope.id).map(item => ({ file: item.file, owner: item.owner })),
}, null, 2));
