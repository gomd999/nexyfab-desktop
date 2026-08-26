import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBranchRelation } from './workspace-guardrails.mjs';
import { parseSyncArguments, syncIssues } from './sync.mjs';

function state(overrides = {}) {
  return {
    id: 'ai-design', kind: 'scope', branch: 'scope/ai-design', worktree: 'C:/repo/ai-design',
    dirtyFiles: 0, baseOnly: 0, targetOnly: 0, relation: 'IN_SYNC', ...overrides,
  };
}

test('classifies branch relationships from the integration point of view', () => {
  assert.equal(classifyBranchRelation({ baseOnly: 0, targetOnly: 0 }), 'IN_SYNC');
  assert.equal(classifyBranchRelation({ baseOnly: 2, targetOnly: 0 }), 'BEHIND');
  assert.equal(classifyBranchRelation({ baseOnly: 0, targetOnly: 3 }), 'AHEAD');
  assert.equal(classifyBranchRelation({ baseOnly: 2, targetOnly: 3 }), 'DIVERGED');
  assert.throws(() => classifyBranchRelation({ baseOnly: -1, targetOnly: 0 }), /branch_relation_invalid/);
});

test('check mode fails on every one-sided or unsafe target state', () => {
  const issues = syncIssues([
    state({ id: 'missing', worktree: null, dirtyFiles: null }),
    state({ id: 'dirty', dirtyFiles: 2 }),
    state({ id: 'behind', baseOnly: 4, relation: 'BEHIND' }),
    state({ id: 'ahead', targetOnly: 1, relation: 'AHEAD' }),
    state({ id: 'diverged', baseOnly: 2, targetOnly: 1, relation: 'DIVERGED' }),
    state({ id: 'release', kind: 'release', branch: 'release/web-public', targetOnly: 1, relation: 'AHEAD' }),
  ]);
  assert.deepEqual(issues.map(issue => issue.code), [
    'workspace_sync_worktree_missing',
    'workspace_sync_worktree_dirty',
    'workspace_sync_target_behind',
    'workspace_sync_scope_ready_to_integrate',
    'workspace_sync_target_diverged',
    'workspace_sync_release_ahead',
  ]);
});

test('apply mode permits only clean fast-forward targets', () => {
  assert.deepEqual(syncIssues([state({ baseOnly: 4, relation: 'BEHIND' })], { allowFastForward: true }), []);
  assert.equal(syncIssues([state({ dirtyFiles: 1, baseOnly: 4, relation: 'BEHIND' })], { allowFastForward: true })[0].code, 'workspace_sync_worktree_dirty');
  assert.equal(syncIssues([state({ targetOnly: 1, relation: 'AHEAD' })], { allowFastForward: true })[0].code, 'workspace_sync_scope_ready_to_integrate');
});

test('argument parsing is explicit and rejects ambiguous modes', () => {
  assert.deepEqual(parseSyncArguments(['ai-design', 'release', '--apply']), { apply: true, targets: ['ai-design', 'release'] });
  assert.throws(() => parseSyncArguments(['--apply', '--check']), /mode_conflict/);
  assert.throws(() => parseSyncArguments(['--force']), /argument_unknown/);
});
