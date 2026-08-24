import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_POSTGRES_CONSTRAINTS,
  COMMERCIAL_POSTGRES_HARDENING_TRIGGERS,
  COMMERCIAL_POSTGRES_MIGRATIONS,
  COMMERCIAL_POSTGRES_TABLES,
  commercialPostgresMigrationChecksumEnvKey,
  commercialReadinessIssues,
} from './commercial-readiness';

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
  GENERATION_EVIDENCE_SIGNING_SECRET: 'commercial-generation-evidence-secret-32-bytes',
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

  it('requires a strong server-only generation evidence signing secret', () => {
    const issues = commercialReadinessIssues({ ...base, GENERATION_EVIDENCE_SIGNING_SECRET: 'short' });
    expect(issues.map(issue => issue.code)).toContain('cad_release.evidence_signing_secret_weak');
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

  it('requires all append-only commercial migrations and both Ed25519 registries', () => {
    const issues = commercialReadinessIssues({
      ...base,
      NEXYFAB_COMMERCIAL_MODE: '1',
      NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE: '1',
      POSTGRES_MIGRATION_VERSION: '2026082202',
    });
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'database.migration_version_required',
      'database.migration_2026082202_checksum_required',
      'database.migration_2026082203_checksum_required',
      'database.migration_2026082204_checksum_required',
      'database.migration_2026082403_checksum_required',
      'worker.ed25519_registry_required',
      'verifier.ed25519_registry_required',
    ]));
  });
});

describe('commercial PostgreSQL readiness contract', () => {
  it('covers the canonical CAD, AI authority, and exact bridge migrations', () => {
    expect(COMMERCIAL_POSTGRES_MIGRATIONS.slice(-4)).toEqual([
      2026082301,
      2026082401,
      2026082402,
      2026082403,
    ]);
    expect(COMMERCIAL_POSTGRES_TABLES).toEqual(expect.arrayContaining([
      'nf_cad_canonical_v2_revisions',
      'nf_ai_design_workspace_runtimes',
      'nf_ai_design_artifacts',
      'nf_ai_precision_bridge_outbox',
      'nf_ai_precision_bridge_receipts',
    ]));
  });

  it('keeps every hardening object bound to a required authority table', () => {
    const tables = new Set(COMMERCIAL_POSTGRES_TABLES);
    for (const [table] of [
      ...COMMERCIAL_POSTGRES_CONSTRAINTS,
      ...COMMERCIAL_POSTGRES_HARDENING_TRIGGERS,
    ]) {
      expect(tables.has(table), table).toBe(true);
    }
    expect(new Set(COMMERCIAL_POSTGRES_TABLES).size).toBe(COMMERCIAL_POSTGRES_TABLES.length);
    expect(new Set(COMMERCIAL_POSTGRES_MIGRATIONS).size).toBe(COMMERCIAL_POSTGRES_MIGRATIONS.length);
  });

  it('uses the deployed canonical CAD checksum key and versioned keys elsewhere', () => {
    expect(commercialPostgresMigrationChecksumEnvKey(2026082401))
      .toBe('CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM');
    expect(commercialPostgresMigrationChecksumEnvKey(2026082403))
      .toBe('POSTGRES_MIGRATION_CHECKSUM_2026082403');
  });
});
