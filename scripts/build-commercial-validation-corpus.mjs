#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDomainCandidates } from './build-domain-accuracy-candidates.mjs';

export const COMMERCIAL_DOMAINS = ['mechanical', 'building', 'civil', 'landscape', 'interior'];

const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function buildCommercialValidationCorpus({ countPerDomain = 20, referenceManifest, referencePath }) {
  if (!Number.isSafeInteger(countPerDomain) || countPerDomain < 20) {
    throw new Error('countPerDomain must be an integer >= 20');
  }
  const syntheticCases = COMMERCIAL_DOMAINS.flatMap(domain => buildDomainCandidates(domain, countPerDomain));
  const referenceApproved = referenceManifest.policy?.commercialScoreRequiresApproval === false;
  const independent = Object.fromEntries(COMMERCIAL_DOMAINS.map(domain => [domain, {
    requiredCases: 20,
    approvedCases: 0,
    requiredIndependentReviewers: 2,
    independentReviewers: 0,
    releaseEligible: false,
    blockers: ['approved_independent_holdout_required', 'two_independent_reviewers_required'],
  }]));
  return {
    schema: 'nexyfab.commercial-validation-corpus.v1',
    generatedAt: new Date().toISOString(),
    policy: {
      lanesAreMutuallyExclusive: true,
      syntheticMayCertifyCommercialAccuracy: false,
      referenceMayCertifyCommercialAccuracy: referenceApproved,
      independentHoldoutRequiredForGA: true,
      trainingFromReferenceAllowed: referenceManifest.policy?.trainingUseAllowed === true,
    },
    lanes: {
      synthetic: {
        purpose: ['development', 'regression', 'failure_reproduction', 'performance'],
        cases: syntheticCases,
        summary: {
          total: syntheticCases.length,
          byDomain: Object.fromEntries(COMMERCIAL_DOMAINS.map(domain => [domain, syntheticCases.filter(item => item.domain === domain).length])),
        },
      },
      reference: {
        purpose: ['format_coverage', 'complexity_probe', 'internal_regression'],
        sourceManifest: referencePath,
        sourceManifestSha256: referenceManifest.__sha256 ?? null,
        sourceReadOnly: referenceManifest.policy?.sourceReadOnly === true,
        localEvaluationOnlyUntilLicenseReview: referenceManifest.policy?.localEvaluationOnlyUntilLicenseReview !== false,
        summary: referenceManifest.summary,
      },
      independentHoldout: {
        purpose: ['commercial_accuracy_claim', 'expert_review', 'ga_release_gate'],
        domains: independent,
      },
    },
    decision: 'development_and_private_evaluation_ready_ga_blocked',
  };
}

function valueAfter(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

async function main() {
  const referencePath = path.resolve(valueAfter('--reference', 'docs/evidence/cad-independent/reference-utilization-manifest-260809.json'));
  const output = path.resolve(valueAfter('--out', 'docs/evidence/release/commercial-validation-corpus-260810.json'));
  const countPerDomain = Number(valueAfter('--count-per-domain', '20'));
  const referenceManifest = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
  referenceManifest.__sha256 = hashFile(referencePath);
  const result = buildCommercialValidationCorpus({
    countPerDomain,
    referenceManifest,
    referencePath: path.relative(process.cwd(), referencePath).replaceAll('\\', '/'),
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    output,
    decision: result.decision,
    synthetic: result.lanes.synthetic.summary,
    reference: result.lanes.reference.summary,
    independentHoldout: result.lanes.independentHoldout.domains,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`[commercial-validation-corpus] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
