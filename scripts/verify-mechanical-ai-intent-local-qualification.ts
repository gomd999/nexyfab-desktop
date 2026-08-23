#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORPUS_SCHEMA = 'nexyfab.mechanical-ai-intent-corpus.v1';
const RESULTS_SCHEMA = 'nexyfab.mechanical-ai-intent-local-results.v1';
const RECEIPT_SCHEMA = 'nexyfab.mechanical-ai-intent-local-qualification-receipt.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const CATEGORIES = [
  'ko_practical',
  'en_practical',
  'mixed_units',
  'missing_required',
  'contradictory_or_unmanufacturable',
] as const;
const FEATURES = [
  'hole', 'fillet', 'chamfer', 'shell', 'rib', 'linearPattern', 'circularPattern', 'draft', 'scale', 'moveCopy',
  'variableFillet', 'offsetFace', 'thread', 'helix', 'bend', 'flange', 'hem', 'jog', 'tab', 'cut',
  'bendRelief', 'cornerRelief', 'variableShell', 'sketchExtrude', 'revolve', 'sweep', 'loft', 'mirror', 'boolean', 'splitBody',
] as const;
const SOURCE_PATHS = [
  'scripts/mechanical-ai-intent-local-qualification.ts',
  'src/lib/ai/guidedDesignBrief.ts',
  'src/lib/ai/aiCanonicalCandidate.ts',
  'src/lib/ai/mechanicalCoreFeatureContract.ts',
] as const;

interface VerifyOptions {
  repositoryRoot?: string;
}

export interface MechanicalAiIntentVerification {
  ok: boolean;
  input: string;
  checkedCases: number;
  issues: string[];
  remainingNotRun: {
    aiModelCall: number;
    geometry: number;
    verification: number;
    commercialCampaign: boolean;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function unsafeRelativePath(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) return true;
  return value.replaceAll('\\', '/').split('/').some(segment => segment === '..' || segment === '');
}

function hasSymlink(root: string, target: string): boolean {
  if (!within(root, target)) return false;
  const relative = path.relative(root, target);
  let current = root;
  if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return true;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function readJson(absolutePath: string, label: string, issues: string[]): Record<string, unknown> | null {
  if (!fs.existsSync(absolutePath)) {
    issues.push(`${label}_missing`);
    return null;
  }
  if (hasSymlink(path.parse(absolutePath).root, absolutePath)) {
    issues.push(`${label}_symlink_rejected`);
    return null;
  }
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile()) {
    issues.push(`${label}_not_regular_file`);
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as unknown;
    const value = record(parsed);
    if (!value) issues.push(`${label}_json_object_required`);
    return value;
  } catch {
    issues.push(`${label}_json_invalid`);
    return null;
  }
}

function verifyBinding(
  bindingValue: unknown,
  repositoryRoot: string,
  expectedPath: string,
  label: string,
  issues: string[],
): void {
  const binding = record(bindingValue);
  if (!binding) {
    issues.push(`${label}_binding_missing`);
    return;
  }
  if (binding.path !== expectedPath) issues.push(`${label}_path_mismatch`);
  if (unsafeRelativePath(binding.path)) {
    issues.push(`${label}_path_unsafe`);
    return;
  }
  const absolutePath = path.resolve(repositoryRoot, String(binding.path));
  if (!within(repositoryRoot, absolutePath)) {
    issues.push(`${label}_path_escape`);
    return;
  }
  if (hasSymlink(repositoryRoot, absolutePath)) {
    issues.push(`${label}_symlink_rejected`);
    return;
  }
  if (!fs.existsSync(absolutePath) || !fs.lstatSync(absolutePath).isFile()) {
    issues.push(`${label}_file_missing`);
    return;
  }
  const bytes = fs.readFileSync(absolutePath);
  if (!SHA256.test(String(binding.sha256 ?? ''))) issues.push(`${label}_sha256_invalid`);
  if (binding.sha256 !== sha256(bytes)) issues.push(`${label}_sha256_mismatch`);
  if (!Number.isSafeInteger(binding.bytes) || binding.bytes !== bytes.byteLength) issues.push(`${label}_bytes_mismatch`);
}

function expectedSummary(cases: Record<string, unknown>[]) {
  const categoryCounts = Object.fromEntries(CATEGORIES.map(category => [
    category,
    cases.filter(item => item.category === category).length,
  ]));
  return {
    total: cases.length,
    categoryCounts,
    parsePass: cases.filter(item => record(item.parse)?.status === 'PASS').length,
    requirementsReady: cases.filter(item => record(item.requirementsGate)?.status === 'PASS').length,
    negativeCorrectlyBlocked: cases.filter(item => item.expectedRequirementOutcome === 'BLOCKED' && record(item.requirementsGate)?.status === 'BLOCKED').length,
    candidatePass: cases.filter(item => record(item.candidateValidation)?.status === 'PASS').length,
    candidateBlocked: cases.filter(item => record(item.candidateValidation)?.status === 'BLOCKED').length,
    geometryEligible: cases.filter(item => record(item.geometry)?.eligibility === 'ELIGIBLE').length,
    geometryBlocked: cases.filter(item => record(item.geometry)?.eligibility === 'BLOCKED').length,
    geometryExecution: { PASS: 0, FAIL: 0, NOT_RUN: cases.filter(item => record(item.geometry)?.execution === 'NOT_RUN').length },
    verificationEligibility: { ELIGIBLE: 0, BLOCKED: cases.filter(item => record(item.verification)?.eligibility === 'BLOCKED').length },
    verificationExecution: { PASS: 0, FAIL: 0, NOT_RUN: cases.filter(item => record(item.verification)?.execution === 'NOT_RUN').length },
    expectedOutcomePass: cases.filter(item => record(item.qualification)?.status === 'PASS').length,
    expectedOutcomeFail: cases.filter(item => record(item.qualification)?.status === 'FAIL').length,
  };
}

function verifyCorpus(corpus: Record<string, unknown> | null, issues: string[]): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  if (!corpus) return byId;
  if (corpus.schema !== CORPUS_SCHEMA) issues.push('corpus_schema_invalid');
  if (corpus.frozenDefinition !== true) issues.push('corpus_not_frozen');
  if (!isDeepStrictEqual(corpus.categories, [...CATEGORIES])) issues.push('corpus_categories_invalid');
  if (!isDeepStrictEqual(corpus.featureContract, [...FEATURES])) issues.push('corpus_feature_contract_invalid');
  const cases = Array.isArray(corpus.cases) ? corpus.cases.map(record).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  if (cases.length !== 150) issues.push(`corpus_case_count:${cases.length}/150`);
  for (const item of cases) {
    const id = typeof item.caseId === 'string' ? item.caseId : '';
    if (!id || byId.has(id)) issues.push(id ? `corpus_duplicate_case:${id}` : 'corpus_case_id_invalid');
    else byId.set(id, item);
    if (!CATEGORIES.includes(item.category as (typeof CATEGORIES)[number])) issues.push(`corpus_category_invalid:${id}`);
    if (!FEATURES.includes(item.feature as (typeof FEATURES)[number])) issues.push(`corpus_feature_invalid:${id}`);
    if (typeof item.prompt !== 'string' || !item.prompt.trim()) issues.push(`corpus_prompt_invalid:${id}`);
    const expected = item.expectedRequirementOutcome;
    if (expected !== 'READY' && expected !== 'BLOCKED') issues.push(`corpus_expected_outcome_invalid:${id}`);
  }
  for (const category of CATEGORIES) {
    const categoryCases = cases.filter(item => item.category === category);
    if (categoryCases.length !== 30) issues.push(`corpus_category_count:${category}:${categoryCases.length}/30`);
    for (const feature of FEATURES) {
      const count = categoryCases.filter(item => item.feature === feature).length;
      if (count !== 1) issues.push(`corpus_matrix_count:${category}:${feature}:${count}/1`);
    }
  }
  return byId;
}

function verifyResults(
  results: Record<string, unknown> | null,
  corpusById: Map<string, Record<string, unknown>>,
  issues: string[],
): { cases: Record<string, unknown>[]; summary: ReturnType<typeof expectedSummary> } {
  const emptySummary = expectedSummary([]);
  if (!results) return { cases: [], summary: emptySummary };
  if (results.schema !== RESULTS_SCHEMA) issues.push('results_schema_invalid');
  if (!Number.isFinite(Date.parse(String(results.generatedAt ?? '')))) issues.push('results_generated_at_invalid');
  const boundary = record(results.executionBoundary);
  if (!isDeepStrictEqual(boundary, {
    parser: 'LOCAL_DETERMINISTIC', aiModelCall: 'NOT_RUN', geometry: 'NOT_RUN', verification: 'NOT_RUN',
  })) issues.push('results_execution_boundary_invalid');
  const cases = Array.isArray(results.cases) ? results.cases.map(record).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  if (cases.length !== 150) issues.push(`results_case_count:${cases.length}/150`);
  const seen = new Set<string>();
  for (const item of cases) {
    const id = typeof item.caseId === 'string' ? item.caseId : '';
    if (!id || seen.has(id)) issues.push(id ? `results_duplicate_case:${id}` : 'results_case_id_invalid');
    seen.add(id);
    const corpusCase = corpusById.get(id);
    if (!corpusCase) issues.push(`results_case_not_in_corpus:${id}`);
    if (corpusCase && (item.category !== corpusCase.category || item.expectedFeature !== corpusCase.feature
      || item.expectedRequirementOutcome !== corpusCase.expectedRequirementOutcome)) issues.push(`results_case_binding_mismatch:${id}`);
    const positive = item.expectedRequirementOutcome === 'READY';
    const parse = record(item.parse);
    const gate = record(item.requirementsGate);
    const candidate = record(item.candidateValidation);
    const geometry = record(item.geometry);
    const verification = record(item.verification);
    const qualification = record(item.qualification);
    if (parse?.status !== 'PASS') issues.push(`case_parse_not_pass:${id}`);
    if (positive) {
      if (gate?.status !== 'PASS' || gate.ready !== true) issues.push(`case_positive_requirements_invalid:${id}`);
      if (candidate?.status !== 'PASS' || candidate.state !== 'PREVIEW') issues.push(`case_positive_candidate_invalid:${id}`);
      if (geometry?.eligibility !== 'ELIGIBLE') issues.push(`case_positive_geometry_eligibility_invalid:${id}`);
    } else {
      if (gate?.status !== 'BLOCKED' || gate.ready !== false || typeof gate.nextQuestion !== 'string' || !gate.nextQuestion) issues.push(`case_negative_requirements_not_blocked:${id}`);
      if (candidate?.status !== 'BLOCKED' || candidate.state !== 'BLOCKED') issues.push(`case_negative_candidate_not_blocked:${id}`);
      if (geometry?.eligibility !== 'BLOCKED') issues.push(`case_negative_geometry_not_blocked:${id}`);
    }
    if (geometry?.execution !== 'NOT_RUN') issues.push(`case_geometry_execution_not_not_run:${id}`);
    if (geometry?.status === 'PASS') issues.push(`case_geometry_pass_forbidden:${id}`);
    if (verification?.eligibility !== 'BLOCKED' || verification.execution !== 'NOT_RUN') issues.push(`case_verification_not_blocked_not_run:${id}`);
    if (verification?.status === 'PASS') issues.push(`case_verification_pass_forbidden:${id}`);
    if (qualification?.status !== 'PASS' || strings(qualification.assertions).length !== 0) issues.push(`case_qualification_invalid:${id}`);
  }
  for (const id of corpusById.keys()) if (!seen.has(id)) issues.push(`results_case_missing:${id}`);
  const summary = expectedSummary(cases);
  if (!isDeepStrictEqual(results.summary, summary)) issues.push('results_summary_not_recomputed');
  if (!isDeepStrictEqual(results.localQualification, { status: 'PASS', scope: 'parse_requirements_candidate_and_eligibility_only' })) {
    issues.push('results_local_qualification_invalid');
  }
  const commercial = record(results.commercialCampaign);
  if (commercial?.status !== 'NOT_RUN' || commercial.releaseEligible !== false) issues.push('results_commercial_boundary_invalid');
  if (summary.geometryExecution.PASS !== 0 || summary.geometryExecution.NOT_RUN !== 150) issues.push('results_geometry_claim_boundary_invalid');
  if (summary.verificationExecution.PASS !== 0 || summary.verificationExecution.NOT_RUN !== 150) issues.push('results_verification_claim_boundary_invalid');
  return { cases, summary };
}

export function verifyMechanicalAiIntentLocalQualification(
  inputDirectory: string,
  options: VerifyOptions = {},
): MechanicalAiIntentVerification {
  const issues: string[] = [];
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const input = path.resolve(inputDirectory);
  if (!within(repositoryRoot, input)) issues.push('input_path_escape');
  if (within(repositoryRoot, input) && hasSymlink(repositoryRoot, input)) issues.push('input_symlink_rejected');
  if (!fs.existsSync(input) || !fs.lstatSync(input).isDirectory()) issues.push('input_directory_missing');
  const corpusPath = path.join(input, 'corpus.json');
  const resultsPath = path.join(input, 'results.json');
  const receiptPath = path.join(input, 'receipt.json');
  const receiptShaPath = path.join(input, 'receipt.sha256');
  const corpus = within(repositoryRoot, input) ? readJson(corpusPath, 'corpus', issues) : null;
  const results = within(repositoryRoot, input) ? readJson(resultsPath, 'results', issues) : null;
  const receipt = within(repositoryRoot, input) ? readJson(receiptPath, 'receipt', issues) : null;
  const corpusById = verifyCorpus(corpus, issues);
  const evaluated = verifyResults(results, corpusById, issues);

  if (receipt) {
    if (receipt.schema !== RECEIPT_SCHEMA) issues.push('receipt_schema_invalid');
    if (receipt.qualificationClass !== 'LOCAL_DETERMINISTIC_NO_GEOMETRY') issues.push('receipt_qualification_class_invalid');
    if (!Number.isFinite(Date.parse(String(receipt.generatedAt ?? ''))) || receipt.generatedAt !== results?.generatedAt) issues.push('receipt_generated_at_invalid');
    const sourceBindings = Array.isArray(receipt.sourceBindings) ? receipt.sourceBindings : [];
    if (sourceBindings.length !== SOURCE_PATHS.length) issues.push('receipt_source_binding_count_invalid');
    for (const binding of sourceBindings) {
      if (unsafeRelativePath(record(binding)?.path)) issues.push('receipt_source_binding_path_unsafe');
    }
    for (const sourcePath of SOURCE_PATHS) {
      const matches = sourceBindings.filter(binding => record(binding)?.path === sourcePath);
      if (matches.length !== 1) issues.push(`receipt_source_binding_cardinality:${sourcePath}:${matches.length}`);
      verifyBinding(matches[0], repositoryRoot, sourcePath, `source:${sourcePath}`, issues);
    }
    const artifactBindings = Array.isArray(receipt.artifactBindings) ? receipt.artifactBindings : [];
    const expectedArtifacts = [corpusPath, resultsPath].map(item => path.relative(repositoryRoot, item).replaceAll('\\', '/'));
    if (artifactBindings.length !== expectedArtifacts.length) issues.push('receipt_artifact_binding_count_invalid');
    for (const binding of artifactBindings) {
      if (unsafeRelativePath(record(binding)?.path)) issues.push('receipt_artifact_binding_path_unsafe');
    }
    for (const artifactPath of expectedArtifacts) {
      const matches = artifactBindings.filter(binding => record(binding)?.path === artifactPath);
      if (matches.length !== 1) issues.push(`receipt_artifact_binding_cardinality:${artifactPath}:${matches.length}`);
      verifyBinding(matches[0], repositoryRoot, artifactPath, `artifact:${artifactPath}`, issues);
    }
    if (!isDeepStrictEqual(receipt.summary, evaluated.summary)) issues.push('receipt_summary_not_recomputed');
    if (!isDeepStrictEqual(receipt.localQualification, results?.localQualification)) issues.push('receipt_local_qualification_mismatch');
    if (!isDeepStrictEqual(receipt.commercialCampaign, results?.commercialCampaign)) issues.push('receipt_commercial_campaign_mismatch');
    const commercial = record(receipt.commercialCampaign);
    if (commercial?.status !== 'NOT_RUN' || commercial.releaseEligible !== false) issues.push('receipt_commercial_boundary_invalid');
  }

  if (!fs.existsSync(receiptShaPath)) issues.push('receipt_sha256_missing');
  else if (hasSymlink(repositoryRoot, receiptShaPath)) issues.push('receipt_sha256_symlink_rejected');
  else {
    const receiptBytes = fs.existsSync(receiptPath) && !hasSymlink(repositoryRoot, receiptPath) ? fs.readFileSync(receiptPath) : null;
    const manifest = fs.readFileSync(receiptShaPath, 'utf8').trim();
    const match = /^([a-f0-9]{64}) {2}receipt\.json$/.exec(manifest);
    if (!match) issues.push('receipt_sha256_format_invalid');
    else if (!receiptBytes || match[1] !== sha256(receiptBytes)) issues.push('receipt_sha256_mismatch');
  }

  return {
    ok: issues.length === 0,
    input: path.relative(repositoryRoot, input).replaceAll('\\', '/'),
    checkedCases: evaluated.cases.length,
    issues: [...new Set(issues)],
    remainingNotRun: {
      aiModelCall: evaluated.cases.length,
      geometry: evaluated.cases.filter(item => record(item.geometry)?.execution === 'NOT_RUN').length,
      verification: evaluated.cases.filter(item => record(item.verification)?.execution === 'NOT_RUN').length,
      commercialCampaign: record(results?.commercialCampaign)?.status === 'NOT_RUN',
    },
  };
}

function option(args: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  return args.find(item => item.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function main(args = process.argv.slice(2)): number {
  const input = option(args, 'input') ?? 'docs/evidence/cad-independent/local/mechanical-ai-intent-qualification-260813';
  const result = verifyMechanicalAiIntentLocalQualification(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[verify-mechanical-ai-intent-local-qualification] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
