import assert from 'node:assert/strict';
import test from 'node:test';
import { changedBusinessRowCounts } from './run-postgres-migration-with-receipt.mjs';

test('treats newly created empty tables as unchanged business data', () => {
  assert.deepEqual(changedBusinessRowCounts([], [
    ['nf_users', 0],
    ['nf_projects', 0],
  ]), []);
});

test('reports inserted, deleted, and removed business rows', () => {
  assert.deepEqual(changedBusinessRowCounts([
    ['nf_files', 2],
    ['nf_projects', 1],
    ['nf_users', 0],
  ], [
    ['nf_files', 3],
    ['nf_users', 1],
  ]), ['nf_files', 'nf_projects', 'nf_users']);
});

test('treats an absent table and an empty table equivalently in either direction', () => {
  assert.deepEqual(changedBusinessRowCounts([['nf_projects', 0]], []), []);
});
