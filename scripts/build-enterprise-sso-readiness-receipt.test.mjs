import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_RELEASE_BASELINE_PATH,
  DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH,
  ENTERPRISE_SSO_CASE_SCHEMA,
  ENTERPRISE_SSO_CASE_SPECS,
  ENTERPRISE_SSO_COLLECTOR_ALLOWLIST_SCHEMA,
  ENTERPRISE_SSO_EVIDENCE_SCHEMA,
  ENTERPRISE_SSO_ISOLATION_SCHEMA,
  attachEvidenceSha256,
  buildEnterpriseSsoReadinessReceipt,
  enterpriseSsoCaseEvidenceRoot,
  enterpriseSsoCollectorAttestationPayload,
  fileBinding,
  verifyEnterpriseSsoReadinessReceipt,
  writeEnterpriseSsoReceiptFile,
} from './build-enterprise-sso-readiness-receipt.mjs';
import { sha256 } from './immutable-receipt-binding.mjs';

const SOURCE_FILES = [
  'scripts/build-enterprise-sso-readiness-receipt.mjs',
  'src/lib/saml-sso-verifier.ts',
  'src/lib/oidc-sso-readiness.ts',
  'src/app/api/nexyfab/sso/callback/route.ts',
];
const release = { buildId: 'build-sso-1', deploymentId: 'staging-deploy-1', gitHead: 'a'.repeat(40) };
const target = 'https://staging.nexyfab.test';
const now = Date.parse('2026-08-23T00:20:00.000Z');
const generatedAt = new Date(now).toISOString();
const keyPair = generateKeyPairSync('ed25519');
const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function writeJson(root, relativePath, value) {
  const absolute = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function fixtureRoot({ completeRelease = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-enterprise-sso-'));
  for (const relativePath of SOURCE_FILES) writeJson(root, relativePath, { fixture: relativePath });
  writeJson(root, DEFAULT_RELEASE_BASELINE_PATH, {
    release: {
      buildId: completeRelease ? release.buildId : null,
      deploymentId: completeRelease ? release.deploymentId : null,
      head: release.gitHead,
    },
  });
  return root;
}

function trustedCollectors(root, { origins = [target] } = {}) {
  const relativePath = DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH;
  writeJson(root, relativePath, attachEvidenceSha256({
    schema: ENTERPRISE_SSO_COLLECTOR_ALLOWLIST_SCHEMA,
    collectors: [{
      id: 'collector-a',
      status: 'ACTIVE',
      publicKeyPem,
      publicKeySha256: sha256(publicKeyPem),
      allowedStagingOrigins: origins,
      allowedDeploymentIds: [release.deploymentId],
    }],
  }, 'allowlistSha256'));
  return relativePath;
}

function rawCase(spec, { caseTarget = target, capturedAt = generatedAt, mutate = null } = {}) {
  const accepted = spec.outcome === 'ACCEPTED';
  const raw = {
    schema: ENTERPRISE_SSO_CASE_SCHEMA,
    caseId: spec.id,
    protocol: spec.protocol,
    capturedAt,
    environment: 'staging',
    target: caseTarget,
    release,
    runId: 'sso-staging-run-001',
    stimulus: spec.stimulus,
    request: { correlationId: `correlation-${spec.id}`, safeSha256: '1'.repeat(64) },
    response: { safeSha256: '2'.repeat(64) },
    transaction: {
      id: `transaction-${spec.id}`,
      ...(spec.predecessorCaseId ? {
        predecessorCaseId: spec.predecessorCaseId,
        predecessorTransactionId: `transaction-${spec.predecessorCaseId}`,
      } : {}),
    },
    observation: {
      httpStatus: accepted ? 302 : 400,
      outcome: spec.outcome,
      errorCode: spec.errorCode,
      sessionIssued: spec.session,
      validatedControls: spec.validated ?? [],
      rejectedControls: spec.rejected ?? [],
      ...(spec.replayAttempt ? { attempt: spec.replayAttempt } : {}),
    },
    sessionEvidence: accepted
      ? { lookup: 'FOUND', cleanup: 'CONFIRMED', sessionIdSha256: '3'.repeat(64) }
      : { lookup: 'NOT_FOUND', cleanup: 'NOT_REQUIRED', sessionIdSha256: null },
    ...(spec.protocol === 'saml' ? {
      samlEvidence: {
        certificateSha256: '4'.repeat(64), referenceIdSha256: '5'.repeat(64), digestSha256: '6'.repeat(64),
        signedElement: 'Response', signatureAlgorithm: 'rsa-sha256',
      },
    } : {
      oidcEvidence: {
        issuer: 'https://idp.example.test', issuerSha256: sha256('https://idp.example.test'),
        discoverySha256: '7'.repeat(64), jwksSha256: '8'.repeat(64), kidSha256: '9'.repeat(64),
        algorithm: spec.oidcAlgorithm, idTokenSha256: 'a'.repeat(64), userinfoSubjectSha256: 'b'.repeat(64),
      },
    }),
  };
  mutate?.(raw);
  return attachEvidenceSha256(raw, 'artifactSha256');
}

function writeEvidence(root, {
  caseTarget = target,
  runStartedAt = '2026-08-23T00:10:00.000Z',
  runCompletedAt = generatedAt,
  signManifest = true,
  mutateCase = null,
  allowedOrigins = [target],
} = {}) {
  const cases = ENTERPRISE_SSO_CASE_SPECS.map(spec => {
    const relativePath = `artifacts/sso/${spec.id}.json`;
    writeJson(root, relativePath, rawCase(spec, {
      caseTarget,
      capturedAt: runCompletedAt,
      mutate: mutateCase?.id === spec.id ? mutateCase.apply : null,
    }));
    return { id: spec.id, artifact: fileBinding(root, relativePath) };
  });
  const isolationPath = 'artifacts/sso/isolation.json';
  writeJson(root, isolationPath, attachEvidenceSha256({
    schema: ENTERPRISE_SSO_ISOLATION_SCHEMA,
    capturedAt: runCompletedAt,
    environment: 'staging',
    target: caseTarget,
    deploymentId: release.deploymentId,
    release,
    controls: { databaseIsolated: true, redisIsolated: true, sessionStoreIsolated: true, productionMutationDisabled: true },
  }, 'isolationSha256'));
  const body = {
    schema: ENTERPRISE_SSO_EVIDENCE_SCHEMA,
    capturedAt: runCompletedAt,
    environment: 'staging',
    target: caseTarget,
    release,
    run: { id: 'sso-staging-run-001', runner: 'nexyfab-staging-sso-e2e', startedAt: runStartedAt, completedAt: runCompletedAt },
    cases,
    caseEvidenceRootSha256: enterpriseSsoCaseEvidenceRoot(cases),
    isolationReceipt: fileBinding(root, isolationPath),
  };
  const attestation = {
    collectorId: 'collector-a', algorithm: 'Ed25519', signedAt: runCompletedAt,
    signature: signManifest ? sign(null, Buffer.from(enterpriseSsoCollectorAttestationPayload(body)), keyPair.privateKey).toString('base64') : Buffer.alloc(64).toString('base64'),
  };
  const manifest = attachEvidenceSha256({ ...body, attestation });
  const inputPath = 'artifacts/sso/manifest.json';
  writeJson(root, inputPath, manifest);
  return { inputPath, trustedCollectorsPath: trustedCollectors(root, { origins: allowedOrigins }) };
}

function build(root, evidence = null, overrides = {}) {
  return buildEnterpriseSsoReadinessReceipt({ root, ...evidence, generatedAt, now, ...overrides });
}

test('default remains an honest NOT_RUN/HOLD receipt', () => {
  const root = fixtureRoot({ completeRelease: false });
  const receipt = build(root);
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.releaseEligible, false);
  assert.equal(receipt.protocols.saml.status, 'NOT_RUN');
  assert.equal(receipt.protocols.oidc.status, 'NOT_RUN');
  assert.equal(receipt.sourceBindings.some(binding => binding.path === DEFAULT_RELEASE_BASELINE_PATH), false);
  assert.equal(Object.hasOwn(receipt.evidenceContract, 'releaseBaseline'), false);
  assert.deepEqual(verifyEnterpriseSsoReadinessReceipt(receipt, { root, expectedRelease: receipt.release, now }), { ok: true, releaseEligible: false, errors: [] });
});

test('derives PASS only from fresh signed evidence, exact origin, isolation, release, and all structured cases', () => {
  const root = fixtureRoot();
  const receipt = build(root, writeEvidence(root));
  assert.equal(receipt.status, 'PASS', receipt.blockers.join(','));
  assert.equal(receipt.evidenceContract.verifiedCaseIds.length, ENTERPRISE_SSO_CASE_SPECS.length);
  assert.deepEqual(verifyEnterpriseSsoReadinessReceipt(receipt, { root, expectedRelease: release, now }), { ok: true, releaseEligible: true, errors: [] });
});

test('rejects unsigned synthetic evidence and stale evidence rewrapped in a fresh receipt', () => {
  const unsignedRoot = fixtureRoot();
  const unsigned = build(unsignedRoot, writeEvidence(unsignedRoot, { signManifest: false }));
  assert.equal(unsigned.releaseEligible, false);
  assert.ok(unsigned.blockers.includes('collector_attestation_signature_invalid'));

  const staleRoot = fixtureRoot();
  const stale = build(staleRoot, writeEvidence(staleRoot, {
    runStartedAt: '2026-08-20T00:00:00.000Z', runCompletedAt: '2026-08-20T00:10:00.000Z',
  }));
  assert.equal(stale.releaseEligible, false);
  assert.ok(stale.blockers.includes('staging_evidence_freshness_invalid'));
  assert.ok(stale.blockers.includes('collector_attestation_time_invalid'));
});

test('rejects a caller-selected collector allowlist even when its signature is valid', () => {
  const root = fixtureRoot();
  const evidence = writeEvidence(root);
  const alternatePath = 'artifacts/sso/caller-trusted-collectors.json';
  writeJson(root, alternatePath, JSON.parse(fs.readFileSync(path.join(root, ...evidence.trustedCollectorsPath.split('/')), 'utf8')));
  const receipt = build(root, { ...evidence, trustedCollectorsPath: alternatePath });
  assert.equal(receipt.releaseEligible, false);
  assert.ok(receipt.blockers.includes('trusted_collector_allowlist_path_not_pinned'));
});

test('rejects an arbitrary staging-looking domain even with otherwise signed evidence', () => {
  const root = fixtureRoot();
  const receipt = build(root, writeEvidence(root, { caseTarget: 'https://staging.attacker.example', allowedOrigins: [target] }));
  assert.equal(receipt.releaseEligible, false);
  assert.ok(receipt.blockers.includes('staging_origin_or_deployment_not_allowlisted'));
});

test('rejects non-exact error codes and unlinked replay attempts after valid self-hashing', () => {
  const codeRoot = fixtureRoot();
  const badCode = build(codeRoot, writeEvidence(codeRoot, {
    mutateCase: { id: 'saml_invalid_signature_rejected', apply: raw => { raw.observation.errorCode = 'SOME_ERROR'; } },
  }));
  assert.equal(badCode.releaseEligible, false);
  assert.ok(badCode.blockers.includes('case_observation_invalid:saml_invalid_signature_rejected'));

  const replayRoot = fixtureRoot();
  const unlinked = build(replayRoot, writeEvidence(replayRoot, {
    mutateCase: { id: 'oidc_code_replay_rejected', apply: raw => { raw.transaction.predecessorTransactionId = 'unlinked-transaction'; } },
  }));
  assert.equal(unlinked.releaseEligible, false);
  assert.ok(unlinked.blockers.includes('replay_predecessor_link_invalid:oidc_code_replay_rejected'));
});

test('rejects input and release-baseline path escape before reading outside the root', () => {
  const root = fixtureRoot();
  const escapedInput = build(root, { inputPath: '../outside.json', trustedCollectorsPath: '../collectors.json' });
  assert.equal(escapedInput.releaseEligible, false);
  assert.ok(escapedInput.blockers.includes('unsafe_evidence_path_rejected'));
  assert.throws(() => build(root, null, { releaseBaselinePath: '../outside-baseline.json' }), /unsafe_evidence_path/);
  assert.throws(() => writeEnterpriseSsoReceiptFile(root, '../outside-receipt.json', {}), /unsafe_evidence_path/);
});

test('rejects a symlinked evidence input instead of following it', t => {
  const root = fixtureRoot();
  const outside = path.join(os.tmpdir(), `nexyfab-sso-outside-${process.pid}.json`);
  fs.writeFileSync(outside, '{}\n');
  const linkPath = path.join(root, 'artifacts', 'sso', 'linked-manifest.json');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(outside, linkPath, 'file');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Windows symlink permission is unavailable');
      return;
    }
    throw error;
  }
  const receipt = build(root, { inputPath: 'artifacts/sso/linked-manifest.json', trustedCollectorsPath: DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH });
  assert.equal(receipt.releaseEligible, false);
  assert.ok(receipt.blockers.includes('staging_evidence_unreadable'));
});
