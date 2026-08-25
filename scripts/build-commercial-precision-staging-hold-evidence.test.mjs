import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectCommercialPrecisionStagingHoldEvidence,
  STAGING_HOLD_EVIDENCE_SCHEMA,
  verifyCommercialPrecisionStagingHoldEvidence,
} from './build-commercial-precision-staging-hold-evidence.mjs';

const buildId = 'a'.repeat(40);
const deploymentId = '11111111-2222-3333-4444-555555555555';
const precisionReceiptSha256 = 'b'.repeat(64);

function fixture(overrides = {}) {
  const values = {
    '/api/health/live/': [200, { status: 'ok', build: buildId }],
    '/api/health/ready/': [200, {
      status: 'ok', db: { status: 'ok', backend: 'postgres', required: true },
      redis: { status: 'ok', required: true },
      commercialBoundary: { status: 'skipped', required: false },
    }],
    '/api/health/release/': [503, {
      status: 'HOLD',
      release: {
        buildId, deploymentId, gitHead: buildId, migrationVersion: 2026082502,
        precisionRuntime: { status: 'HOLD', receiptSha256: precisionReceiptSha256 },
      },
      evidence: { migration: { status: 'PASS' } },
    }],
    '/api/internal/precision-cad-commercial/claim/': [403, { ok: false, code: 'FORBIDDEN' }],
    '/api/internal/precision-cad-commercial/artifacts/': [403, { ok: false, code: 'LEASE_CAPABILITY_INVALID' }],
    '/api/internal/precision-cad-commercial/callback/': [503, { ok: false, code: 'CALLBACK_NOT_CONFIGURED' }],
    ...overrides,
  };
  return async raw => {
    const url = new URL(raw);
    const [status, body] = values[url.pathname] ?? [500, { code: 'unexpected_path' }];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

test('verifies an exact fail-closed staging deployment without qualifying beta or GA', async () => {
  const receipt = await collectCommercialPrecisionStagingHoldEvidence({
    baseUrl: 'https://nexyfab-staging.example.test',
    expectedBuildId: buildId,
    expectedDeploymentId: deploymentId,
    fetchImpl: fixture(),
    generatedAt: '2026-08-25T00:00:00.000Z',
  });
  assert.equal(receipt.schema, STAGING_HOLD_EVIDENCE_SCHEMA);
  assert.equal(receipt.status, 'STAGING_HOLD_VERIFIED');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.checks.every(item => item.pass), true);
  assert.equal(receipt.decision.privateBetaEligible, false);
  assert.equal(receipt.decision.commercialGaEligible, false);
  assert.equal(receipt.release.precisionRuntimeReceiptSha256, precisionReceiptSha256);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(verifyCommercialPrecisionStagingHoldEvidence(receipt, {
    expectedRelease: { buildId, head: buildId, stagingDeploymentId: deploymentId },
    expectedOrigin: 'https://nexyfab-staging.example.test',
    now: Date.parse('2026-08-25T00:01:00.000Z'),
  }), { ok: true, blockers: [] });
});

test('fails closed on an exact release mismatch', async () => {
  const receipt = await collectCommercialPrecisionStagingHoldEvidence({
    baseUrl: 'https://nexyfab-staging.example.test',
    expectedBuildId: buildId,
    expectedDeploymentId: deploymentId,
    fetchImpl: fixture({
      '/api/health/live/': [200, { status: 'ok', build: 'c'.repeat(40) }],
    }),
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.status, 'HOLD_VERIFICATION_FAILED');
  assert.ok(receipt.decision.blockers.includes('staging_check_failed:live_exact_release'));
});

test('refuses a production or non-HTTPS origin', async () => {
  for (const baseUrl of ['https://nexyfab.com', 'http://nexyfab-staging.example.test']) {
    await assert.rejects(
      collectCommercialPrecisionStagingHoldEvidence({
        baseUrl, expectedBuildId: buildId, expectedDeploymentId: deploymentId,
        fetchImpl: fixture(),
      }),
      /isolated_staging_https_origin_required/,
    );
  }
});

test('verifier rejects tampering, release transplant, and stale evidence', async () => {
  const receipt = await collectCommercialPrecisionStagingHoldEvidence({
    baseUrl: 'https://nexyfab-staging.example.test',
    expectedBuildId: buildId,
    expectedDeploymentId: deploymentId,
    fetchImpl: fixture(),
    generatedAt: '2026-08-25T00:00:00.000Z',
  });
  const tampered = structuredClone(receipt);
  tampered.checks[0].pass = false;
  let result = verifyCommercialPrecisionStagingHoldEvidence(tampered, {
    expectedRelease: { buildId, head: buildId },
    now: Date.parse('2026-08-25T00:01:00.000Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('receipt_hash_invalid'));
  assert.ok(result.blockers.includes('staging_checks_invalid'));

  result = verifyCommercialPrecisionStagingHoldEvidence(receipt, {
    expectedRelease: { buildId: 'c'.repeat(40), head: 'c'.repeat(40) },
    now: Date.parse('2026-08-25T00:01:00.000Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('release_binding_mismatch'));

  result = verifyCommercialPrecisionStagingHoldEvidence(receipt, {
    expectedRelease: { buildId, head: buildId },
    now: Date.parse('2026-08-27T00:00:01.000Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('receipt_stale'));
});
