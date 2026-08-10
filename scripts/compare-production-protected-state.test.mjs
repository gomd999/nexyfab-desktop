import assert from 'node:assert/strict';
import test from 'node:test';
import { stableColumns } from './compare-production-protected-state.mjs';

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
