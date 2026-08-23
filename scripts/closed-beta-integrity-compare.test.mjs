import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256 } from './immutable-receipt-binding.mjs';
import {
  buildClosedBetaIntegrityReceipt,
  compareClosedBetaIntegrity,
  verifyClosedBetaIntegrityReceipt,
} from './closed-beta-integrity-compare.mjs';

const snapshot = () => ({
  schemaVersion: 2,
  source: { readonly: true, databasePathSha256: 'd'.repeat(64), databaseBytes: 1024 },
  tables: {
    nf_users: { rowCount: 1, columns: ['id', 'email'], contentSha256: 'a'.repeat(64) },
  },
  files: [{ relativePath: 'data/private-storage/files/u/a.step', pathSha256: sha256('data/private-storage/files/u/a.step'), size: 10, contentSha256: 'f'.repeat(64) }],
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

test('rejects matching but empty or malformed snapshots instead of manufacturing PASS', () => {
  const empty = {
    schemaVersion: 2,
    source: { readonly: true, databasePathSha256: 'd'.repeat(64), databaseBytes: 0 },
    tables: {},
    files: [],
  };
  const emptyResult = compareClosedBetaIntegrity(empty, structuredClone(empty));
  assert.equal(emptyResult.ok, false);
  assert.ok(emptyResult.differences.includes('baseline_protected_tables_invalid'));

  const malformed = snapshot();
  malformed.files.push({ ...malformed.files[0] });
  const malformedResult = compareClosedBetaIntegrity(malformed, structuredClone(malformed));
  assert.equal(malformedResult.ok, false);
  assert.ok(malformedResult.differences.some(value => value.startsWith('baseline_file_invalid:')));
});

test('builds a fresh release-bound receipt from exact snapshot bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closed-beta-v2-'));
  try {
    const baseline = Buffer.from(`${JSON.stringify(snapshot())}\n`);
    const candidate = Buffer.from(`${JSON.stringify(snapshot())}\n`);
    fs.writeFileSync(path.join(root, 'baseline.json'), baseline);
    fs.writeFileSync(path.join(root, 'candidate.json'), candidate);
    const now = Date.parse('2026-08-23T00:00:00.000Z');
    const receipt = buildClosedBetaIntegrityReceipt(compareClosedBetaIntegrity(JSON.parse(baseline), JSON.parse(candidate)), {
      root,
      baselinePath: 'baseline.json',
      candidatePath: 'candidate.json',
      baselineBytes: baseline,
      candidateBytes: candidate,
      generatedAt: new Date(now).toISOString(),
      now,
      release: { buildId: 'build-1', deploymentId: 'deploy-1', gitHead: 'a'.repeat(40) },
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'PASS');
    assert.deepEqual(verifyClosedBetaIntegrityReceipt(receipt, { root, now, expectedRelease: { buildId: 'build-1', deploymentId: 'deploy-1', head: 'a'.repeat(40) } }), { ok: true, blockers: [] });
    fs.writeFileSync(path.join(root, 'candidate.json'), Buffer.from(`${JSON.stringify({ ...snapshot(), source: { readonly: false, databasePathSha256: 'db' } })}\n`));
    assert.equal(verifyClosedBetaIntegrityReceipt(receipt, { root, now }).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('holds on path traversal, stale receipts, and forged labels', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closed-beta-v2-hold-'));
  try {
    const bytes = Buffer.from(`${JSON.stringify(snapshot())}\n`);
    fs.writeFileSync(path.join(root, 'snapshot.json'), bytes);
    const now = Date.parse('2026-08-23T00:00:00.000Z');
    const hold = buildClosedBetaIntegrityReceipt({ ok: true, differences: [], summary: {} }, {
      root,
      baselinePath: '../snapshot.json',
      candidatePath: 'snapshot.json',
      baselineBytes: bytes,
      candidateBytes: bytes,
      generatedAt: new Date(now - 2 * 24 * 60 * 60_000).toISOString(),
      now,
      release: { buildId: 'build-1', deploymentId: 'deploy-1', gitHead: 'not-a-sha' },
    });
    assert.equal(hold.ok, false);
    assert.equal(hold.status, 'HOLD');
    const forged = { ...hold, ok: true, status: 'PASS' };
    assert.equal(verifyClosedBetaIntegrityReceipt(forged, { root, now }).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
