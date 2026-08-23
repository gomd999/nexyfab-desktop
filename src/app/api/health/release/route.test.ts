import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({
  getDbAdapter: vi.fn(),
  registry: vi.fn(),
}));

vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: state.getDbAdapter }));
vi.mock('@/lib/ai/externalCommercialVerifierRegistry', () => ({ loadExternalCommercialVerifierRegistry: state.registry }));

import { GET } from './route';
import { buildReleaseEvidence, loadReleaseEvidenceFile } from '@/lib/releaseHealthEvidence';

const ids = {
  NEXYFAB_BUILD_ID: 'build-1',
  RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
  RAILWAY_DEPLOYMENT_ID: 'cf509f59-dfc8-49cb-8e19-09ddcf3cd5e8',
};

const canonical = (value: any): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

function signReceipt(receipt: Record<string, any>, secret: string) {
  const unsigned = { ...receipt };
  delete unsigned.receiptSha256;
  delete unsigned.receiptHmacSha256;
  const receiptSha256 = createHash('sha256').update(canonical(unsigned)).digest('hex');
  const receiptHmacSha256 = createHmac('sha256', secret).update(canonical({ ...unsigned, receiptSha256 })).digest('hex');
  return { ...unsigned, receiptSha256, receiptHmacSha256 };
}

beforeEach(() => {
  state.getDbAdapter.mockReset().mockReturnValue(undefined);
  state.registry.mockReset().mockReturnValue(undefined);
  vi.stubEnv('I18N_RELEASE_RECEIPT_PATH', 'missing-i18n.json');
  vi.stubEnv('SEVEN_DAY_OPERATIONS_RECEIPT_PATH', 'missing-seven-day.json');
});

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health/release', () => {
  it('fails closed as NOT_RUN when runtime release evidence is absent', async () => {
    const result = await buildReleaseEvidence({ env: {}, now: Date.parse('2026-08-23T00:00:00.000Z') });

    expect(result.status).toBe('NOT_RUN');
    expect(result.release).toMatchObject({ buildId: null, deploymentId: null, gitHead: null, migrationVersion: null });
    expect(result.release.i18n.status).toBe('NOT_RUN');
    expect(result.release.sevenDay.status).toBe('NOT_RUN');
  });

  it('does not promote legacy bool-only receipts or self-asserted migration claims', async () => {
    const result = await buildReleaseEvidence({
      env: { ...ids, POSTGRES_MIGRATION_CHECKSUM_2026082208: '8'.repeat(64) },
      now: Date.parse('2026-08-23T00:00:00.000Z'),
      db: { backend: 'postgres', queryOne: vi.fn().mockResolvedValue({ version: 2026082208, checksum: '8'.repeat(64) }) },
      i18nReceipt: { ok: true, status: 'QUALIFIED', buildId: ids.NEXYFAB_BUILD_ID },
      sevenDayReceipt: { ok: true, generatedAt: '2026-08-23T00:00:00.000Z', release: { buildId: ids.NEXYFAB_BUILD_ID } },
    });

    expect(result.status).toBe('HOLD');
    expect(result.release.migrationVersion).toBeNull();
    expect(result.release.i18n.status).toBe('HOLD');
    expect(result.release.sevenDay.status).toBe('HOLD');
  });

  it('does not derive a build ID from git and requires the production commercial runtime boundary', async () => {
    const noBuild = await buildReleaseEvidence({
      env: { RAILWAY_GIT_COMMIT_SHA: ids.RAILWAY_GIT_COMMIT_SHA, RAILWAY_DEPLOYMENT_ID: ids.RAILWAY_DEPLOYMENT_ID },
      now: Date.parse('2026-08-23T00:00:00.000Z'),
    });
    expect(noBuild.release.buildId).toBeNull();
    expect(noBuild.evidence.build.status).toBe('NOT_RUN');
    expect(noBuild.evidence.runtime.status).toBe('NOT_RUN');

    const staging = await buildReleaseEvidence({
      env: { ...ids, RAILWAY_ENVIRONMENT_NAME: 'staging', NEXYFAB_COMMERCIAL_MODE: '1' },
      now: Date.parse('2026-08-23T00:00:00.000Z'),
    });
    expect(staging.status).toBe('HOLD');
    expect(staging.evidence.runtime).toMatchObject({ status: 'HOLD', environment: 'staging', commercialMode: true });
  });

  it('rejects placeholder git and Railway deployment identities', async () => {
    const result = await buildReleaseEvidence({
      env: {
        NEXYFAB_BUILD_ID: ids.NEXYFAB_BUILD_ID,
        RAILWAY_GIT_COMMIT_SHA: 'not-a-real-commit',
        RAILWAY_DEPLOYMENT_ID: 'deployment-1',
        RAILWAY_ENVIRONMENT_NAME: 'production',
        NEXYFAB_COMMERCIAL_MODE: '1',
      },
      now: Date.parse('2026-08-23T00:00:00.000Z'),
    });

    expect(result.release.gitHead).toBeNull();
    expect(result.release.deploymentId).toBeNull();
    expect(result.evidence.git.status).toBe('NOT_RUN');
    expect(result.evidence.deployment.status).toBe('NOT_RUN');
    expect(result.status).not.toBe('PASS');
  });

  it('rejects an evidence path that escapes through a directory link', async () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-release-link-'));
    const root = path.join(fixture, 'root');
    const outside = path.join(fixture, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'receipt.json'), JSON.stringify({ status: 'QUALIFIED' }));
    try {
      symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error: any) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return;
      throw error;
    }

    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      await expect(loadReleaseEvidenceFile('linked/receipt.json')).resolves.toBeUndefined();
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('requires exactly three valid and distinct external verifier fingerprints', async () => {
    const result = await buildReleaseEvidence({
      env: { ...ids, RAILWAY_ENVIRONMENT_NAME: 'production', NEXYFAB_COMMERCIAL_MODE: '1' },
      now: Date.parse('2026-08-23T00:00:00.000Z'),
      registry: { identities: [
        { role: 'external_verifier', fingerprintSha256: 'not-a-sha' },
        { role: 'external_verifier', fingerprintSha256: 'b'.repeat(64) },
        { role: 'external_verifier', fingerprintSha256: 'b'.repeat(64) },
      ] },
    });
    expect(result.release.registryRoles).toBe(3);
    expect(result.release.registryFingerprintsUnique).toBe(false);
    expect(result.status).toBe('HOLD');
  });

  it('passes only a complete production-bound release evidence set with real operation evidence bytes', async () => {
    const now = Date.parse('2026-08-23T00:00:00.000Z');
    const secret = 's'.repeat(32);
    const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-release-health-'));
    const bind = (file: string, value: unknown) => {
      const bytes = Buffer.from(JSON.stringify(value));
      writeFileSync(path.join(evidenceRoot, file), bytes);
      return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
    };
    const sampleBindings = Array.from({ length: 28 }, (_, index) => bind(`sample-${index}.json`, { index }));
    const costBindings = [bind('cost-1.json', { total: 1 }), bind('cost-2.json', { total: 2 })];
    const services = Object.fromEntries(['web', 'openscad-worker', 'fea-worker'].map(name => [name, {
      coverageHours: 168, spanHours: 168, samples: 28, uniqueWindows: 28,
      invalidWindows: 0, overlaps: 0, gaps: 0, durationMismatches: 0,
      maxMemoryMb: 256, minimumRuntimeMemoryLimitMb: name === 'fea-worker' ? 2048 : name === 'web' ? 768 : 512,
      ...(name === 'web' ? { totalRequests: 2800, total5xx: 0, errorRatePercent: 0 } : {}),
    }]));
    const policy = {
      requiredCoverageHours: 168, requiredSampleCount: 28, expectedWindowHours: 6,
      http5xxMaxPercent: 1, requireRuntimeMemoryLimitEvidence: true, monthlyCostBudgetUsd: 50,
      memoryLimitsMb: { web: 768, 'openscad-worker': 512, 'fea-worker': 2048 },
    };
    const sevenDayReceipt = signReceipt({
      schema: 'nexyfab.seven-day-operations-receipt.v3', generatedAt: new Date(now).toISOString(), ok: true, blockers: [],
      services, policy,
      cost: {
        ok: true, blockers: [], samples: 2, coverageHours: 168,
        projectedMonthlyDollars: 20, monthlyBudgetDollars: 50,
        scopedServices: ['nexyfab.com', 'nexyfab-openscad-worker', 'nexyfab-fea-worker', 'Postgres-KN2x', 'Redis-IrVt'],
      },
      release: {
        buildId: ids.NEXYFAB_BUILD_ID, head: ids.RAILWAY_GIT_COMMIT_SHA,
        qualifyingFrom: new Date(now - 168 * 60 * 60 * 1000).toISOString(), environment: 'production',
        deployments: { web: ids.RAILWAY_DEPLOYMENT_ID, 'openscad-worker': 'openscad-d', 'fea-worker': 'fea-d' },
      },
      evidenceBindings: {
        release: bind('release.json', { release: true }), policy: bind('policy.json', policy),
        samples: sampleBindings, costSnapshots: costBindings,
      },
    }, secret);
    const i18nReceipt = signReceipt({
      schema: 'nexyfab.commercial-i18n-release-receipt.v2', status: 'QUALIFIED', gaReady: true,
      generatedAt: new Date(now).toISOString(), buildId: ids.NEXYFAB_BUILD_ID, head: ids.RAILWAY_GIT_COMMIT_SHA,
      catalog: { qualified: true, sourcePairs: 2711, translatedPairs: 2711 },
    }, secret);
    const env: Record<string, string> = {
      ...ids, RAILWAY_ENVIRONMENT_NAME: 'production', NEXYFAB_COMMERCIAL_MODE: '1', GENERATION_EVIDENCE_SIGNING_SECRET: secret,
    };
    for (const version of [2026082202, 2026082203, 2026082204, 2026082205, 2026082206, 2026082207, 2026082208]) env[`POSTGRES_MIGRATION_CHECKSUM_${version}`] = String(version).slice(-1).repeat(64);
    const queryOne = async <T = Record<string, unknown>>(_sql: string, ...params: unknown[]): Promise<T | undefined> => {
      const version = Number(params[0]);
      return { version, checksum: String(version).slice(-1).repeat(64) } as T;
    };
    const result = await buildReleaseEvidence({
      env, now, evidenceRoot, i18nReceipt, sevenDayReceipt,
      db: { backend: 'postgres', queryOne },
      registry: { identities: ['a', 'b', 'c'].map(value => ({ role: 'external_verifier', fingerprintSha256: value.repeat(64) })) },
    });
    expect(result.status).toBe('PASS');
    expect(result.release).toMatchObject({ migrationVersion: 2026082208, registryRoles: 3, registryFingerprintsUnique: true });
    expect(result.release.i18n.status).toBe('QUALIFIED');
    expect(result.release.sevenDay.status).toBe('QUALIFIED');
  });

  it('returns sanitized HOLD and never includes connection secrets', async () => {
    vi.stubEnv('NEXYFAB_BUILD_ID', ids.NEXYFAB_BUILD_ID);
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', ids.RAILWAY_GIT_COMMIT_SHA);
    vi.stubEnv('RAILWAY_DEPLOYMENT_ID', ids.RAILWAY_DEPLOYMENT_ID);
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '0');
    vi.stubEnv('DATABASE_URL', 'postgresql://user:super-secret@example.test/db');

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('HOLD');
    expect(JSON.stringify(body)).not.toContain('postgresql://');
    expect(JSON.stringify(body)).not.toContain('super-secret');
  });
});
