import { describe, expect, it } from 'vitest';
import { commercialReadinessIssues } from './commercial-readiness';

const base = {
  DATABASE_URL: 'postgres://db',
  REDIS_URL: 'redis://cache',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'redis-rest-token',
  NEXYFAB_CAD_INDEPENDENT_MODE: '1',
  OPENSCAD_EXTERNAL_WORKER: '1',
  CAD_RUNTIME_EXTERNAL_WORKER: '1',
  S3_BUCKET: 'cad-private',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  CRON_SECRET: 'cron-secret',
  SMTP_HOST: 'smtp.example.com',
  SENTRY_DSN: 'https://public@sentry.example/1',
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'stable-key',
  TOSS_SECRET_KEY: 'toss-secret',
  TOSS_WEBHOOK_SECRET: 'toss-webhook',
};

describe('commercialReadinessIssues', () => {
  it('accepts a complete commercial configuration', () => {
    expect(commercialReadinessIssues(base)).toEqual([]);
  });

  it('requires distributed infrastructure and observability', () => {
    const issues = commercialReadinessIssues({
      ...base,
      REDIS_URL: '',
      SENTRY_DSN: undefined,
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'rate_limit.redis_required',
      'observability.sentry_required',
    ]));
  });

  it('requires fail-closed distributed CAD account quotas', () => {
    const issues = commercialReadinessIssues({
      ...base,
      REDIS_URL: '',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: undefined,
      NEXYFAB_CAD_INDEPENDENT_MODE: '0',
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'rate_limit.redis_required',
      'cad_mode.independent_required',
    ]));
  });

  it('requires every native CAD executable to stay outside the web service', () => {
    const issues = commercialReadinessIssues({
      ...base,
      OPENSCAD_EXTERNAL_WORKER: '0',
      CAD_RUNTIME_EXTERNAL_WORKER: '',
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'cad_runtime.openscad_isolation_required',
      'cad_runtime.native_isolation_required',
    ]));
  });

  it('accepts direct Railway Redis without Upstash REST credentials', () => {
    expect(commercialReadinessIssues({
      ...base,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    })).toEqual([]);
  });

  it('does not accept a payment API key without webhook verification', () => {
    const issues = commercialReadinessIssues({
      ...base,
      TOSS_WEBHOOK_SECRET: undefined,
    });
    expect(issues.some((issue) => issue.code === 'payments.provider_incomplete')).toBe(true);
  });

  it('accepts any one fully configured supported payment provider', () => {
    const env = { ...base, TOSS_SECRET_KEY: undefined, TOSS_WEBHOOK_SECRET: undefined };
    expect(commercialReadinessIssues({
      ...env,
      DODO_API_KEY: 'dodo-key',
      DODO_WEBHOOK_SECRET: 'dodo-webhook',
    })).toEqual([]);
  });
});
