import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRailwayStagingIsolationEvidenceV2,
  captureRailwayStagingIsolationEvidenceV2,
  verifyRailwayStagingIsolationEvidenceV2,
} from './build-railway-staging-isolation-evidence-v2.mjs';

const production = {
  service: 'nexyfab.com', environment: 'production', environmentId: 'prod-env', deploymentId: 'prod-deployment',
  variables: {
    DATABASE_URL: 'postgresql://prod:secret@postgres-prod:5432/nexyfab', REDIS_URL: 'redis://prod:secret@redis-prod:6379',
    JWT_SECRET: 'prod-jwt', ADMIN_SECRET: 'prod-admin', AUTH_SYNC_SECRET: 'prod-auth', CRON_SECRET: 'prod-cron',
    DEV_SEED_KEY: 'prod-seed', NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'prod-actions', SELFTEST_TOKEN: 'prod-selftest',
    ADMIN_PASSWORD_HASH: 'prod-password', NEXT_PUBLIC_SITE_URL: 'https://nexyfab.com', NEXYFAB_CAD_INDEPENDENT_MODE: '1',
  },
};

const staging = {
  service: 'nexyfab.com', environment: 'staging', environmentId: 'stage-env', deploymentId: 'stage-evidence-deployment',
  variables: {
    DATABASE_URL: 'postgresql://stage:secret@postgres-stage:5432/nexyfab', REDIS_URL: 'redis://stage:secret@redis-stage:6379',
    JWT_SECRET: 'stage-jwt', ADMIN_SECRET: 'stage-admin', AUTH_SYNC_SECRET: 'stage-auth', CRON_SECRET: 'stage-cron',
    DEV_SEED_KEY: 'stage-seed', NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'stage-actions', SELFTEST_TOKEN: 'stage-selftest',
    ADMIN_PASSWORD_HASH: 'stage-password', NEXT_PUBLIC_SITE_URL: 'https://nexyfab-staging.up.railway.app', NEXYFAB_CAD_INDEPENDENT_MODE: '1',
  },
};

const release = {
  buildId: 'build-20260823', productionDeploymentId: 'prod-deployment',
  evidenceDeploymentId: 'stage-evidence-deployment', gitHead: 'a'.repeat(40),
};
const signingSecret = 'isolation-evidence-signing-secret-32-bytes-minimum';

test('builds fresh release-bound v2 evidence with only fingerprints, and verifies it', () => {
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  const receipt = buildRailwayStagingIsolationEvidenceV2({
    production, staging, release, generatedAt: new Date(now - 1000).toISOString(), now, signingSecret,
  });
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.blockers, []);
  assert.equal(verifyRailwayStagingIsolationEvidenceV2(receipt, { expectedRelease: release, now, signingSecret }), true);
  assert.match(receipt.receiptHmacSha256, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(receipt);
  for (const secret of ['prod:secret', 'stage:secret', 'prod-jwt', 'stage-jwt', 'postgres-prod', 'nexyfab-staging.up.railway.app']) {
    assert.equal(serialized.includes(secret), false, `raw value leaked: ${secret}`);
  }
  assert.match(receipt.variableFingerprints.JWT_SECRET.production.sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.checks.find(item => item.id === 'cad_quota_fail_closed').pass, true);
});

test('fails closed for shared state, disabled quota mode, and release mismatch', () => {
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  const shared = buildRailwayStagingIsolationEvidenceV2({
    production,
    staging: { ...staging, variables: { ...staging.variables, DATABASE_URL: production.variables.DATABASE_URL, JWT_SECRET: production.variables.JWT_SECRET, NEXYFAB_CAD_INDEPENDENT_MODE: '0' } },
    release, generatedAt: new Date(now - 1000).toISOString(), now, signingSecret,
  });
  assert.equal(shared.ok, false);
  assert.ok(shared.blockers.includes('database_url_isolated'));
  assert.ok(shared.blockers.includes('jwt_secret_isolated'));
  assert.ok(shared.blockers.includes('cad_quota_fail_closed'));
  assert.equal(verifyRailwayStagingIsolationEvidenceV2(shared, { expectedRelease: release, now, signingSecret }), false);

  const receipt = buildRailwayStagingIsolationEvidenceV2({ production, staging, release, generatedAt: new Date(now - 1000).toISOString(), now, signingSecret });
  assert.equal(verifyRailwayStagingIsolationEvidenceV2(receipt, { expectedRelease: { ...release, evidenceDeploymentId: 'other' }, now, signingSecret }), false);
  const tampered = { ...receipt, checks: receipt.checks.map(item => item.id === 'redis_url_isolated' ? { ...item, pass: false } : item) };
  assert.equal(verifyRailwayStagingIsolationEvidenceV2(tampered, { expectedRelease: release, now, signingSecret }), false);
  assert.equal(verifyRailwayStagingIsolationEvidenceV2(receipt, { expectedRelease: release, now, signingSecret: 'wrong-secret-that-is-still-at-least-32-bytes' }), false);
});

test('rejects stale or malformed release inputs before producing evidence', () => {
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  assert.throws(() => buildRailwayStagingIsolationEvidenceV2({
    production, staging, release: { ...release, gitHead: 'bad' }, generatedAt: new Date(now).toISOString(), now, signingSecret,
  }), /release_binding_invalid/);
  assert.throws(() => buildRailwayStagingIsolationEvidenceV2({
    production, staging, release, generatedAt: new Date(now - 25 * 60 * 60_000).toISOString(), now, signingSecret,
  }), /generated_at_not_fresh/);
  const sameEnvironment = buildRailwayStagingIsolationEvidenceV2({
    production: { ...production, environmentId: staging.environmentId }, staging, release, generatedAt: new Date(now).toISOString(), now, signingSecret,
  });
  assert.equal(sameEnvironment.ok, false);
  assert.ok(sameEnvironment.blockers.includes('environment_ids_distinct'));
});

test('captures in-memory Railway variable snapshots without persisting raw secrets', () => {
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  const byEnvironment = {
    production: { ...production.variables, RAILWAY_ENVIRONMENT_ID: production.environmentId, RAILWAY_DEPLOYMENT_ID: production.deploymentId, RAILWAY_PROJECT_ID: 'project-1' },
    staging: { ...staging.variables, RAILWAY_ENVIRONMENT_ID: staging.environmentId, RAILWAY_DEPLOYMENT_ID: staging.deploymentId, RAILWAY_PROJECT_ID: 'project-1' },
  };
  const receipt = captureRailwayStagingIsolationEvidenceV2({
    buildId: release.buildId,
    gitCommit: release.gitHead,
    generatedAt: new Date(now).toISOString(),
    now,
    signingSecret,
    loadVariables: (_service, environment) => byEnvironment[environment],
  });
  assert.equal(receipt.ok, true);
  assert.equal(verifyRailwayStagingIsolationEvidenceV2(receipt, { expectedRelease: release, now, signingSecret }), true);
  assert.equal(JSON.stringify(receipt).includes(production.variables.JWT_SECRET), false);
  assert.equal(JSON.stringify(receipt).includes(staging.variables.JWT_SECRET), false);
});
