#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
} from './canonical-text-binding.mjs';
import { createAiCanonicalCandidate, guardAiCanonicalCandidate } from '../src/lib/ai/aiCanonicalCandidate';
import { buildGuidedDesignBrief, buildGuidedRequirementGate, seedGuidedBriefInputs } from '../src/lib/ai/guidedDesignBrief';
import { MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES } from '../src/lib/ai/mechanicalCoreFeatureContract';
import { verifyMechanicalCoreLocalBinding } from './mechanical-core-feature-local-closed-loop';
import {
  buildMechanicalAiIntentCorpus,
  type MechanicalAiIntentCorpusCase,
} from './mechanical-ai-intent-local-qualification';
import {
  executeMechanicalCoreRuntimeBundle,
  mechanicalCoreRuntimeSourceRevision,
  MECHANICAL_CORE_RUNTIME_BUNDLE,
  MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA,
  type MechanicalCoreRuntimeFeature,
  type MechanicalCoreRuntimeIntentBinding,
  type MechanicalCoreRuntimePaths,
} from './mechanical-core-feature-local-runtime';

export const MECHANICAL_AI_INTENT_RUNTIME_SCHEMA =
  'nexyfab.mechanical-ai-intent-runtime-integration.v1' as const;
const REPRESENTATIVE_CATEGORIES = ['ko_practical', 'en_practical', 'mixed_units'] as const;
const SHA256 = /^[a-f0-9]{64}$/;

interface ParsedDimensionInput {
  dimensionsMm: { width: number; length: number; thickness: number };
  sourceUnits: string[];
  sourceTriples: Array<{ values: [number, number, number]; unit: 'mm' | 'in'; normalizedMm: [number, number, number] }>;
}

interface PreparedIntent {
  item: MechanicalAiIntentCorpusCase;
  candidateId: string;
  candidateBaseRevision: string;
  status: 'READY' | 'BLOCKED';
  issues: string[];
  binding?: MechanicalCoreRuntimeIntentBinding;
}

const slash = (value: string): string => value.replaceAll('\\', '/');
const render = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value: Uint8Array | string): string => crypto.createHash('sha256').update(value).digest('hex');

function resolveInside(root: string, relative: string): string {
  const normalized = slash(relative);
  if (!normalized || path.isAbsolute(relative) || normalized.split('/').includes('..')) throw new Error(`INTENT_RUNTIME_PATH_INVALID:${relative}`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`INTENT_RUNTIME_PATH_ESCAPE:${relative}`);
  return resolved;
}

function writeBound(root: string, relative: string, value: string | Uint8Array) {
  const absolute = resolveInside(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, value);
  const bytes = fs.readFileSync(absolute);
  return { path: slash(relative), ...canonicalTextBinding(bytes) };
}

function normalizeTriple(values: [number, number, number], unit: 'mm' | 'in'): [number, number, number] {
  const scale = unit === 'in' ? 25.4 : 1;
  return values.map(value => value * scale) as [number, number, number];
}

/** Parses only explicit three-axis dimensional groups; it never invents a missing common unit. */
export function parseAuthoritativeDimensions(prompt: string): ParsedDimensionInput | null {
  const triples: ParsedDimensionInput['sourceTriples'] = [];
  const triplePattern = /(\d+(?:\.\d+)?)\s*(mm|in)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|in)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|in)/gi;
  for (const match of prompt.matchAll(triplePattern)) {
    const common = match[6]?.toLowerCase();
    const units = [match[2]?.toLowerCase() || common, match[4]?.toLowerCase() || common, common];
    if (!units.every(unit => unit === 'mm' || unit === 'in') || new Set(units).size !== 1) return null;
    const values = [Number(match[1]), Number(match[3]), Number(match[5])] as [number, number, number];
    if (values.some(value => !Number.isFinite(value) || value <= 0)) return null;
    const unit = units[0] as 'mm' | 'in';
    triples.push({ values, unit, normalizedMm: normalizeTriple(values, unit) });
  }
  if (!triples.length) return null;
  const authoritative = triples[0]!.normalizedMm;
  const equivalent = triples.every(triple => triple.normalizedMm.every((value, index) => Math.abs(value - authoritative[index]!) <= 0.02));
  if (!equivalent) return null;
  return {
    dimensionsMm: { width: authoritative[0], length: authoritative[1], thickness: authoritative[2] },
    sourceUnits: [...new Set(triples.map(triple => triple.unit))],
    sourceTriples: triples,
  };
}

export function selectRepresentativeMechanicalIntents(): MechanicalAiIntentCorpusCase[] {
  const corpus = buildMechanicalAiIntentCorpus();
  return MECHANICAL_CORE_RUNTIME_BUNDLE.slice(0, 10).map((feature, index) => {
    const category = REPRESENTATIVE_CATEGORIES[index % REPRESENTATIVE_CATEGORIES.length]!;
    const item = corpus.cases.find(candidate => candidate.feature === feature && candidate.category === category);
    if (!item || item.expectedRequirementOutcome !== 'READY') throw new Error(`REPRESENTATIVE_INTENT_MISSING:${feature}:${category}`);
    return item;
  });
}

function prepareIntent(item: MechanicalAiIntentCorpusCase, revision: string): PreparedIntent {
  const parsed = parseAuthoritativeDimensions(item.prompt);
  const brief = buildGuidedDesignBrief({
    prompt: item.prompt,
    requestedStage: 'exact',
    selectedDomains: ['mechanical'],
    inputs: seedGuidedBriefInputs(item.prompt, 'mechanical'),
  });
  const gate = buildGuidedRequirementGate(brief);
  const candidateId = `intent-runtime:${item.caseId}`;
  const input = parsed ? {
    caseId: item.caseId,
    feature: item.feature,
    promptSha256: hash(item.prompt),
    sourceUnits: parsed.sourceUnits,
    sourceTriples: parsed.sourceTriples,
    normalizedUnit: 'mm',
    dimensionsMm: parsed.dimensionsMm,
  } : null;
  const candidate = createAiCanonicalCandidate({
    id: candidateId,
    kind: 'intent',
    baseRevision: revision,
    summary: `Revision-bound runtime intent for ${item.feature}`,
    payload: {
      intents: [{ kind: 'add_feature', featureType: item.feature, ...(input ? { designInput: input } : {}) }],
    },
    requirementGate: gate,
    now: '2026-08-13T00:00:00.000Z',
  });
  const guard = guardAiCanonicalCandidate(candidate, revision);
  const issues = [
    ...(!parsed ? ['authoritative_dimension_parse_failed'] : []),
    ...(!gate.ready ? gate.issues : []),
    ...(!guard.allowed ? guard.issues : []),
  ];
  if (!parsed || issues.length) return { item, candidateId, candidateBaseRevision: revision, status: 'BLOCKED', issues: [...new Set(issues)] };
  const inputSha256 = hash(render(input));
  return {
    item,
    candidateId,
    candidateBaseRevision: revision,
    status: 'READY',
    issues: [],
    binding: {
      caseId: item.caseId,
      candidateId,
      candidateBaseRevision: revision,
      promptSha256: hash(item.prompt),
      inputSha256,
      sourceUnits: parsed.sourceUnits,
      normalizedUnit: 'mm',
      dimensionsMm: parsed.dimensionsMm,
    },
  };
}

function readJson(root: string, relative: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(resolveInside(root, relative), 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function sameBinding(actual: unknown, expected: MechanicalCoreRuntimeIntentBinding): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function verifyFeatureArtifacts(
  root: string,
  paths: MechanicalCoreRuntimePaths,
  feature: MechanicalCoreRuntimeFeature,
  binding: MechanicalCoreRuntimeIntentBinding,
) {
  const relative = (filename: string) => slash(path.posix.join(paths.artifactRoot, feature, filename));
  const create = readJson(root, relative('create.json'));
  const edit = readJson(root, relative('edit.json'));
  const regenerate = readJson(root, relative('regenerate.json'));
  const nfabRelative = relative('saved-project.nfab');
  const nfab = readJson(root, nfabRelative);
  const issues: string[] = [];
  for (const [axis, artifact] of Object.entries({ create, edit, regenerate })) {
    if (artifact?.schema !== MECHANICAL_CORE_RUNTIME_EXECUTION_SCHEMA || artifact.feature !== feature || artifact.status !== 'PASS') issues.push(`${axis}_artifact_invalid`);
    if (!sameBinding(artifact?.intentBinding, binding)) issues.push(`${axis}_intent_binding_mismatch`);
  }
  const assertion = create?.intentDimensionAssertion as Record<string, unknown> | undefined;
  const expectedExtents = [binding.dimensionsMm.width, binding.dimensionsMm.thickness, binding.dimensionsMm.length];
  const actualExtents = Array.isArray(assertion?.extentsMm) ? assertion.extentsMm : [];
  if (assertion?.status !== 'PASS' || JSON.stringify(assertion.expectedExtentsMm) !== JSON.stringify(expectedExtents)
    || actualExtents.length !== 3 || actualExtents.some((value, index) => typeof value !== 'number' || Math.abs(value - expectedExtents[index]!) > 1e-5)) issues.push('create_exact_dimension_assertion_invalid');
  const editAssertion = edit?.intentDimensionAssertion as Record<string, unknown> | undefined;
  if (editAssertion?.status !== 'PASS' || editAssertion.inputSha256 !== binding.inputSha256
    || JSON.stringify(editAssertion.dimensionsMm) !== JSON.stringify(binding.dimensionsMm)) issues.push('edit_dimension_assertion_invalid');
  const scene = nfab?.scene as Record<string, unknown> | undefined;
  const params = scene?.params as Record<string, unknown> | undefined;
  const meta = nfab?.meta as Record<string, unknown> | undefined;
  if (params?.width !== binding.dimensionsMm.width || params.height !== binding.dimensionsMm.thickness || params.depth !== binding.dimensionsMm.length) issues.push('feature_tree_dimensions_mismatch');
  if (meta?.intentInputSha256 !== binding.inputSha256 || meta.candidateBaseRevision !== binding.candidateBaseRevision) issues.push('feature_tree_revision_binding_mismatch');
  const artifactBindings = [relative('create.json'), relative('edit.json'), relative('regenerate.json'), nfabRelative].map(item => {
    const bytes = fs.existsSync(resolveInside(root, item)) ? fs.readFileSync(resolveInside(root, item)) : Buffer.alloc(0);
    return { path: item, ...canonicalTextBinding(bytes) };
  });
  if (artifactBindings.some(item => item.bytes <= 0 || !SHA256.test(item.sha256))) issues.push('artifact_bytes_or_sha_invalid');
  return { issues, artifactBindings };
}

export interface MechanicalAiIntentRuntimeHarnessOptions {
  outputRoot?: string;
  now?: Date;
}

export async function executeMechanicalAiIntentRuntimeHarness(
  repositoryRoot = process.cwd(),
  options: MechanicalAiIntentRuntimeHarnessOptions = {},
) {
  const outputRoot = options.outputRoot ?? 'docs/evidence/cad-independent/local/mechanical-ai-intent-runtime-260813';
  const paths: MechanicalCoreRuntimePaths = {
    artifactRoot: slash(path.posix.join(outputRoot, 'runtime')),
    receiptOutput: slash(path.posix.join(outputRoot, 'runtime-axis-evidence.json')),
  };
  const now = options.now ?? new Date();
  const revision = mechanicalCoreRuntimeSourceRevision(repositoryRoot);
  const prepared = selectRepresentativeMechanicalIntents().map(item => prepareIntent(item, revision.designRevisionSha256));
  const intentBindings = Object.fromEntries(prepared.flatMap(item => item.binding ? [[item.item.feature, item.binding]] : [])) as Partial<Record<MechanicalCoreRuntimeFeature, MechanicalCoreRuntimeIntentBinding>>;
  const runtime = await executeMechanicalCoreRuntimeBundle(repositoryRoot, paths, now, { intentBindings });
  const cases = prepared.map(item => {
    const axes = runtime.receipt.runs.filter(run => run.feature === item.item.feature);
    const runtimePass = axes.length === 7 && axes.every(run => run.status === 'PASS' && run.evidence.length > 0
      && run.evidence.every(binding => verifyMechanicalCoreLocalBinding(repositoryRoot, binding)));
    const artifact = item.binding
      ? verifyFeatureArtifacts(repositoryRoot, paths, item.item.feature as MechanicalCoreRuntimeFeature, item.binding)
      : { issues: ['authoritative_intent_binding_missing'], artifactBindings: [] };
    const issues = [...item.issues, ...(!runtimePass ? ['runtime_seven_axis_incomplete'] : []), ...artifact.issues];
    return {
      caseId: item.item.caseId,
      category: item.item.category,
      feature: item.item.feature,
      candidate: { id: item.candidateId, baseRevision: item.candidateBaseRevision, status: item.status === 'READY' ? 'PASS' : 'BLOCKED' },
      authoritativeInput: item.binding ?? null,
      runtimeAxes: Object.fromEntries(MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES.map(axis => [axis, axes.find(run => run.axis === axis)?.status ?? 'NOT_RUN'])),
      artifactBindings: artifact.artifactBindings,
      status: issues.length === 0 ? 'PASS' : item.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL',
      issues,
    };
  });
  const summary = {
    requiredCases: 10,
    pass: cases.filter(item => item.status === 'PASS').length,
    fail: cases.filter(item => item.status === 'FAIL').length,
    blocked: cases.filter(item => item.status === 'BLOCKED').length,
    requiredAxes: 70,
    axisPass: cases.reduce((sum, item) => sum + Object.values(item.runtimeAxes).filter(status => status === 'PASS').length, 0),
    axisFail: cases.reduce((sum, item) => sum + Object.values(item.runtimeAxes).filter(status => status === 'FAIL').length, 0),
    axisNotRun: cases.reduce((sum, item) => sum + Object.values(item.runtimeAxes).filter(status => status === 'NOT_RUN').length, 0),
  };
  const results = {
    schema: MECHANICAL_AI_INTENT_RUNTIME_SCHEMA,
    generatedAt: now.toISOString(),
    revision: revision.designRevisionSha256,
    executionBoundary: { aiModelCall: 'NOT_RUN', canonicalCandidate: 'EXECUTED', exactGeometry: 'EXECUTED', featureTree: 'EXECUTED', sevenAxisRuntime: 'EXECUTED' },
    cases,
    summary,
    localIntegration: { status: summary.pass === 10 && summary.axisPass === 70 ? 'PASS' : 'FAIL' },
    commercialCampaign: { status: 'NOT_RUN', releaseEligible: false, blockers: ['real_ai_model_campaign_not_run', 'external_commercial_receipt_not_evaluated'] },
  };
  const resultsBinding = writeBound(repositoryRoot, slash(path.posix.join(outputRoot, 'intent-runtime-results.json')), render(results));
  const runtimeReceiptBytes = fs.readFileSync(resolveInside(repositoryRoot, paths.receiptOutput));
  const receipt = {
    schema: 'nexyfab.mechanical-ai-intent-runtime-receipt.v1',
    generatedAt: now.toISOString(),
    textCanonicalization: TEXT_BINDING_CANONICALIZATION,
    revision: revision.designRevisionSha256,
    sourceBindings: revision.sources,
    artifactBindings: [
      resultsBinding,
      { path: paths.receiptOutput, ...canonicalTextBinding(runtimeReceiptBytes) },
    ],
    summary,
    localIntegration: results.localIntegration,
    commercialCampaign: results.commercialCampaign,
    claimBoundary: 'Local deterministic chat-intent to canonical-candidate to exact-runtime integration only; no AI model or external commercial campaign was run.',
  };
  const receiptBinding = writeBound(repositoryRoot, slash(path.posix.join(outputRoot, 'receipt.json')), render(receipt));
  writeBound(repositoryRoot, slash(path.posix.join(outputRoot, 'receipt.sha256')), `${receiptBinding.sha256}  receipt.json\n`);
  return { results, receipt, paths };
}

function option(args: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  return args.find(item => item.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main(args = process.argv.slice(2)): Promise<number> {
  if (!args.includes('--write')) throw new Error('INTENT_RUNTIME_WRITE_FLAG_REQUIRED');
  const outputRoot = option(args, 'output') ?? undefined;
  const result = await executeMechanicalAiIntentRuntimeHarness(process.cwd(), { outputRoot });
  process.stdout.write(`${JSON.stringify({ summary: result.results.summary, localIntegration: result.results.localIntegration, commercialCampaign: result.results.commercialCampaign })}\n`);
  return result.results.localIntegration.status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`[mechanical-ai-intent-runtime-harness] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
