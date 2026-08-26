#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMMERCIAL_DOMAINS,
  COMMERCIAL_SYNTHETIC_REQUIRED_AXES,
} from './build-commercial-synthetic-campaign-receipt.mjs';
import { validateCase } from './domain-accuracy-validator.mjs';

function option(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = args.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label}_invalid`);
  return parsed;
}

function selectedDomains(value) {
  const domains = value ? value.split(',').map(item => item.trim()).filter(Boolean) : [...COMMERCIAL_DOMAINS];
  if (!domains.length || new Set(domains).size !== domains.length
    || domains.some(domain => !COMMERCIAL_DOMAINS.includes(domain))) {
    throw new Error('domains_invalid');
  }
  return domains;
}

function outputInsideRoot(root, value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}_missing`);
  const resolvedRoot = path.resolve(root);
  const output = path.resolve(resolvedRoot, value);
  const relative = path.relative(resolvedRoot, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label}_outside_root`);
  return output;
}

function syntheticCaseFromCorpus(item) {
  return {
    schema: 'nexyfab.commercial-synthetic-campaign-case.v1',
    caseId: item.caseId,
    domain: item.domain,
    sourceHash: item.sourceHash,
    split: 'synthetic',
    templateId: item.templateId,
    parameters: item.parameters,
    artifactHash: item.artifactHash,
    artifactSummary: item.artifactSummary,
    syntheticRequiredAxes: [...COMMERCIAL_SYNTHETIC_REQUIRED_AXES],
  };
}

function exactPassingObservation(run) {
  const axes = run?.assertions?.map(assertion => assertion?.axis);
  return run?.requiredGatesPassed === true
    && run?.falseVerified === false
    && run?.falseClear === false
    && run?.destructivePartMerge === false
    && JSON.stringify(axes) === JSON.stringify(COMMERCIAL_SYNTHETIC_REQUIRED_AXES)
    && run.assertions.every(assertion => assertion?.status === 'pass'
      && typeof assertion?.reason === 'string'
      && assertion.reason.trim());
}

/**
 * Executes the synthetic template-rebuild campaign and retains every raw axis
 * assertion. This is regression evidence only; it intentionally cannot claim
 * independent holdout accuracy, native-CAD interoperability, or certification.
 */
export async function runCommercialSyntheticCampaign({
  corpus,
  domains = COMMERCIAL_DOMAINS,
  casesPerDomain = 20,
  campaigns = 3,
  repeats = 5,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (corpus?.schema !== 'nexyfab.commercial-validation-corpus.v1') throw new Error('corpus_schema_invalid');
  const selected = selectedDomains(domains.join(','));
  const caseCount = positiveInteger(casesPerDomain, 'cases_per_domain');
  const campaignCount = positiveInteger(campaigns, 'campaigns');
  const repeatCount = positiveInteger(repeats, 'repeats');
  const corpusCases = Array.isArray(corpus?.lanes?.synthetic?.cases) ? corpus.lanes.synthetic.cases : [];
  const sourceCases = [];
  const results = [];
  const summary = {};

  for (const domain of selected) {
    const domainCases = corpusCases.filter(item => item?.domain === domain).slice(0, caseCount);
    if (domainCases.length !== caseCount) throw new Error(`corpus_cases_below_required:${domain}:${domainCases.length}/${caseCount}`);
    for (const corpusCase of domainCases) {
      const caseValue = syntheticCaseFromCorpus(corpusCase);
      sourceCases.push(caseValue);
      for (let campaign = 1; campaign <= campaignCount; campaign++) {
        for (let repeat = 1; repeat <= repeatCount; repeat++) {
          const observation = await validateCase(corpusCase, {
            caseValue,
            campaign,
            repeat,
            attempt: 1,
          }, { subject: 'rebuild' });
          if (!exactPassingObservation(observation)) {
            throw new Error(`synthetic_campaign_observation_failed:${domain}:${caseValue.caseId}:${campaign}:${repeat}`);
          }
          results.push({
            schema: 'nexyfab.commercial-synthetic-campaign-run.v1',
            subject: 'template_rebuild',
            ...observation,
          });
        }
      }
    }
    summary[domain] = {
      cases: domainCases.length,
      campaigns: campaignCount,
      repeats: repeatCount,
      runs: domainCases.length * campaignCount * repeatCount,
    };
  }

  return {
    sourceBundle: {
      schema: 'nexyfab.commercial-synthetic-campaign-source.v1',
      generatedAt,
      claimBoundary: {
        syntheticRegressionOnly: true,
        independentHoldout: false,
      },
      cases: sourceCases,
    },
    resultBundle: {
      schema: 'nexyfab.commercial-synthetic-campaign-results.v1',
      generatedAt,
      execution: {
        subject: 'template_rebuild',
        requiredAxes: [...COMMERCIAL_SYNTHETIC_REQUIRED_AXES],
        campaigns: campaignCount,
        repeats: repeatCount,
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      claimBoundary: {
        syntheticRegressionOnly: true,
        certifiesCommercialAccuracy: false,
        substitutesForIndependentHoldout: false,
      },
      results,
      summary,
    },
  };
}

function atomicJson(output, value) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, output);
}

export async function main(args = process.argv.slice(2)) {
  const root = path.resolve(option(args, 'root', process.cwd()));
  const corpusPath = path.resolve(root, option(args, 'corpus', 'docs/evidence/release/commercial-validation-corpus-260810.json'));
  const relativeCorpus = path.relative(root, corpusPath);
  if (!relativeCorpus || relativeCorpus.startsWith('..') || path.isAbsolute(relativeCorpus)) throw new Error('corpus_path_outside_root');
  const sourceOutput = outputInsideRoot(root, option(args, 'source-out'), 'source_output');
  const resultsOutput = outputInsideRoot(root, option(args, 'results-out'), 'results_output');
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const observation = await runCommercialSyntheticCampaign({
    corpus,
    domains: selectedDomains(option(args, 'domains')),
    casesPerDomain: positiveInteger(option(args, 'cases-per-domain', '20'), 'cases_per_domain'),
    campaigns: positiveInteger(option(args, 'campaigns', '3'), 'campaigns'),
    repeats: positiveInteger(option(args, 'repeats', '5'), 'repeats'),
    generatedAt: option(args, 'generated-at', new Date().toISOString()),
  });
  atomicJson(sourceOutput, observation.sourceBundle);
  atomicJson(resultsOutput, observation.resultBundle);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    sourceOutput,
    resultsOutput,
    cases: observation.sourceBundle.cases.length,
    runs: observation.resultBundle.results.length,
    summary: observation.resultBundle.summary,
    claimBoundary: observation.resultBundle.claimBoundary,
  })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`[commercial-synthetic-campaign] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
