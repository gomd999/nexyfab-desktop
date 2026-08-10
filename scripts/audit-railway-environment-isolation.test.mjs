import assert from 'node:assert/strict';
import test from 'node:test';
import { auditRailwayEnvironmentIsolation } from './audit-railway-environment-isolation.mjs';

const production = {
  DATABASE_URL: 'postgresql://prod:secret@postgres-prod:5432/nexyfab',
  REDIS_URL: 'redis://default:secret@redis-prod:6379',
  JWT_SECRET: 'production-jwt',
  NEXT_PUBLIC_SITE_URL: 'https://nexyfab.com',
  NEXYFAB_CAD_INDEPENDENT_MODE: '1',
  S3_BUCKET: 'nexyfab-production',
  DODO_API_KEY: 'live-dodo',
  DODO_WEBHOOK_SECRET: 'live-webhook',
  DODO_PRODUCT_PRO_MONTHLY: 'live-product',
  TOSS_SECRET_KEY: 'live_sk_example',
  TOSS_WEBHOOK_SECRET: 'live-toss-webhook',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_ck_example',
  STRIPE_SECRET_KEY: 'sk_live_example',
  STRIPE_WEBHOOK_SECRET: 'whsec_live',
};

const staging = {
  DATABASE_URL: 'postgresql://stage:secret@postgres-stage:5432/nexyfab',
  REDIS_URL: 'redis://default:secret@redis-stage:6379',
  JWT_SECRET: 'staging-jwt',
  NEXT_PUBLIC_SITE_URL: 'https://nexyfab-staging.up.railway.app',
  NEXYFAB_CAD_INDEPENDENT_MODE: '1',
  S3_BUCKET: 'nexyfab-staging',
  DODO_API_KEY: 'test-dodo',
  DODO_WEBHOOK_SECRET: 'test-webhook',
  DODO_PRODUCT_PRO_MONTHLY: 'test-product',
  DODO_MODE: 'test',
  TOSS_SECRET_KEY: 'test_sk_example',
  TOSS_WEBHOOK_SECRET: 'test-toss-webhook',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_ck_example',
  STRIPE_SECRET_KEY: 'sk_test_example',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
};

test('accepts an isolated staging environment and never emits secret values', () => {
  const receipt = auditRailwayEnvironmentIsolation(production, staging, { generatedAt: '2026-08-11T00:00:00.000Z' });
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.blockers, []);
  const serialized = JSON.stringify(receipt);
  for (const secret of ['production-jwt', 'staging-jwt', 'live-dodo', 'test-dodo']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('fails closed when staging shares protected state or live payment configuration', () => {
  const receipt = auditRailwayEnvironmentIsolation(production, {
    ...staging,
    DATABASE_URL: production.DATABASE_URL,
    REDIS_URL: production.REDIS_URL,
    JWT_SECRET: production.JWT_SECRET,
    NEXT_PUBLIC_SITE_URL: production.NEXT_PUBLIC_SITE_URL,
    S3_BUCKET: production.S3_BUCKET,
    DODO_MODE: 'live',
    TOSS_SECRET_KEY: production.TOSS_SECRET_KEY,
    NEXT_PUBLIC_TOSS_CLIENT_KEY: production.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    STRIPE_SECRET_KEY: production.STRIPE_SECRET_KEY,
  }, { generatedAt: '2026-08-11T00:00:00.000Z' });
  assert.equal(receipt.ok, false);
  for (const blocker of [
    'database_url_isolated',
    'redis_url_isolated',
    'jwt_secret_isolated',
    'site_url_isolated',
    's3_bucket_isolated',
    'dodo_sandbox_mode',
    'toss_sandbox_mode',
    'stripe_sandbox_mode',
  ]) assert.ok(receipt.blockers.includes(blocker), `missing blocker: ${blocker}`);
});

test('requires fail-closed CAD quota enforcement', () => {
  const receipt = auditRailwayEnvironmentIsolation(production, {
    ...staging,
    NEXYFAB_CAD_INDEPENDENT_MODE: '0',
  }, { generatedAt: '2026-08-11T00:00:00.000Z' });
  assert.equal(receipt.ok, false);
  assert.ok(receipt.blockers.includes('cad_quota_fail_closed'));
});
