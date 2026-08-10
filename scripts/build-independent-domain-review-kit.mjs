#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const domains = {
  mechanical: ['dimension', 'topology', 'assembly', 'STEP roundtrip', 'BOM'],
  building: ['spatial hierarchy', 'placement', 'IFC semantics', 'openings', 'quantity'],
  civil: ['alignment', 'profile', 'corridor', 'terrain', 'LandXML/IFC roundtrip'],
  landscape: ['terrain', 'grading', 'drainage', 'planting quantities', 'spatial clearance'],
  interior: ['space boundary', 'egress', 'door swing', 'MEP interference', 'quantity'],
};

const cases = Object.entries(domains).flatMap(([domain, axes]) => Array.from({ length: 20 }, (_, index) => ({
  caseId: `${domain}-independent-${String(index + 1).padStart(2, '0')}`,
  domain,
  status: 'source_required',
  requiredAxes: axes,
  source: {
    organizationId: null,
    lineageId: null,
    sourceSha256: null,
    licenseDecision: null,
    independentOfTrainingAndReferenceCorpus: null,
    acquisitionAttestation: null,
  },
  blindedRun: {
    inputSha256: null,
    outputArtifactHashes: [],
    automaticValidationReceipt: null,
    executedAt: null,
  },
  reviews: {
    domainReviewer: { reviewerId: null, decision: null, reviewedAt: null, signature: null },
    independentReviewer: { reviewerId: null, decision: null, reviewedAt: null, signature: null },
    disagreementResolution: null,
  },
  releaseEligible: false,
})));

const artifact = {
  schema: 'nexyfab.independent-domain-review-kit.v1',
  generatedAt: new Date().toISOString(),
  policy: {
    casesPerDomain: 20,
    independentReviewersPerCase: 2,
    sourceMayNotComeFromSyntheticLane: true,
    sourceMayNotComeFromReferenceLane: true,
    reviewerMayNotBeReplacedByAi: true,
    signedDecisionRequired: true,
    sourceOrArtifactMutationInvalidatesReview: true,
  },
  summary: {
    requiredCases: cases.length,
    acquiredCases: 0,
    approvedCases: 0,
    requiredSignedReviews: cases.length * 2,
    completedSignedReviews: 0,
  },
  cases,
};

const output = path.resolve(process.env.INDEPENDENT_REVIEW_KIT_OUTPUT ?? 'docs/evidence/release/independent-domain-review-kit-260810.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, output, ...artifact.summary })}\n`);
