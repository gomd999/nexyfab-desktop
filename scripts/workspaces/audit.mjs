#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  getScope,
  parseNul,
  readRegistry,
  repositoryRoot,
  resolveOwnership,
  runGit,
} from './workspace-registry.mjs';

const registry = readRegistry();
const trackedFiles = parseNul(runGit(['ls-files', '-z']));
const collisions = [];
let sharedFiles = 0;
const ownedCounts = Object.fromEntries(registry.scopes.map(scope => [scope.id, 0]));

for (const file of trackedFiles) {
  const ownership = resolveOwnership(file, registry);
  if (ownership.shared) {
    sharedFiles += 1;
    continue;
  }
  if (ownership.explicitOwners.length > 1) collisions.push(ownership);
  ownedCounts[ownership.owner] += 1;
}

const descriptorIssues = [];
for (const scopeDefinition of registry.scopes) {
  const scope = getScope(registry, scopeDefinition.id);
  const descriptorPath = path.join(repositoryRoot, 'workspaces', scope.id, 'SCOPE.json');
  if (!fs.existsSync(descriptorPath)) {
    descriptorIssues.push(`scope_descriptor_missing:${scope.id}`);
    continue;
  }
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  if (descriptor.schema !== 'nexyfab.workspace-scope.v1' || descriptor.id !== scope.id) {
    descriptorIssues.push(`scope_descriptor_invalid:${scope.id}`);
  }
}

const result = {
  ok: collisions.length === 0 && descriptorIssues.length === 0,
  schema: registry.schema,
  integrationBranch: registry.integrationBranch,
  trackedFiles: trackedFiles.length,
  sharedFiles,
  ownedFiles: ownedCounts,
  collisions,
  descriptorIssues,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
