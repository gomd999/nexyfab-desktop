#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_DOMAINS = ['mechanical', 'building', 'civil', 'landscape', 'interior'];
export const REQUIRED_DOMAIN_AXES = {
  mechanical: ['dimension', 'topology', 'assembly', 'motion', 'collision clearance', 'STEP roundtrip', 'drawing', 'BOM', 'manufacturing'],
  building: ['spatial hierarchy', 'placement', 'IFC semantics', 'openings', 'quantity'],
  civil: ['alignment', 'profile', 'corridor', 'terrain', 'LandXML/IFC roundtrip'],
  landscape: ['terrain', 'grading', 'drainage', 'planting quantities', 'spatial clearance'],
  interior: ['space boundary', 'egress', 'door swing', 'MEP interference', 'quantity'],
};

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === actual.length
    && [...actual].sort().join('\0') === [...expected].sort().join('\0');
}

export function validateIndependentDomainReviewKit(value) {
  const issues = [];
  if (!value || typeof value !== 'object' || value.schema !== 'nexyfab.independent-domain-review-kit.v1') {
    return { structurallyValid: false, releaseEligible: false, issues: ['kit_schema_invalid'], counts: {} };
  }
  const cases = Array.isArray(value.cases) ? value.cases : [];
  const ids = new Set();
  const counts = Object.fromEntries(REQUIRED_DOMAINS.map(domain => [domain, 0]));
  let acquired = 0;
  let approved = 0;
  let signedReviews = 0;
  for (const item of cases) {
    if (!item?.caseId || ids.has(item.caseId)) issues.push(`case_id_invalid:${item?.caseId ?? 'missing'}`);
    ids.add(item?.caseId);
    if (!REQUIRED_DOMAINS.includes(item?.domain)) issues.push(`case_domain_invalid:${item?.caseId ?? 'missing'}`);
    else {
      counts[item.domain] += 1;
      if (!sameStringSet(item?.requiredAxes, REQUIRED_DOMAIN_AXES[item.domain])) {
        issues.push(`case_required_axes_invalid:${item?.caseId ?? 'missing'}`);
      }
    }
    const sourceReady = /^[a-f0-9]{64}$/.test(String(item?.source?.sourceSha256 ?? ''))
      && item?.source?.licenseDecision === 'approved'
      && item?.source?.independentOfTrainingAndReferenceCorpus === true
      && typeof item?.source?.acquisitionAttestation === 'string'
      && item.source.acquisitionAttestation.trim().length > 0;
    if (sourceReady) acquired += 1;
    const reviews = [item?.reviews?.domainReviewer, item?.reviews?.independentReviewer];
    const completeReviews = reviews.filter(review => review?.decision === 'approved'
      && typeof review?.reviewerId === 'string' && review.reviewerId.trim()
      && typeof review?.signature === 'string' && review.signature.trim()
      && Number.isFinite(Date.parse(review?.reviewedAt))).length;
    signedReviews += completeReviews;
    const genuinelyEligible = sourceReady
      && /^[a-f0-9]{64}$/.test(String(item?.blindedRun?.inputSha256 ?? ''))
      && Array.isArray(item?.blindedRun?.outputArtifactHashes)
      && item.blindedRun.outputArtifactHashes.length > 0
      && item.blindedRun.outputArtifactHashes.every(hash => /^[a-f0-9]{64}$/.test(String(hash)))
      && completeReviews === 2
      && reviews[0].reviewerId !== reviews[1].reviewerId;
    if (genuinelyEligible) approved += 1;
    if (item?.releaseEligible === true && !genuinelyEligible) issues.push(`false_release_eligible:${item.caseId}`);
  }
  for (const domain of REQUIRED_DOMAINS) {
    if (counts[domain] < 20) issues.push(`domain_shortfall:${domain}:${counts[domain]}/20`);
  }
  if (cases.length < 100) issues.push(`total_shortfall:${cases.length}/100`);
  const expected = { requiredCases: cases.length, acquiredCases: acquired, approvedCases: approved, requiredSignedReviews: cases.length * 2, completedSignedReviews: signedReviews };
  for (const [key, actual] of Object.entries(expected)) {
    if (value.summary?.[key] !== actual) issues.push(`summary_mismatch:${key}:${value.summary?.[key] ?? 'missing'}/${actual}`);
  }
  return {
    structurallyValid: issues.length === 0,
    releaseEligible: issues.length === 0 && REQUIRED_DOMAINS.every(domain => counts[domain] >= 20) && approved >= 100,
    issues,
    counts,
    summary: expected,
  };
}

export function main(args = process.argv.slice(2)) {
  const input = path.resolve(args[0] ?? 'docs/evidence/release/independent-domain-review-kit-260810.json');
  try {
    const report = validateIndependentDomainReviewKit(JSON.parse(fs.readFileSync(input, 'utf8')));
    process.stdout.write(`${JSON.stringify({ input, ...report }, null, 2)}\n`);
    return report.structurallyValid ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
