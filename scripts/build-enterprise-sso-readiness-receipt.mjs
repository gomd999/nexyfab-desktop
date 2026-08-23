#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { attachReceiptSha256, canonicalJson, sha256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

export const ENTERPRISE_SSO_RECEIPT_SCHEMA = 'nexyfab.enterprise-sso-readiness.v1';
export const ENTERPRISE_SSO_EVIDENCE_SCHEMA = 'nexyfab.enterprise-sso-staging-evidence.v1';
export const ENTERPRISE_SSO_CASE_SCHEMA = 'nexyfab.enterprise-sso-staging-case.v1';
export const ENTERPRISE_SSO_COLLECTOR_ALLOWLIST_SCHEMA = 'nexyfab.enterprise-sso-trusted-collectors.v1';
export const ENTERPRISE_SSO_ISOLATION_SCHEMA = 'nexyfab.enterprise-sso-staging-isolation.v1';
export const DEFAULT_ENTERPRISE_SSO_RECEIPT_PATH = 'docs/evidence/release/enterprise-sso-readiness-receipt.json';
export const DEFAULT_RELEASE_BASELINE_PATH = 'docs/evidence/release/commercial-release-baseline-current.json';
export const DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH = 'docs/evidence/release/enterprise-sso-trusted-collectors.json';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const ALLOWED_REJECT_STATUS = new Set([400, 401, 403]);
export const ENTERPRISE_SSO_MAX_AGE_MS = 24 * 60 * 60_000;
export const ENTERPRISE_SSO_FUTURE_SKEW_MS = 5 * 60_000;
export const ENTERPRISE_SSO_MAX_RUN_MS = 2 * 60 * 60_000;
export const ENTERPRISE_SSO_MAX_RECEIPT_DELAY_MS = 15 * 60_000;
const CODE_SOURCE_PATHS = Object.freeze([
  'scripts/build-enterprise-sso-readiness-receipt.mjs',
  'src/lib/saml-sso-verifier.ts',
  'src/lib/oidc-sso-readiness.ts',
  'src/app/api/nexyfab/sso/callback/route.ts',
]);

export const ENTERPRISE_SSO_CASE_SPECS = Object.freeze([
  { id: 'saml_signed_response_or_assertion', protocol: 'saml', stimulus: 'valid_signed_login', outcome: 'ACCEPTED', errorCode: null, session: true, validated: ['xml_signature', 'signed_response_or_assertion', 'unique_id_reference', 'issuer', 'audience', 'destination', 'not_before', 'not_on_or_after', 'in_response_to'] },
  { id: 'saml_invalid_signature_rejected', protocol: 'saml', stimulus: 'invalid_signature', outcome: 'REJECTED', errorCode: 'SAML_INVALID_SIGNATURE', session: false, rejected: ['xml_signature'] },
  { id: 'saml_wrapping_duplicate_id_rejected', protocol: 'saml', stimulus: 'signature_wrapping_duplicate_id', outcome: 'REJECTED', errorCode: 'SAML_SIGNATURE_WRAPPING_REJECTED', session: false, rejected: ['signature_wrapping', 'duplicate_id'] },
  { id: 'saml_issuer_mismatch_rejected', protocol: 'saml', stimulus: 'issuer_mismatch', outcome: 'REJECTED', errorCode: 'SAML_ISSUER_MISMATCH', session: false, rejected: ['issuer'] },
  { id: 'saml_audience_mismatch_rejected', protocol: 'saml', stimulus: 'audience_mismatch', outcome: 'REJECTED', errorCode: 'SAML_AUDIENCE_MISMATCH', session: false, rejected: ['audience'] },
  { id: 'saml_destination_mismatch_rejected', protocol: 'saml', stimulus: 'destination_mismatch', outcome: 'REJECTED', errorCode: 'SAML_DESTINATION_MISMATCH', session: false, rejected: ['destination'] },
  { id: 'saml_not_before_rejected', protocol: 'saml', stimulus: 'not_before_in_future', outcome: 'REJECTED', errorCode: 'SAML_NOT_YET_VALID', session: false, rejected: ['not_before'] },
  { id: 'saml_expired_rejected', protocol: 'saml', stimulus: 'not_on_or_after_expired', outcome: 'REJECTED', errorCode: 'SAML_ASSERTION_EXPIRED', session: false, rejected: ['not_on_or_after'] },
  { id: 'saml_in_response_to_rejected', protocol: 'saml', stimulus: 'in_response_to_mismatch', outcome: 'REJECTED', errorCode: 'SAML_IN_RESPONSE_TO_MISMATCH', session: false, rejected: ['in_response_to'] },
  { id: 'saml_replay_rejected', protocol: 'saml', stimulus: 'assertion_replay_second_attempt', outcome: 'REJECTED', errorCode: 'SAML_REPLAY_REJECTED', session: false, rejected: ['replay'], replayAttempt: 2, predecessorCaseId: 'saml_signed_response_or_assertion' },
  { id: 'oidc_valid_authorization_code_flow', protocol: 'oidc', stimulus: 'valid_authorization_code_login', outcome: 'ACCEPTED', errorCode: null, session: true, oidcAlgorithm: 'RS256', validated: ['one_use_state', 'nonce', 'pkce_s256', 'https_discovery_pinned', 'jwks_signature', 'algorithm_allowlist', 'issuer', 'audience', 'exp', 'nonce_claim', 'userinfo_sub', 'redirect_allowlist'] },
  { id: 'oidc_state_replay_rejected', protocol: 'oidc', stimulus: 'state_second_use', outcome: 'REJECTED', errorCode: 'OIDC_STATE_REPLAY_REJECTED', session: false, oidcAlgorithm: 'RS256', rejected: ['one_use_state'], replayAttempt: 2, predecessorCaseId: 'oidc_valid_authorization_code_flow' },
  { id: 'oidc_nonce_mismatch_rejected', protocol: 'oidc', stimulus: 'nonce_mismatch', outcome: 'REJECTED', errorCode: 'OIDC_NONCE_MISMATCH', session: false, oidcAlgorithm: 'RS256', rejected: ['nonce', 'nonce_claim'] },
  { id: 'oidc_pkce_mismatch_rejected', protocol: 'oidc', stimulus: 'pkce_verifier_mismatch', outcome: 'REJECTED', errorCode: 'OIDC_PKCE_MISMATCH', session: false, oidcAlgorithm: 'RS256', rejected: ['pkce_s256'] },
  { id: 'oidc_unpinned_discovery_rejected', protocol: 'oidc', stimulus: 'unpinned_or_insecure_discovery', outcome: 'REJECTED', errorCode: 'OIDC_DISCOVERY_NOT_PINNED', session: false, oidcAlgorithm: 'RS256', rejected: ['https_discovery_pinned'] },
  { id: 'oidc_disallowed_algorithm_rejected', protocol: 'oidc', stimulus: 'disallowed_or_none_algorithm', outcome: 'REJECTED', errorCode: 'OIDC_ALGORITHM_NOT_ALLOWED', session: false, oidcAlgorithm: 'none', rejected: ['algorithm_allowlist', 'jwks_signature'] },
  { id: 'oidc_issuer_mismatch_rejected', protocol: 'oidc', stimulus: 'issuer_mismatch', outcome: 'REJECTED', errorCode: 'OIDC_ISSUER_MISMATCH', session: false, oidcAlgorithm: 'RS256', rejected: ['issuer'] },
  { id: 'oidc_audience_mismatch_rejected', protocol: 'oidc', stimulus: 'audience_mismatch', outcome: 'REJECTED', errorCode: 'OIDC_AUDIENCE_MISMATCH', session: false, oidcAlgorithm: 'RS256', rejected: ['audience'] },
  { id: 'oidc_expired_token_rejected', protocol: 'oidc', stimulus: 'expired_id_token', outcome: 'REJECTED', errorCode: 'OIDC_TOKEN_EXPIRED', session: false, oidcAlgorithm: 'RS256', rejected: ['exp'] },
  { id: 'oidc_userinfo_subject_mismatch_rejected', protocol: 'oidc', stimulus: 'userinfo_subject_mismatch', outcome: 'REJECTED', errorCode: 'OIDC_USERINFO_SUB_MISMATCH', session: false, oidcAlgorithm: 'RS256', rejected: ['userinfo_sub'] },
  { id: 'oidc_redirect_not_allowlisted_rejected', protocol: 'oidc', stimulus: 'post_login_redirect_not_allowlisted', outcome: 'REJECTED', errorCode: 'OIDC_REDIRECT_NOT_ALLOWED', session: false, oidcAlgorithm: 'RS256', rejected: ['redirect_allowlist'] },
  { id: 'oidc_code_replay_rejected', protocol: 'oidc', stimulus: 'authorization_code_second_use', outcome: 'REJECTED', errorCode: 'OIDC_CODE_REPLAY_REJECTED', session: false, oidcAlgorithm: 'RS256', rejected: ['replay'], replayAttempt: 2, predecessorCaseId: 'oidc_valid_authorization_code_flow' },
]);

const CASE_BY_ID = new Map(ENTERPRISE_SSO_CASE_SPECS.map(spec => [spec.id, spec]));

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function sameRelease(left, right) {
  return left?.buildId === right?.buildId
    && left?.deploymentId === right?.deploymentId
    && left?.gitHead === (right?.gitHead ?? right?.head);
}

function completeRelease(release) {
  return typeof release?.buildId === 'string' && release.buildId.length > 0
    && typeof release?.deploymentId === 'string' && release.deploymentId.length > 0
    && GIT_SHA.test(String(release?.gitHead ?? ''));
}

function isolatedStagingTarget(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && url.origin !== 'https://nexyfab.com'
      && ['staging', 'stage', 'preview', 'test'].some(marker => hostname.includes(marker));
  } catch {
    return false;
  }
}

function uniqueStrings(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length;
}

function containsAll(actual, required = []) {
  return uniqueStrings(actual) && required.every(item => actual.includes(item));
}

function normalizeRelative(root, candidate) {
  if (typeof candidate !== 'string' || !candidate) throw new Error('evidence_path_missing');
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, absolute).replaceAll('\\', '/');
  if (!relative || relative === '.' || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`unsafe_evidence_path:${candidate}`);
  return { absolute, relative };
}

export function fileBinding(root, candidate) {
  return readBoundFile(root, candidate).binding;
}

function readBoundFile(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const { absolute, relative } = normalizeRelative(resolvedRoot, candidate);
  const link = fs.lstatSync(absolute);
  if (link.isSymbolicLink()) throw new Error(`evidence_symlink_rejected:${candidate}`);
  const realRoot = fs.realpathSync.native(resolvedRoot);
  const realFile = fs.realpathSync.native(absolute);
  const contained = path.relative(realRoot, realFile);
  const stat = fs.statSync(realFile);
  if (!contained || contained.startsWith('..') || path.isAbsolute(contained) || !stat.isFile() || stat.size <= 0) throw new Error(`evidence_file_invalid:${candidate}`);
  const bytes = fs.readFileSync(realFile);
  return { binding: { path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) }, bytes };
}

function readContainedJson(root, candidate) {
  const bound = readBoundFile(root, candidate);
  return { binding: bound.binding, document: JSON.parse(bound.bytes.toString('utf8')) };
}

export function enterpriseSsoCaseEvidenceRoot(cases) {
  return sha256((cases ?? []).map(entry => ({ id: entry?.id, artifact: entry?.artifact }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id))));
}

export function enterpriseSsoCollectorAttestationPayload(manifest) {
  const body = { ...(manifest ?? {}) };
  delete body.attestation;
  delete body.evidenceSha256;
  return canonicalJson({ purpose: 'nexyfab-enterprise-sso-staging-evidence-v1', manifest: body });
}

function validTimeWindow(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp <= now + ENTERPRISE_SSO_FUTURE_SKEW_MS
    && timestamp >= now - ENTERPRISE_SSO_MAX_AGE_MS;
}

function bindingMatches(root, binding) {
  if (typeof binding?.path !== 'string' || !Number.isInteger(binding?.bytes) || binding.bytes <= 0 || !SHA256.test(String(binding?.sha256 ?? ''))) return false;
  try {
    return canonicalJson(fileBinding(root, binding.path)) === canonicalJson(binding);
  } catch {
    return false;
  }
}

export function attachEvidenceSha256(document, field = 'evidenceSha256') {
  const unsigned = { ...(document ?? {}) };
  delete unsigned[field];
  return { ...unsigned, [field]: sha256(unsigned) };
}

function verifyDocumentSha256(document, field) {
  if (!SHA256.test(String(document?.[field] ?? ''))) return false;
  const unsigned = { ...document };
  delete unsigned[field];
  return sha256(unsigned) === document[field];
}

function blankProtocols(status = 'NOT_RUN') {
  return {
    saml: {
      status, signatureValidation: false, signedResponseOrAssertion: false, uniqueIdReferenceValidation: false,
      wrappingAndDuplicateIdRejected: false, issuerAudienceDestinationTimeValidated: false,
      inResponseToValidated: false, replayRejected: false, localSessionIssued: false,
    },
    oidc: {
      status, oneUseStateNoncePkce: false, pinnedHttpsDiscovery: false, jwksAlgorithmAllowlist: false,
      idTokenClaimsValidated: false, userinfoSubjectBound: false, redirectAllowlist: false,
      replayRejected: false, localSessionIssued: false,
    },
  };
}

function evaluateRawCase(raw, spec, manifest) {
  const errors = [];
  if (raw?.schema !== ENTERPRISE_SSO_CASE_SCHEMA || !verifyDocumentSha256(raw, 'artifactSha256')) errors.push('case_contract_or_hash_invalid');
  if (raw?.caseId !== spec.id || raw?.protocol !== spec.protocol || raw?.stimulus !== spec.stimulus) errors.push('case_identity_invalid');
  if (raw?.environment !== 'staging' || raw?.target !== manifest.target || !sameRelease(raw?.release, manifest.release) || raw?.runId !== manifest?.run?.id) errors.push('case_source_binding_invalid');
  if (!validDate(raw?.capturedAt) || Date.parse(raw.capturedAt) < Date.parse(manifest?.run?.startedAt) || Date.parse(raw.capturedAt) > Date.parse(manifest?.run?.completedAt)) errors.push('case_time_invalid');
  if (typeof raw?.request?.correlationId !== 'string' || raw.request.correlationId.length < 8) errors.push('case_correlation_missing');
  if (!SHA256.test(String(raw?.request?.safeSha256 ?? '')) || !SHA256.test(String(raw?.response?.safeSha256 ?? ''))) errors.push('request_response_safe_hash_missing');
  if (typeof raw?.transaction?.id !== 'string' || raw.transaction.id.length < 8) errors.push('transaction_identity_missing');
  const observation = raw?.observation;
  if (observation?.outcome !== spec.outcome || observation?.sessionIssued !== spec.session || observation?.errorCode !== spec.errorCode) errors.push('case_observation_invalid');
  if (spec.outcome === 'ACCEPTED') {
    if (![200, 302].includes(observation?.httpStatus) || !containsAll(observation?.validatedControls, spec.validated)) errors.push('accepted_case_controls_incomplete');
  } else if (!ALLOWED_REJECT_STATUS.has(observation?.httpStatus)
    || !containsAll(observation?.rejectedControls, spec.rejected)) errors.push('rejected_case_controls_incomplete');
  if (spec.replayAttempt && observation?.attempt !== spec.replayAttempt) errors.push('replay_attempt_not_observed');
  const session = raw?.sessionEvidence;
  if (spec.session) {
    if (session?.lookup !== 'FOUND' || session?.cleanup !== 'CONFIRMED' || !SHA256.test(String(session?.sessionIdSha256 ?? ''))) errors.push('session_lookup_cleanup_not_verified');
  } else if (session?.lookup !== 'NOT_FOUND' || session?.cleanup !== 'NOT_REQUIRED' || session?.sessionIdSha256 !== null) errors.push('rejected_case_session_evidence_invalid');
  if (spec.protocol === 'saml') {
    const evidence = raw?.samlEvidence;
    if (!SHA256.test(String(evidence?.certificateSha256 ?? '')) || !SHA256.test(String(evidence?.referenceIdSha256 ?? ''))
      || !SHA256.test(String(evidence?.digestSha256 ?? '')) || !['Response', 'Assertion'].includes(evidence?.signedElement)
      || !['rsa-sha256', 'ecdsa-sha256'].includes(evidence?.signatureAlgorithm)) errors.push('saml_cryptographic_observation_incomplete');
  } else {
    const evidence = raw?.oidcEvidence;
    if (typeof evidence?.issuer !== 'string' || !/^https?:\/\//.test(evidence.issuer)
      || evidence?.issuerSha256 !== sha256(evidence?.issuer)
      || !SHA256.test(String(evidence?.discoverySha256 ?? '')) || !SHA256.test(String(evidence?.jwksSha256 ?? ''))
      || !SHA256.test(String(evidence?.kidSha256 ?? '')) || !SHA256.test(String(evidence?.idTokenSha256 ?? ''))
      || !SHA256.test(String(evidence?.userinfoSubjectSha256 ?? '')) || evidence?.algorithm !== spec.oidcAlgorithm) errors.push('oidc_cryptographic_observation_incomplete');
  }
  return [...new Set(errors)];
}

function protocolsFromPassedCases(passed) {
  const has = id => passed.has(id);
  const samlPositive = has('saml_signed_response_or_assertion');
  const oidcPositive = has('oidc_valid_authorization_code_flow');
  const samlTime = has('saml_not_before_rejected') && has('saml_expired_rejected');
  const samlIdentity = has('saml_issuer_mismatch_rejected') && has('saml_audience_mismatch_rejected') && has('saml_destination_mismatch_rejected');
  const oidcClaims = has('oidc_issuer_mismatch_rejected') && has('oidc_audience_mismatch_rejected') && has('oidc_expired_token_rejected') && has('oidc_nonce_mismatch_rejected');
  const saml = {
    status: 'NOT_RUN',
    signatureValidation: samlPositive && has('saml_invalid_signature_rejected'),
    signedResponseOrAssertion: samlPositive,
    uniqueIdReferenceValidation: samlPositive,
    wrappingAndDuplicateIdRejected: has('saml_wrapping_duplicate_id_rejected'),
    issuerAudienceDestinationTimeValidated: samlPositive && samlIdentity && samlTime,
    inResponseToValidated: samlPositive && has('saml_in_response_to_rejected'),
    replayRejected: has('saml_replay_rejected'),
    localSessionIssued: samlPositive,
  };
  saml.status = Object.values(saml).slice(1).every(Boolean) ? 'PASS' : 'HOLD';
  const oidc = {
    status: 'NOT_RUN',
    oneUseStateNoncePkce: oidcPositive && has('oidc_state_replay_rejected') && has('oidc_nonce_mismatch_rejected') && has('oidc_pkce_mismatch_rejected'),
    pinnedHttpsDiscovery: oidcPositive && has('oidc_unpinned_discovery_rejected'),
    jwksAlgorithmAllowlist: oidcPositive && has('oidc_disallowed_algorithm_rejected'),
    idTokenClaimsValidated: oidcPositive && oidcClaims,
    userinfoSubjectBound: oidcPositive && has('oidc_userinfo_subject_mismatch_rejected'),
    redirectAllowlist: oidcPositive && has('oidc_redirect_not_allowlisted_rejected'),
    replayRejected: has('oidc_state_replay_rejected') && has('oidc_code_replay_rejected'),
    localSessionIssued: oidcPositive,
  };
  oidc.status = Object.values(oidc).slice(1).every(Boolean) ? 'PASS' : 'HOLD';
  return { saml, oidc };
}

function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}

function verifyCollectorAttestation(root, trustedCollectorsPath, manifest, now) {
  const blockers = [];
  let binding = null;
  let allowlist = null;
  if (trustedCollectorsPath !== DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH) {
    return { blockers: ['trusted_collector_allowlist_path_not_pinned'], binding, collector: null };
  }
  try {
    ({ binding, document: allowlist } = readContainedJson(root, trustedCollectorsPath));
  } catch {
    return { blockers: ['trusted_collector_allowlist_unreadable'], binding, collector: null };
  }
  if (allowlist?.schema !== ENTERPRISE_SSO_COLLECTOR_ALLOWLIST_SCHEMA || !verifyDocumentSha256(allowlist, 'allowlistSha256')) blockers.push('trusted_collector_allowlist_invalid');
  const collectors = Array.isArray(allowlist?.collectors) ? allowlist.collectors : [];
  const collector = collectors.find(item => item?.id === manifest?.attestation?.collectorId && item?.status === 'ACTIVE') ?? null;
  if (!collector || typeof collector.publicKeyPem !== 'string' || collector.publicKeySha256 !== sha256(collector.publicKeyPem)) blockers.push('trusted_collector_not_allowlisted');
  if (!exactHttpsOrigin(manifest?.target) || !Array.isArray(collector?.allowedStagingOrigins)
    || !collector.allowedStagingOrigins.every(exactHttpsOrigin) || !collector.allowedStagingOrigins.includes(manifest.target)
    || !Array.isArray(collector?.allowedDeploymentIds) || !uniqueStrings(collector.allowedDeploymentIds)
    || !collector.allowedDeploymentIds.includes(manifest?.release?.deploymentId)) blockers.push('staging_origin_or_deployment_not_allowlisted');
  const signedAt = Date.parse(manifest?.attestation?.signedAt);
  if (manifest?.attestation?.algorithm !== 'Ed25519' || !validTimeWindow(manifest?.attestation?.signedAt, now)
    || signedAt < Date.parse(manifest?.run?.completedAt) || signedAt > Date.parse(manifest?.generatedAt ?? manifest?.capturedAt) + ENTERPRISE_SSO_MAX_RECEIPT_DELAY_MS) blockers.push('collector_attestation_time_invalid');
  try {
    const signature = Buffer.from(String(manifest?.attestation?.signature ?? ''), 'base64');
    if (!collector || signature.length !== 64 || !verifySignature(null, Buffer.from(enterpriseSsoCollectorAttestationPayload(manifest)), createPublicKey(collector.publicKeyPem), signature)) blockers.push('collector_attestation_signature_invalid');
  } catch {
    blockers.push('collector_attestation_signature_invalid');
  }
  return { blockers: [...new Set(blockers)], binding, collector };
}

function verifyIsolationReceipt(root, binding, manifest, now) {
  const blockers = [];
  let document = null;
  if (!bindingMatches(root, binding)) return { blockers: ['staging_isolation_binding_invalid'], document };
  try {
    ({ document } = readContainedJson(root, binding.path));
  } catch {
    return { blockers: ['staging_isolation_receipt_unreadable'], document };
  }
  if (document?.schema !== ENTERPRISE_SSO_ISOLATION_SCHEMA || !verifyDocumentSha256(document, 'isolationSha256')) blockers.push('staging_isolation_receipt_invalid');
  if (document?.environment !== 'staging' || document?.target !== manifest?.target || !sameRelease(document?.release, manifest?.release)
    || document?.deploymentId !== manifest?.release?.deploymentId || !validTimeWindow(document?.capturedAt, now)) blockers.push('staging_isolation_identity_or_time_invalid');
  const controls = document?.controls;
  if (controls?.databaseIsolated !== true || controls?.redisIsolated !== true || controls?.sessionStoreIsolated !== true
    || controls?.productionMutationDisabled !== true) blockers.push('staging_isolation_controls_incomplete');
  return { blockers: [...new Set(blockers)], document };
}

function evaluateEvidence(root, inputPath, expectedRelease, {
  trustedCollectorsPath,
  generatedAt,
  now,
} = {}) {
  const blockers = [];
  const passed = new Set();
  const evidenceBindings = [];
  const rawCases = new Map();
  let manifest = null;
  let manifestBinding = null;
  try {
    ({ binding: manifestBinding, document: manifest } = readContainedJson(root, inputPath));
  } catch (error) {
    const blocker = error instanceof Error && error.message.startsWith('unsafe_evidence_path:')
      ? 'unsafe_evidence_path_rejected'
      : 'staging_evidence_unreadable';
    return { blockers: [blocker], passed, protocols: blankProtocols(), evidenceBindings, manifest, manifestBinding };
  }
  evidenceBindings.push(manifestBinding);
  if (manifest?.schema !== ENTERPRISE_SSO_EVIDENCE_SCHEMA || !verifyDocumentSha256(manifest, 'evidenceSha256')) blockers.push('staging_evidence_contract_or_hash_invalid');
  if (manifest?.environment !== 'staging' || !exactHttpsOrigin(manifest?.target) || !isolatedStagingTarget(manifest?.target)) blockers.push('staging_target_invalid');
  if (!completeRelease(manifest?.release) || !sameRelease(manifest.release, expectedRelease)) blockers.push('staging_release_identity_mismatch');
  const startedAt = Date.parse(manifest?.run?.startedAt);
  const completedAt = Date.parse(manifest?.run?.completedAt);
  const receiptTime = Date.parse(generatedAt);
  if (typeof manifest?.run?.id !== 'string' || manifest.run.id.length < 8 || manifest.run.runner !== 'nexyfab-staging-sso-e2e'
    || !validDate(manifest.run.startedAt) || !validDate(manifest.run.completedAt)
    || startedAt > completedAt || completedAt - startedAt > ENTERPRISE_SSO_MAX_RUN_MS) blockers.push('staging_run_identity_invalid');
  if (manifest?.capturedAt !== manifest?.run?.completedAt || !validTimeWindow(manifest?.capturedAt, now)
    || !validTimeWindow(generatedAt, now) || receiptTime < completedAt || receiptTime - completedAt > ENTERPRISE_SSO_MAX_RECEIPT_DELAY_MS) blockers.push('staging_evidence_freshness_invalid');
  if (manifest?.caseEvidenceRootSha256 !== enterpriseSsoCaseEvidenceRoot(manifest?.cases)) blockers.push('case_evidence_root_invalid');
  const collectorVerification = trustedCollectorsPath
    ? verifyCollectorAttestation(root, trustedCollectorsPath, manifest, now)
    : { blockers: ['trusted_collector_allowlist_missing'], binding: null };
  blockers.push(...collectorVerification.blockers);
  if (collectorVerification.binding) evidenceBindings.push(collectorVerification.binding);
  const isolationVerification = verifyIsolationReceipt(root, manifest?.isolationReceipt, manifest, now);
  blockers.push(...isolationVerification.blockers);
  if (bindingMatches(root, manifest?.isolationReceipt)) evidenceBindings.push(manifest.isolationReceipt);
  const entries = Array.isArray(manifest?.cases) ? manifest.cases : [];
  const ids = entries.map(entry => entry?.id);
  if (ids.length !== new Set(ids).size) blockers.push('duplicate_case_id');
  if (entries.length !== ENTERPRISE_SSO_CASE_SPECS.length || ENTERPRISE_SSO_CASE_SPECS.some(spec => !ids.includes(spec.id))) blockers.push('required_raw_cases_missing');
  const artifactPaths = new Set();
  for (const entry of entries) {
    const spec = CASE_BY_ID.get(entry?.id);
    if (!spec || !bindingMatches(root, entry?.artifact) || artifactPaths.has(entry?.artifact?.path)) {
      blockers.push(`case_artifact_binding_invalid:${entry?.id ?? 'unknown'}`);
      continue;
    }
    artifactPaths.add(entry.artifact.path);
    evidenceBindings.push(entry.artifact);
    try {
      const { document: raw } = readContainedJson(root, entry.artifact.path);
      const errors = evaluateRawCase(raw, spec, manifest);
      if (!validTimeWindow(raw?.capturedAt, now)) errors.push('case_freshness_invalid');
      rawCases.set(spec.id, raw);
      if (errors.length === 0) passed.add(spec.id);
      else blockers.push(...errors.map(error => `${error}:${spec.id}`));
    } catch {
      blockers.push(`case_artifact_unreadable:${spec.id}`);
    }
  }
  for (const spec of ENTERPRISE_SSO_CASE_SPECS.filter(item => item.predecessorCaseId)) {
    const raw = rawCases.get(spec.id);
    const predecessor = rawCases.get(spec.predecessorCaseId);
    if (raw?.transaction?.predecessorCaseId !== spec.predecessorCaseId
      || raw?.transaction?.predecessorTransactionId !== predecessor?.transaction?.id) {
      passed.delete(spec.id);
      blockers.push(`replay_predecessor_link_invalid:${spec.id}`);
    }
  }
  return { blockers: [...new Set(blockers)], passed, protocols: protocolsFromPassedCases(passed), evidenceBindings, manifest, manifestBinding, collectorBinding: collectorVerification.binding };
}

function releaseFromBaseline(baseline) {
  return {
    buildId: baseline?.release?.buildId ?? null,
    deploymentId: baseline?.release?.deploymentId ?? null,
    gitHead: baseline?.release?.head ?? null,
  };
}

function codeBindings(root) {
  return CODE_SOURCE_PATHS.map(candidate => fileBinding(root, candidate));
}

export function buildEnterpriseSsoReadinessReceipt({
  root = scriptRoot,
  inputPath = null,
  trustedCollectorsPath = DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH,
  releaseBaselinePath = DEFAULT_RELEASE_BASELINE_PATH,
  generatedAt = new Date().toISOString(),
  now = Date.now(),
} = {}) {
  const { document: baseline } = readContainedJson(root, releaseBaselinePath);
  const expectedRelease = releaseFromBaseline(baseline);
  const evaluated = inputPath ? evaluateEvidence(root, inputPath, expectedRelease, { trustedCollectorsPath, generatedAt, now }) : null;
  const protocols = evaluated?.protocols ?? blankProtocols();
  const blockers = [...(evaluated?.blockers ?? ['staging_evidence_not_supplied'])];
  if (!completeRelease(expectedRelease)) blockers.push('release_identity_incomplete');
  if (protocols.saml.status !== 'PASS') blockers.push('saml_staging_cases_not_verified');
  if (protocols.oidc.status !== 'PASS') blockers.push('oidc_staging_cases_not_verified');
  const releaseEligible = blockers.length === 0;
  // Bind the release tuple, not the mutable baseline file bytes. The release
  // baseline includes this receipt as evidence, so byte-binding both files
  // would create an impossible circular hash dependency.
  const sourceBindings = [...codeBindings(root), ...(evaluated?.evidenceBindings ?? [])];
  const receipt = {
    schema: ENTERPRISE_SSO_RECEIPT_SCHEMA,
    generatedAt,
    ok: releaseEligible,
    status: releaseEligible ? 'PASS' : 'HOLD',
    releaseEligible,
    environment: 'staging',
    target: evaluated?.manifest?.target ?? null,
    release: expectedRelease,
    evidenceContract: {
      schema: ENTERPRISE_SSO_EVIDENCE_SCHEMA,
      derivation: 'attested-raw-case-artifacts-v2',
      sourceManifest: evaluated?.manifestBinding ?? null,
      trustedCollectors: evaluated?.collectorBinding ?? null,
      isolationReceipt: evaluated?.manifest?.isolationReceipt ?? null,
      caseEvidenceRootSha256: evaluated?.manifest?.caseEvidenceRootSha256 ?? null,
      runId: evaluated?.manifest?.run?.id ?? null,
      requiredCaseIds: ENTERPRISE_SSO_CASE_SPECS.map(spec => spec.id),
      verifiedCaseIds: ENTERPRISE_SSO_CASE_SPECS.filter(spec => evaluated?.passed.has(spec.id)).map(spec => spec.id),
    },
    protocols,
    blockers: [...new Set(blockers)],
    sourceBindings,
  };
  return attachReceiptSha256(receipt);
}

export function verifyEnterpriseSsoReadinessReceipt(receipt, {
  root = scriptRoot,
  expectedRelease = null,
  now = Date.now(),
} = {}) {
  const errors = [];
  if (receipt?.schema !== ENTERPRISE_SSO_RECEIPT_SCHEMA || !verifyReceiptSha256(receipt)) errors.push('receipt_contract_or_hash_invalid');
  if (receipt?.environment !== 'staging' || receipt?.evidenceContract?.schema !== ENTERPRISE_SSO_EVIDENCE_SCHEMA
    || receipt?.evidenceContract?.derivation !== 'attested-raw-case-artifacts-v2') errors.push('evidence_derivation_contract_invalid');
  if (!validTimeWindow(receipt?.generatedAt, now)) errors.push('receipt_freshness_invalid');
  if (!Array.isArray(receipt?.sourceBindings) || receipt.sourceBindings.length === 0
    || receipt.sourceBindings.some(binding => !bindingMatches(root, binding))) errors.push('source_binding_invalid');
  const declaredBindingPaths = receipt?.sourceBindings?.map(binding => binding?.path) ?? [];
  if (CODE_SOURCE_PATHS.some(sourcePath => !declaredBindingPaths.includes(sourcePath))
    || new Set(declaredBindingPaths).size !== declaredBindingPaths.length) errors.push('source_binding_set_invalid');
  const requiredIds = ENTERPRISE_SSO_CASE_SPECS.map(spec => spec.id);
  if (canonicalJson(receipt?.evidenceContract?.requiredCaseIds) !== canonicalJson(requiredIds)) errors.push('required_case_set_invalid');
  const manifestBinding = receipt?.evidenceContract?.sourceManifest;
  let evaluated = null;
  if (manifestBinding) {
    if (!bindingMatches(root, manifestBinding)) errors.push('manifest_binding_invalid');
    else evaluated = evaluateEvidence(root, manifestBinding.path, expectedRelease ?? receipt?.release, {
      trustedCollectorsPath: receipt?.evidenceContract?.trustedCollectors?.path,
      generatedAt: receipt?.generatedAt,
      now,
    });
  }
  const requiredBindings = [...(evaluated?.evidenceBindings ?? [])];
  if (requiredBindings.some(binding => !receipt.sourceBindings?.some(declared => canonicalJson(declared) === canonicalJson(binding)))) errors.push('source_binding_set_incomplete');
  const derivedProtocols = evaluated?.protocols ?? blankProtocols();
  if (canonicalJson(receipt?.protocols) !== canonicalJson(derivedProtocols)) errors.push('protocol_summary_not_derived');
  const verifiedCaseIds = ENTERPRISE_SSO_CASE_SPECS.filter(spec => evaluated?.passed.has(spec.id)).map(spec => spec.id);
  if (canonicalJson(receipt?.evidenceContract?.verifiedCaseIds) !== canonicalJson(verifiedCaseIds)) errors.push('verified_case_set_not_derived');
  if (receipt?.evidenceContract?.runId !== (evaluated?.manifest?.run?.id ?? null)) errors.push('run_identity_not_derived');
  if (receipt?.target !== (evaluated?.manifest?.target ?? null)) errors.push('target_not_derived');
  if (canonicalJson(receipt?.evidenceContract?.trustedCollectors) !== canonicalJson(evaluated?.collectorBinding ?? null)) errors.push('collector_binding_not_derived');
  if (canonicalJson(receipt?.evidenceContract?.isolationReceipt) !== canonicalJson(evaluated?.manifest?.isolationReceipt ?? null)) errors.push('isolation_binding_not_derived');
  if (receipt?.evidenceContract?.caseEvidenceRootSha256 !== (evaluated?.manifest?.caseEvidenceRootSha256 ?? null)) errors.push('case_root_not_derived');
  if (expectedRelease && !sameRelease(receipt?.release, expectedRelease)) errors.push('release_identity_mismatch');
  const evidenceBlockers = [...(evaluated?.blockers ?? ['staging_evidence_not_supplied'])];
  if (!completeRelease(receipt?.release)) evidenceBlockers.push('release_identity_incomplete');
  if (derivedProtocols.saml.status !== 'PASS') evidenceBlockers.push('saml_staging_cases_not_verified');
  if (derivedProtocols.oidc.status !== 'PASS') evidenceBlockers.push('oidc_staging_cases_not_verified');
  const expectedBlockers = [...new Set(evidenceBlockers)];
  if (canonicalJson(receipt?.blockers) !== canonicalJson(expectedBlockers)) errors.push('blockers_not_derived');
  const releaseEligible = errors.length === 0 && expectedBlockers.length === 0;
  if (receipt?.ok !== releaseEligible || receipt?.releaseEligible !== releaseEligible || receipt?.status !== (releaseEligible ? 'PASS' : 'HOLD')) errors.push('release_claim_not_derived');
  return { ok: errors.length === 0, releaseEligible, errors: [...new Set(errors)] };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

export function writeEnterpriseSsoReceiptFile(root, relativePath, value) {
  const resolvedRoot = path.resolve(root);
  const { absolute, relative } = normalizeRelative(resolvedRoot, relativePath);
  let cursor = resolvedRoot;
  for (const segment of relative.split('/').slice(0, -1)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe_output_parent:${relativePath}`);
    } else fs.mkdirSync(cursor);
  }
  const realRoot = fs.realpathSync.native(resolvedRoot);
  const realParent = fs.realpathSync.native(path.dirname(absolute));
  const contained = path.relative(realRoot, realParent);
  if (contained.startsWith('..') || path.isAbsolute(contained)) throw new Error(`unsafe_output_parent:${relativePath}`);
  if (fs.existsSync(absolute)) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`unsafe_output_target:${relativePath}`);
  }
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = scriptRoot;
  const outputPath = argumentValue('--output') ?? process.env.ENTERPRISE_SSO_READINESS_RECEIPT ?? DEFAULT_ENTERPRISE_SSO_RECEIPT_PATH;
  const inputPath = argumentValue('--input') ?? process.env.ENTERPRISE_SSO_STAGING_EVIDENCE ?? null;
  const trustedCollectorsPath = argumentValue('--trusted-collectors') ?? process.env.ENTERPRISE_SSO_TRUSTED_COLLECTORS ?? DEFAULT_ENTERPRISE_SSO_TRUSTED_COLLECTORS_PATH;
  const releaseBaselinePath = argumentValue('--release-baseline') ?? process.env.RELEASE_BASELINE ?? DEFAULT_RELEASE_BASELINE_PATH;
  const receipt = buildEnterpriseSsoReadinessReceipt({ root, inputPath, trustedCollectorsPath, releaseBaselinePath });
  let releaseReady = receipt.releaseEligible;
  if (process.argv.includes('--write')) writeEnterpriseSsoReceiptFile(root, outputPath, receipt);
  else if (process.argv.includes('--check')) {
    const existing = readContainedJson(root, outputPath).document;
    const expectedRelease = releaseFromBaseline(readContainedJson(root, releaseBaselinePath).document);
    const verification = verifyEnterpriseSsoReadinessReceipt(existing, { root, expectedRelease });
    releaseReady = verification.releaseEligible;
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    if (!verification.ok || (process.argv.includes('--require-release-ready') && !verification.releaseEligible)) process.exitCode = 1;
  } else process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes('--require-release-ready') && !releaseReady) process.exitCode = 1;
}
