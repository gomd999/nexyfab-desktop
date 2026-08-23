#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOMAIN_AXES = Object.freeze({
  mechanical: ['dimension', 'topology', 'assembly', 'motion', 'collision clearance', 'STEP roundtrip', 'drawing', 'BOM', 'manufacturing'],
  building: ['spatial hierarchy', 'placement', 'IFC semantics', 'openings', 'quantity'],
  civil: ['alignment', 'profile', 'corridor', 'terrain', 'LandXML/IFC roundtrip'],
  landscape: ['terrain', 'grading', 'drainage', 'planting quantities', 'spatial clearance'],
  interior: ['space boundary', 'egress', 'door swing', 'MEP interference', 'quantity'],
});

export const RELEASE_CHANNEL_DOMAINS = Object.freeze({
  'mechanical-core': ['mechanical'],
  'complex-mechanical': ['mechanical'],
  'verified-building': ['building'],
  'verified-interior': ['interior'],
  'verified-civil': ['civil'],
  'verified-landscape': ['landscape'],
  'spatial-labs': ['building', 'civil', 'landscape', 'interior'],
  platform: Object.keys(DOMAIN_AXES),
});

function option(args, name, fallback) {
  const prefix = `--${name}=`;
  const found = args.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function buildIndependentDomainReviewKit({
  releaseChannel = 'platform',
  generatedAt = new Date().toISOString(),
} = {}) {
  const requiredDomains = RELEASE_CHANNEL_DOMAINS[releaseChannel];
  if (!requiredDomains) throw new Error(`INDEPENDENT_REVIEW_RELEASE_CHANNEL_INVALID:${releaseChannel}`);
  const cases = requiredDomains.flatMap(domain => Array.from({ length: 20 }, (_, index) => ({
    caseId: `${domain}-independent-${String(index + 1).padStart(2, '0')}`,
    domain,
    status: 'source_required',
    requiredAxes: DOMAIN_AXES[domain],
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
      automaticValidationReceipt: { schema: null, path: null, sha256: null },
      executedAt: null,
    },
    reviews: {
      domainReviewer: { reviewerId: null, independentFromBuild: null, decision: null, reviewedAt: null, targetHash: null, signature: null },
      independentReviewer: { reviewerId: null, independentFromBuild: null, decision: null, reviewedAt: null, targetHash: null, signature: null },
      disagreementResolution: null,
    },
    releaseEligible: false,
  })));

  return {
    schema: 'nexyfab.independent-domain-review-kit.v3',
    generatedAt,
    releaseChannel,
    requiredDomains,
    policy: {
      casesPerDomain: 20,
      independentReviewersPerCase: 2,
      sourceMayNotComeFromSyntheticLane: true,
      sourceMayNotComeFromReferenceLane: true,
      reviewerMayNotBeReplacedByAi: true,
      signedDecisionRequired: true,
      cryptographicSignatureRequired: true,
      trustedReviewerRegistryRequired: true,
      sourceOrArtifactMutationInvalidatesReview: true,
      spatialEvidenceMaySatisfyMechanicalCore: false,
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
}

export function main(args = process.argv.slice(2)) {
  const releaseChannel = option(args, 'channel', process.env.NEXYFAB_RELEASE_CHANNEL ?? 'platform');
  const artifact = buildIndependentDomainReviewKit({ releaseChannel });
  const defaultName = releaseChannel === 'platform'
    ? 'docs/evidence/release/independent-domain-review-kit-260810.json'
    : `docs/evidence/release/${releaseChannel}-independent-domain-review-kit.json`;
  const output = path.resolve(option(args, 'out', process.env.INDEPENDENT_REVIEW_KIT_OUTPUT ?? defaultName));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, output, releaseChannel, requiredDomains: artifact.requiredDomains, ...artifact.summary })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
