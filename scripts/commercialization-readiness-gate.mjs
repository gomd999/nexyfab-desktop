#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readReleaseWorkingTreeChanges } from './build-release-baseline.mjs';
import { parseTrustedIndependentReviewers, validateIndependentDomainReviewKit } from './validate-independent-domain-review-kit.mjs';
import { verifySevenDayOperationsReceiptBindings, verifySevenDayOperationsReceiptSignature } from './build-seven-day-operations-receipt.mjs';
import { SHA256 as IMMUTABLE_SHA256, sha256 as immutableSha256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
} from './canonical-text-binding.mjs';
import { verifyRailwayResourceBaselineDerivation } from './build-railway-resource-baseline-v2.mjs';
import {
  COMMERCIAL_SYNTHETIC_CAMPAIGN_RECEIPT_SCHEMA,
  COMMERCIAL_SYNTHETIC_REQUIRED_AXES,
  verifyCommercialSyntheticCampaignReceiptDerivation,
} from './build-commercial-synthetic-campaign-receipt.mjs';
import { verifyOpenScadHttpSmokeReceipt } from './build-openscad-http-smoke-v2.mjs';
import { verifyRailwayStagingIsolationEvidenceV2 } from './build-railway-staging-isolation-evidence-v2.mjs';
import { verifyCommercialSecurityEvidenceReceipt } from './build-commercial-security-evidence-receipt-v2.mjs';
import { verifyCommercialPrecisionStagingHoldEvidence } from './build-commercial-precision-staging-hold-evidence.mjs';
import { verifyClosedBetaIntegrityReceipt } from './closed-beta-integrity-compare.mjs';
import { verifyProtectedStateReceipt } from './compare-production-protected-state.mjs';
import { verifyCommercialLiveSmokeReceipt } from './build-commercial-live-smoke-receipt-v2.mjs';
import { verifyAuthenticatedCommercialE2EReceipt } from '../e2e/authenticated-commercial-e2e-receipt.mjs';
import { verifyArchitectureInteriorRecoveryEvidence } from '../e2e/architecture-interior-recovery-evidence.mjs';
import { verifySpecialtyIndependentReleaseReceipt } from './verify-specialty-independent-release-receipt.mjs';
import { verifyEnterpriseSsoReadinessReceipt } from './build-enterprise-sso-readiness-receipt.mjs';
import { verifyWindowsSeaReleaseReceipt } from './agent-sidecar/windows-sea-release-evidence.mjs';
import { largeUploadStagingReceiptStatus } from './build-large-upload-staging-readiness-receipt.mjs';
import {
  COMMERCIAL_PRECISION_DEFAULT_OBSERVATION,
  COMMERCIAL_PRECISION_DEFAULT_RECEIPT,
  verifyCommercialPrecisionRuntimeEvidence,
} from './build-commercial-precision-runtime-evidence.mjs';

const MECHANICAL_COMPLEX_FAMILIES = ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'machine_skid', 'welded_enclosure'];
const verifiedFamily = family => Object.freeze({ domains: ['mechanical'], complexFamilies: [family], promotionFamily: family, mechanicalScope: true, complexScope: true });
const verifiedSpatialDomain = domain => Object.freeze({ domains: [domain], complexFamilies: [], mechanicalScope: false, complexScope: false });
const verifiedSpecialtyTrack = specialtyTrack => Object.freeze({ domains: [], complexFamilies: [], mechanicalScope: false, complexScope: false, specialtyTrack });
const RELEASE_CONTRACTS = Object.freeze({
  'mechanical-core': Object.freeze({ domains: ['mechanical'], complexFamilies: [], mechanicalScope: true, complexScope: false }),
  'complex-mechanical': Object.freeze({ domains: ['mechanical'], complexFamilies: MECHANICAL_COMPLEX_FAMILIES, mechanicalScope: true, complexScope: true }),
  'verified-robot': verifiedFamily('robot'),
  'verified-gearbox': verifiedFamily('gearbox'),
  'verified-pressure-vessel': verifiedFamily('pressure_vessel'),
  'verified-turbomachinery': verifiedFamily('turbomachinery'),
  'verified-factory-equipment': verifiedFamily('factory_equipment'),
  'verified-machine-skid': verifiedFamily('machine_skid'),
  'verified-welded-enclosure': verifiedFamily('welded_enclosure'),
  'verified-building': verifiedSpatialDomain('building'),
  'verified-interior': verifiedSpatialDomain('interior'),
  'verified-civil': verifiedSpatialDomain('civil'),
  'verified-landscape': verifiedSpatialDomain('landscape'),
  'verified-sheet-metal': verifiedSpecialtyTrack('sheet-metal'),
  'verified-welded-fabrication': verifiedSpecialtyTrack('welded-fabrication'),
  'verified-mold-tooling': verifiedSpecialtyTrack('mold-tooling'),
  'verified-piping': verifiedSpecialtyTrack('piping'),
  'verified-hvac': verifiedSpecialtyTrack('hvac'),
  'verified-ecad-mcad': verifiedSpecialtyTrack('ecad-mcad'),
  'spatial-labs': Object.freeze({ domains: ['building', 'civil', 'landscape', 'interior'], complexFamilies: [], mechanicalScope: false, complexScope: false }),
  platform: Object.freeze({ domains: ['mechanical', 'building', 'civil', 'landscape', 'interior'], complexFamilies: [...MECHANICAL_COMPLEX_FAMILIES, 'interior'], mechanicalScope: true, complexScope: true }),
});
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const OPERATIONS_SERVICES = ['web', 'openscad-worker', 'fea-worker'];
const OPERATIONS_COST_SERVICES = ['nexyfab.com', 'nexyfab-openscad-worker', 'nexyfab-fea-worker', 'Postgres-KN2x', 'Redis-IrVt'];
const COMMERCIAL_MIGRATION_VERSIONS = [
  2026082202, 2026082203, 2026082204, 2026082205, 2026082206, 2026082207, 2026082208,
  2026082301, 2026082401, 2026082402, 2026082403, 2026082501, 2026082502,
];
const LATEST_COMMERCIAL_MIGRATION = COMMERCIAL_MIGRATION_VERSIONS.at(-1);
const PRODUCTION_TARGET = 'https://nexyfab.com';
const LIVE_SMOKE_REQUIRED_CHECKS = ['live', 'ready', 'capabilities', 'scad-agent-route', 'openscad'];
const AUTHENTICATED_E2E_REQUIRED_CHECKS = ['login', 'session', 'project_create', 'project_read', 'cad_verify', 'storage_state_reconnect', 'expert_workspace_visible', 'project_cleanup', 'logout'];
const SYNTHETIC_DOMAINS = ['mechanical', 'building', 'civil', 'landscape', 'interior'];
const LOCAL_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60_000;
const PRODUCT_RELEASE_SURFACES = Object.freeze(['web', 'enterprise', 'desktop', 'large-upload']);
const FULL_PRODUCT_SCOPE_ALIASES = new Set(['all', 'full', 'full-product', 'full-ga', 'whole-product']);
const FULL_PRODUCT_SPECIALTY_CHANNELS = Object.freeze({
  'sheet-metal': 'verified-sheet-metal',
  'welded-fabrication': 'verified-welded-fabrication',
  'mold-tooling': 'verified-mold-tooling',
  piping: 'verified-piping',
  hvac: 'verified-hvac',
  'ecad-mcad': 'verified-ecad-mcad',
});
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === actual.length
    && [...actual].sort().join('\0') === [...expected].sort().join('\0');
}

export function mechanicalScopeContractStatus(scope) {
  const evidence = scope?.evidence ?? {};
  const decision = scope?.decision ?? {};
  const evidenceKeys = [
    'internalRegressionVerified',
    'intentQualification150Verified',
    'intentRuntimeRepresentativeVerified',
    'assemblyDrawingHandoffLocalVerified',
    'coreThirtyFeatureClosedLoopVerified',
    'directDesignCandidateVerified',
    'directDesignThirtyVerified',
    'intentCampaign150Verified',
    'standardStepConformanceVerified',
    'artifactRevisionConsistencyVerified',
    'blindProductChallengeVerified',
    'manufacturingReceiptVerified',
  ];
  const evidenceShapeValid = evidenceKeys.every(key => typeof evidence[key] === 'boolean');
  const derivedPrivateBeta = evidence.internalRegressionVerified === true
    && evidence.coreThirtyFeatureClosedLoopVerified === true
    && evidence.directDesignCandidateVerified === true
    && evidence.artifactRevisionConsistencyVerified === true;
  const derivedSelfService = derivedPrivateBeta
    && evidence.directDesignThirtyVerified === true
    && evidence.intentCampaign150Verified === true
    && evidence.standardStepConformanceVerified === true
    && evidence.blindProductChallengeVerified === true;
  const derivedManufacturing = derivedSelfService && evidence.manufacturingReceiptVerified === true;
  const derivedStatus = derivedManufacturing
    ? 'manufacturing_release_verified'
    : derivedSelfService
      ? 'self_service_verified'
      : derivedPrivateBeta
        ? 'ga_evidence_pending'
        : 'private_beta_evidence_pending';
  const sourcesValid = Array.isArray(scope?.sources)
    && scope.sources.length > 0
    && scope.sources.every(item => typeof item?.path === 'string'
      && item.path.length > 0
      && SHA256.test(String(item?.sha256 ?? ''))
      && Number.isSafeInteger(item?.bytes)
      && item.bytes > 0
      && (item?.canonicalization === 'utf8-crlf-to-lf' || item?.canonicalization === 'raw'));
  const boundary = scope?.claimBoundary ?? {};
  const valid = scope?.schema === 'nexyfab.mechanical-product-scope-assessment.v4'
    && scope?.releaseChannel === 'mechanical-core'
    && (scope?.assessedAt === null || typeof scope?.assessedAt === 'string')
    && sourcesValid
    && evidenceShapeValid
    && typeof decision.privateBetaEligible === 'boolean'
    && typeof decision.selfServiceEligible === 'boolean'
    && typeof decision.manufacturingReleaseVerified === 'boolean'
    && decision.failClosed === true
    && decision.privateBetaEligible === derivedPrivateBeta
    && decision.selfServiceEligible === derivedSelfService
    && decision.manufacturingReleaseVerified === derivedManufacturing
    && decision.status === derivedStatus
    && Array.isArray(scope?.blockers)
    && scope.blockers.every(item => typeof item === 'string' && item.length > 0)
    && boundary.internalRegressionCertifiesCommercialAccuracy === false
    && boundary.syntheticEvidenceCertifiesCommercialAccuracy === false
    && boundary.stepExportAloneCertifiesManufacturability === false
    && boundary.kernelSelfRoundtripCertifiesCommercialCadCompatibility === false
    && boundary.featureRegistrationAloneCertifiesClosedLoop === false
    && boundary.spatialLabsEvidenceMaySatisfyMechanicalCore === false
    && boundary.vendorSpecificCadValidationRequiredForBaseRelease === false
    && boundary.internalRoleSeparatedReviewMayBeMarketedAsExternal === false;
  return { valid, evidence, decision, derivedPrivateBeta, derivedSelfService, derivedManufacturing, derivedStatus };
}

export function independentHoldoutDomainEligible(holdout) {
  return holdout?.releaseEligible === true
    && Number.isInteger(holdout?.requiredCases)
    && holdout.requiredCases >= 20
    && holdout?.approvedCases === holdout.requiredCases
    && Number.isInteger(holdout?.requiredIndependentReviewers)
    && holdout.requiredIndependentReviewers >= 2
    && Number.isInteger(holdout?.independentReviewers)
    && holdout.independentReviewers >= holdout.requiredIndependentReviewers
    && typeof holdout?.sourceReviewKit?.path === 'string'
    && holdout.sourceReviewKit.path.length > 0
    && SHA256.test(String(holdout?.sourceReviewKit?.sha256 ?? ''))
    && holdout?.sourceReviewKitVerified === true;
}

export function sevenDayOperationsReceiptEligible(receipt, expectedRelease = null, now = Date.now(), evidenceBindingsVerified = false) {
  const policy = receipt?.policy;
  const services = receipt?.services;
  const cost = receipt?.cost;
  const release = receipt?.release;
  const generatedAt = Date.parse(receipt?.generatedAt);
  const qualifyingFrom = Date.parse(release?.qualifyingFrom);
  const serviceNames = services && typeof services === 'object' && !Array.isArray(services) ? Object.keys(services) : [];
  const deploymentNames = release?.deployments && typeof release.deployments === 'object' && !Array.isArray(release.deployments)
    ? Object.keys(release.deployments)
    : [];
  return receipt?.schema === 'nexyfab.seven-day-operations-receipt.v3'
    && receipt?.ok === true
    && evidenceBindingsVerified === true
    && Array.isArray(receipt?.blockers) && receipt.blockers.length === 0
    && Number.isFinite(policy?.requiredCoverageHours) && policy.requiredCoverageHours >= 168
    && Number.isInteger(policy?.requiredSampleCount) && policy.requiredSampleCount >= 28
    && Number.isFinite(policy?.expectedWindowHours) && policy.expectedWindowHours === 6
    && Number.isFinite(policy?.http5xxMaxPercent) && policy.http5xxMaxPercent >= 0 && policy.http5xxMaxPercent <= 1
    && policy?.requireRuntimeMemoryLimitEvidence === true
    && Number.isFinite(policy?.monthlyCostBudgetUsd) && policy.monthlyCostBudgetUsd > 0
    && policy?.memoryLimitsMb && OPERATIONS_SERVICES.every(name => Number.isFinite(policy.memoryLimitsMb[name]) && policy.memoryLimitsMb[name] > 0)
    && sameStringSet(serviceNames, OPERATIONS_SERVICES)
    && Object.entries(services).every(([name, service]) => Number.isFinite(service?.coverageHours)
      && service.coverageHours >= policy.requiredCoverageHours
      && Number.isFinite(service?.spanHours) && service.spanHours >= policy.requiredCoverageHours
      && Number.isInteger(service?.samples) && service.samples >= policy.requiredSampleCount
      && Number.isInteger(service?.uniqueWindows) && service.uniqueWindows >= policy.requiredSampleCount
      && service?.invalidWindows === 0 && service?.overlaps === 0 && service?.gaps === 0 && service?.durationMismatches === 0
      && Number.isFinite(service?.maxMemoryMb) && service.maxMemoryMb >= 0 && service.maxMemoryMb <= policy.memoryLimitsMb[name]
      && Number.isFinite(service?.minimumRuntimeMemoryLimitMb) && service.minimumRuntimeMemoryLimitMb >= policy.memoryLimitsMb[name]
      && (name !== 'web' || (Number.isFinite(service?.totalRequests) && service.totalRequests > 0
        && Number.isFinite(service?.total5xx) && service.total5xx >= 0 && service.total5xx <= service.totalRequests
        && Number.isFinite(service?.errorRatePercent) && service.errorRatePercent >= 0
        && service.errorRatePercent <= policy.http5xxMaxPercent)))
    && cost?.ok === true
    && Array.isArray(cost?.blockers) && cost.blockers.length === 0
    && Number.isInteger(cost?.samples) && cost.samples >= 2
    && Number.isFinite(cost?.coverageHours) && cost.coverageHours >= policy.requiredCoverageHours
    && Number.isFinite(cost?.projectedMonthlyDollars) && cost.projectedMonthlyDollars >= 0
    && Number.isFinite(cost?.monthlyBudgetDollars) && cost.monthlyBudgetDollars === policy.monthlyCostBudgetUsd
    && cost.projectedMonthlyDollars <= cost.monthlyBudgetDollars
    && sameStringSet(cost?.scopedServices, OPERATIONS_COST_SERVICES)
    && typeof release?.buildId === 'string' && release.buildId.length > 0
    && release?.environment === 'production'
    && sameStringSet(deploymentNames, OPERATIONS_SERVICES)
    && OPERATIONS_SERVICES.every(name => typeof release.deployments[name] === 'string' && release.deployments[name].length > 0)
    && Number.isFinite(generatedAt) && Number.isFinite(qualifyingFrom)
    && generatedAt >= qualifyingFrom + 168 * 3_600_000
    && generatedAt <= now + 5 * 60_000
    && (!expectedRelease || (release.buildId === expectedRelease.buildId
      && release.deployments.web === expectedRelease.deploymentId));
}

export function expertReviewSignoffPayload(receipt, signoff) {
  return canonical({
    schema: 'nexyfab.independent-domain-expert-review-signoff.v2',
    releaseChannel: receipt?.releaseChannel,
    release: receipt?.release,
    holdoutCorpusSha256: receipt?.holdoutCorpusSha256,
    reviewerId: signoff?.reviewerId,
    role: signoff?.role,
    decision: signoff?.decision,
    signedAt: signoff?.signedAt,
  });
}

export function expertReviewReceiptEligible(receipt, releaseChannel, {
  expectedRelease = null,
  expectedHoldoutCorpusSha256 = null,
  trustedReviewers = parseTrustedIndependentReviewers(),
  now = Date.now(),
} = {}) {
  const reviewers = Array.isArray(receipt?.reviewers) ? receipt.reviewers : [];
  const summary = receipt?.summary ?? {};
  const generatedAt = Date.parse(receipt?.generatedAt);
  const release = receipt?.release;
  const releaseMatches = expectedRelease
    && release?.buildId === expectedRelease.buildId
    && release?.gitHead === expectedRelease.head;
  const corpusMatches = typeof expectedHoldoutCorpusSha256 === 'string'
    && receipt?.holdoutCorpusSha256 === expectedHoldoutCorpusSha256;
  const reviewerIds = new Set(reviewers.map(item => item?.reviewerId));
  const validSignoffs = reviewers.filter(item => {
    const reviewerId = typeof item?.reviewerId === 'string' ? item.reviewerId.trim() : '';
    const registration = trustedReviewers?.[reviewerId];
    const signedAt = Date.parse(item?.signedAt);
    const unsigned = {
      reviewerId,
      role: item?.role,
      decision: item?.decision,
      signedAt: item?.signedAt,
    };
    if (!reviewerId || !registration || !registration.roles?.includes(item?.role)
      || item?.independentFromBuild !== true
      || item?.decision !== 'approved'
      || !Number.isFinite(signedAt)
      || signedAt > generatedAt
      || signedAt > now
      || now - signedAt > 90 * 86_400_000
      || typeof item?.signature !== 'string' || !item.signature.trim()) return false;
    try {
      return crypto.verify(
        null,
        Buffer.from(expertReviewSignoffPayload(receipt, unsigned)),
        registration.publicKey,
        Buffer.from(item.signature, 'base64'),
      );
    } catch {
      return false;
    }
  });
  const validRoles = new Set(validSignoffs.map(item => item?.role));
  const fingerprints = validSignoffs.map(item => {
    try {
      return crypto.createHash('sha256').update(crypto.createPublicKey(trustedReviewers[item.reviewerId].publicKey).export({ type: 'spki', format: 'der' })).digest('hex');
    } catch {
      return null;
    }
  });
  return receipt?.schema === 'nexyfab.independent-domain-expert-review.v1'
    && receipt?.ok === true
    && receipt?.releaseChannel === releaseChannel
    && releaseMatches
    && GIT_COMMIT_SHA.test(String(release?.gitHead ?? ''))
    && GIT_COMMIT_SHA.test(String(expectedRelease?.head ?? ''))
    && Number.isFinite(generatedAt)
    && generatedAt <= now + 5 * 60_000
    && generatedAt >= now - 90 * 86_400_000
    && SHA256.test(String(receipt?.holdoutCorpusSha256 ?? ''))
    && corpusMatches
    && reviewers.length >= 2
    && reviewerIds.size === reviewers.length
    && validSignoffs.length === reviewers.length
    && validRoles.has('domain-reviewer')
    && validRoles.has('independent-reviewer')
    && new Set(fingerprints).size === fingerprints.length
    && Number.isInteger(summary?.cases) && summary.cases >= 20
    && summary?.dualApproved === summary.cases
    && summary?.pending === 0 && summary?.rejected === 0 && summary?.changesRequested === 0;
}

function receiptSha256(value) {
  const { sha256, ...unsigned } = value ?? {};
  return SHA256.test(String(sha256 ?? ''))
    && crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex') === sha256;
}

function releaseBindingMatches(receipt, expectedRelease) {
  return receipt?.release?.buildId === expectedRelease?.buildId
    && receipt?.release?.deploymentId === expectedRelease?.deploymentId
    && receipt?.release?.gitHead === expectedRelease?.head
    && typeof receipt?.release?.buildId === 'string' && receipt.release.buildId.length > 0
    && typeof receipt?.release?.deploymentId === 'string' && receipt.release.deploymentId.length > 0
    && GIT_COMMIT_SHA.test(String(receipt?.release?.gitHead ?? ''));
}

function authenticatedStagingReleaseBindingMatches(receipt, expectedRelease) {
  const release = receipt?.release;
  return release?.buildId === expectedRelease?.buildId
    && release?.productionDeploymentId === expectedRelease?.deploymentId
    && release?.gitHead === expectedRelease?.head
    && typeof release?.evidenceDeploymentId === 'string' && release.evidenceDeploymentId.length > 0
    && release.evidenceDeploymentId !== release.productionDeploymentId
    && GIT_COMMIT_SHA.test(String(release?.gitHead ?? ''));
}

function isolatedStagingTarget(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && url.origin !== PRODUCTION_TARGET
      && ['staging', 'stage', 'preview', 'test'].some(marker => hostname.includes(marker));
  } catch {
    return false;
  }
}

function readyCommercialBoundarySnapshotEligible(ready) {
  return ready?.status === 'ok'
    && ready?.db?.status === 'ok' && ready.db.required === true && ready.db.backend === 'postgres'
    && ready?.redis?.status === 'ok' && ready.redis.required === true
    && ready?.commercialBoundary?.status === 'ok' && ready.commercialBoundary.required === true;
}

function receiptFresh(generatedAt, now, maxAgeMs = 24 * 60 * 60_000) {
  const timestamp = Date.parse(generatedAt);
  return Number.isFinite(timestamp) && timestamp <= now + 5 * 60_000 && timestamp >= now - maxAgeMs;
}

function releaseBoundReceiptMetadata(receipt, expectedRelease, now, schema) {
  return receipt?.schema === schema
    && receipt?.ok === true
    && receiptFresh(receipt.generatedAt, now)
    && typeof receipt?.release?.buildId === 'string' && receipt.release.buildId.length > 0
    && typeof receipt?.release?.deploymentId === 'string' && receipt.release.deploymentId.length > 0
    && GIT_COMMIT_SHA.test(String(receipt?.release?.gitHead ?? ''))
    && (!expectedRelease || (receipt.release.buildId === expectedRelease.buildId
      && receipt.release.deploymentId === expectedRelease.deploymentId
      && receipt.release.gitHead === expectedRelease.head))
    && verifyReceiptSha256(receipt);
}

function sourceBindingShape(binding) {
  return typeof binding?.path === 'string' && binding.path.length > 0
    && Number.isInteger(binding?.bytes) && binding.bytes > 0
    && IMMUTABLE_SHA256.test(String(binding?.sha256 ?? ''));
}

function localFileBindingShape(binding) {
  return sourceBindingShape(binding)
    && !path.isAbsolute(binding.path)
    && binding.path !== '.'
    && !binding.path.split(/[\\/]+/).includes('..');
}

function verifyLocalFileBindings(bindings, root = process.cwd()) {
  if (!Array.isArray(bindings) || bindings.length === 0) return false;
  const resolvedRoot = path.resolve(root);
  const seen = new Set();
  return bindings.every(binding => {
    if (!localFileBindingShape(binding) || seen.has(binding.path)) return false;
    seen.add(binding.path);
    const absolute = path.resolve(resolvedRoot, binding.path);
    if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`)) return false;
    try {
      if (fs.lstatSync(absolute).isSymbolicLink()) return false;
      const realRoot = fs.realpathSync.native(resolvedRoot);
      const realFile = fs.realpathSync.native(absolute);
      const realRelative = path.relative(realRoot, realFile);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative) || seen.has(realFile)) return false;
      seen.add(realFile);
      const stat = fs.statSync(realFile);
      if (!stat.isFile()) return false;
      const bytes = fs.readFileSync(realFile);
      if (binding.canonicalization !== undefined) {
        if (binding.canonicalization !== TEXT_BINDING_CANONICALIZATION) return false;
        const actual = canonicalTextBinding(bytes);
        return actual.bytes === binding.bytes && actual.sha256 === binding.sha256;
      }
      return stat.size === binding.bytes
        && crypto.createHash('sha256').update(bytes).digest('hex') === binding.sha256;
    } catch {
      return false;
    }
  });
}

function releaseBoundLocalEvidence(receipt, expectedRelease, now, schema, root, { requireCapturedAt = false } = {}) {
  return receipt?.schema === schema
    && receiptFresh(receipt.generatedAt, now, LOCAL_EVIDENCE_MAX_AGE_MS)
    && (!requireCapturedAt || (typeof receipt.capturedAt === 'string'
      && receiptFresh(receipt.capturedAt, now, LOCAL_EVIDENCE_MAX_AGE_MS)))
    && releaseBindingMatches(receipt, expectedRelease)
    && verifyLocalFileBindings(receipt.sourceBindings, root)
    && verifyReceiptSha256(receipt);
}

function productReceiptBaseStatus(receipt, expectedRelease, now, schema, root) {
  const blockers = [];
  if (!receipt || typeof receipt !== 'object') blockers.push('receipt_missing');
  if (receipt?.schema !== schema) blockers.push('schema_invalid');
  if (receipt?.ok !== true || receipt?.status !== 'PASS' || receipt?.releaseEligible !== true) blockers.push('pass_claim_missing');
  if (!receiptFresh(receipt?.generatedAt, now, LOCAL_EVIDENCE_MAX_AGE_MS)) blockers.push('receipt_stale_or_time_invalid');
  if (!releaseBindingMatches(receipt, expectedRelease)) blockers.push('release_binding_mismatch');
  if (!verifyReceiptSha256(receipt)) blockers.push('receipt_hash_invalid');
  if (!verifyLocalFileBindings(receipt?.sourceBindings, root)) blockers.push('source_bindings_invalid');
  if (!Array.isArray(receipt?.blockers) || receipt.blockers.length !== 0) blockers.push('receipt_blockers_present');
  return blockers;
}

export function enterpriseSsoReadinessStatus(receipt, expectedRelease, {
  now = Date.now(),
  root = process.cwd(),
} = {}) {
  const blockers = productReceiptBaseStatus(receipt, expectedRelease, now, 'nexyfab.enterprise-sso-readiness.v1', root);
  const evidenceVerification = verifyEnterpriseSsoReadinessReceipt(receipt, { root, expectedRelease });
  if (!evidenceVerification.ok || !evidenceVerification.releaseEligible) blockers.push('raw_case_evidence_contract_invalid');
  const saml = receipt?.protocols?.saml;
  const oidc = receipt?.protocols?.oidc;
  if (!(receipt?.environment === 'staging' && isolatedStagingTarget(receipt?.target))) blockers.push('isolated_staging_target_invalid');
  if (!(saml?.status === 'PASS'
    && saml.signatureValidation === true
    && saml.signedResponseOrAssertion === true
    && saml.uniqueIdReferenceValidation === true
    && saml.wrappingAndDuplicateIdRejected === true
    && saml.issuerAudienceDestinationTimeValidated === true
    && saml.inResponseToValidated === true
    && saml.replayRejected === true
    && saml.localSessionIssued === true)) blockers.push('saml_commercial_flow_not_verified');
  if (!(oidc?.status === 'PASS'
    && oidc.oneUseStateNoncePkce === true
    && oidc.pinnedHttpsDiscovery === true
    && oidc.jwksAlgorithmAllowlist === true
    && oidc.idTokenClaimsValidated === true
    && oidc.userinfoSubjectBound === true
    && oidc.redirectAllowlist === true
    && oidc.replayRejected === true
    && oidc.localSessionIssued === true)) blockers.push('oidc_commercial_flow_not_verified');
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export function windowsSeaReleaseStatus(receipt, expectedRelease, {
  now = Date.now(),
  root = process.cwd(),
  trustedKeyAllowlist,
} = {}) {
  return verifyWindowsSeaReleaseReceipt(receipt, expectedRelease, { now, root, trustedKeyAllowlist });
}

export function largeUploadStagingReadinessStatus(receipt, expectedRelease, {
  now = Date.now(),
  root = process.cwd(),
} = {}) {
  return largeUploadStagingReceiptStatus(receipt, expectedRelease, { now, root });
}

export function resourceBaselineReceiptEligible(receipt, expectedRelease, {
  now = Date.now(),
  root = process.cwd(),
} = {}) {
  const memory = receipt?.memory;
  const assessment = receipt?.assessment;
  const derivedCurrentMaxWithinTarget = Number.isFinite(memory?.maxMb)
    && Number.isFinite(assessment?.runtimeMemoryTargetMb)
    && memory.maxMb <= assessment.runtimeMemoryTargetMb;
  return releaseBoundLocalEvidence(receipt, expectedRelease, now, 'nexyfab.railway-resource-baseline.v2', root, { requireCapturedAt: true })
    && receipt?.service === 'nexyfab.com'
    && receipt?.environment === 'production'
    && Number.isFinite(receipt?.windowHours) && receipt.windowHours > 0
    && derivedCurrentMaxWithinTarget
    && assessment?.currentMaxWithinTarget === derivedCurrentMaxWithinTarget
    && assessment?.sevenDayBaselineRequired === true
    && verifyRailwayResourceBaselineDerivation(receipt, { root });
}

export function syntheticCampaignReceiptEligible(receipt, expectedRelease, {
  requiredDomains = SYNTHETIC_DOMAINS,
  expectedCorpusSha256 = null,
  now = Date.now(),
  root = process.cwd(),
} = {}) {
  const domains = receipt?.domains;
  const domainNames = domains && typeof domains === 'object' && !Array.isArray(domains) ? Object.keys(domains) : [];
  const selectedDomains = [...requiredDomains];
  const domainRowsValid = domainNames.every(domain => SYNTHETIC_DOMAINS.includes(domain))
    && selectedDomains.every(domain => domainNames.includes(domain))
    && selectedDomains.every(domain => {
      const row = domains[domain];
      return Number.isInteger(row?.cases) && row.cases >= 20
        && Number.isInteger(row?.campaigns) && row.campaigns >= 3
        && Number.isInteger(row?.repeats) && row.repeats >= 5
        && Number.isInteger(row?.runs) && row.runs === row.cases * row.campaigns * row.repeats
        && Number.isInteger(row?.gatePasses) && row.gatePasses === row.runs;
    });
  const totalRuns = domainNames.reduce((sum, domain) => sum + domains?.[domain]?.runs, 0);
  const totalGatePasses = domainNames.reduce((sum, domain) => sum + domains?.[domain]?.gatePasses, 0);
  const corpus = receipt?.corpus;
  return releaseBoundLocalEvidence(receipt, expectedRelease, now, COMMERCIAL_SYNTHETIC_CAMPAIGN_RECEIPT_SCHEMA, root)
    && receipt?.ok === true
    && receipt?.certificationEvidence === false
    && receipt?.textCanonicalization === TEXT_BINDING_CANONICALIZATION
    && receipt?.executor?.subject === 'template_rebuild'
    && receipt?.executor?.rawAssertionsRequired === true
    && JSON.stringify(receipt?.executor?.requiredAxes) === JSON.stringify(COMMERCIAL_SYNTHETIC_REQUIRED_AXES)
    && receipt?.claimBoundary?.syntheticRegressionOnly === true
    && receipt?.claimBoundary?.certifiesCommercialAccuracy === false
    && receipt?.claimBoundary?.substitutesForIndependentHoldout === false
    && receipt?.claimBoundary?.substitutesForNativeCadReview === false
    && domainRowsValid
    && receipt.totalRuns === totalRuns
    && receipt.totalGatePasses === totalGatePasses
    && localFileBindingShape(corpus)
    && (!expectedCorpusSha256 || corpus.sha256 === expectedCorpusSha256)
    && verifyLocalFileBindings([corpus], root)
    && verifyCommercialSyntheticCampaignReceiptDerivation(receipt, { root, now });
}

export function verifyReceiptSourceBindings(receipt, root = process.cwd()) {
  const evidence = receipt?.evidence;
  if (!evidence || typeof evidence !== 'object') return false;
  const resolvedRoot = path.resolve(root);
  return Object.values(evidence).every(binding => {
    if (!sourceBindingShape(binding)) return false;
    const absolute = path.resolve(resolvedRoot, binding.path);
    if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`)) return false;
    try {
      if (fs.lstatSync(absolute).isSymbolicLink()) return false;
      const realRoot = fs.realpathSync.native(resolvedRoot);
      const realFile = fs.realpathSync.native(absolute);
      const realRelative = path.relative(realRoot, realFile);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) return false;
      const stat = fs.statSync(realFile);
      if (!stat.isFile() || stat.size !== binding.bytes) return false;
      return crypto.createHash('sha256').update(fs.readFileSync(realFile)).digest('hex') === binding.sha256;
    } catch {
      return false;
    }
  });
}

export function closedBetaIntegrityReceiptEligible(receipt, expectedRelease, now = Date.now(), evidenceBindingsVerified = false) {
  const evidence = receipt?.evidence;
  const comparisonSha256 = immutableSha256({
    differences: receipt?.differences,
    summary: receipt?.summary,
    evidence,
  });
  return releaseBoundReceiptMetadata(receipt, expectedRelease, now, 'nexyfab.closed-beta-integrity-comparison.v2')
    && Array.isArray(receipt?.differences) && receipt.differences.length === 0
    && sourceBindingShape(evidence?.baselineSnapshot)
    && sourceBindingShape(evidence?.candidateSnapshot)
    && IMMUTABLE_SHA256.test(String(receipt?.comparisonSha256 ?? ''))
    && receipt.comparisonSha256 === comparisonSha256
    && evidenceBindingsVerified === true;
}

export function productionProtectedStateReceiptEligible(receipt, expectedRelease, now = Date.now()) {
  const evidence = receipt?.evidence;
  const stateBinding = value => IMMUTABLE_SHA256.test(String(value?.identitySha256 ?? ''))
    && IMMUTABLE_SHA256.test(String(value?.stateSha256 ?? ''));
  const comparisonSha256 = immutableSha256({ tables: receipt?.tables, blockers: receipt?.blockers, evidence });
  return releaseBoundReceiptMetadata(receipt, expectedRelease, now, 'nexyfab.production-protected-state-compare.v2')
    && Array.isArray(receipt?.blockers) && receipt.blockers.length === 0
    && Number.isInteger(receipt?.protectedTableCount) && receipt.protectedTableCount > 0
    && receipt?.tables && Object.keys(receipt.tables).length === receipt.protectedTableCount
    && stateBinding(evidence?.baseline) && stateBinding(evidence?.candidate)
    && evidence.baseline.identitySha256 !== evidence.candidate.identitySha256
    && IMMUTABLE_SHA256.test(String(receipt?.comparisonSha256 ?? ''))
    && receipt.comparisonSha256 === comparisonSha256
    && receipt?.tables && Object.values(receipt.tables).every(table => IMMUTABLE_SHA256.test(String(table?.baselineStateSha256 ?? ''))
      && IMMUTABLE_SHA256.test(String(table?.candidateStateSha256 ?? '')));
}

export function liveSmokeReceiptEligible(receipt, expectedRelease, now = Date.now()) {
  const results = Array.isArray(receipt?.results) ? receipt.results : [];
  const requiredChecks = Array.isArray(receipt?.requiredChecks) ? receipt.requiredChecks : [];
  const resultById = new Map(results.map(item => [item?.id, item]));
  return receipt?.schema === 'nexyfab.deployment-ai-cad-smoke.v2'
    && receipt?.status === 'pass'
    && receipt?.target === PRODUCTION_TARGET
    && releaseBindingMatches(receipt, expectedRelease)
    && receiptFresh(receipt.generatedAt, now)
    && sameStringSet(requiredChecks, LIVE_SMOKE_REQUIRED_CHECKS)
    && sameStringSet([...resultById.keys()], LIVE_SMOKE_REQUIRED_CHECKS)
    && LIVE_SMOKE_REQUIRED_CHECKS.every(id => resultById.get(id)?.status === 'pass')
    && resultById.get('live')?.httpStatus === 200
    && resultById.get('ready')?.httpStatus === 200
    && resultById.get('capabilities')?.httpStatus === 200
    && resultById.get('scad-agent-route')?.httpStatus === 405
    && resultById.get('openscad')?.httpStatus === 200
    && readyCommercialBoundarySnapshotEligible(receipt.ready)
    && receiptSha256(receipt);
}

export function authenticatedE2EReceiptEligible(receipt, expectedRelease, now = Date.now()) {
  return receipt?.schema === 'nexyfab.authenticated-commercial-e2e.v2'
    && receipt?.ok === true
    && receipt?.environment === 'staging'
    && isolatedStagingTarget(receipt?.target)
    && authenticatedStagingReleaseBindingMatches(receipt, expectedRelease)
    && receiptFresh(receipt.generatedAt, now)
    && sameStringSet(receipt.requiredChecks, AUTHENTICATED_E2E_REQUIRED_CHECKS)
    && sameStringSet(receipt.checks, AUTHENTICATED_E2E_REQUIRED_CHECKS)
    && receipt.credentialsPersisted === false
    && receipt.transientProjectRetained === false
    && readyCommercialBoundarySnapshotEligible(receipt.ready)
    && receiptSha256(receipt);
}

function objectRestoreRoleEligible(role) {
  const objects = Array.isArray(role?.objects) ? role.objects : [];
  const keys = objects.map(item => item?.keySha256);
  return SHA256.test(String(role?.endpointSha256 ?? ''))
    && typeof role?.region === 'string' && role.region.length > 0
    && typeof role?.bucket === 'string' && role.bucket.length > 0
    && typeof role?.prefix === 'string' && role.prefix.length > 0 && role.prefix.endsWith('/')
    && Number.isInteger(role?.objectCount) && role.objectCount > 0
    && Number.isSafeInteger(role?.totalBytes) && role.totalBytes > 0
    && role.objectCount === objects.length
    && new Set(keys).size === keys.length
    && objects.every(item => SHA256.test(String(item?.keySha256 ?? ''))
      && Number.isSafeInteger(item?.bytes) && item.bytes >= 0
      && SHA256.test(String(item?.contentSha256 ?? '')))
    && objects.reduce((sum, item) => sum + item.bytes, 0) === role.totalBytes
    && SHA256.test(String(role?.manifestSha256 ?? ''))
    && crypto.createHash('sha256').update(JSON.stringify(objects)).digest('hex') === role.manifestSha256;
}

function objectStorageRestoreEligible(value) {
  const source = value?.source;
  const backup = value?.backup;
  const restored = value?.restored;
  const bindings = value?.databaseBindings;
  const limits = value?.limits;
  const identities = [source, backup, restored].map(role =>
    `${role?.endpointSha256 ?? ''}\0${role?.region ?? ''}\0${role?.bucket ?? ''}\0${role?.prefix ?? ''}`);
  return value?.schema === 'nexyfab.object-storage-isolated-restore-drill.v1'
    && value?.status === 'PASS'
    && value?.safety?.sourceWasReadOnly === true
    && value.safety.sourceUnchanged === true
    && value.safety.backupPrefixInitiallyEmpty === true
    && value.safety.restorePrefixInitiallyEmpty === true
    && value.safety.roleIdentitiesDistinct === true
    && value.safety.noOverwriteWrites === true
    && objectRestoreRoleEligible(source)
    && objectRestoreRoleEligible(backup)
    && objectRestoreRoleEligible(restored)
    && new Set(identities).size === 3
    && !source.bucket.includes('backup') && !source.bucket.includes('restore-drill')
    && backup.bucket.includes('backup') && backup.prefix.includes('backup')
    && restored.bucket.includes('restore-drill') && restored.prefix.includes('restore-drill')
    && backup.exactSourceMatch === true && restored.exactSourceMatch === true
    && source.objectCount === backup.objectCount && backup.objectCount === restored.objectCount
    && source.totalBytes === backup.totalBytes && backup.totalBytes === restored.totalBytes
    && source.manifestSha256 === backup.manifestSha256
    && backup.manifestSha256 === restored.manifestSha256
    && JSON.stringify(source.objects) === JSON.stringify(backup.objects)
    && JSON.stringify(backup.objects) === JSON.stringify(restored.objects)
    && Number.isInteger(bindings?.count) && bindings.count >= 7
    && bindings.count <= source.objectCount
    && Number.isInteger(bindings?.byKind?.immutable_input) && bindings.byKind.immutable_input >= 1
    && Number.isInteger(bindings?.byKind?.committed_output) && bindings.byKind.committed_output >= 3
    && Number.isInteger(bindings?.byKind?.artifact_snapshot) && bindings.byKind.artifact_snapshot >= 3
    && SHA256.test(String(bindings?.manifestSha256 ?? ''))
    && bindings?.allMatched === true
    && Number.isInteger(limits?.maxObjects) && source.objectCount <= limits.maxObjects
    && Number.isSafeInteger(limits?.maxTotalBytes) && source.totalBytes <= limits.maxTotalBytes
    && Number.isSafeInteger(limits?.maxObjectBytes)
    && source.objects.every(item => item.bytes <= limits.maxObjectBytes);
}

export function restoreReceiptEligible(receipt, expectedRelease, now = Date.now()) {
  const migration = receipt?.migration;
  const latestMigration = Array.isArray(migration?.migrations)
    ? migration.migrations.find(item => item?.version === LATEST_COMMERCIAL_MIGRATION)
    : null;
  const sourceHash = receipt?.source?.tableContentSha256;
  const restoredHash = receipt?.restored?.tableContentSha256;
  const migratedHash = receipt?.migrated?.tableContentSha256;
  const timing = receipt?.timing;
  const drillStartedAt = Date.parse(timing?.drillStartedAt);
  const backupCapturedAt = Date.parse(timing?.backupCapturedAt);
  const restoreStartedAt = Date.parse(timing?.restoreStartedAt);
  const completedAt = Date.parse(timing?.completedAt);
  const objectRestoreStartedAt = Date.parse(timing?.objectRestoreStartedAt);
  return receipt?.schema === 'nexyfab.backup-isolated-restore-drill.v3'
    && receipt?.ok === true
    && receipt?.target === 'production'
    && releaseBindingMatches(receipt, expectedRelease)
    && receiptFresh(receipt.generatedAt, now)
    && receipt?.safety?.environment === 'staging'
    && receipt.safety.sourceEnvironment === 'production'
    && receipt.safety.restoredEnvironment === 'staging'
    && receipt.safety.isolatedDatabaseIdentity === true
    && receipt.safety.sourceWasReadOnly === true
    && receipt.safety.sourceUnchangedDuringDrill === true
    && receipt.safety.productionRestorePerformed === false
    && typeof receipt.safety.sourceDatabase === 'string' && receipt.safety.sourceDatabase.length > 0
    && typeof receipt.safety.restoreDatabase === 'string' && /_restore_drill(?:_|$)/i.test(receipt.safety.restoreDatabase)
    && SHA256.test(String(receipt?.backup?.sha256 ?? ''))
    && Number.isInteger(receipt.backup.bytes) && receipt.backup.bytes > 0
    && SHA256.test(String(receipt?.backup?.sourceSnapshotSha256 ?? ''))
    && SHA256.test(String(sourceHash ?? ''))
    && SHA256.test(String(restoredHash ?? ''))
    && SHA256.test(String(migratedHash ?? ''))
    && receipt.backup.sourceSnapshotSha256 === sourceHash
    && sourceHash === restoredHash && restoredHash === migratedHash
    && receipt.source.afterObjectRestoreTableContentSha256 === sourceHash
    && receipt.source.afterObjectRestoreSchemaSha256 === receipt.source.schemaSha256
    && receipt.restored.exactSourceMatch === true
    && receipt.restored.businessDataSha256 === restoredHash
    && receipt.restored.foreignKeys?.integrityOk === true
    && receipt.restored.foreignKeys.orphanRows === 0
    && receipt.constraintValidation?.ok === true
    && receipt.migrated.businessRowsPreserved === true
    && receipt.migrated.businessDataSha256 === migratedHash
    && receipt.migrated.foreignKeys?.ok === true
    && receipt.migrated.foreignKeys.orphanRows === 0
    && receipt.migrationTarget === LATEST_COMMERCIAL_MIGRATION
    && receipt.migration.targetVersion === LATEST_COMMERCIAL_MIGRATION
    && latestMigration?.decision && ['apply', 'already_applied'].includes(latestMigration.decision)
    && SHA256.test(String(latestMigration.checksum ?? ''))
    && objectStorageRestoreEligible(receipt.objectStorage)
    && receipt?.claimBoundary?.evidenceClass === 'release-bound'
    && receipt.claimBoundary.localFixture === false
    && receipt.claimBoundary.releaseBoundObservation === true
    && receipt.claimBoundary.crossStorePointInTimeConsistencyVerified === true
    && receipt.claimBoundary.privateBetaEligible === true
    && receipt.claimBoundary.commercialGaEligible === false
    && Number.isFinite(drillStartedAt) && Number.isFinite(backupCapturedAt)
    && Number.isFinite(restoreStartedAt) && Number.isFinite(objectRestoreStartedAt) && Number.isFinite(completedAt)
    && drillStartedAt <= completedAt && backupCapturedAt <= restoreStartedAt
    && restoreStartedAt <= objectRestoreStartedAt && objectRestoreStartedAt <= completedAt
    && Number.isFinite(receipt.objectives?.rpoAgeAtDrillStartMs) && receipt.objectives.rpoAgeAtDrillStartMs >= 0
    && Number.isFinite(receipt.objectives?.rtoRestoreMigrateValidateMs) && receipt.objectives.rtoRestoreMigrateValidateMs >= 0
    && Number.isFinite(receipt.objectives?.rtoObjectRestoreValidateMs) && receipt.objectives.rtoObjectRestoreValidateMs >= 0
    && receipt.objectives.rpoAgeAtDrillStartMs === Math.max(0, drillStartedAt - backupCapturedAt)
    && receipt.objectives.rtoRestoreMigrateValidateMs === completedAt - restoreStartedAt
    && receipt.objectives.rtoObjectRestoreValidateMs === completedAt - objectRestoreStartedAt
    && receiptSha256(receipt);
}

export function productionMigrationReceiptEligible(receipt, expectedRelease = null, now = Date.now(), sourceBindingsVerified = false) {
  const generatedAt = Date.parse(receipt?.generatedAt);
  const migrations = Array.isArray(receipt?.migrations) ? receipt.migrations : [];
  const versions = migrations.map(item => item?.version);
  const expectedExpiresAt = Number.isFinite(generatedAt)
    ? new Date(generatedAt + 24 * 60 * 60_000).toISOString()
    : null;
  return receipt?.schema === 'nexyfab.postgres-migration-receipt.v2'
    && receipt?.ok === true
    && receipt?.status === 'PASS'
    && receipt?.target === 'production'
    && sourceBindingsVerified === true
    && Number.isFinite(generatedAt)
    && generatedAt <= now + 5 * 60_000
    && generatedAt >= now - 24 * 60 * 60_000
    && receipt?.freshness?.generatedAt === receipt.generatedAt
    && receipt?.freshness?.maxAgeMs === 24 * 60 * 60_000
    && receipt?.freshness?.expiresAt === expectedExpiresAt
    && Array.isArray(receipt?.blockers) && receipt.blockers.length === 0
    && Array.isArray(receipt?.changedBusinessTables) && receipt.changedBusinessTables.length === 0
    && Number.isInteger(receipt?.before?.tableCount) && receipt.before.tableCount >= 0
    && Number.isSafeInteger(receipt?.before?.totalRows) && receipt.before.totalRows >= 0
    && SHA256.test(String(receipt?.before?.businessRowCountSha256 ?? ''))
    && Number.isInteger(receipt?.after?.tableCount) && receipt.after.tableCount >= 0
    && Number.isSafeInteger(receipt?.after?.totalRows) && receipt.after.totalRows >= 0
    && receipt.after.businessRowCountSha256 === receipt.before.businessRowCountSha256
    && sameStringSet(versions.map(String), COMMERCIAL_MIGRATION_VERSIONS.map(String))
    && migrations.every(item => COMMERCIAL_MIGRATION_VERSIONS.includes(item?.version)
      && SHA256.test(String(item?.sourceSha256 ?? ''))
      && SHA256.test(String(item?.databaseChecksum ?? ''))
      && item.sourceSha256 === item.databaseChecksum
      && item?.checksumMatchesSource === true
      && ['apply', 'already_applied'].includes(item?.decision))
    && typeof receipt?.release?.buildId === 'string' && receipt.release.buildId.length > 0
    && typeof receipt?.release?.deploymentId === 'string' && receipt.release.deploymentId.length > 0
    && GIT_COMMIT_SHA.test(String(receipt?.release?.gitHead ?? ''))
    && (!expectedRelease || (receipt.release.buildId === expectedRelease.buildId
      && receipt.release.deploymentId === expectedRelease.deploymentId
      && receipt.release.gitHead === expectedRelease.head))
    && verifyReceiptSha256(receipt);
}

export function verifyProductionMigrationReceiptBindings(receipt, root = process.cwd()) {
  if (!Array.isArray(receipt?.migrations)) return false;
  const byVersion = new Map(receipt.migrations.map(item => [item?.version, item]));
  if (receipt.migrations.length !== COMMERCIAL_MIGRATION_VERSIONS.length
    || byVersion.size !== COMMERCIAL_MIGRATION_VERSIONS.length) return false;
  const bindings = [];
  for (const version of COMMERCIAL_MIGRATION_VERSIONS) {
    const item = byVersion.get(version);
    const expectedPath = `src/lib/db-postgres-migration-${version}.sql`;
    if (!item || item.sourcePath !== expectedPath
      || item.source?.path !== expectedPath
      || item.source?.bytes !== item.sourceBytes
      || item.source?.sha256 !== item.sourceSha256) return false;
    bindings.push({ path: item.sourcePath, bytes: item.sourceBytes, sha256: item.sourceSha256 });
  }
  return verifyLocalFileBindings(bindings, root) && verifyReceiptSha256(receipt);
}

export function verifyIndependentHoldoutKitBindings(validationCorpus, root = process.cwd()) {
  const domains = validationCorpus?.lanes?.independentHoldout?.domains;
  if (!domains || typeof domains !== 'object') return validationCorpus;
  const resolvedRoot = path.resolve(root);
  for (const [domain, holdout] of Object.entries(domains)) {
    holdout.sourceReviewKitVerified = false;
    const relativePath = holdout?.sourceReviewKit?.path;
    const expectedHash = String(holdout?.sourceReviewKit?.sha256 ?? '');
    if (typeof relativePath !== 'string' || !relativePath || !SHA256.test(expectedHash)) continue;
    const absolute = path.resolve(resolvedRoot, relativePath);
    if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`)) continue;
    try {
      if (fs.lstatSync(absolute).isSymbolicLink()) continue;
      const realRoot = fs.realpathSync.native(resolvedRoot);
      const realFile = fs.realpathSync.native(absolute);
      const realRelative = path.relative(realRoot, realFile);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) continue;
      const bytes = fs.readFileSync(realFile);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== expectedHash) continue;
      const report = validateIndependentDomainReviewKit(JSON.parse(bytes.toString('utf8')));
      holdout.sourceReviewKitVerified = report.releaseEligible === true
        && report.requiredDomains.length === 1 && report.requiredDomains[0] === domain
        && report.summary.requiredCases === holdout.requiredCases
        && report.summary.approvedCases === holdout.approvedCases;
    } catch {
      holdout.sourceReviewKitVerified = false;
    }
  }
  return validationCorpus;
}

export function releaseContractFor(value) {
  const channel = String(value ?? '').trim() || 'mechanical-core';
  const contract = RELEASE_CONTRACTS[channel];
  return contract ? { channel, ...contract } : null;
}

export function productReleaseScopeFor(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) {
    return {
      explicit: false,
      valid: true,
      requested: null,
      surfaces: ['web'],
      claimBoundary: 'web-only-default-private-beta; commercial-ga requires an explicit product scope',
    };
  }
  const tokens = raw.split(/[,+\s]+/).filter(Boolean);
  if (tokens.length === 1 && FULL_PRODUCT_SCOPE_ALIASES.has(tokens[0])) {
    return { explicit: true, valid: true, requested: raw, surfaces: [...PRODUCT_RELEASE_SURFACES], claimBoundary: 'full-product' };
  }
  const valid = tokens.length > 0
    && new Set(tokens).size === tokens.length
    && tokens.every(token => PRODUCT_RELEASE_SURFACES.includes(token));
  if (!valid) {
    return {
      explicit: true,
      valid: false,
      requested: raw,
      // An ambiguous scope must not silently omit a commercial surface.
      surfaces: [...PRODUCT_RELEASE_SURFACES],
      claimBoundary: 'ambiguous-fail-closed-full-product',
    };
  }
  const surfaces = [...new Set(['web', ...tokens])].sort((left, right) => PRODUCT_RELEASE_SURFACES.indexOf(left) - PRODUCT_RELEASE_SURFACES.indexOf(right));
  return { explicit: true, valid: true, requested: raw, surfaces, claimBoundary: 'explicit' };
}

export function readGitIdentity(root = process.cwd()) {
  const dotGit = path.join(root, '.git');
  let gitDir = dotGit;
  if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
    const pointer = fs.readFileSync(dotGit, 'utf8').trim();
    if (!pointer.startsWith('gitdir:')) return { branch: null, head: null };
    gitDir = path.resolve(root, pointer.slice('gitdir:'.length).trim());
  }
  if (!fs.existsSync(gitDir)) return { branch: null, head: null };

  const headValue = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  if (!headValue.startsWith('ref:')) return { branch: null, head: headValue || null };
  const ref = headValue.slice('ref:'.length).trim();
  const looseRef = path.join(gitDir, ...ref.split('/'));
  let head = fs.existsSync(looseRef) ? fs.readFileSync(looseRef, 'utf8').trim() : '';
  if (!head) {
    const packedRefs = path.join(gitDir, 'packed-refs');
    if (fs.existsSync(packedRefs)) {
      const row = fs.readFileSync(packedRefs, 'utf8')
        .split(/\r?\n/)
        .find(line => !line.startsWith('#') && !line.startsWith('^') && line.endsWith(` ${ref}`));
      head = row?.split(' ')[0] ?? '';
    }
  }
  return {
    branch: ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref,
    head: head || null,
  };
}

export function evaluateCommercializationReadiness(input) {
  const privateBetaBlockers = [];
  const gaBlockers = [];
  const blockPrivate = value => privateBetaBlockers.push(value);
  const blockGa = value => gaBlockers.push(value);
  const contract = releaseContractFor(input.releaseChannel);
  if (!contract) blockPrivate(`release_channel_invalid:${String(input.releaseChannel ?? '')}`);
  const productScope = productReleaseScopeFor(input.productReleaseScope);
  if (!productScope.valid) blockPrivate('product_release_scope_invalid_or_ambiguous');
  const platformContract = RELEASE_CONTRACTS.platform;
  const fullProductReleaseContractCompatible = contract
    && sameStringSet(contract.domains, platformContract.domains)
    && sameStringSet(contract.complexFamilies, platformContract.complexFamilies)
    && contract.mechanicalScope === platformContract.mechanicalScope
    && contract.complexScope === platformContract.complexScope;
  if (productScope.claimBoundary === 'full-product' && !fullProductReleaseContractCompatible) {
    blockPrivate('full_product_scope_release_channel_incompatible');
  }
  const requiredDomains = contract?.domains ?? [];
  const requiredComplexFamilies = contract?.complexFamilies ?? [];
  let specialtyReleaseVerification = null;

  const release = input.releaseBaseline?.release ?? {};
  const currentRelease = input.currentRelease ?? {};
  if (!String(release.branch ?? '').startsWith('release/')) blockPrivate('release_branch_not_fixed');
  if (!currentRelease.branch || !currentRelease.head) blockPrivate('current_release_identity_unavailable');
  else {
    if (release.branch !== currentRelease.branch) blockPrivate('release_baseline_branch_mismatch');
    if (release.head !== currentRelease.head) blockPrivate('release_baseline_head_mismatch');
  }
  if (release.baselineStatus !== 'committed' || release.workingTreeChanges !== 0) blockPrivate('release_candidate_not_committed');
  if (currentRelease.workingTreeChanges !== 0) blockPrivate('current_release_working_tree_dirty');
  if (release.environment !== 'production') blockPrivate('release_environment_not_production');
  if (release.service !== 'nexyfab.com') blockPrivate('release_service_not_nexyfab');
  for (const field of ['deploymentId', 'buildId', 'rollbackDeploymentId', 'dockerImageDigest']) {
    if (!release[field]) blockPrivate(`release_identity_missing:${field}`);
  }
  if (release.railwayIgnore?.missing?.length) blockPrivate('railway_deploy_exclusions_incomplete');
  let coreStagingHoldVerification;
  try {
    coreStagingHoldVerification = verifyCommercialPrecisionStagingHoldEvidence(
      input.coreStagingHoldReceipt,
      { expectedRelease: { buildId: release.buildId, head: release.head } },
    );
  } catch {
    coreStagingHoldVerification = { ok: false, blockers: ['staging_hold_verifier_error'] };
  }
  if (coreStagingHoldVerification.ok !== true) blockPrivate('core_staging_hold_not_verified');

  if (contract?.specialtyTrack) {
    try {
      specialtyReleaseVerification = verifySpecialtyIndependentReleaseReceipt(
        input.specialtyReleaseReceipt,
        input.evidenceRoot ?? process.cwd(),
        {
          channel: contract.channel,
          buildId: release.buildId,
          deploymentId: release.deploymentId,
          gitHead: release.head,
        },
        input.specialtyReleaseTrustedReviewers,
      );
    } catch {
      specialtyReleaseVerification = { ok: false, blockers: ['specialty_receipt_verifier_error'] };
    }
    if (specialtyReleaseVerification.ok !== true) {
      blockPrivate(`specialty_independent_release_receipt_missing:${contract.specialtyTrack}`);
    }
  }

  if (!closedBetaIntegrityReceiptEligible(input.closedBeta, release, Date.now(), input.closedBetaEvidenceVerified)
    || input.closedBetaReceiptVerified !== true) blockPrivate('closed_beta_integrity_failed');
  if (!productionProtectedStateReceiptEligible(input.productionProtectedState, release)
    || input.productionProtectedStateReceiptVerified !== true) blockPrivate('production_protected_state_failed');
  if (!liveSmokeReceiptEligible(input.liveSmoke, release) || input.liveSmokeReceiptVerified !== true) blockPrivate('production_smoke_not_passed');
  if (!verifyOpenScadHttpSmokeReceipt(input.openscadHttpSmoke, release, {
    root: input.evidenceRoot ?? process.cwd(),
  })) blockPrivate('openscad_http_smoke_not_passed');
  if (!authenticatedE2EReceiptEligible(input.authenticatedE2E, release) || input.authenticatedE2EReceiptVerified !== true) blockPrivate('authenticated_user_e2e_not_passed');
  const architectureInteriorRecoveryRequired = requiredDomains.some(domain => domain === 'building' || domain === 'interior');
  let architectureInteriorRecoveryReceiptVerified = false;
  try {
    architectureInteriorRecoveryReceiptVerified = verifyArchitectureInteriorRecoveryEvidence(
      input.architectureInteriorRecovery,
      {
        buildId: release.buildId,
        productionDeploymentId: release.deploymentId,
        evidenceDeploymentId: input.authenticatedE2E?.release?.evidenceDeploymentId,
        gitHead: release.head,
      },
      { root: input.evidenceRoot ?? process.cwd() },
    ) && input.architectureInteriorRecoveryReceiptVerified === true
      && input.architectureInteriorRecovery?.target === input.authenticatedE2E?.target;
  } catch {
    architectureInteriorRecoveryReceiptVerified = false;
  }
  if (architectureInteriorRecoveryRequired && !architectureInteriorRecoveryReceiptVerified) {
    blockPrivate('architecture_interior_recovery_not_passed');
  }
  if (!resourceBaselineReceiptEligible(input.resourceBaseline, release, {
    now: Date.now(),
    root: input.evidenceRoot ?? process.cwd(),
  })) blockPrivate('runtime_memory_target_failed');
  if (!productionMigrationReceiptEligible(input.migrationReceipt, release, Date.now(), input.migrationReceiptSourceBindingsVerified)) blockPrivate('production_migration_receipt_missing');
  if (!restoreReceiptEligible(input.restoreReceipt, release)) blockPrivate('backup_restore_receipt_missing');
  const environmentIsolationValid = verifyRailwayStagingIsolationEvidenceV2(input.environmentIsolationReceipt, {
    expectedRelease: {
      buildId: release.buildId,
      productionDeploymentId: release.deploymentId,
      evidenceDeploymentId: input.authenticatedE2E?.release?.evidenceDeploymentId,
      gitHead: release.head,
    },
    service: 'nexyfab.com',
    signingSecret: input.evidenceSigningSecret,
  });
  if (!environmentIsolationValid) blockPrivate('distributed_quota_environment_not_verified');

  const corpus = input.validationCorpus?.lanes;
  for (const domain of requiredDomains) {
    if ((corpus?.synthetic?.summary?.byDomain?.[domain] ?? 0) < 20) blockPrivate(`synthetic_cases_missing:${domain}`);
    const holdout = corpus?.independentHoldout?.domains?.[domain];
    if (domain !== 'mechanical' && !independentHoldoutDomainEligible(holdout)) blockGa(`independent_holdout_not_eligible:${domain}`);
  }
  if (corpus?.reference?.sourceReadOnly !== true) blockPrivate('reference_corpus_not_read_only');
  if (!contract?.specialtyTrack && !syntheticCampaignReceiptEligible(input.syntheticCampaignReceipt, release, {
    requiredDomains,
    expectedCorpusSha256: input.syntheticCampaignCorpusSha256,
    now: Date.now(),
    root: input.evidenceRoot ?? process.cwd(),
  })) blockPrivate('synthetic_domain_campaign_incomplete');

  if (requiredComplexFamilies.length > 0) {
    const allComplexCases = Array.isArray(input.complexHoldoutCases) ? input.complexHoldoutCases : [];
    const complexCases = allComplexCases.filter(item => requiredComplexFamilies.includes(item?.family));
    const complexCaseIds = new Set(complexCases.map(item => item?.caseId).filter(Boolean));
    const complexHashes = new Set(complexCases.map(item => String(item?.sourceHash ?? '').toLowerCase()).filter(Boolean));
    const complexLineages = new Set(complexCases.map(item => String(item?.holdoutGroup ?? '').toLowerCase()).filter(Boolean));
    const expectedCases = requiredComplexFamilies.length * 20;
    const complexStructureValid = complexCases.length === expectedCases
      && complexCaseIds.size === complexCases.length
      && complexHashes.size === complexCases.length
      && complexLineages.size === complexCases.length
      && complexCases.every(item => item?.schema === 'nexyfab.complex-benchmark-case.v2'
        && item?.split === 'holdout'
        && requiredComplexFamilies.includes(item?.family)
        && Array.isArray(item?.assertions)
        && item.assertions.length > 0);
    if (!complexStructureValid) blockGa('complex_holdout_integrity_incomplete');
    for (const family of requiredComplexFamilies) {
      const count = complexCases.filter(item => item?.family === family).length;
      if (count !== 20) blockGa(`complex_holdout_family_incomplete:${family}:${count}/20`);
    }

    const complexApproval = input.complexGroundTruthValidation;
    const approvalSummary = complexApproval?.summary ?? {};
    const selectedApprovalResults = Array.isArray(complexApproval?.results)
      ? complexApproval.results.filter(item => requiredComplexFamilies.includes(item?.family))
      : [];
    const selectedApprovalsComplete = selectedApprovalResults.length === expectedCases
      && new Set(selectedApprovalResults.map(item => item?.caseId)).size === expectedCases
      && selectedApprovalResults.every(item => complexCaseIds.has(item?.caseId)
        && item?.status === 'approved'
        && item?.scoreEligible === true);
    const summaryMatchesChannel = contract?.channel === 'platform'
      ? approvalSummary.cases === expectedCases && approvalSummary.records === expectedCases && approvalSummary.approved === expectedCases && selectedApprovalsComplete
      : selectedApprovalsComplete;
    const complexApprovalsComplete = complexApproval?.schema === 'nexyfab.complex-ground-truth-approval-validation.v1'
      && summaryMatchesChannel
      && (contract?.channel !== 'platform' || (approvalSummary.pending === 0
        && approvalSummary.invalid === 0
        && approvalSummary.rejected === 0
        && approvalSummary.changesRequested === 0))
      && requiredComplexFamilies.every(family => complexApproval?.byFamily?.[family]?.cases === 20
        && complexApproval?.byFamily?.[family]?.approved === 20);
    if (!complexApprovalsComplete) blockGa('complex_ground_truth_dual_approval_incomplete');
  }

  if (contract?.mechanicalScope) {
    const runtimeEvidence = input.commercialPrecisionRuntimeEvidenceStatus;
    if (runtimeEvidence?.privateBetaEligible !== true) {
      blockPrivate('commercial_precision_runtime_private_beta_not_verified');
    }
    if (runtimeEvidence?.commercialGaEligible !== true) {
      blockGa('commercial_precision_runtime_ga_not_verified');
    }
    const mechanicalScope = input.mechanicalProductScope;
    const scopeStatus = mechanicalScopeContractStatus(mechanicalScope);
    if (!scopeStatus.valid) blockPrivate('mechanical_product_scope_contract_incomplete');
    else {
      if (scopeStatus.evidence.internalRegressionVerified !== true) blockPrivate('mechanical_scope_internal_regression_incomplete');
      if (scopeStatus.evidence.coreThirtyFeatureClosedLoopVerified !== true) blockGa('mechanical_scope_30_feature_closed_loop_incomplete');
      if (scopeStatus.evidence.directDesignCandidateVerified !== true) blockPrivate('mechanical_scope_ten_direct_designs_incomplete');
      if (scopeStatus.evidence.directDesignThirtyVerified !== true) blockGa('mechanical_scope_thirty_direct_designs_incomplete');
      if (scopeStatus.evidence.intentCampaign150Verified !== true) blockGa('mechanical_scope_intent_campaign_150_incomplete');
      if (scopeStatus.evidence.standardStepConformanceVerified !== true) blockGa('mechanical_scope_standard_step_conformance_incomplete');
      if (scopeStatus.evidence.artifactRevisionConsistencyVerified !== true) blockGa('mechanical_scope_revision_consistency_incomplete');
      if (scopeStatus.evidence.blindProductChallengeVerified !== true) blockGa('mechanical_scope_blind_product_challenge_incomplete');
      if (scopeStatus.evidence.manufacturingReceiptVerified !== true) blockGa('mechanical_scope_manufacturing_receipt_incomplete');
    }
    if (input.mechanicalProductScope?.decision?.privateBetaEligible !== true) {
      blockPrivate('mechanical_product_private_beta_not_eligible');
    }
    if (input.mechanicalProductScope?.decision?.selfServiceEligible !== true) {
      blockGa('mechanical_product_self_service_not_eligible');
    }
    if (input.mechanicalProductScope?.decision?.manufacturingReleaseVerified !== true) {
      blockGa('mechanical_manufacturing_release_not_verified');
    }
  }
  if (contract?.complexScope) {
    const familyDecision = contract.promotionFamily ? input.complexProductScope?.families?.[contract.promotionFamily] : null;
    const selfServiceEligible = contract.promotionFamily
      ? familyDecision?.selfServiceEligible === true
      : input.complexProductScope?.decision?.mechanicalComplexSelfServiceEligible === true
        || input.complexProductScope?.decision?.broadComplexProductSelfServiceEligible === true;
    const manufacturingVerified = contract.promotionFamily
      ? familyDecision?.manufacturingReleaseVerified === true
      : input.complexProductScope?.decision?.mechanicalManufacturingReleaseVerified === true
        || input.complexProductScope?.decision?.manufacturingReleaseGuaranteed === true;
    if (!selfServiceEligible) blockGa(contract.promotionFamily ? `complex_family_self_service_not_eligible:${contract.promotionFamily}` : 'complex_product_self_service_not_eligible');
    if (!manufacturingVerified) blockGa(contract.promotionFamily ? `complex_family_manufacturing_not_verified:${contract.promotionFamily}` : 'complex_manufacturing_release_not_verified');
  }
  let securityReceiptVerification;
  try {
    securityReceiptVerification = verifyCommercialSecurityEvidenceReceipt(input.securityReceipt, {
      root: input.evidenceRoot ?? process.cwd(),
      expectedRelease: {
        buildId: release.buildId,
        deploymentId: release.deploymentId,
        head: release.head,
        environment: release.environment,
        service: release.service,
      },
    });
  } catch {
    // A missing/malformed external receipt is a normal HOLD state, not a gate
    // process crash or an implicit PASS.
    securityReceiptVerification = { ok: false, blockers: ['security_receipt_verifier_error'] };
  }
  // The v2 receipt is the promotion authority. Raw source aggregates remain
  // available to callers as diagnostics, but cannot grant or revoke security
  // eligibility independently of the bound, derived receipt.
  if (securityReceiptVerification.ok !== true) blockPrivate('commercial_security_receipt_missing');

  const productEvidence = {
    enterpriseSso: { required: productScope.surfaces.includes('enterprise'), receiptVerified: false, blockers: [], receiptSha256: input.enterpriseSsoReceipt?.receiptSha256 ?? null, sourceBindings: input.enterpriseSsoReceipt?.sourceBindings ?? [] },
    windowsAgentSidecar: { required: productScope.surfaces.includes('desktop'), receiptVerified: false, blockers: [], receiptSha256: input.windowsSeaReceipt?.receiptSha256 ?? null, sourceBindings: input.windowsSeaReceipt?.sourceBindings ?? [] },
    largeUpload: { required: productScope.surfaces.includes('large-upload'), receiptVerified: false, blockers: [], receiptSha256: input.largeUploadStagingReceipt?.receiptSha256 ?? null, sourceBindings: input.largeUploadStagingReceipt?.sourceBindings ?? [] },
    specialtyTracks: productScope.claimBoundary === 'full-product' ? {} : null,
  };
  if (productEvidence.enterpriseSso.required) {
    const status = enterpriseSsoReadinessStatus(input.enterpriseSsoReceipt, release, { root: input.evidenceRoot ?? process.cwd() });
    productEvidence.enterpriseSso.receiptVerified = status.ok;
    productEvidence.enterpriseSso.blockers = status.blockers;
    if (!status.ok) blockPrivate('enterprise_sso_readiness_receipt_missing');
  }
  if (productEvidence.windowsAgentSidecar.required) {
    const status = windowsSeaReleaseStatus(input.windowsSeaReceipt, release, {
      root: input.evidenceRoot ?? process.cwd(),
      trustedKeyAllowlist: input.windowsSeaTrustedKeyAllowlist,
    });
    productEvidence.windowsAgentSidecar.receiptVerified = status.ok;
    productEvidence.windowsAgentSidecar.blockers = status.blockers;
    if (!status.ok) blockPrivate('windows_sea_release_receipt_missing');
  }
  if (productEvidence.largeUpload.required) {
    const status = largeUploadStagingReadinessStatus(input.largeUploadStagingReceipt, release, { root: input.evidenceRoot ?? process.cwd() });
    productEvidence.largeUpload.receiptVerified = status.ok;
    productEvidence.largeUpload.blockers = status.blockers;
    if (!status.ok) blockPrivate('large_upload_staging_readiness_receipt_missing');
  }
  if (productEvidence.specialtyTracks) {
    for (const [track, channel] of Object.entries(FULL_PRODUCT_SPECIALTY_CHANNELS)) {
      const receipt = input.fullProductSpecialtyReceipts?.[track] ?? null;
      let status;
      try {
        status = verifySpecialtyIndependentReleaseReceipt(
          receipt,
          input.evidenceRoot ?? process.cwd(),
          { channel, buildId: release.buildId, deploymentId: release.deploymentId, gitHead: release.head },
          input.specialtyReleaseTrustedReviewers,
        );
      } catch {
        status = { ok: false, blockers: ['specialty_receipt_verifier_error'], receiptSha256: receipt?.receiptSha256 ?? null };
      }
      productEvidence.specialtyTracks[track] = {
        required: true,
        channel,
        receiptVerified: status.ok === true,
        receiptSha256: receipt?.receiptSha256 ?? status.receiptSha256 ?? null,
        blockers: status.blockers ?? ['specialty_receipt_not_evaluated'],
      };
      if (status.ok !== true) blockPrivate(`full_product_specialty_receipt_missing:${track}`);
    }
  }

  gaBlockers.unshift(...privateBetaBlockers);
  if (!productScope.explicit) blockGa('product_release_scope_not_explicit_for_ga');
  if (!sevenDayOperationsReceiptEligible(input.sevenDayOperationsReceipt, release, Date.now(), input.sevenDayOperationsEvidenceVerified)) blockGa('seven_day_operations_receipt_missing');
  if (contract?.channel !== 'mechanical-core' && !contract?.specialtyTrack && !expertReviewReceiptEligible(input.expertReviewReceipt, contract?.channel, {
    expectedRelease: { buildId: release.buildId, head: release.head },
    expectedHoldoutCorpusSha256: input.expertReviewExpectedHoldoutCorpusSha256,
    trustedReviewers: input.expertReviewTrustedReviewers,
  })) blockGa('expert_review_receipt_missing');

  return {
    schema: 'nexyfab.commercialization-readiness.v4',
    evaluatedReleaseBaseline: input.releaseBaselineBinding ?? null,
    release: {
      branch: release.branch ?? null,
      gitHead: release.head ?? null,
      baselineStatus: release.baselineStatus ?? null,
      workingTreeChanges: release.workingTreeChanges ?? null,
      deploymentId: release.deploymentId ?? null,
      buildId: release.buildId ?? null,
      rollbackDeploymentId: release.rollbackDeploymentId ?? null,
      dockerImageDigest: release.dockerImageDigest ?? null,
      dbSchemaVersion: release.dbSchemaVersion ?? null,
      environment: release.environment ?? null,
      service: release.service ?? null,
    },
    releaseChannel: contract?.channel ?? null,
    productReleaseScope: productScope,
    coreStagingHoldEvidence: {
      receiptVerified: coreStagingHoldVerification.ok === true,
      receiptSha256: input.coreStagingHoldReceipt?.receiptSha256 ?? null,
      buildId: input.coreStagingHoldReceipt?.release?.buildId ?? null,
      deploymentId: input.coreStagingHoldReceipt?.release?.deploymentId ?? null,
      blockers: coreStagingHoldVerification.blockers,
    },
    productEvidence,
    requiredDomains,
    requiredComplexFamilies,
    specialtyTrack: contract?.specialtyTrack ?? null,
    specialtyEvidence: contract?.specialtyTrack ? {
      receiptVerified: specialtyReleaseVerification?.ok === true,
      receiptSha256: input.specialtyReleaseReceipt?.receiptSha256 ?? null,
      blockers: specialtyReleaseVerification?.blockers ?? ['specialty_receipt_not_evaluated'],
    } : null,
    securityEvidence: {
      receiptVerified: securityReceiptVerification.ok === true,
      receiptSha256: input.securityReceipt?.receiptSha256 ?? null,
      sourceBindings: input.securityReceipt?.sourceBindings ?? [],
      derived: input.securityReceipt?.evidence ?? null,
      blockers: securityReceiptVerification.blockers,
      rawDiagnostics: input.security ?? null,
    },
    architectureInteriorRecoveryEvidence: architectureInteriorRecoveryRequired ? {
      required: true,
      receiptVerified: architectureInteriorRecoveryReceiptVerified,
      receiptSha256: input.architectureInteriorRecovery?.sha256 ?? null,
      target: input.architectureInteriorRecovery?.target ?? null,
    } : { required: false, receiptVerified: false, receiptSha256: null, target: null },
    commercialPrecisionRuntimeEvidence: {
      required: contract?.mechanicalScope === true,
      receiptVerified: input.commercialPrecisionRuntimeEvidenceStatus?.receiptVerified === true,
      privateBetaEligible: input.commercialPrecisionRuntimeEvidenceStatus?.privateBetaEligible === true,
      commercialGaEligible: input.commercialPrecisionRuntimeEvidenceStatus?.commercialGaEligible === true,
      status: input.commercialPrecisionRuntimeEvidenceStatus?.status ?? 'HOLD',
      receiptSha256: input.commercialPrecisionRuntimeEvidenceStatus?.receiptSha256 ?? null,
      blockers: input.commercialPrecisionRuntimeEvidenceStatus?.blockers ?? ['runtime_evidence_not_evaluated'],
    },
    privateBeta: { eligible: privateBetaBlockers.length === 0, blockers: [...new Set(privateBetaBlockers)] },
    commercialGa: { eligible: gaBlockers.length === 0, blockers: [...new Set(gaBlockers)] },
  };
}

const readJson = value => JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
const readJsonWithBinding = value => {
  const absolute = path.resolve(value);
  const bytes = fs.readFileSync(absolute);
  const relativePath = path.relative(process.cwd(), absolute);
  return {
    document: JSON.parse(bytes.toString('utf8')),
    binding: {
      path: (!relativePath.startsWith('..') && !path.isAbsolute(relativePath) ? relativePath : absolute).replaceAll(path.sep, '/'),
      bytes: bytes.byteLength,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
};
const optionalJson = value => value && fs.existsSync(path.resolve(value)) ? readJson(value) : null;

async function main() {
  const routeMatrix = readJson(process.env.ROUTE_SECURITY_MATRIX ?? 'docs/evidence/security/route-security-matrix-260810.json');
  const cadApiControls = readJson(process.env.CAD_API_CONTROL_EVIDENCE ?? 'docs/evidence/cad-independent/cad-api-control-evidence.json');
  const secretScan = readJson(process.env.SECRET_SCAN_EVIDENCE ?? 'docs/evidence/security/secret-scan-260810.json');
  const dependencyAudit = readJson(process.env.DEPENDENCY_AUDIT_EVIDENCE ?? 'docs/evidence/security/dependency-audit-260810.json');
  const complexHoldoutCases = readJson(process.env.COMPLEX_HOLDOUT_CASES ?? 'docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json');
  const complexGroundTruthValidation = readJson(process.env.COMPLEX_GROUND_TRUTH_VALIDATION ?? 'docs/evidence/complex-holdout-lineage-v2-260807/ground-truth-approval-validation.json');
  const complexProductScope = readJson(process.env.COMPLEX_PRODUCT_SCOPE_ASSESSMENT ?? 'docs/evidence/cad-independent/complex-product-scope-assessment.json');
  const mechanicalProductScope = optionalJson(process.env.MECHANICAL_PRODUCT_SCOPE_ASSESSMENT ?? 'docs/evidence/cad-independent/mechanical-product-scope-assessment.json');
  const validationCorpusPath = path.resolve(process.env.COMMERCIAL_VALIDATION_CORPUS ?? 'docs/evidence/release/commercial-validation-corpus-260810.json');
  const validationCorpusBytes = fs.readFileSync(validationCorpusPath);
  const validationCorpus = verifyIndependentHoldoutKitBindings(JSON.parse(validationCorpusBytes.toString('utf8')));
  const syntheticCampaignPath = path.resolve(process.env.SYNTHETIC_CAMPAIGN_RECEIPT ?? 'docs/evidence/release/commercial-synthetic-campaign-receipt-260810.json');
  const resourceBaselinePath = path.resolve(process.env.RAILWAY_RESOURCE_BASELINE ?? 'docs/evidence/release/railway-resource-baseline-260810.json');
  const sevenDayOperationsReceipt = optionalJson(process.env.SEVEN_DAY_OPERATIONS_RECEIPT ?? 'docs/evidence/release/seven-day-operations-receipt.json');
  const migrationReceipt = optionalJson(process.env.PRODUCTION_MIGRATION_RECEIPT ?? 'docs/evidence/release/production-migration-receipt.json');
  const securityReceipt = optionalJson(process.env.COMMERCIAL_SECURITY_RECEIPT ?? 'docs/evidence/release/commercial-security-evidence-receipt.json');
  const coreStagingHoldReceipt = optionalJson(
    process.env.COMMERCIAL_PRECISION_STAGING_HOLD_RECEIPT
      ?? 'docs/evidence/release/commercial-precision-staging-hold-20260825.json',
  );
  const specialtyReleaseReceipt = optionalJson(process.env.SPECIALTY_RELEASE_RECEIPT ?? 'docs/evidence/release/specialty-independent-release-receipt.json');
  const specialtyReleaseTrustedReviewers = optionalJson(process.env.SPECIALTY_RELEASE_TRUSTED_REVIEWERS ?? 'docs/evidence/release/specialty-trusted-reviewers.json');
  const closedBetaReceipt = readJson(process.env.CLOSED_BETA_COMPARISON ?? 'docs/evidence/release/closed-beta-integrity-commercial-release-260810.json');
  const productionProtectedStateReceipt = optionalJson(process.env.PRODUCTION_PROTECTED_STATE_RECEIPT ?? 'docs/evidence/release/production-protected-state-receipt.json');
  const liveSmokeReceipt = readJson(process.env.COMMERCIAL_LIVE_SMOKE ?? 'docs/evidence/release/commercial-live-smoke-with-service-env-260810.json');
  const authenticatedE2EReceipt = optionalJson(process.env.AUTHENTICATED_E2E_RECEIPT ?? 'docs/evidence/release/authenticated-commercial-e2e-260810.json');
  const architectureInteriorRecoveryReceipt = optionalJson(process.env.ARCHITECTURE_INTERIOR_RECOVERY_RECEIPT ?? 'docs/evidence/release/architecture-interior-recovery.json');
  const enterpriseSsoReceipt = optionalJson(process.env.ENTERPRISE_SSO_READINESS_RECEIPT ?? 'docs/evidence/release/enterprise-sso-readiness-receipt.json');
  const windowsSeaReceipt = optionalJson(process.env.WINDOWS_SEA_RELEASE_RECEIPT ?? 'docs/evidence/release/windows-agent-sidecar-release-receipt.json');
  const largeUploadStagingReceipt = optionalJson(process.env.LARGE_UPLOAD_STAGING_READINESS_RECEIPT ?? 'docs/evidence/release/large-upload-staging-readiness-receipt.json');
  const fullProductSpecialtyReceiptMap = optionalJson(
    process.env.FULL_PRODUCT_SPECIALTY_RECEIPTS ?? 'docs/evidence/release/full-product-specialty-release-receipts.json',
  );
  const releaseBaselineSource = readJsonWithBinding(process.env.RELEASE_BASELINE ?? 'docs/evidence/release/commercial-release-baseline-current.json');
  const releaseBaseline = releaseBaselineSource.document;
  const expectedRelease = releaseBaseline?.release ?? {};
  const commercialPrecisionRuntimeReceipt = optionalJson(
    process.env.COMMERCIAL_PRECISION_RUNTIME_RECEIPT ?? COMMERCIAL_PRECISION_DEFAULT_RECEIPT,
  );
  const commercialPrecisionRuntimeEvidenceStatus = verifyCommercialPrecisionRuntimeEvidence(
    commercialPrecisionRuntimeReceipt,
    {
      sourceRoot: process.cwd(),
      evidenceRoot: process.env.NEXYFAB_COMMERCIAL_PRECISION_EVIDENCE_ROOT ?? '',
      observationPath: process.env.COMMERCIAL_PRECISION_RUNTIME_OBSERVATION
        ?? COMMERCIAL_PRECISION_DEFAULT_OBSERVATION,
      expectedRelease,
      secret: process.env.GENERATION_EVIDENCE_SIGNING_SECRET,
      now: Date.now(),
    },
  );
  const closedBetaVerification = verifyClosedBetaIntegrityReceipt(closedBetaReceipt, {
    root: process.cwd(),
    expectedRelease,
  });
  const productionProtectedStateVerification = verifyProtectedStateReceipt(productionProtectedStateReceipt, {
    expectedRelease,
  });
  const liveSmokeReceiptVerified = verifyCommercialLiveSmokeReceipt(liveSmokeReceipt, expectedRelease, {
    root: process.cwd(),
  });
  const authenticatedE2EReceiptVerified = verifyAuthenticatedCommercialE2EReceipt(authenticatedE2EReceipt, {
    buildId: expectedRelease.buildId,
    productionDeploymentId: expectedRelease.deploymentId,
    evidenceDeploymentId: authenticatedE2EReceipt?.release?.evidenceDeploymentId,
    gitHead: expectedRelease.head,
  }, { root: process.cwd() });
  const architectureInteriorRecoveryReceiptVerified = verifyArchitectureInteriorRecoveryEvidence(architectureInteriorRecoveryReceipt, {
    buildId: expectedRelease.buildId,
    productionDeploymentId: expectedRelease.deploymentId,
    evidenceDeploymentId: authenticatedE2EReceipt?.release?.evidenceDeploymentId,
    gitHead: expectedRelease.head,
  }, { root: process.cwd() });
  const result = evaluateCommercializationReadiness({
    releaseChannel: process.env.NEXYFAB_RELEASE_CHANNEL,
    productReleaseScope: process.env.NEXYFAB_PRODUCT_RELEASE_SCOPE,
    currentRelease: { ...readGitIdentity(), workingTreeChanges: readReleaseWorkingTreeChanges().length },
    releaseBaseline,
    releaseBaselineBinding: releaseBaselineSource.binding,
    coreStagingHoldReceipt,
    closedBeta: closedBetaReceipt,
    closedBetaEvidenceVerified: verifyReceiptSourceBindings(closedBetaReceipt),
    closedBetaReceiptVerified: closedBetaVerification.ok,
    productionProtectedState: productionProtectedStateReceipt,
    productionProtectedStateReceiptVerified: productionProtectedStateVerification.ok,
    validationCorpus,
    syntheticCampaignReceipt: readJson(syntheticCampaignPath),
    syntheticCampaignCorpusSha256: crypto.createHash('sha256').update(validationCorpusBytes).digest('hex'),
    complexHoldoutCases,
    complexGroundTruthValidation,
    complexProductScope,
    mechanicalProductScope,
    commercialPrecisionRuntimeEvidenceStatus,
    liveSmoke: liveSmokeReceipt,
    liveSmokeReceiptVerified,
    openscadHttpSmoke: optionalJson(process.env.OPENSCAD_HTTP_SMOKE ?? 'docs/evidence/release/openscad-http-smoke-260810.json'),
    authenticatedE2E: authenticatedE2EReceipt,
    authenticatedE2EReceiptVerified,
    architectureInteriorRecovery: architectureInteriorRecoveryReceipt,
    architectureInteriorRecoveryReceiptVerified,
    resourceBaseline: readJson(resourceBaselinePath),
    evidenceRoot: process.cwd(),
    migrationReceipt,
    migrationReceiptSourceBindingsVerified: verifyProductionMigrationReceiptBindings(migrationReceipt),
    restoreReceipt: optionalJson(process.env.BACKUP_RESTORE_RECEIPT ?? 'docs/evidence/release/backup-restore-receipt.json'),
    environmentIsolationReceipt: optionalJson(process.env.ENVIRONMENT_ISOLATION_RECEIPT ?? 'docs/evidence/release/railway-staging-isolation-receipt.json'),
    evidenceSigningSecret: process.env.GENERATION_EVIDENCE_SIGNING_SECRET,
    securityReceipt,
    enterpriseSsoReceipt,
    windowsSeaReceipt,
    largeUploadStagingReceipt,
    fullProductSpecialtyReceipts: fullProductSpecialtyReceiptMap?.schema === 'nexyfab.full-product-specialty-release-map.v1'
      ? fullProductSpecialtyReceiptMap.receipts
      : null,
    specialtyReleaseReceipt,
    specialtyReleaseTrustedReviewers,
    sevenDayOperationsReceipt,
    sevenDayOperationsEvidenceVerified: verifySevenDayOperationsReceiptBindings(sevenDayOperationsReceipt)
      && verifySevenDayOperationsReceiptSignature(sevenDayOperationsReceipt),
    expertReviewReceipt: optionalJson(process.env.EXPERT_REVIEW_RECEIPT ?? 'docs/evidence/release/expert-review-receipt.json'),
    expertReviewExpectedHoldoutCorpusSha256: crypto.createHash('sha256').update(validationCorpusBytes).digest('hex'),
    expertReviewTrustedReviewers: parseTrustedIndependentReviewers(),
    security: {
      routeMatrixOk: routeMatrix.status === 'pass'
        && routeMatrix.summary?.unknownClassifications === 0
        && routeMatrix.summary?.routesWithGaps === 0,
      cadApiControlsOk: cadApiControls.status === 'pass'
        && cadApiControls.issues?.length === 0
        && cadApiControls.checks?.allCadRoutesBehindActiveProxy === true,
      secretFindings: secretScan.findingCount,
      dependencyVulnerabilities: dependencyAudit.vulnerabilities?.total,
    },
  });
  const report = {
    ...result,
    generatedAt: new Date().toISOString(),
    evidence: {
      routeSecurityMatrix: routeMatrix.status,
      cadApiControls: cadApiControls.status,
      secretFindings: secretScan.findingCount,
      dependencyVulnerabilities: dependencyAudit.vulnerabilities?.total,
      commercialSecurityReceipt: result.securityEvidence,
      coreStagingHoldEvidence: result.coreStagingHoldEvidence,
      productReleaseScope: result.productReleaseScope,
      productEvidence: result.productEvidence,
      complexHoldoutCases: Array.isArray(complexHoldoutCases) ? complexHoldoutCases.length : null,
      complexGroundTruthApproved: complexGroundTruthValidation?.summary?.approved ?? null,
      complexProductSelfServiceEligible: complexProductScope?.decision?.broadComplexProductSelfServiceEligible === true,
      complexManufacturingReleaseVerified: complexProductScope?.decision?.manufacturingReleaseGuaranteed === true,
      mechanicalScopeStatus: mechanicalProductScope?.decision?.status ?? null,
      mechanicalInternalRegressionVerified: mechanicalProductScope?.evidence?.internalRegressionVerified === true,
      mechanicalIntentQualification150Verified: mechanicalProductScope?.evidence?.intentQualification150Verified === true,
      mechanicalIntentRuntimeRepresentativeVerified: mechanicalProductScope?.evidence?.intentRuntimeRepresentativeVerified === true,
      mechanicalAssemblyDrawingHandoffLocalVerified: mechanicalProductScope?.evidence?.assemblyDrawingHandoffLocalVerified === true,
      mechanicalCoreThirtyFeatureClosedLoopVerified: mechanicalProductScope?.evidence?.coreThirtyFeatureClosedLoopVerified === true,
      mechanicalDirectDesignCandidateVerified: mechanicalProductScope?.evidence?.directDesignCandidateVerified === true,
      mechanicalDirectDesignThirtyVerified: mechanicalProductScope?.evidence?.directDesignThirtyVerified === true,
      mechanicalIntentCampaign150Verified: mechanicalProductScope?.evidence?.intentCampaign150Verified === true,
      mechanicalStandardStepConformanceVerified: mechanicalProductScope?.evidence?.standardStepConformanceVerified === true,
      mechanicalRevisionConsistencyVerified: mechanicalProductScope?.evidence?.artifactRevisionConsistencyVerified === true,
      mechanicalBlindProductChallengeVerified: mechanicalProductScope?.evidence?.blindProductChallengeVerified === true,
      mechanicalManufacturingReceiptVerified: mechanicalProductScope?.evidence?.manufacturingReceiptVerified === true,
      commercialPrecisionRuntimeReceiptVerified: result.commercialPrecisionRuntimeEvidence.receiptVerified,
      commercialPrecisionRuntimePrivateBetaEligible: result.commercialPrecisionRuntimeEvidence.privateBetaEligible,
      commercialPrecisionRuntimeGaEligible: result.commercialPrecisionRuntimeEvidence.commercialGaEligible,
      releaseChannel: result.releaseChannel,
      requiredDomains: result.requiredDomains,
      requiredComplexFamilies: result.requiredComplexFamilies,
      specialtyTrack: result.specialtyTrack,
      specialtyEvidence: result.specialtyEvidence,
      distributedQuotaEnvironmentVerified: result.privateBeta.blockers.includes('distributed_quota_environment_not_verified') === false,
    },
  };
  const outputPath = path.resolve(process.env.COMMERCIALIZATION_GATE_OUTPUT ?? 'docs/evidence/release/commercialization-readiness-current.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!result.privateBeta.eligible || !result.commercialGa.eligible) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`[commercialization-gate] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
