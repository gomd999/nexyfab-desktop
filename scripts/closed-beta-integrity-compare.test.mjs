import assert from 'node:assert/strict';
import test from 'node:test';
import { compareClosedBetaIntegrity } from './closed-beta-integrity-compare.mjs';

const snapshot = () => ({
  schemaVersion: 2,
  source: { readonly: true, databasePathSha256: 'db' },
  tables: {
    nf_users: { rowCount: 1, columns: ['id', 'email'], contentSha256: 'users' },
  },
  files: [{ relativePath: 'data/private-storage/files/u/a.step', pathSha256: 'path', size: 10, contentSha256: 'file' }],
  summary: { protectedRowCount: 1, fileBytes: 10 },
});

test('accepts identical protected Closed Beta state', () => {
  assert.deepEqual(compareClosedBetaIntegrity(snapshot(), structuredClone(snapshot())), {
    ok: true,
    differences: [],
    summary: { protectedTableCount: 1, protectedRowCount: 1, protectedFileCount: 1, protectedFileBytes: 10 },
  });
});

test('fails closed for account, permission-scope, and file mutations', () => {
  const baseline = snapshot();
  const changed = snapshot();
  changed.tables.nf_users.contentSha256 = 'changed';
  changed.tables.nf_documents = { rowCount: 0, columns: ['id'], contentSha256: 'empty' };
  changed.files[0].contentSha256 = 'changed';
  const result = compareClosedBetaIntegrity(baseline, changed);
  assert.equal(result.ok, false);
  assert.ok(result.differences.some((value) => value.startsWith('protected_table_set_changed:')));
  assert.ok(result.differences.includes('table_content_changed:nf_users'));
  assert.ok(result.differences.includes('file_content_changed:data/private-storage/files/u/a.step'));
});

test('rejects snapshots that were not produced read-only', () => {
  const changed = snapshot();
  changed.source.readonly = false;
  assert.ok(compareClosedBetaIntegrity(snapshot(), changed).differences.includes('candidate_not_readonly'));
});
