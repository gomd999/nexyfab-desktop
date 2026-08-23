import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHandoffDocument } from './handoff-validation.mjs';
import { resolveOwnership } from './workspace-registry.mjs';

const registry = {
  integrationBranch: 'integration/nexyfab',
  defaultOwner: 'platform',
  sharedPaths: ['packages/**'],
  scopes: [
    { id: 'platform', branch: 'scope/platform', ownedPaths: ['apps/**'], checks: ['npm run lint:ci', 'npm run typecheck'] },
    { id: 'precision-cad', branch: 'scope/precision-cad', ownedPaths: ['capabilities/precision-cad/**'], checks: ['npm run typecheck'] },
    { id: 'ai-design', branch: 'scope/ai-design', ownedPaths: ['capabilities/ai-design/**'], checks: ['npm run typecheck'] },
  ],
};

function document(overrides = {}) {
  return `# Platform handoff\n\n- Created: 2026-08-24T00:00:00.000Z\n- Branch: \`${overrides.branch ?? 'scope/platform'}\`\n- Head: \`${'a'.repeat(40)}\`\n- Integration target: \`integration/nexyfab\`\n\n## Summary\n\n${overrides.summary ?? 'Completed an isolated platform boundary with evidence.'}\n\n## Changed paths\n\n- \`${overrides.path ?? 'apps/core-api/server.mjs'}\`\n\n## Verification\n\n- [x] \`npm run lint:ci\`\n- [x] \`npm run typecheck\`\n\n## Remaining work and risks\n\n- Release remains intentionally held.\n`;
}

test('completed handoff validates required checks and owned paths', () => {
  assert.equal(evaluateHandoffDocument(document(), registry.scopes[0], registry, resolveOwnership).ok, true);
});

test('handoff rejects TODO text, unchecked required checks, and shared paths', () => {
  const markdown = document({ summary: 'TODO: finish this handoff', path: 'packages/contracts/index.ts' }).replace('- [x] `npm run typecheck`', '- [ ] `npm run typecheck`');
  const result = evaluateHandoffDocument(markdown, registry.scopes[0], registry, resolveOwnership);
  assert.equal(result.ok, false);
  assert.match(result.issues.join(','), /summary_incomplete/);
  assert.match(result.issues.join(','), /required_check_not_verified/);
  assert.match(result.issues.join(','), /shared_path_forbidden/);
});
