#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MECHANICAL_CORE_30_FEATURES } from '../src/lib/ai/mechanicalCoreFeatureContract';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
  canonicalTextSha256,
} from './canonical-text-binding.mjs';

const RECEIPT_SCHEMA = 'nexyfab.mechanical-ai-intent-runtime-receipt.v1';
const RESULTS_SCHEMA = 'nexyfab.mechanical-ai-intent-runtime-integration.v1';
const AXIS_SCHEMA = 'nexyfab.mechanical-core-feature-local-axis-evidence.v1';
const RUNTIME_SCHEMA = 'nexyfab.mechanical-core-feature-local-runtime.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const DIMENSION_TOLERANCE_MM = 1e-5;
const FEATURES = ['hole', 'fillet', 'chamfer', 'shell', 'rib', 'linearPattern', 'circularPattern', 'draft', 'scale', 'moveCopy'] as const;
const AXES = ['create', 'edit', 'regenerate', 'save_reopen', 'undo', 'export', 'drawing'] as const;
const SOURCE_PATHS = [
  'src/app/[lang]/shape-generator/features/occtEngine.ts',
  'src/app/[lang]/shape-generator/features/topologyEdgeFinder.ts',
  'src/app/[lang]/shape-generator/features/variableFillet.ts',
  'src/app/[lang]/shape-generator/features/offsetFace.ts',
  'src/app/[lang]/shape-generator/features/thread.ts',
  'src/app/[lang]/shape-generator/features/threads/applyThreadOcct.ts',
  'src/app/[lang]/shape-generator/features/helix.ts',
  'src/app/[lang]/shape-generator/features/sheetMetal.ts',
  'src/app/[lang]/shape-generator/features/tab.ts',
  'src/app/[lang]/shape-generator/features/cut.ts',
  'src/app/[lang]/shape-generator/features/reliefCuts.ts',
  'src/app/[lang]/shape-generator/features/variableShell.ts',
  'src/app/[lang]/shape-generator/features/revolve.ts',
  'src/app/[lang]/shape-generator/features/sweep.ts',
  'src/app/[lang]/shape-generator/features/loft.ts',
  'src/app/[lang]/shape-generator/features/mirror.ts',
  'src/app/[lang]/shape-generator/features/boolean.ts',
  'src/app/[lang]/shape-generator/features/splitBody.ts',
  'src/app/[lang]/shape-generator/features/pipelineManager.ts',
  'src/app/[lang]/shape-generator/sketch/extrudeProfile.ts',
  'src/app/[lang]/shape-generator/io/nfabFormat.ts',
  'src/app/[lang]/shape-generator/history/CommandHistory.ts',
  'src/app/[lang]/shape-generator/features/types.ts',
  'src/lib/ai/mechanicalCoreFeatureContract.ts',
  'scripts/mechanical-core-feature-local-runtime.ts',
] as const;

type JsonRecord = Record<string, unknown>;

export interface MechanicalAiIntentRuntimeReceiptVerification {
  ok: boolean;
  input: string;
  casesChecked: number;
  axesChecked: number;
  issues: string[];
  claimBoundary: { aiModelCall: 'NOT_RUN' | 'INVALID'; externalCommercialCampaign: 'NOT_RUN' | 'INVALID'; releaseEligible: false };
}

function object(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function hash(value: Uint8Array | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function unsafeRelative(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) return true;
  return value.replaceAll('\\', '/').split('/').some(segment => segment === '' || segment === '..');
}

function hasSymlink(root: string, target: string): boolean {
  if (!inside(root, target)) return false;
  let current = root;
  if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return true;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function readJson(root: string, absolute: string, label: string, issues: string[]): JsonRecord | null {
  if (!inside(root, absolute)) {
    issues.push(`${label}_path_escape`);
    return null;
  }
  if (hasSymlink(root, absolute)) {
    issues.push(`${label}_symlink_rejected`);
    return null;
  }
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
    issues.push(`${label}_missing`);
    return null;
  }
  try {
    const parsed = object(JSON.parse(fs.readFileSync(absolute, 'utf8')) as unknown);
    if (!parsed) issues.push(`${label}_object_required`);
    return parsed;
  } catch {
    issues.push(`${label}_json_invalid`);
    return null;
  }
}

function bindingKey(binding: JsonRecord): string {
  return `${String(binding.path)}\0${String(binding.sha256)}\0${String(binding.bytes)}`;
}

function verifyBinding(
  root: string,
  bindingValue: unknown,
  label: string,
  issues: string[],
  expectedPath?: string,
): JsonRecord | null {
  const binding = object(bindingValue);
  if (!binding) {
    issues.push(`${label}_binding_invalid`);
    return null;
  }
  if (expectedPath !== undefined && binding.path !== expectedPath) issues.push(`${label}_path_mismatch`);
  if (unsafeRelative(binding.path)) {
    issues.push(`${label}_path_unsafe`);
    return binding;
  }
  const absolute = path.resolve(root, String(binding.path));
  if (!inside(root, absolute)) {
    issues.push(`${label}_path_escape`);
    return binding;
  }
  if (hasSymlink(root, absolute)) {
    issues.push(`${label}_symlink_rejected`);
    return binding;
  }
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
    issues.push(`${label}_file_missing`);
    return binding;
  }
  const bytes = fs.readFileSync(absolute);
  const canonical = canonicalTextBinding(bytes);
  if (binding.canonicalization !== TEXT_BINDING_CANONICALIZATION) issues.push(`${label}_canonicalization_invalid`);
  if (!SHA256.test(String(binding.sha256 ?? ''))) issues.push(`${label}_sha256_invalid`);
  if (binding.sha256 !== canonical.sha256) issues.push(`${label}_sha256_mismatch`);
  if (!Number.isSafeInteger(binding.bytes) || binding.bytes !== canonical.bytes) issues.push(`${label}_bytes_mismatch`);
  return binding;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function matchesDimensions(value: unknown, expected: { width: number; length: number; thickness: number }): boolean {
  const dimensions = object(value);
  return dimensions?.width === expected.width && dimensions.length === expected.length && dimensions.thickness === expected.thickness;
}

function expectedForCase(category: unknown): { dimensions: { width: number; length: number; thickness: number }; units: string[] } | null {
  if (category === 'mixed_units') return { dimensions: { width: 100, length: 60, thickness: 6.35 }, units: ['mm', 'in'] };
  if (category === 'ko_practical' || category === 'en_practical') return { dimensions: { width: 100, length: 60, thickness: 8 }, units: ['mm'] };
  return null;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function verifyCaseArtifacts(
  root: string,
  input: string,
  item: JsonRecord,
  revision: string,
  axisBindingKeys: Set<string>,
  issues: string[],
): void {
  const id = String(item.caseId ?? 'unknown');
  const feature = String(item.feature ?? 'unknown');
  const expected = expectedForCase(item.category);
  const candidate = object(item.candidate);
  const authoritative = object(item.authoritativeInput);
  if (!expected) issues.push(`case:${id}:category_invalid`);
  if (candidate?.status !== 'PASS' || candidate.baseRevision !== revision || candidate.id !== `intent-runtime:${id}`) issues.push(`case:${id}:candidate_revision_invalid`);
  if (!authoritative || authoritative.caseId !== id || authoritative.candidateId !== candidate?.id
    || authoritative.candidateBaseRevision !== revision || authoritative.normalizedUnit !== 'mm'
    || !SHA256.test(String(authoritative.promptSha256 ?? '')) || !SHA256.test(String(authoritative.inputSha256 ?? ''))) {
    issues.push(`case:${id}:authoritative_binding_invalid`);
  }
  if (expected && (!sameStrings(authoritative?.sourceUnits, expected.units) || !matchesDimensions(authoritative?.dimensionsMm, expected.dimensions))) {
    issues.push(`case:${id}:authoritative_dimensions_or_units_invalid`);
  }
  const runtimeAxes = object(item.runtimeAxes);
  if (!runtimeAxes || AXES.some(axis => runtimeAxes[axis] !== 'PASS') || Object.keys(runtimeAxes ?? {}).length !== AXES.length) issues.push(`case:${id}:runtime_axes_invalid`);
  if (item.status !== 'PASS' || !Array.isArray(item.issues) || item.issues.length !== 0) issues.push(`case:${id}:case_status_invalid`);

  const artifactBindings = Array.isArray(item.artifactBindings) ? item.artifactBindings : [];
  const expectedArtifacts = ['create.json', 'edit.json', 'regenerate.json', 'saved-project.nfab']
    .map(file => path.relative(root, path.join(input, 'runtime', feature, file)).replaceAll('\\', '/'));
  if (artifactBindings.length !== expectedArtifacts.length) issues.push(`case:${id}:artifact_binding_count`);
  const artifacts = new Map<string, JsonRecord>();
  for (const expectedPath of expectedArtifacts) {
    const matches = artifactBindings.filter(value => object(value)?.path === expectedPath);
    if (matches.length !== 1) issues.push(`case:${id}:artifact_cardinality:${expectedPath}`);
    const binding = verifyBinding(root, matches[0], `case:${id}:artifact:${path.basename(expectedPath)}`, issues, expectedPath);
    if (binding) {
      artifacts.set(path.basename(expectedPath), binding);
      if (!axisBindingKeys.has(bindingKey(binding))) issues.push(`case:${id}:artifact_not_axis_bound:${path.basename(expectedPath)}`);
    }
  }
  const create = readJson(root, path.join(input, 'runtime', feature, 'create.json'), `case:${id}:create`, issues);
  const edit = readJson(root, path.join(input, 'runtime', feature, 'edit.json'), `case:${id}:edit`, issues);
  const regenerate = readJson(root, path.join(input, 'runtime', feature, 'regenerate.json'), `case:${id}:regenerate`, issues);
  const nfab = readJson(root, path.join(input, 'runtime', feature, 'saved-project.nfab'), `case:${id}:nfab`, issues);
  for (const [axis, artifact] of Object.entries({ create, edit, regenerate })) {
    if (artifact?.schema !== RUNTIME_SCHEMA || artifact.feature !== feature || artifact.axis !== axis || artifact.status !== 'PASS') issues.push(`case:${id}:${axis}_artifact_invalid`);
    const binding = object(artifact?.intentBinding);
    if (!binding || binding.caseId !== id || binding.candidateId !== candidate?.id || binding.candidateBaseRevision !== revision
      || binding.inputSha256 !== authoritative?.inputSha256 || binding.promptSha256 !== authoritative?.promptSha256
      || binding.normalizedUnit !== 'mm' || !sameStrings(binding.sourceUnits, expected?.units ?? [])
      || !matchesDimensions(binding.dimensionsMm, expected?.dimensions ?? { width: NaN, length: NaN, thickness: NaN })) {
      issues.push(`case:${id}:${axis}_intent_binding_invalid`);
    }
  }
  if (expected) {
    const dimensionAssertion = object(create?.intentDimensionAssertion);
    const expectedExtents = [expected.dimensions.width, expected.dimensions.thickness, expected.dimensions.length];
    const assertedExpected = Array.isArray(dimensionAssertion?.expectedExtentsMm) ? dimensionAssertion.expectedExtentsMm : [];
    const actual = Array.isArray(dimensionAssertion?.extentsMm) ? dimensionAssertion.extentsMm : [];
    const baseBounds = object(create?.intentBaseExact)?.boundsMm;
    const bounds = Array.isArray(baseBounds) ? baseBounds : [];
    const derived = bounds.length === 2 && Array.isArray(bounds[0]) && Array.isArray(bounds[1])
      ? expectedExtents.map((_, index) => number(bounds[1][index]) !== null && number(bounds[0][index]) !== null
        ? number(bounds[1][index])! - number(bounds[0][index])! : NaN)
      : [];
    const toleranceInvalid = dimensionAssertion?.status !== 'PASS'
      || assertedExpected.length !== 3 || assertedExpected.some((value, index) => value !== expectedExtents[index])
      || actual.length !== 3 || actual.some((value, index) => number(value) === null || Math.abs(number(value)! - expectedExtents[index]!) > DIMENSION_TOLERANCE_MM)
      || derived.length !== 3 || derived.some((value, index) => !Number.isFinite(value) || Math.abs(value - expectedExtents[index]!) > DIMENSION_TOLERANCE_MM)
      || actual.some((value, index) => Math.abs(number(value)! - derived[index]!) > DIMENSION_TOLERANCE_MM);
    if (toleranceInvalid) issues.push(`case:${id}:exact_dimension_tolerance_exceeded`);
    const editAssertion = object(edit?.intentDimensionAssertion);
    if (editAssertion?.status !== 'PASS' || editAssertion.inputSha256 !== authoritative?.inputSha256
      || editAssertion.normalizedUnit !== 'mm' || !matchesDimensions(editAssertion.dimensionsMm, expected.dimensions)) {
      issues.push(`case:${id}:edit_dimension_assertion_invalid`);
    }
    const sceneParams = object(object(nfab?.scene)?.params);
    const meta = object(nfab?.meta);
    if (sceneParams?.width !== expected.dimensions.width || sceneParams.height !== expected.dimensions.thickness
      || sceneParams.depth !== expected.dimensions.length || meta?.intentCaseId !== id
      || meta.intentInputSha256 !== authoritative?.inputSha256 || meta.candidateBaseRevision !== revision) {
      issues.push(`case:${id}:feature_tree_binding_invalid`);
    }
  }
}

export function verifyMechanicalAiIntentRuntimeReceipt(
  inputDirectory: string,
  repositoryRoot = process.cwd(),
): MechanicalAiIntentRuntimeReceiptVerification {
  const root = path.resolve(repositoryRoot);
  const input = path.resolve(inputDirectory);
  const issues: string[] = [];
  if (!inside(root, input)) issues.push('input_path_escape');
  if (inside(root, input) && hasSymlink(root, input)) issues.push('input_symlink_rejected');
  if (!fs.existsSync(input) || !fs.lstatSync(input).isDirectory()) issues.push('input_directory_missing');
  const receiptPath = path.join(input, 'receipt.json');
  const resultsPath = path.join(input, 'intent-runtime-results.json');
  const axisPath = path.join(input, 'runtime-axis-evidence.json');
  const shaPath = path.join(input, 'receipt.sha256');
  const receipt = inside(root, input) ? readJson(root, receiptPath, 'receipt', issues) : null;
  const results = inside(root, input) ? readJson(root, resultsPath, 'results', issues) : null;
  const axisReceipt = inside(root, input) ? readJson(root, axisPath, 'axis_receipt', issues) : null;

  if (receipt?.schema !== RECEIPT_SCHEMA) issues.push('receipt_schema_invalid');
  if (receipt?.textCanonicalization !== TEXT_BINDING_CANONICALIZATION) issues.push('receipt_text_canonicalization_invalid');
  if (results?.schema !== RESULTS_SCHEMA) issues.push('results_schema_invalid');
  if (axisReceipt?.schema !== AXIS_SCHEMA) issues.push('axis_schema_invalid');
  const revision = String(receipt?.revision ?? '');
  if (!SHA256.test(revision) || results?.revision !== revision || axisReceipt?.designRevisionSha256 !== revision) issues.push('revision_binding_invalid');
  if (!Number.isFinite(Date.parse(String(receipt?.generatedAt ?? ''))) || receipt?.generatedAt !== results?.generatedAt || receipt?.generatedAt !== axisReceipt?.generatedAt) issues.push('generated_at_binding_invalid');

  const sourceBindings = Array.isArray(receipt?.sourceBindings) ? receipt.sourceBindings : [];
  if (sourceBindings.length !== SOURCE_PATHS.length) issues.push('source_binding_count_invalid');
  const verifiedSources: JsonRecord[] = [];
  for (const sourcePath of SOURCE_PATHS) {
    const matches = sourceBindings.filter(value => object(value)?.path === sourcePath);
    if (matches.length !== 1) issues.push(`source_binding_cardinality:${sourcePath}`);
    const binding = verifyBinding(root, matches[0], `source:${sourcePath}`, issues, sourcePath);
    if (binding) verifiedSources.push(binding);
  }
  for (const binding of sourceBindings) if (unsafeRelative(object(binding)?.path)) issues.push('source_binding_path_unsafe');
  const derivedRevision = hash(verifiedSources.map(binding => `${binding.path}\0${binding.sha256}\0${binding.bytes}`).join('\n'));
  if (derivedRevision !== revision) issues.push('source_revision_stale_or_tampered');

  const receiptArtifacts = Array.isArray(receipt?.artifactBindings) ? receipt.artifactBindings : [];
  const expectedReceiptArtifacts = [resultsPath, axisPath].map(value => path.relative(root, value).replaceAll('\\', '/'));
  if (receiptArtifacts.length !== 2) issues.push('receipt_artifact_binding_count_invalid');
  for (const expectedPath of expectedReceiptArtifacts) {
    const matches = receiptArtifacts.filter(value => object(value)?.path === expectedPath);
    if (matches.length !== 1) issues.push(`receipt_artifact_binding_cardinality:${expectedPath}`);
    verifyBinding(root, matches[0], `receipt_artifact:${path.basename(expectedPath)}`, issues, expectedPath);
  }
  for (const binding of receiptArtifacts) if (unsafeRelative(object(binding)?.path)) issues.push('receipt_artifact_path_unsafe');

  if (!fs.existsSync(shaPath)) issues.push('receipt_sha256_missing');
  else if (hasSymlink(root, shaPath)) issues.push('receipt_sha256_symlink_rejected');
  else {
    const match = /^([a-f0-9]{64}) {2}receipt\.json$/.exec(fs.readFileSync(shaPath, 'utf8').trim());
    if (!match) issues.push('receipt_sha256_format_invalid');
    else if (!fs.existsSync(receiptPath) || match[1] !== canonicalTextSha256(fs.readFileSync(receiptPath))) issues.push('receipt_sha256_mismatch');
  }

  // Keep the complete submitted run set for validation. Filtering unknown
  // features before validation would let a receipt append arbitrary axis rows
  // to an otherwise complete 70-run bundle without invalidating it. The local
  // runtime bundle may carry the remaining 20 feature families, but every row
  // must still belong to the frozen 30-feature contract.
  const rawRuns = Array.isArray(axisReceipt?.runs) ? axisReceipt.runs : [];
  const allRuns = rawRuns
    .map(object)
    .filter((value): value is JsonRecord => Boolean(value));
  if (allRuns.length !== rawRuns.length) issues.push('axis_run_invalid:non_object');
  const selectedRuns = allRuns.filter(run => FEATURES.includes(run.feature as (typeof FEATURES)[number]));
  const axisBindingKeys = new Set<string>();
  for (const run of allRuns) {
    const feature = String(run.feature);
    const axis = String(run.axis);
    const knownFeature = (MECHANICAL_CORE_30_FEATURES as readonly string[]).includes(feature);
    const knownAxis = AXES.includes(axis as (typeof AXES)[number]);
    if (!knownFeature || !knownAxis) {
      issues.push(`axis_run_invalid:${feature}:${axis}`);
      continue;
    }
    const evidence = Array.isArray(run.evidence) ? run.evidence : [];
    if (FEATURES.includes(feature as (typeof FEATURES)[number])) {
      if (run.status !== 'PASS' || run.executedAt !== receipt?.generatedAt || evidence.length === 0) issues.push(`axis_run_invalid:${feature}:${axis}`);
      for (const bindingValue of evidence) {
        const binding = verifyBinding(root, bindingValue, `axis:${feature}:${axis}`, issues);
        if (binding) axisBindingKeys.add(bindingKey(binding));
      }
    } else if (run.status !== 'NOT_RUN' || run.executedAt !== null || evidence.length !== 0 || typeof run.detail !== 'string' || !run.detail.trim()) {
      issues.push(`axis_run_claim_invalid:${feature}:${axis}`);
    }
  }
  const submittedPairs = new Set<string>();
  for (const run of allRuns) {
    const pair = `${String(run.feature)}:${String(run.axis)}`;
    if (submittedPairs.has(pair)) issues.push(`axis_run_duplicate:${pair}`);
    submittedPairs.add(pair);
  }
  for (const feature of FEATURES) for (const axis of AXES) {
    const count = selectedRuns.filter(run => run.feature === feature && run.axis === axis).length;
    if (count !== 1) issues.push(`axis_cardinality:${feature}:${axis}:${count}/1`);
  }
  if (selectedRuns.length !== 70) issues.push(`axis_count:${selectedRuns.length}/70`);

  const cases = (Array.isArray(results?.cases) ? results.cases : []).map(object).filter((value): value is JsonRecord => Boolean(value));
  if (cases.length !== 10) issues.push(`case_count:${cases.length}/10`);
  if (new Set(cases.map(item => item.caseId)).size !== cases.length) issues.push('case_id_duplicate');
  if (new Set(cases.map(item => item.feature)).size !== FEATURES.length || FEATURES.some(feature => cases.filter(item => item.feature === feature).length !== 1)) issues.push('feature_set_not_unique_first_ten');
  for (const item of cases) verifyCaseArtifacts(root, input, item, revision, axisBindingKeys, issues);

  const derivedSummary = {
    requiredCases: 10,
    pass: cases.filter(item => item.status === 'PASS').length,
    fail: cases.filter(item => item.status === 'FAIL').length,
    blocked: cases.filter(item => item.status === 'BLOCKED').length,
    requiredAxes: 70,
    axisPass: selectedRuns.filter(run => run.status === 'PASS').length,
    axisFail: selectedRuns.filter(run => run.status === 'FAIL').length,
    axisNotRun: selectedRuns.filter(run => run.status === 'NOT_RUN').length,
  };
  if (JSON.stringify(results?.summary) !== JSON.stringify(derivedSummary) || JSON.stringify(receipt?.summary) !== JSON.stringify(derivedSummary)
    || derivedSummary.pass !== 10 || derivedSummary.axisPass !== 70 || derivedSummary.fail !== 0 || derivedSummary.blocked !== 0) {
    issues.push('summary_not_recomputed_or_incomplete');
  }
  const boundary = object(results?.executionBoundary);
  const resultCommercial = object(results?.commercialCampaign);
  const receiptCommercial = object(receipt?.commercialCampaign);
  const aiNotRun = boundary?.aiModelCall === 'NOT_RUN';
  const externalNotRun = resultCommercial?.status === 'NOT_RUN' && resultCommercial.releaseEligible === false
    && receiptCommercial?.status === 'NOT_RUN' && receiptCommercial.releaseEligible === false
    && Array.isArray(resultCommercial.blockers) && resultCommercial.blockers.includes('external_commercial_receipt_not_evaluated')
    && Array.isArray(receiptCommercial.blockers) && receiptCommercial.blockers.includes('external_commercial_receipt_not_evaluated');
  if (!aiNotRun) issues.push('ai_model_claim_boundary_invalid');
  if (!externalNotRun) issues.push('external_commercial_claim_boundary_invalid');
  if (object(results?.localIntegration)?.status !== 'PASS' || object(receipt?.localIntegration)?.status !== 'PASS') issues.push('local_integration_status_invalid');

  return {
    ok: issues.length === 0,
    input: path.relative(root, input).replaceAll('\\', '/'),
    casesChecked: cases.length,
    axesChecked: selectedRuns.length,
    issues: [...new Set(issues)],
    claimBoundary: {
      aiModelCall: aiNotRun ? 'NOT_RUN' : 'INVALID',
      externalCommercialCampaign: externalNotRun ? 'NOT_RUN' : 'INVALID',
      releaseEligible: false,
    },
  };
}

function option(args: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  return args.find(item => item.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function main(args = process.argv.slice(2)): number {
  const input = option(args, 'input') ?? 'docs/evidence/cad-independent/local/mechanical-ai-intent-runtime-260813';
  const result = verifyMechanicalAiIntentRuntimeReceipt(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[verify-mechanical-ai-intent-runtime-receipt] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
