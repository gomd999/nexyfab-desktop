#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOMAIN_AXES, RELEASE_CHANNEL_DOMAINS } from './build-independent-domain-review-kit.mjs';

export const REQUIRED_DOMAINS = Object.keys(DOMAIN_AXES);
export const REQUIRED_DOMAIN_AXES = DOMAIN_AXES;

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === actual.length
    && [...actual].sort().join('\0') === [...expected].sort().join('\0');
}

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function parseTrustedIndependentReviewers(raw = process.env.NEXYFAB_CAD_REVIEWER_KEYS) {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function independentDomainReviewTargetHash(value, item) {
  return sha256(canonical({
    schema: 'nexyfab.independent-domain-review-target.v1',
    releaseChannel: value.releaseChannel,
    caseId: item.caseId,
    domain: item.domain,
    requiredAxes: item.requiredAxes,
    source: item.source,
    blindedRun: item.blindedRun,
  }));
}

export function independentDomainReviewPayload(value, item, role, review) {
  return canonical({
    schema: 'nexyfab.independent-domain-review-signoff.v1',
    releaseChannel: value.releaseChannel,
    caseId: item.caseId,
    role,
    reviewerId: review.reviewerId,
    decision: review.decision,
    reviewedAt: review.reviewedAt,
    targetHash: review.targetHash,
  });
}

function publicKeyFingerprint(publicKey) {
  try {
    return sha256(crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' }));
  } catch {
    return null;
  }
}

function reviewAttempted(review) {
  return review && Object.values(review).some(value => value !== null && value !== false && value !== '');
}

function validateReview({ value, item, review, role, trustedReviewers, now, issues }) {
  if (!reviewAttempted(review)) return { valid: false, reviewerId: null, keyFingerprint: null };
  const reviewerId = typeof review?.reviewerId === 'string' ? review.reviewerId.trim() : '';
  const reviewedAt = Date.parse(review?.reviewedAt);
  const registration = trustedReviewers[reviewerId];
  const expectedTargetHash = independentDomainReviewTargetHash(value, item);
  let valid = review?.decision === 'approved'
    && review?.independentFromBuild === true
    && reviewerId.length > 0
    && Number.isFinite(reviewedAt)
    && reviewedAt >= Date.parse(item?.blindedRun?.executedAt)
    && reviewedAt <= now
    && review?.targetHash === expectedTargetHash
    && typeof review?.signature === 'string'
    && review.signature.trim().length > 0
    && registration?.roles?.includes(role);
  if (valid) {
    try {
      valid = crypto.verify(
        null,
        Buffer.from(independentDomainReviewPayload(value, item, role, review)),
        registration.publicKey,
        Buffer.from(review.signature, 'base64'),
      );
    } catch {
      valid = false;
    }
  }
  if (!valid) issues.push(`review_signature_invalid:${item.caseId}:${role}`);
  return { valid, reviewerId: valid ? reviewerId : null, keyFingerprint: valid ? publicKeyFingerprint(registration.publicKey) : null };
}

export function validateIndependentDomainReviewKit(value, {
  trustedReviewers = parseTrustedIndependentReviewers(),
  now = Date.now(),
} = {}) {
  const issues = [];
  const v1 = value?.schema === 'nexyfab.independent-domain-review-kit.v1';
  const v2 = value?.schema === 'nexyfab.independent-domain-review-kit.v2';
  const v3 = value?.schema === 'nexyfab.independent-domain-review-kit.v3';
  if (!value || typeof value !== 'object' || (!v1 && !v2 && !v3)) {
    return { structurallyValid: false, releaseEligible: false, issues: ['kit_schema_invalid'], counts: {} };
  }
  const releaseChannel = v1 ? 'platform' : value.releaseChannel;
  const requiredDomains = RELEASE_CHANNEL_DOMAINS[releaseChannel];
  if (!requiredDomains) {
    return { structurallyValid: false, releaseEligible: false, issues: [`release_channel_invalid:${releaseChannel}`], counts: {} };
  }
  if ((v2 || v3) && !sameStringSet(value.requiredDomains, requiredDomains)) issues.push('required_domains_contract_mismatch');
  if (releaseChannel === 'mechanical-core' && requiredDomains.some(domain => domain !== 'mechanical')) {
    issues.push('mechanical_core_spatial_scope_leak');
  }

  const cases = Array.isArray(value.cases) ? value.cases : [];
  const ids = new Set();
  const sourceHashes = new Set();
  const lineageIds = new Set();
  const counts = Object.fromEntries(requiredDomains.map(domain => [domain, 0]));
  let acquired = 0;
  let approved = 0;
  let signedReviews = 0;
  for (const item of cases) {
    if (!item?.caseId || ids.has(item.caseId)) issues.push(`case_id_invalid:${item?.caseId ?? 'missing'}`);
    ids.add(item?.caseId);
    if (!requiredDomains.includes(item?.domain)) issues.push(`case_domain_out_of_release_scope:${item?.caseId ?? 'missing'}`);
    else {
      counts[item.domain] += 1;
      if (!sameStringSet(item?.requiredAxes, DOMAIN_AXES[item.domain])) {
        issues.push(`case_required_axes_invalid:${item?.caseId ?? 'missing'}`);
      }
    }

    const sourceHash = String(item?.source?.sourceSha256 ?? '');
    const lineageId = String(item?.source?.lineageId ?? '').trim();
    const sourceReady = /^[a-f0-9]{64}$/.test(sourceHash)
      && typeof item?.source?.organizationId === 'string'
      && item.source.organizationId.trim().length > 0
      && lineageId.length > 0
      && item?.source?.licenseDecision === 'approved'
      && item?.source?.independentOfTrainingAndReferenceCorpus === true
      && typeof item?.source?.acquisitionAttestation === 'string'
      && item.source.acquisitionAttestation.trim().length > 0;
    if (sourceReady) {
      acquired += 1;
      if (sourceHashes.has(sourceHash)) issues.push(`source_hash_reused:${item.caseId}`);
      if (lineageIds.has(lineageId)) issues.push(`source_lineage_reused:${item.caseId}`);
      sourceHashes.add(sourceHash);
      lineageIds.add(lineageId);
    }

    const reviews = [item?.reviews?.domainReviewer, item?.reviews?.independentReviewer];
    const validatedReviews = v3 ? [
      validateReview({ value, item, review: reviews[0], role: 'domain-reviewer', trustedReviewers, now, issues }),
      validateReview({ value, item, review: reviews[1], role: 'independent-reviewer', trustedReviewers, now, issues }),
    ] : [];
    const completeReviews = validatedReviews.filter(review => review.valid).length;
    signedReviews += completeReviews;
    const automaticReceipt = item?.blindedRun?.automaticValidationReceipt;
    const automaticReceiptReady = automaticReceipt?.schema === 'nexyfab.domain-automatic-validation.v1'
      && typeof automaticReceipt?.path === 'string'
      && automaticReceipt.path.trim().length > 0
      && !automaticReceipt.path.replaceAll('\\', '/').split('/').includes('..')
      && !automaticReceipt.path.startsWith('/')
      && !/^[A-Za-z]:[\\/]/.test(automaticReceipt.path)
      && /^[a-f0-9]{64}$/.test(String(automaticReceipt?.sha256));
    const blindedRunReady = item?.blindedRun?.inputSha256 === sourceHash
      && Array.isArray(item?.blindedRun?.outputArtifactHashes)
      && item.blindedRun.outputArtifactHashes.length > 0
      && item.blindedRun.outputArtifactHashes.every(hash => /^[a-f0-9]{64}$/.test(String(hash)))
      && automaticReceiptReady
      && Number.isFinite(Date.parse(item?.blindedRun?.executedAt));
    const genuinelyEligible = sourceReady
      && blindedRunReady
      && v3
      && completeReviews === 2
      && validatedReviews[0].reviewerId !== validatedReviews[1].reviewerId
      && validatedReviews[0].keyFingerprint !== null
      && validatedReviews[0].keyFingerprint !== validatedReviews[1].keyFingerprint;
    if (item?.releaseEligible === true && !genuinelyEligible) issues.push(`false_release_eligible:${item.caseId}`);
    if (item?.releaseEligible === true && genuinelyEligible) approved += 1;
  }

  for (const domain of requiredDomains) {
    if (counts[domain] !== 20) issues.push(`domain_case_count_invalid:${domain}:${counts[domain]}/20`);
  }
  const requiredCases = requiredDomains.length * 20;
  if (cases.length !== requiredCases) issues.push(`total_case_count_invalid:${cases.length}/${requiredCases}`);
  const expected = {
    requiredCases,
    acquiredCases: acquired,
    approvedCases: approved,
    requiredSignedReviews: requiredCases * 2,
    completedSignedReviews: signedReviews,
  };
  for (const [key, actual] of Object.entries(expected)) {
    if (value.summary?.[key] !== actual) issues.push(`summary_mismatch:${key}:${value.summary?.[key] ?? 'missing'}/${actual}`);
  }
  return {
    structurallyValid: issues.length === 0,
    releaseEligible: issues.length === 0 && approved === requiredCases,
    releaseChannel,
    requiredDomains,
    issues,
    counts,
    summary: expected,
  };
}

export function main(args = process.argv.slice(2)) {
  const structuralOnly = args.includes('--structural-only');
  const input = path.resolve(args.find(arg => !arg.startsWith('--')) ?? 'docs/evidence/release/independent-domain-review-kit-260810.json');
  try {
    const report = validateIndependentDomainReviewKit(JSON.parse(fs.readFileSync(input, 'utf8')));
    process.stdout.write(`${JSON.stringify({ input, validationMode: structuralOnly ? 'structural-only' : 'release-eligibility', ...report }, null, 2)}\n`);
    return structuralOnly ? (report.structurallyValid ? 0 : 1) : (report.releaseEligible ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
