import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_RUNTIME_KEYS,
  WEB_PUBLIC_AI_DESIGN_SOURCE_MIGRATION_CHECKSUM,
  deploymentCliMessage,
  deploymentMessage,
  npmInvocation,
  railwayTargetIds,
  selectDeploymentTarget,
  stagingHoldIssues,
  targetGateEnvironment,
  webPublicIssues,
} from './deploy-railway-verified.mjs';

const commercialRuntimeKeys = [
  'NEXYFAB_COMMERCIAL_MODE',
  'NEXYFAB_BUILD_ID',
  'RELEASE_GIT_HEAD',
  'NEXYFAB_AGENT_APPROVAL_SECRET',
  'NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON',
  'NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE',
  'EXTERNAL_WORKER_ORCHESTRATOR_URL',
  'EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL',
  'POSTGRES_MIGRATION_VERSION',
  ...['2026082202', '2026082203', '2026082204', '2026082205', '2026082206', '2026082207', '2026082208', '2026082301', '2026082402', '2026082403', '2026082501', '2026082502', '2026082602']
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
  assert.equal(TARGET_RUNTIME_KEYS.includes('NEXYFAB_PAYMENTS_ENABLED'), true);
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
    autoDeployEnabled: false,
    target: {
      NEXYFAB_COMMERCIAL_MODE: '0',
      NEXYFAB_RELEASE_CHANNEL: 'staging-hold',
      NEXYFAB_BUILD_ID: buildId,
      RELEASE_GIT_HEAD: buildId,
    },
  };
  assert.deepEqual(stagingHoldIssues(passing), []);
  assert.ok(stagingHoldIssues({ ...passing, environment: 'production' }).includes('staging_hold_environment_must_be_staging'));
  assert.ok(stagingHoldIssues({ ...passing, autoDeployEnabled: true }).includes('staging_hold_auto_deploy_must_be_disabled'));
  assert.ok(stagingHoldIssues({ ...passing, site: 'https://nexyfab.com' }).includes('staging_hold_site_must_be_isolated_staging_host'));
  assert.ok(stagingHoldIssues({ ...passing, target: { ...passing.target, NEXYFAB_COMMERCIAL_MODE: '1' } }).includes('staging_hold_commercial_mode_must_be_0'));
  assert.ok(stagingHoldIssues({ ...passing, target: { ...passing.target, NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE: '1' } }).includes('staging_hold_precision_commercial_mode_must_not_be_1'));
  assert.ok(stagingHoldIssues({ ...passing, target: { ...passing.target, NEXYFAB_RELEASE_CHANNEL: 'production' } }).includes('staging_hold_release_channel_required'));
  assert.ok(stagingHoldIssues({ ...passing, expectedBuildId: 'b'.repeat(40) }).includes('staging_hold_build_id_mismatch'));
  assert.ok(stagingHoldIssues({ ...passing, target: { ...passing.target, RELEASE_GIT_HEAD: 'b'.repeat(40) } }).includes('staging_hold_release_git_head_mismatch'));
});

test('web-public deployment is restricted to production with payments and precision commerce disabled', () => {
  const buildId = 'c'.repeat(40);
  const target = {
    NEXYFAB_COMMERCIAL_MODE: '0',
    NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE: '0',
    NEXYFAB_PAYMENTS_ENABLED: 'false',
    NEXYFAB_RELEASE_CHANNEL: 'web-public',
    NEXYFAB_BUILD_ID: buildId,
    RELEASE_GIT_HEAD: buildId,
    OPENSCAD_EXTERNAL_WORKER: '1',
    NEXYFAB_CAD_INDEPENDENT_MODE: '1',
    SECURITY_GATE_MODE: 'enforce',
    DATABASE_URL: 'postgresql://private',
    REDIS_URL: 'redis://private',
    S3_BUCKET: 'nexyfab-private',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
    OBJECT_STORAGE_PRIVATE_BUCKET: 'nexyfab-private',
    CRON_SECRET: 'cron',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'mailer',
    SMTP_PASS: 'mail-secret',
    SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
    NEXT_PUBLIC_AUTH_URL: 'https://nexyfab.com',
    RECAPTCHA_SECRET_KEY: 'recaptcha-secret',
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY: 'recaptcha-site',
    RECAPTCHA_ALLOWED_HOSTNAMES: 'nexyfab.com,www.nexyfab.com',
    JWT_SECRET: 'jwt-secret',
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'actions-secret',
    POSTGRES_MIGRATION_CHECKSUM_2026082602: WEB_PUBLIC_AI_DESIGN_SOURCE_MIGRATION_CHECKSUM,
  };
  const passing = {
    environment: 'production',
    service: 'nexyfab.com',
    site: 'https://nexyfab.com',
    expectedBuildId: buildId,
    autoDeployEnabled: false,
    target,
  };

  assert.deepEqual(webPublicIssues(passing), []);
  assert.ok(webPublicIssues({ ...passing, environment: 'staging' }).includes('web_public_environment_must_be_production'));
  assert.ok(webPublicIssues({ ...passing, service: 'other' }).includes('web_public_service_must_be_nexyfab_com'));
  assert.ok(webPublicIssues({ ...passing, autoDeployEnabled: true }).includes('web_public_auto_deploy_must_be_disabled'));
  assert.ok(webPublicIssues({ ...passing, site: 'https://staging.nexyfab.com' }).includes('web_public_site_must_be_canonical_production_host'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, NEXYFAB_COMMERCIAL_MODE: '1' } }).includes('web_public_commercial_mode_must_be_0'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE: '1' } }).includes('web_public_precision_commercial_mode_must_be_0'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, NEXYFAB_PAYMENTS_ENABLED: 'true' } }).includes('web_public_payments_must_be_false'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, NEXYFAB_RELEASE_CHANNEL: 'production' } }).includes('web_public_release_channel_required'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, NEXYFAB_BUILD_ID: 'wrong' } }).includes('web_public_build_id_mismatch'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, SECURITY_GATE_MODE: 'shadow' } }).includes('web_public_security_gate_must_be_enforced'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, SMTP_PASS: '' } }).includes('web_public_required_variable_missing:SMTP_PASS'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, OBJECT_STORAGE_PRIVATE_BUCKET: 'unverified' } }).includes('web_public_private_bucket_must_match_verified_s3_bucket'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, NEXT_PUBLIC_AUTH_URL: 'http://localhost:3000' } }).includes('web_public_auth_url_must_be_canonical_production_host'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, RECAPTCHA_ALLOWED_HOSTNAMES: 'nexyfab.com' } }).includes('web_public_recaptcha_hosts_must_cover_canonical_hosts'));
  assert.ok(webPublicIssues({ ...passing, target: { ...target, POSTGRES_MIGRATION_CHECKSUM_2026082602: '0'.repeat(64) } }).includes('web_public_ai_design_source_migration_checksum_mismatch'));
});

test('Railway target IDs resolve the exact named environment and service', () => {
  const status = {
    id: 'project-1',
    environments: { edges: [
      { node: { id: 'production-1', name: 'production', serviceInstances: { edges: [
        { node: { serviceId: 'service-prod', serviceName: 'nexyfab.com' } },
      ] } } },
      { node: { id: 'staging-1', name: 'staging', serviceInstances: { edges: [
        { node: { serviceId: 'service-web', serviceName: 'nexyfab.com' } },
        { node: { serviceId: 'service-db', serviceName: 'Postgres-KN2x' } },
      ] } } },
    ] },
  };
  assert.deepEqual(railwayTargetIds(status, 'staging', 'nexyfab.com'), {
    projectId: 'project-1', environmentId: 'staging-1', serviceId: 'service-web',
  });
  assert.equal(railwayTargetIds(status, 'staging', 'missing'), null);
  assert.equal(railwayTargetIds(status, 'missing', 'nexyfab.com'), null);
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

test('deployment metadata binds the exact clean Git source identity', () => {
  const buildId = 'b'.repeat(40);
  assert.equal(
    deploymentMessage({ stagingHold: true, expectedBuildId: buildId, attemptId: 'attempt-1', now: '2026-08-25T00:00:00.000Z' }),
    `verified staging HOLD deploy build=${buildId} source=clean-git-v1 attempt=attempt-1 at=2026-08-25T00:00:00.000Z`,
  );
  assert.equal(
    deploymentMessage({ stagingHold: false, expectedBuildId: buildId, attemptId: 'attempt-2', now: '2026-08-25T00:00:00.000Z' }),
    `verified deploy build=${buildId} source=clean-git-v1 attempt=attempt-2 at=2026-08-25T00:00:00.000Z`,
  );
  assert.equal(
    deploymentMessage({ stagingHold: false, webPublic: true, expectedBuildId: buildId, attemptId: 'attempt-3', now: '2026-08-25T00:00:00.000Z' }),
    `verified web-public no-payment deploy build=${buildId} source=clean-git-v1 attempt=attempt-3 at=2026-08-25T00:00:00.000Z`,
  );
  assert.throws(() => deploymentMessage({ stagingHold: false, expectedBuildId: buildId }), /attempt ID is required/);
});

test('deployment polling selects only the exact upload-attempt message', () => {
  const beforeIds = new Set(['before-1']);
  const rows = [
    { id: 'other-new', status: 'BUILDING', meta: { cliMessage: 'someone else deployed concurrently' } },
    { id: 'before-1', status: 'SUCCESS', meta: { cliMessage: 'old attempt' } },
    { id: 'ours', status: 'BUILDING', meta: { cliMessage: 'exact-attempt-message' } },
  ];
  assert.equal(deploymentCliMessage(rows[2]), 'exact-attempt-message');
  assert.equal(selectDeploymentTarget(rows, {
    verifyOnly: false,
    expectedDeploymentId: '',
    attemptMessage: 'exact-attempt-message',
    beforeIds,
  })?.id, 'ours');
  assert.equal(selectDeploymentTarget(rows, {
    verifyOnly: false,
    expectedDeploymentId: '',
    attemptMessage: 'missing',
    beforeIds,
  }), null);
});

test('deployment polling rejects duplicate exact attempt messages', () => {
  assert.throws(() => selectDeploymentTarget([
    { id: 'ours-1', meta: { cliMessage: 'exact-attempt-message' } },
    { id: 'ours-2', meta: { cliMessage: 'exact-attempt-message' } },
  ], {
    verifyOnly: false,
    expectedDeploymentId: '',
    attemptMessage: 'exact-attempt-message',
    beforeIds: new Set(),
  }), /multiple Railway deployments matched exact upload attempt/);
});

test('verify-only selects the explicit deployment ID instead of list order', () => {
  const rows = [
    { id: 'newest-unrelated', meta: { cliMessage: 'other' } },
    { id: 'expected-deployment', meta: { cliMessage: 'verified source' } },
  ];
  assert.equal(selectDeploymentTarget(rows, {
    verifyOnly: true,
    expectedDeploymentId: 'expected-deployment',
    attemptMessage: '',
  })?.id, 'expected-deployment');
  assert.equal(selectDeploymentTarget(rows, {
    verifyOnly: true,
    expectedDeploymentId: 'missing',
    attemptMessage: '',
  }), null);
});
