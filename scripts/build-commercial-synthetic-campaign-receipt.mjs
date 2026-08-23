#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMMERCIAL_SYNTHETIC_CAMPAIGN_RECEIPT_SCHEMA =
  'nexyfab.commercial-synthetic-campaign-receipt.v2';
export const COMMERCIAL_DOMAINS = Object.freeze([
  'mechanical',
  'building',
  'civil',
  'landscape',
  'interior',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const MAX_AGE_MS = 24 * 60 * 60_000;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(
    Buffer.isBuffer(value) ? value : canonicalJson(value),
  ).digest('hex');
}

function withReceiptSha256(unsigned) {
  return { ...unsigned, receiptSha256: sha256(unsigned) };
}

function option(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = args.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function optionList(args, names) {
  const values = [];
  for (const name of names) {
    for (let index = 0; index < args.length; index++) {
      const value = args[index];
      if (value === `--${name}` && args[index + 1]) values.push(args[++index]);
      else if (value?.startsWith(`--${name}=`)) values.push(value.slice(name.length + 3));
    }
  }
  return values.flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
}

function relativeFile(root, input, label) {
  if (typeof input !== 'string' || !input.trim()) throw new Error(`${label}_path_missing`);
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, input);
  const relative = path.relative(resolvedRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label}_path_outside_root`);
  }
  const lexical = relative.replaceAll('\\', '/');
  const linkStat = fs.lstatSync(absolute);
  if (linkStat.isSymbolicLink()) throw new Error(`${label}_symlink_rejected`);
  const realRoot = fs.realpathSync.native(resolvedRoot);
  const realFile = fs.realpathSync.native(absolute);
  const realRelative = path.relative(realRoot, realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`${label}_symlink_rejected`);
  }
  const stat = fs.statSync(realFile);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`${label}_not_a_file`);
  const bytes = fs.readFileSync(realFile);
  return {
    path: lexical,
    bytes: bytes.length,
    sha256: sha256(bytes),
    bytesValue: bytes,
  };
}

function parseJson(binding, label) {
  try {
    return JSON.parse(binding.bytesValue.toString('utf8'));
  } catch (error) {
    throw new Error(`${label}_json_invalid:${error instanceof Error ? error.message : String(error)}`);
  }
}

function recordsIn(value, keys, label) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') throw new Error(`${label}_records_missing`);
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  const grouped = Object.values(value).filter(item => Array.isArray(item));
  if (grouped.length && grouped.length === Object.keys(value).length) return grouped.flat();
  throw new Error(`${label}_records_missing`);
}

function pathsFrom(input, names) {
  for (const name of names) {
    const value = input?.[name];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
  }
  return [];
}

function assertFresh(generatedAt, now) {
  if (typeof generatedAt !== 'string') throw new Error('generated_at_missing');
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - MAX_AGE_MS) {
    throw new Error('generated_at_not_fresh');
  }
}

function assertRelease(release) {
  const gitHead = release?.head ?? release?.gitHead;
  if (typeof release?.buildId !== 'string' || !release.buildId.trim()) {
    throw new Error('release_build_id_missing');
  }
  if (typeof release?.deploymentId !== 'string' || !release.deploymentId.trim()) {
    throw new Error('release_deployment_id_missing');
  }
  if (!GIT_HEAD.test(String(gitHead ?? ''))) throw new Error('release_git_head_invalid');
  return { buildId: release.buildId, deploymentId: release.deploymentId, gitHead };
}

function assertDomains(requiredDomains) {
  if (!Array.isArray(requiredDomains) || !requiredDomains.length
    || new Set(requiredDomains).size !== requiredDomains.length
    || requiredDomains.some(domain => !COMMERCIAL_DOMAINS.includes(domain))) {
    throw new Error('required_domains_invalid');
  }
  return [...requiredDomains];
}

function assertBindingUniqueness(bindings) {
  const paths = new Set();
  const hashes = new Set();
  for (const binding of bindings) {
    if (paths.has(binding.path)) throw new Error('source_binding_path_duplicate');
    if (hashes.has(`${binding.bytes}:${binding.sha256}`)) throw new Error('source_binding_duplicate');
    paths.add(binding.path);
    hashes.add(`${binding.bytes}:${binding.sha256}`);
  }
}

function indexCases(cases, domains) {
  const byDomain = Object.fromEntries(domains.map(domain => [domain, new Map()]));
  for (const item of cases) {
    if (!item || typeof item !== 'object' || typeof item.caseId !== 'string' || !item.caseId.trim()) {
      throw new Error('source_case_invalid');
    }
    if (!domains.includes(item.domain)) throw new Error(`source_case_domain_invalid:${item.caseId}`);
    if (!SHA256.test(String(item.sourceHash ?? ''))) throw new Error(`source_case_hash_invalid:${item.caseId}`);
    const map = byDomain[item.domain];
    if (map.has(item.caseId)) throw new Error(`source_case_duplicate:${item.domain}:${item.caseId}`);
    map.set(item.caseId, item);
  }
  if (Object.values(byDomain).some(map => map.size < 20)) throw new Error('source_cases_below_minimum');
  return byDomain;
}

function assertCasesMatchCorpus(casesByDomain, corpus, domains) {
  const corpusCases = recordsIn(corpus?.lanes?.synthetic, ['cases'], 'corpus_synthetic');
  const corpusByDomain = indexCases(corpusCases.filter(item => domains.includes(item?.domain)), domains);
  for (const domain of domains) {
    const sourceCases = casesByDomain[domain];
    const boundCorpusCases = corpusByDomain[domain];
    if (sourceCases.size !== boundCorpusCases.size) throw new Error(`source_corpus_case_set_mismatch:${domain}`);
    for (const [caseId, sourceCase] of sourceCases) {
      const corpusCase = boundCorpusCases.get(caseId);
      if (!corpusCase || corpusCase.sourceHash !== sourceCase.sourceHash) {
        throw new Error(`source_corpus_case_mismatch:${domain}:${caseId}`);
      }
    }
  }
}

function deriveDomain(domain, cases, runs) {
  const runsByCase = new Map([...cases.keys()].map(caseId => [caseId, []]));
  const runKeys = new Set();
  for (const run of runs) {
    if (!run || typeof run !== 'object' || run.domain !== domain || typeof run.caseId !== 'string') {
      throw new Error(`campaign_run_invalid:${domain}`);
    }
    if (!cases.has(run.caseId)) throw new Error(`campaign_run_case_unknown:${domain}:${run.caseId}`);
    if (!Number.isSafeInteger(run.campaign) || run.campaign < 1
      || !Number.isSafeInteger(run.repeat) || run.repeat < 1) {
      throw new Error(`campaign_run_index_invalid:${domain}:${run.caseId}`);
    }
    if (run.usedForTuning !== false || typeof run.requiredGatesPassed !== 'boolean') {
      throw new Error(`campaign_run_contract_invalid:${domain}:${run.caseId}`);
    }
    if (!SHA256.test(String(run.sourceHash ?? '')) || run.sourceHash !== cases.get(run.caseId).sourceHash) {
      throw new Error(`campaign_run_source_mismatch:${domain}:${run.caseId}`);
    }
    const key = `${run.caseId}:${run.campaign}:${run.repeat}`;
    if (runKeys.has(key)) throw new Error(`campaign_run_duplicate:${domain}:${key}`);
    runKeys.add(key);
    runsByCase.get(run.caseId).push(run);
  }
  if ([...runsByCase.values()].some(items => items.length === 0)) throw new Error(`campaign_case_unmeasured:${domain}`);

  const sets = [...runsByCase.entries()].map(([caseId, items]) => {
    const campaigns = [...new Set(items.map(item => item.campaign))].sort((a, b) => a - b);
    const repeatsByCampaign = new Map(campaigns.map(campaign => [
      campaign,
      [...new Set(items.filter(item => item.campaign === campaign).map(item => item.repeat))].sort((a, b) => a - b),
    ]));
    return { caseId, campaigns, repeatsByCampaign };
  });
  const first = sets[0];
  const expectedCampaigns = first.campaigns;
  const expectedRepeats = first.repeatsByCampaign.get(expectedCampaigns[0]);
  if (!expectedRepeats?.length || expectedCampaigns.some(campaign => {
    const repeats = first.repeatsByCampaign.get(campaign);
    return !repeats || repeats.length !== expectedRepeats.length
      || repeats.some((value, repeatIndex) => value !== expectedRepeats[repeatIndex]);
  })) throw new Error(`campaign_repeat_shape_invalid:${domain}`);
  for (const item of sets) {
    if (item.campaigns.length !== expectedCampaigns.length
      || item.campaigns.some((value, index) => value !== expectedCampaigns[index])) {
      throw new Error(`campaign_shape_inconsistent:${domain}:${item.caseId}`);
    }
    for (const campaign of expectedCampaigns) {
      const repeats = item.repeatsByCampaign.get(campaign);
      if (!repeats || repeats.length !== expectedRepeats.length
        || repeats.some((value, index) => value !== expectedRepeats[index])) {
        throw new Error(`repeat_shape_inconsistent:${domain}:${item.caseId}:${campaign}`);
      }
    }
  }
  const expectedRuns = cases.size * expectedCampaigns.length * expectedRepeats.length;
  if (runs.length !== expectedRuns) throw new Error(`run_aggregate_inconsistent:${domain}`);
  const gatePasses = runs.filter(run => run.requiredGatesPassed).length;
  if (gatePasses !== runs.length) throw new Error(`gate_pass_aggregate_inconsistent:${domain}`);
  return {
    cases: cases.size,
    campaigns: expectedCampaigns.length,
    repeats: expectedRepeats.length,
    runs: runs.length,
    gatePasses,
  };
}

/**
 * Build a release receipt exclusively from the bytes on disk and complete
 * campaign records. Summary/count fields are deliberately never accepted as
 * input; every aggregate in the result is derived from source and run JSON.
 */
export function buildCommercialSyntheticCampaignReceipt({
  campaignResultPaths,
  campaignResultPath,
  campaignResultFiles,
  resultPath,
  sourcePaths,
  sourcePath,
  sourceJsonPaths,
  sourceFiles,
  campaignResults,
  sourceCases,
  corpusPath,
  corpusFile,
  commercialValidationCorpusPath,
  corpusBytes,
  release,
  generatedAt = new Date().toISOString(),
  now = Date.now(),
  root = process.cwd(),
  requiredDomains = COMMERCIAL_DOMAINS,
} = {}) {
  const domains = assertDomains(requiredDomains);
  const resultPaths = campaignResultPaths ?? campaignResultFiles ?? (campaignResultPath ?? resultPath ? [campaignResultPath ?? resultPath] : undefined)
    ?? pathsFrom({ campaignResults }, ['campaignResults']);
  const sourceJsonInputPaths = sourcePaths ?? sourceJsonPaths ?? sourceFiles ?? (sourcePath ? [sourcePath] : undefined)
    ?? pathsFrom({ sourceCases }, ['sourceCases']);
  if (!Array.isArray(resultPaths) || !resultPaths.length) throw new Error('campaign_result_paths_missing');
  if (!Array.isArray(sourceJsonInputPaths) || !sourceJsonInputPaths.length) throw new Error('source_paths_missing');
  const corpusInputPath = corpusPath ?? corpusFile ?? commercialValidationCorpusPath;
  if (typeof corpusInputPath !== 'string' || !corpusInputPath.trim()) throw new Error('corpus_path_missing');
  assertFresh(generatedAt, now);
  const releaseBinding = assertRelease(release);
  const resultBindings = resultPaths.map(file => relativeFile(root, file, 'campaign_result'));
  const sourceBindings = sourceJsonInputPaths.map(file => relativeFile(root, file, 'source'));
  const corpusBinding = relativeFile(root, corpusInputPath, 'corpus');
  assertBindingUniqueness([...resultBindings, ...sourceBindings, corpusBinding]);
  if (corpusBytes !== undefined
    && !Buffer.from(corpusBytes).equals(corpusBinding.bytesValue)) throw new Error('corpus_bytes_mismatch');
  const corpus = parseJson(corpusBinding, 'corpus');
  if (corpus?.schema !== 'nexyfab.commercial-validation-corpus.v1') throw new Error('corpus_schema_invalid');

  const cases = sourceBindings.flatMap(binding => recordsIn(parseJson(binding, 'source'), ['cases', 'sourceCases', 'items'], 'source'));
  const runs = resultBindings.flatMap(binding => recordsIn(parseJson(binding, 'campaign_result'), ['results', 'runs', 'campaignResults', 'items'], 'campaign_result'));
  const casesByDomain = indexCases(cases, domains);
  assertCasesMatchCorpus(casesByDomain, corpus, domains);
  const runsByDomain = Object.fromEntries(domains.map(domain => [domain, []]));
  for (const run of runs) {
    if (!run || typeof run !== 'object' || !domains.includes(run.domain)) throw new Error('campaign_result_domain_invalid');
    runsByDomain[run.domain].push(run);
  }
  const domainRows = Object.fromEntries(domains.map(domain => [
    domain,
    deriveDomain(domain, casesByDomain[domain], runsByDomain[domain]),
  ]));
  const totalRuns = domains.reduce((sum, domain) => sum + domainRows[domain].runs, 0);
  const totalGatePasses = domains.reduce((sum, domain) => sum + domainRows[domain].gatePasses, 0);
  const unsigned = {
    schema: COMMERCIAL_SYNTHETIC_CAMPAIGN_RECEIPT_SCHEMA,
    generatedAt,
    ok: true,
    certificationEvidence: false,
    release: releaseBinding,
    inputs: {
      campaignResults: resultBindings.map(binding => binding.path).sort(),
      sourceCases: sourceBindings.map(binding => binding.path).sort(),
    },
    sourceBindings: [...resultBindings, ...sourceBindings]
      .map(binding => Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'bytesValue')))
      .sort((left, right) => left.path.localeCompare(right.path)),
    corpus: Object.fromEntries(Object.entries(corpusBinding).filter(([key]) => key !== 'bytesValue')),
    domains: domainRows,
    totalRuns,
    totalGatePasses,
  };
  return withReceiptSha256(unsigned);
}

// Short alias for callers that keep the release evidence builders behind a
// generic synthetic-campaign interface.
export const buildSyntheticCampaignReceipt = buildCommercialSyntheticCampaignReceipt;

export function verifyCommercialSyntheticCampaignReceiptDerivation(receipt, {
  root = process.cwd(),
  now = Date.now(),
} = {}) {
  try {
    const campaignResultPaths = receipt?.inputs?.campaignResults;
    const sourcePaths = receipt?.inputs?.sourceCases;
    const corpusPath = receipt?.corpus?.path;
    const requiredDomains = receipt?.domains && typeof receipt.domains === 'object' && !Array.isArray(receipt.domains)
      ? Object.keys(receipt.domains)
      : [];
    if (!Array.isArray(campaignResultPaths) || !campaignResultPaths.length
      || !Array.isArray(sourcePaths) || !sourcePaths.length
      || campaignResultPaths.some(item => typeof item !== 'string' || !item)
      || sourcePaths.some(item => typeof item !== 'string' || !item)) return false;
    const rebuilt = buildCommercialSyntheticCampaignReceipt({
      campaignResultPaths,
      sourcePaths,
      corpusPath,
      release: receipt.release,
      generatedAt: receipt.generatedAt,
      now,
      root,
      requiredDomains,
    });
    return canonicalJson(rebuilt) === canonicalJson(receipt);
  } catch {
    return false;
  }
}

export function main(args = process.argv.slice(2)) {
  const root = path.resolve(option(args, 'root', process.cwd()));
  const resultPaths = optionList(args, ['campaign-result', 'campaign-results', 'results']);
  const sourcePaths = optionList(args, ['source', 'source-json', 'source-case']);
  const corpusPath = option(args, 'corpus');
  const out = option(args, 'out');
  const release = {
    buildId: option(args, 'build-id'),
    deploymentId: option(args, 'deployment-id'),
    head: option(args, 'git-head'),
  };
  const receipt = buildCommercialSyntheticCampaignReceipt({
    campaignResultPaths: resultPaths,
    sourcePaths,
    corpusPath,
    release,
    generatedAt: option(args, 'generated-at', new Date().toISOString()),
    root,
  });
  if (!out) throw new Error('output_path_missing');
  const output = path.resolve(root, out);
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, output, totalRuns: receipt.totalRuns })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    process.stderr.write(`[commercial-synthetic-campaign-receipt] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
