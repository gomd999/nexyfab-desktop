#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachReceiptSha256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

export const STAGING_HOLD_EVIDENCE_SCHEMA =
  'nexyfab.commercial-precision-staging-hold-evidence.v1';

const GIT_SHA = /^[a-f0-9]{40}$/;
const DEPLOYMENT_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
export const STAGING_HOLD_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60_000;
export const STAGING_HOLD_CHECK_IDS = Object.freeze([
  'live_exact_release',
  'ready_postgres',
  'ready_redis',
  'commercial_boundary_held',
  'release_exact_identity',
  'release_is_hold',
  'migration_pass',
  'precision_runtime_hold_packaged',
  'forged_claim_rejected',
  'forged_lease_rejected',
  'callback_fail_closed',
]);
export const STAGING_HOLD_EXTERNAL_BLOCKERS = Object.freeze([
  'registered_production_class_native_worker_missing',
  'positive_runtime_closed_loop_not_run',
  'multi_instance_recovery_campaign_not_run',
  'independent_cad_interoperability_review_missing',
  'manufacturing_pilot_evidence_missing',
]);

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
    ...STAGING_HOLD_EXTERNAL_BLOCKERS,
  ];
  return Object.freeze(attachReceiptSha256({
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
  }));
}

export function verifyCommercialPrecisionStagingHoldEvidence(receipt, {
  expectedRelease = null,
  expectedOrigin = null,
  now = Date.now(),
  maxAgeMs = STAGING_HOLD_EVIDENCE_MAX_AGE_MS,
} = {}) {
  const blockers = [];
  const fail = value => blockers.push(value);
  if (receipt?.schema !== STAGING_HOLD_EVIDENCE_SCHEMA) fail('receipt_schema_invalid');
  if (receipt?.ok !== true || receipt?.status !== 'STAGING_HOLD_VERIFIED') fail('receipt_status_invalid');
  if (!verifyReceiptSha256(receipt)) fail('receipt_hash_invalid');

  const generatedAt = Date.parse(receipt?.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt > now + 5 * 60_000 || generatedAt < now - maxAgeMs) {
    fail('receipt_stale');
  }
  let normalizedOrigin = null;
  try { normalizedOrigin = stagingOrigin(receipt?.target?.origin); } catch { fail('staging_origin_invalid'); }
  if (receipt?.target?.environment !== 'staging') fail('target_environment_invalid');
  if (expectedOrigin) {
    try {
      if (normalizedOrigin !== stagingOrigin(expectedOrigin)) fail('staging_origin_mismatch');
    } catch { fail('expected_staging_origin_invalid'); }
  }

  const release = receipt?.release ?? {};
  if (!GIT_SHA.test(String(release.buildId ?? '')) || !GIT_SHA.test(String(release.gitHead ?? ''))
    || !DEPLOYMENT_ID.test(String(release.deploymentId ?? ''))
    || release.migrationVersion !== 2026082502
    || !SHA256.test(String(release.precisionRuntimeReceiptSha256 ?? ''))) fail('release_identity_invalid');
  const expectedGitHead = expectedRelease?.head ?? expectedRelease?.gitHead;
  if (expectedRelease && (release.buildId !== expectedRelease.buildId || release.gitHead !== expectedGitHead)) {
    fail('release_binding_mismatch');
  }
  if (expectedRelease?.stagingDeploymentId
    && release.deploymentId !== expectedRelease.stagingDeploymentId) fail('staging_deployment_mismatch');

  const checks = Array.isArray(receipt?.checks) ? receipt.checks : [];
  const checkIds = checks.map(item => item?.id);
  if (checks.length !== STAGING_HOLD_CHECK_IDS.length
    || new Set(checkIds).size !== STAGING_HOLD_CHECK_IDS.length
    || STAGING_HOLD_CHECK_IDS.some(id => !checkIds.includes(id))
    || checks.some(item => item?.pass !== true || typeof item?.detail !== 'string' || !item.detail)) {
    fail('staging_checks_invalid');
  }

  const responseBindings = receipt?.responseBindings ?? {};
  const responseStatuses = {
    live: 200, ready: 200, release: 503, forgedClaim: 403,
    forgedLease: 403, unconfiguredCallback: 503,
  };
  if (Object.entries(responseStatuses).some(([id, status]) => responseBindings[id]?.status !== status
    || !SHA256.test(String(responseBindings[id]?.bodySha256 ?? '')))) fail('response_bindings_invalid');

  const decisionBlockers = Array.isArray(receipt?.decision?.blockers) ? receipt.decision.blockers : [];
  if (receipt?.decision?.privateBetaEligible !== false
    || receipt?.decision?.commercialGaEligible !== false
    || decisionBlockers.length !== STAGING_HOLD_EXTERNAL_BLOCKERS.length
    || new Set(decisionBlockers).size !== STAGING_HOLD_EXTERNAL_BLOCKERS.length
    || STAGING_HOLD_EXTERNAL_BLOCKERS.some(value => !decisionBlockers.includes(value))) {
    fail('hold_decision_invalid');
  }
  if (receipt?.claimBoundary?.verifiesStagingHoldOnly !== true
    || receipt?.claimBoundary?.positiveWorkerExecutionObserved !== false
    || receipt?.claimBoundary?.productionRuntimeObserved !== false
    || receipt?.claimBoundary?.independentQualificationObserved !== false) fail('claim_boundary_invalid');
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
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
