import assert from 'node:assert/strict';
import test from 'node:test';
import { globToRegExp, matchesPattern, resolveOwnership, validateRegistry } from './workspace-registry.mjs';

const registry = {
  schema: 'nexyfab.workspace-registry.v1',
  integrationBranch: 'integration/nexyfab',
  defaultOwner: 'platform',
  sharedPaths: ['packages/**', 'workspaces/registry.json'],
  scopes: [
    { id: 'platform', branch: 'scope/platform', worktreeDirectory: 'platform', defaultOwner: true, ownedPaths: ['apps/**'] },
    { id: 'precision-cad', branch: 'scope/precision-cad', worktreeDirectory: 'precision-cad', ownedPaths: ['src/lib/cad/**'] },
    { id: 'ai-design', branch: 'scope/ai-design', worktreeDirectory: 'ai-design', ownedPaths: ['src/lib/ai/**'] },
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
    owner: null,
  });
});

test('explicit and default ownership resolve deterministically', () => {
  assert.equal(resolveOwnership('src/lib/ai/provider.ts', registry).owner, 'ai-design');
  assert.equal(resolveOwnership('src/app/page.tsx', registry).owner, 'platform');
});

test('registry validation rejects duplicate scope ids', () => {
  const invalid = structuredClone(registry);
  invalid.scopes[2].id = 'precision-cad';
  assert.throws(() => validateRegistry(invalid), /scope_id_duplicate/);
});
