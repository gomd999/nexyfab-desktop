import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET_RUNTIME_KEYS, npmInvocation, stagingHoldIssues, targetGateEnvironment } from './deploy-railway-verified.mjs';

const commercialRuntimeKeys = [
  'NEXYFAB_COMMERCIAL_MODE',
  'NEXYFAB_BUILD_ID',
  'NEXYFAB_AGENT_APPROVAL_SECRET',
  'NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON',
  'NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE',
  'EXTERNAL_WORKER_ORCHESTRATOR_URL',
  'EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL',
  'POSTGRES_MIGRATION_VERSION',
  ...['2026082202', '2026082203', '2026082204', '2026082205', '2026082206', '2026082207', '2026082208', '2026082301', '2026082402', '2026082403', '2026082501']
    .map(version => `POSTGRES_MIGRATION_CHECKSUM_${version}`),
  'CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM',
  'NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON',
  'NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET',
  'NEXYFAB_COMMERCIAL_TRANSPORT_SECRET',
  'NEXYFAB_COMMERCIAL_CALLBACK_SECRET',
  'NEXYFAB_COMMERCIAL_CALLBACK_URL',
  'NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON',
  'NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET',
  'OBJECT_STORAGE_PRIVATE_BUCKET',
  'I18N_AUTOMATED_TEST_EVIDENCE',
  'I18N_FULL_PRODUCT_REVIEW_RECEIPT',
  'I18N_FULL_PRODUCT_EVIDENCE_ROOT',
];

test('target runtime keys cover commercial readiness, workers, verifier, and all required migration checksums', () => {
  assert.equal(new Set(TARGET_RUNTIME_KEYS).size, TARGET_RUNTIME_KEYS.length);
  for (const key of commercialRuntimeKeys) assert.ok(TARGET_RUNTIME_KEYS.includes(key), `${key} is not target-scoped`);
  assert.equal(TARGET_RUNTIME_KEYS.includes('POSTGRES_MIGRATION_CHECKSUM'), false);
});

test('target environment cannot fall back to local process.env for omitted runtime keys', () => {
  const localEnvironment = Object.fromEntries(TARGET_RUNTIME_KEYS.map(key => [key, `local-${key}`]));
  localEnvironment.LOCAL_ONLY_SENTINEL = 'preserve-me';
  const target = {
    NEXYFAB_COMMERCIAL_MODE: '1',
    NEXYFAB_BUILD_ID: 'railway-build',
    POSTGRES_MIGRATION_CHECKSUM_2026082202: 'target-checksum-2202',
    NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON: 'target-workers',
    NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON: 'target-verifiers',
  };

  const gateEnvironment = targetGateEnvironment(target, localEnvironment);

  assert.equal(gateEnvironment.NEXYFAB_BUILD_ID, 'railway-build');
  assert.equal(gateEnvironment.POSTGRES_MIGRATION_CHECKSUM_2026082202, 'target-checksum-2202');
  assert.equal(gateEnvironment.NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON, 'target-workers');
  assert.equal(gateEnvironment.NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON, 'target-verifiers');
  for (const key of TARGET_RUNTIME_KEYS) {
    if (!Object.hasOwn(target, key)) assert.equal(Object.hasOwn(gateEnvironment, key), false, `${key} leaked from local env`);
  }
  assert.equal(gateEnvironment.LOCAL_ONLY_SENTINEL, 'preserve-me');
});

test('staging HOLD deployment is restricted to an isolated non-commercial target', () => {
  const buildId = 'a'.repeat(40);
  const passing = {
    environment: 'staging',
    site: 'https://nexyfabcom-staging.up.railway.app',
    expectedBuildId: buildId,
    target: {
      NEXYFAB_COMMERCIAL_MODE: '0',
      NEXYFAB_RELEASE_CHANNEL: 'staging-hold',
      NEXYFAB_BUILD_ID: buildId,
    },
  };
  assert.deepEqual(stagingHoldIssues(passing), []);
  assert.ok(stagingHoldIssues({ ...passing, environment: 'production' }).includes('staging_hold_environment_must_be_staging'));
  assert.ok(stagingHoldIssues({ ...passing, site: 'https://nexyfab.com' }).includes('staging_hold_site_must_be_isolated_staging_host'));
  assert.ok(stagingHoldIssues({ ...passing, target: { ...passing.target, NEXYFAB_COMMERCIAL_MODE: '1' } }).includes('staging_hold_commercial_mode_must_be_0'));
  assert.ok(stagingHoldIssues({ ...passing, target: { ...passing.target, NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE: '1' } }).includes('staging_hold_precision_commercial_mode_must_not_be_1'));
  assert.ok(stagingHoldIssues({ ...passing, target: { ...passing.target, NEXYFAB_RELEASE_CHANNEL: 'production' } }).includes('staging_hold_release_channel_required'));
  assert.ok(stagingHoldIssues({ ...passing, expectedBuildId: 'b'.repeat(40) }).includes('staging_hold_build_id_mismatch'));
});

test('Windows invokes the npm JavaScript CLI without a command-shell dependency', () => {
  assert.deepEqual(npmInvocation({
    platform: 'win32',
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    npmExecPath: '',
    fileExists: () => true,
  }), {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    prefixArgs: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
  });
  assert.deepEqual(npmInvocation({
    platform: 'linux',
    execPath: '/usr/bin/node',
    npmExecPath: '',
    fileExists: () => false,
  }), { command: 'npm', prefixArgs: [] });
});
