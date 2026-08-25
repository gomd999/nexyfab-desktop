#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const STAGING_HOLD_EVIDENCE_SCHEMA =
  'nexyfab.commercial-precision-staging-hold-evidence.v1';

const GIT_SHA = /^[a-f0-9]{40}$/;
const DEPLOYMENT_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function stagingOrigin(raw) {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !hostname.includes('staging')
    || ['nexyfab.com', 'www.nexyfab.com'].includes(hostname)) {
    throw new Error('isolated_staging_https_origin_required');
  }
  url.pathname = '/';
  return url.origin;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function probe(fetchImpl, origin, pathname, init = {}) {
  const response = await fetchImpl(`${origin}${pathname}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { /* invalid JSON is a failed check */ }
  return Object.freeze({ status: response.status, body, bodySha256: sha256(raw) });
}

function check(checks, id, pass, detail) {
  checks.push(Object.freeze({ id, pass: Boolean(pass), detail }));
}

export async function collectCommercialPrecisionStagingHoldEvidence({
  baseUrl,
  expectedBuildId,
  expectedDeploymentId,
  expectedGitHead = expectedBuildId,
  fetchImpl = fetch,
  generatedAt = new Date().toISOString(),
} = {}) {
  const origin = stagingOrigin(baseUrl);
  if (!GIT_SHA.test(expectedBuildId ?? '') || !GIT_SHA.test(expectedGitHead ?? '')) {
    throw new Error('exact_git_identity_required');
  }
  if (!DEPLOYMENT_ID.test(expectedDeploymentId ?? '')) {
    throw new Error('exact_deployment_identity_required');
  }

  const jsonHeaders = { 'content-type': 'application/json' };
  const [live, ready, release, forgedClaim, forgedLease, unconfiguredCallback] = await Promise.all([
    probe(fetchImpl, origin, '/api/health/live/'),
    probe(fetchImpl, origin, '/api/health/ready/'),
    probe(fetchImpl, origin, '/api/health/release/'),
    probe(fetchImpl, origin, '/api/internal/precision-cad-commercial/claim/', {
      method: 'POST',
      headers: { ...jsonHeaders, authorization: `Bearer ${'x'.repeat(32)}` },
      body: JSON.stringify({ owner: 'forged-worker' }),
    }),
    probe(fetchImpl, origin, '/api/internal/precision-cad-commercial/artifacts/?jobId=forged-job&artifactId=forged-artifact', {
      headers: {
        authorization: `Bearer ${'x'.repeat(32)}`,
        'x-commercial-worker-identity': 'forged-worker',
      },
    }),
    probe(fetchImpl, origin, '/api/internal/precision-cad-commercial/callback/', {
      method: 'POST', headers: jsonHeaders, body: '{}',
    }),
  ]);

  const checks = [];
  check(checks, 'live_exact_release', live.status === 200 && live.body?.status === 'ok'
    && live.body?.build === expectedBuildId, 'Liveness must bind the exact expected build.');
  check(checks, 'ready_postgres', ready.status === 200 && ready.body?.status === 'ok'
    && ready.body?.db?.status === 'ok' && ready.body?.db?.backend === 'postgres',
  'Readiness must observe authoritative PostgreSQL.');
  check(checks, 'ready_redis', ready.status === 200 && ready.body?.redis?.status === 'ok'
    && ready.body?.redis?.required === true, 'Readiness must observe required Redis.');
  check(checks, 'commercial_boundary_held', ready.body?.commercialBoundary?.status === 'skipped'
    && ready.body?.commercialBoundary?.required === false,
  'Staging HOLD must not enable the commercial boundary before a real worker is registered.');
  check(checks, 'release_exact_identity', release.body?.release?.buildId === expectedBuildId
    && release.body?.release?.deploymentId === expectedDeploymentId
    && release.body?.release?.gitHead === expectedGitHead,
  'Release health must bind exact build, deployment, and Git identities.');
  check(checks, 'release_is_hold', release.status === 503 && release.body?.status === 'HOLD',
    'The staging release must remain fail-closed HOLD.');
  check(checks, 'migration_pass', release.body?.evidence?.migration?.status === 'PASS'
    && Number(release.body?.release?.migrationVersion) === 2026082502,
  'The durable execution migration must be current and verified.');
  check(checks, 'precision_runtime_hold_packaged', release.body?.release?.precisionRuntime?.status === 'HOLD'
    && SHA256.test(String(release.body?.release?.precisionRuntime?.receiptSha256 ?? '')),
  'The runtime must package and expose the signed HOLD receipt instead of reporting NOT_RUN.');
  check(checks, 'forged_claim_rejected', forgedClaim.status === 403
    && forgedClaim.body?.code === 'FORBIDDEN', 'A forged worker claim must be rejected.');
  check(checks, 'forged_lease_rejected', forgedLease.status === 403
    && forgedLease.body?.code === 'LEASE_CAPABILITY_INVALID',
  'A forged artifact lease must be rejected.');
  check(checks, 'callback_fail_closed', unconfiguredCallback.status === 503
    && unconfiguredCallback.body?.code === 'CALLBACK_NOT_CONFIGURED',
  'Callback transport must remain unavailable until separately managed credentials exist.');

  const failedChecks = checks.filter(item => !item.pass).map(item => item.id);
  const blockers = [
    ...failedChecks.map(id => `staging_check_failed:${id}`),
    'registered_production_class_native_worker_missing',
    'positive_runtime_closed_loop_not_run',
    'multi_instance_recovery_campaign_not_run',
    'independent_cad_interoperability_review_missing',
    'manufacturing_pilot_evidence_missing',
  ];
  return Object.freeze({
    schema: STAGING_HOLD_EVIDENCE_SCHEMA,
    generatedAt,
    status: failedChecks.length ? 'HOLD_VERIFICATION_FAILED' : 'STAGING_HOLD_VERIFIED',
    ok: failedChecks.length === 0,
    target: { environment: 'staging', origin },
    release: {
      buildId: expectedBuildId,
      deploymentId: expectedDeploymentId,
      gitHead: expectedGitHead,
      migrationVersion: release.body?.release?.migrationVersion ?? null,
      precisionRuntimeReceiptSha256:
        release.body?.release?.precisionRuntime?.receiptSha256 ?? null,
    },
    checks,
    responseBindings: {
      live: { status: live.status, bodySha256: live.bodySha256 },
      ready: { status: ready.status, bodySha256: ready.bodySha256 },
      release: { status: release.status, bodySha256: release.bodySha256 },
      forgedClaim: { status: forgedClaim.status, bodySha256: forgedClaim.bodySha256 },
      forgedLease: { status: forgedLease.status, bodySha256: forgedLease.bodySha256 },
      unconfiguredCallback: {
        status: unconfiguredCallback.status,
        bodySha256: unconfiguredCallback.bodySha256,
      },
    },
    decision: {
      privateBetaEligible: false,
      commercialGaEligible: false,
      blockers,
    },
    claimBoundary: {
      verifiesStagingHoldOnly: true,
      positiveWorkerExecutionObserved: false,
      productionRuntimeObserved: false,
      independentQualificationObserved: false,
    },
    redaction: 'Only response status codes, selected non-secret fields, and body SHA-256 bindings are persisted.',
  });
}

async function main() {
  const receipt = await collectCommercialPrecisionStagingHoldEvidence({
    baseUrl: option('base-url', process.env.COMMERCIAL_PRECISION_STAGING_BASE_URL),
    expectedBuildId: option('expected-build-id', process.env.NEXYFAB_EXPECTED_BUILD_ID),
    expectedDeploymentId: option('expected-deployment-id', process.env.NEXYFAB_EXPECTED_DEPLOYMENT_ID),
    expectedGitHead: option('expected-git-head', process.env.NEXYFAB_EXPECTED_GIT_HEAD
      || process.env.NEXYFAB_EXPECTED_BUILD_ID),
  });
  const output = option('out', process.env.COMMERCIAL_PRECISION_STAGING_HOLD_OUTPUT);
  if (process.argv.includes('--write')) {
    if (!output) throw new Error('staging_hold_output_required');
    const resolved = path.resolve(output);
    const relative = path.relative(process.cwd(), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || path.extname(resolved).toLowerCase() !== '.json') {
      throw new Error('staging_hold_output_must_be_repository_json');
    }
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`[commercial-precision-staging-hold] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
