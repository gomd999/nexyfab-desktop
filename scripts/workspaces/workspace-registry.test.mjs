import assert from 'node:assert/strict';
import test from 'node:test';
import { globToRegExp, matchesPattern, resolveOwnership, validateRegistry } from './workspace-registry.mjs';

const registry = {
  schema: 'nexyfab.workspace-registry.v1',
  integrationBranch: 'integration/nexyfab',
  releaseBranch: 'release/web-public',
  defaultOwner: 'platform',
  sharedPaths: ['packages/**', 'workspaces/registry.json'],
  scopes: [
    { id: 'platform', branch: 'scope/platform', worktreeDirectory: 'platform', defaultOwner: true, ownedPaths: ['apps/**'], checks: ['npm run typecheck'] },
    { id: 'precision-cad', branch: 'scope/precision-cad', worktreeDirectory: 'precision-cad', ownedPaths: ['src/lib/cad/**'], checks: ['npm run typecheck'] },
    { id: 'ai-design', branch: 'scope/ai-design', worktreeDirectory: 'ai-design', ownedPaths: ['src/lib/ai/**'], checks: ['npm run typecheck'] },
  ],
};

test('glob matching supports recursive and single-segment wildcards', () => {
  assert.equal(matchesPattern('src/lib/cad/feature/tree.ts', 'src/lib/cad/**'), true);
  assert.equal(matchesPattern('src/app/api/nexyfab/projects/[id]/precision-cad-agent/turn/route.ts', 'src/app/api/nexyfab/projects/*/precision-cad-agent/**'), true);
  assert.equal(globToRegExp('apps/**').test('src/apps/file.ts'), false);
});

test('shared ownership takes precedence over explicit or default ownership', () => {
  assert.deepEqual(resolveOwnership('packages/cad-contracts/src/index.ts', registry), {
    file: 'packages/cad-contracts/src/index.ts',
    shared: true,
    explicitOwners: [],
    defaulted: false,
    classification: 'shared',
    owner: null,
  });
});

test('explicit and default ownership resolve deterministically', () => {
  assert.deepEqual(resolveOwnership('src/lib/ai/provider.ts', registry), {
    file: 'src/lib/ai/provider.ts', shared: false, explicitOwners: ['ai-design'], defaulted: false, classification: 'explicit', owner: 'ai-design',
  });
  assert.deepEqual(resolveOwnership('src/app/page.tsx', registry), {
    file: 'src/app/page.tsx', shared: false, explicitOwners: [], defaulted: true, classification: 'default', owner: 'platform',
  });
});

test('registry validation rejects duplicate scope ids', () => {
  const invalid = structuredClone(registry);
  invalid.scopes[2].id = 'precision-cad';
  assert.throws(() => validateRegistry(invalid), /scope_id_duplicate/);
});

test('registry validation requires distinct integration and release branches', () => {
  const missing = structuredClone(registry);
  delete missing.releaseBranch;
  assert.throws(() => validateRegistry(missing), /workspace_registry_branch_invalid/);
  const collided = structuredClone(registry);
  collided.releaseBranch = collided.integrationBranch;
  assert.throws(() => validateRegistry(collided), /workspace_registry_branch_collision/);
});

test('registry validation separates ordinary checks from optional release gates', () => {
  const invalidChecks = structuredClone(registry);
  invalidChecks.scopes[0].checks = [];
  assert.throws(() => validateRegistry(invalidChecks), /workspace_scope_checks_invalid/);

  const invalidReleaseGates = structuredClone(registry);
  invalidReleaseGates.scopes[1].releaseGates = 'npm run release';
  assert.throws(() => validateRegistry(invalidReleaseGates), /workspace_scope_release_gates_invalid/);
});

test('registry validation rejects checks containing shell operators', () => {
  const invalid = structuredClone(registry);
  invalid.scopes[0].checks = ['npm run typecheck && echo bypass'];
  assert.throws(() => validateRegistry(invalid), /workspace_check_command_unsafe/);
});
