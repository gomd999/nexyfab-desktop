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
  if (descriptor.registry !== '../registry.json') descriptorIssues.push(`scope_registry_invalid:${scope.id}`);
  if (descriptor.integrationMode !== 'contracts-and-handoffs') {
    descriptorIssues.push(`scope_integration_mode_invalid:${scope.id}`);
  }
  if (!['COMPATIBILITY_BOUNDARY', 'LEGACY_COMPATIBILITY'].includes(descriptor.migrationState)) {
    descriptorIssues.push(`scope_migration_state_invalid:${scope.id}`);
  }
  for (const field of ['targetRoots', 'legacySourceRoots']) {
    if (!Array.isArray(descriptor[field]) || descriptor[field].length === 0) {
      descriptorIssues.push(`scope_${field}_invalid:${scope.id}`);
      continue;
    }
    for (const sourceRoot of descriptor[field]) {
      if (!fs.existsSync(path.join(repositoryRoot, sourceRoot))) {
        descriptorIssues.push(`scope_${field}_missing:${scope.id}:${sourceRoot}`);
      }
    }
  }

  if (scope.id === 'platform') continue;
  const capabilityPath = path.join(repositoryRoot, 'capabilities', scope.id, 'capability.json');
  if (!fs.existsSync(capabilityPath)) {
    descriptorIssues.push(`capability_descriptor_missing:${scope.id}`);
    continue;
  }
  const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
  if (
    capability.schema !== 'nexyfab.workspace-capability.v1'
    || capability.id !== scope.id
    || capability.owner !== scope.branch
    || capability.implementationState !== descriptor.migrationState
  ) {
    descriptorIssues.push(`capability_descriptor_invalid:${scope.id}`);
  }
  if (!Array.isArray(capability.legacySourceRoots) || capability.legacySourceRoots.length === 0) {
    descriptorIssues.push(`capability_legacy_roots_invalid:${scope.id}`);
  }
  for (const sourceRoot of capability.legacySourceRoots ?? []) {
    if (!fs.existsSync(path.join(repositoryRoot, sourceRoot))) {
      descriptorIssues.push(`capability_legacy_root_missing:${scope.id}:${sourceRoot}`);
    }
  }
  if (!Array.isArray(capability.sharedContracts) || capability.sharedContracts.length === 0) {
    descriptorIssues.push(`capability_contracts_invalid:${scope.id}`);
  }
  for (const contractRoot of capability.sharedContracts ?? []) {
    if (!resolveOwnership(`${contractRoot}/src/index.ts`, registry).shared) {
      descriptorIssues.push(`capability_contract_not_shared:${scope.id}:${contractRoot}`);
    }
    if (!fs.existsSync(path.join(repositoryRoot, contractRoot, 'src', 'index.ts'))) {
      descriptorIssues.push(`capability_contract_missing:${scope.id}:${contractRoot}`);
    }
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
