import assert from 'node:assert/strict';
import test from 'node:test';
import { attachReceiptSha256, sha256 } from './immutable-receipt-binding.mjs';
import {
  buildProtectedStateReceipt,
  databaseIdentitySha256,
  stableColumns,
  verifyProtectedStateReceipt,
} from './compare-production-protected-state.mjs';

test('excludes login telemetry but keeps credentials and signup provenance protected', () => {
  const stable = stableColumns('nf_users', [
    'id',
    'email',
    'password_hash',
    'signup_ip',
    'last_login_at',
    'last_login_ip',
    'last_login_fingerprint',
    'login_count',
  ]);

  assert.deepEqual(stable, ['id', 'email', 'password_hash', 'signup_ip']);
});

test('database identity excludes credentials but distinguishes server and database targets', () => {
  const first = databaseIdentitySha256('postgresql://user-one:secret-one@db.example.test:5432/baseline');
  const sameTargetNewCredentials = databaseIdentitySha256('postgresql://user-two:secret-two@DB.EXAMPLE.TEST:5432/baseline');
  const candidate = databaseIdentitySha256('postgresql://user-one:secret-one@db.example.test:5432/production');
  assert.equal(first, sameTargetNewCredentials);
  assert.notEqual(first, candidate);
  assert.match(first, /^[a-f0-9]{64}$/);
});

function observedState() {
  const tables = {
    nf_users: {
      baselineRows: 2, candidateRows: 2, newRows: 0, missingRows: 0, changedExistingRows: 0,
      changedColumns: {}, primaryKeyColumns: 1, stableColumnCount: 4,
      stableColumnSetSha256: '1'.repeat(64), baselineStateSha256: '2'.repeat(64), candidateStateSha256: '2'.repeat(64),
    },
  };
  return {
    tables,
    evidence: {
      baseline: { identitySha256: sha256('baseline'), stateSha256: sha256({ nf_users: tables.nf_users.baselineStateSha256 }) },
      candidate: { identitySha256: sha256('candidate'), stateSha256: sha256({ nf_users: tables.nf_users.candidateStateSha256 }) },
    },
  };
}

test('builds and verifies a fresh protected-state receipt from derived state hashes', () => {
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  const observed = observedState();
  const receipt = buildProtectedStateReceipt({
    ...observed,
    generatedAt: new Date(now).toISOString(),
    now,
    release: { buildId: 'build-1', deploymentId: 'deploy-1', gitHead: 'b'.repeat(40) },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.status, 'PASS');
  assert.deepEqual(verifyProtectedStateReceipt(receipt, {
    now,
    expectedRelease: { buildId: 'build-1', deploymentId: 'deploy-1', head: 'b'.repeat(40) },
  }), { ok: true, blockers: [] });
});

test('rejects protected-state tampering, stale evidence, and label-only PASS', () => {
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  const observed = observedState();
  const receipt = buildProtectedStateReceipt({
    ...observed,
    generatedAt: new Date(now).toISOString(),
    now,
    release: { buildId: 'build-1', deploymentId: 'deploy-1', gitHead: 'c'.repeat(40) },
  });
  const changedTables = structuredClone(receipt.tables);
  changedTables.nf_users.baselineStateSha256 = '4'.repeat(64);
  const tampered = attachReceiptSha256({
    ...receipt,
    tables: changedTables,
    comparisonSha256: sha256({ tables: changedTables, blockers: receipt.blockers, evidence: receipt.evidence }),
  });
  const result = verifyProtectedStateReceipt(tampered, { now });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('state_derivation_mismatch'));
  assert.equal(verifyProtectedStateReceipt({ ...receipt, generatedAt: '2026-08-20T00:00:00.000Z' }, { now }).ok, false);
  const hold = buildProtectedStateReceipt({ ...observed, blockers: ['protected_rows_changed'], generatedAt: new Date(now).toISOString(), now, release: receipt.release });
  const forged = attachReceiptSha256({ ...hold, ok: true, status: 'PASS' });
  assert.equal(verifyProtectedStateReceipt(forged, { now }).ok, false);
});

test('rejects internally inconsistent protected row counts and unreported changes', () => {
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  const observed = observedState();
  observed.tables.nf_users.missingRows = 1;
  observed.tables.nf_users.candidateRows = 1;
  const receipt = buildProtectedStateReceipt({
    ...observed,
    generatedAt: new Date(now).toISOString(),
    now,
    release: { buildId: 'build-1', deploymentId: 'deploy-1', gitHead: 'd'.repeat(40) },
  });
  const result = verifyProtectedStateReceipt(receipt, { now });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('table_derivation_invalid:nf_users'));
});
