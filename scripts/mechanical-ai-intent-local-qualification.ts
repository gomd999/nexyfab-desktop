#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
  canonicalTextSha256,
} from './canonical-text-binding.mjs';
import {
  createAiCanonicalCandidate,
  guardAiCanonicalCandidate,
} from '../src/lib/ai/aiCanonicalCandidate';
import {
  buildGuidedDesignBrief,
  buildGuidedRequirementGate,
  seedGuidedBriefInputs,
} from '../src/lib/ai/guidedDesignBrief';
import {
  isMechanicalCoreFeatureId,
  MECHANICAL_CORE_30_FEATURES,
  MECHANICAL_CORE_AI_EDITABLE_FEATURES,
  type MechanicalCoreFeatureId,
} from '../src/lib/ai/mechanicalCoreFeatureContract';

export const MECHANICAL_AI_INTENT_CORPUS_SCHEMA =
  'nexyfab.mechanical-ai-intent-corpus.v1' as const;
export const MECHANICAL_AI_INTENT_RESULTS_SCHEMA =
  'nexyfab.mechanical-ai-intent-local-results.v1' as const;
export const MECHANICAL_AI_INTENT_RECEIPT_SCHEMA =
  'nexyfab.mechanical-ai-intent-local-qualification-receipt.v1' as const;

export const MECHANICAL_AI_INTENT_CATEGORIES = [
  'ko_practical',
  'en_practical',
  'mixed_units',
  'missing_required',
  'contradictory_or_unmanufacturable',
] as const;

export type MechanicalAiIntentCategory = (typeof MECHANICAL_AI_INTENT_CATEGORIES)[number];
type ExpectedRequirementOutcome = 'READY' | 'BLOCKED';
type QualificationStatus = 'PASS' | 'FAIL';
type GateStatus = 'PASS' | 'BLOCKED' | 'FAIL';
type EligibilityStatus = 'ELIGIBLE' | 'BLOCKED';

interface FeatureLanguage {
  ko: string;
  en: string;
}

const FEATURE_LANGUAGE: Record<MechanicalCoreFeatureId, FeatureLanguage> = {
  hole: { ko: '구멍', en: 'hole' },
  fillet: { ko: '필렛', en: 'fillet' },
  chamfer: { ko: '모따기', en: 'chamfer' },
  shell: { ko: '쉘', en: 'shell' },
  rib: { ko: '리브', en: 'rib' },
  linearPattern: { ko: '선형 패턴', en: 'linear pattern' },
  circularPattern: { ko: '원형 패턴', en: 'circular pattern' },
  draft: { ko: '구배', en: 'draft' },
  scale: { ko: '스케일', en: 'scale' },
  moveCopy: { ko: '이동 복사', en: 'move copy' },
  variableFillet: { ko: '가변 필렛', en: 'variable fillet' },
  offsetFace: { ko: '면 오프셋', en: 'offset face' },
  thread: { ko: '나사산', en: 'thread' },
  helix: { ko: '나선', en: 'helix' },
  bend: { ko: '굽힘', en: 'bend' },
  flange: { ko: '플랜지', en: 'flange' },
  hem: { ko: '헤밍', en: 'hem' },
  jog: { ko: '조그', en: 'jog' },
  tab: { ko: '탭', en: 'tab' },
  cut: { ko: '절단', en: 'cut' },
  bendRelief: { ko: '굽힘 릴리프', en: 'bend relief' },
  cornerRelief: { ko: '코너 릴리프', en: 'corner relief' },
  variableShell: { ko: '가변 쉘', en: 'variable shell' },
  sketchExtrude: { ko: '스케치 돌출', en: 'sketch extrude' },
  revolve: { ko: '회전', en: 'revolve' },
  sweep: { ko: '스윕', en: 'sweep' },
  loft: { ko: '로프트', en: 'loft' },
  mirror: { ko: '미러', en: 'mirror' },
  boolean: { ko: '불리언', en: 'boolean' },
  splitBody: { ko: '바디 분할', en: 'split body' },
};

export interface MechanicalAiIntentCorpusCase {
  caseId: string;
  category: MechanicalAiIntentCategory;
  feature: MechanicalCoreFeatureId;
  prompt: string;
  expectedRequirementOutcome: ExpectedRequirementOutcome;
  negativeReason?: 'missing_required' | 'contradictory' | 'unmanufacturable';
}

export interface MechanicalAiIntentCorpus {
  schema: typeof MECHANICAL_AI_INTENT_CORPUS_SCHEMA;
  frozenDefinition: true;
  featureContract: readonly MechanicalCoreFeatureId[];
  categories: readonly MechanicalAiIntentCategory[];
  cases: MechanicalAiIntentCorpusCase[];
}

export interface MechanicalAiIntentCaseResult {
  caseId: string;
  category: MechanicalAiIntentCategory;
  expectedFeature: MechanicalCoreFeatureId;
  parsedFeature: MechanicalCoreFeatureId | null;
  expectedRequirementOutcome: ExpectedRequirementOutcome;
  parse: { status: QualificationStatus; issues: string[] };
  requirementsGate: { status: GateStatus; ready: boolean; issues: string[]; nextQuestion: string | null };
  candidateValidation: { status: GateStatus; state: 'PREVIEW' | 'BLOCKED'; issues: string[] };
  geometry: { eligibility: EligibilityStatus; execution: 'NOT_RUN'; blockers: string[] };
  verification: { eligibility: 'BLOCKED'; execution: 'NOT_RUN'; blockers: string[] };
  qualification: { status: QualificationStatus; assertions: string[] };
}

function sha256Bytes(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function promptFor(
  category: MechanicalAiIntentCategory,
  feature: MechanicalCoreFeatureId,
  index: number,
): Pick<MechanicalAiIntentCorpusCase, 'prompt' | 'expectedRequirementOutcome' | 'negativeReason'> {
  const label = FEATURE_LANGUAGE[feature];
  if (category === 'ko_practical') {
    return {
      prompt: `6061-T6 알루미늄을 CNC 가공해서 100×60×8 mm 기준의 ${label.ko} 기능을 적용한 정밀 브래킷을 설계해줘.`,
      expectedRequirementOutcome: 'READY',
    };
  }
  if (category === 'en_practical') {
    return {
      prompt: `Design a precision bracket with the ${label.en} feature, 100 x 60 x 8 mm, in 6061-T6 aluminum using CNC milling.`,
      expectedRequirementOutcome: 'READY',
    };
  }
  if (category === 'mixed_units') {
    return {
      prompt: `Design a precision bracket with the ${label.en} feature: 100 mm × 60 mm × 6.35 mm (3.937 in × 2.362 in × 0.25 in), 6061-T6 aluminum, CNC milled.`,
      expectedRequirementOutcome: 'READY',
    };
  }
  if (category === 'missing_required') {
    return {
      prompt: `Design a precision bracket using the ${label.en} feature.`,
      expectedRequirementOutcome: 'BLOCKED',
      negativeReason: 'missing_required',
    };
  }
  if (index % 2 === 0) {
    return {
      prompt: `Design a precision bracket with the ${label.en} feature, 100 x 60 x 8 mm, using aluminum or steel with CNC milling.`,
      expectedRequirementOutcome: 'BLOCKED',
      negativeReason: 'contradictory',
    };
  }
  return {
    prompt: `Design a precision bracket with the ${label.en} feature, 100 x 60 x 0 mm, in 6061-T6 aluminum; manufacturing impossible.`,
    expectedRequirementOutcome: 'BLOCKED',
    negativeReason: 'unmanufacturable',
  };
}

export function buildMechanicalAiIntentCorpus(): MechanicalAiIntentCorpus {
  const cases = MECHANICAL_AI_INTENT_CATEGORIES.flatMap(category =>
    MECHANICAL_CORE_30_FEATURES.map((feature, index) => ({
      caseId: `${category}-${String(index + 1).padStart(2, '0')}-${feature}`,
      category,
      feature,
      ...promptFor(category, feature, index),
    })));
  return {
    schema: MECHANICAL_AI_INTENT_CORPUS_SCHEMA,
    frozenDefinition: true,
    featureContract: [...MECHANICAL_CORE_30_FEATURES],
    categories: [...MECHANICAL_AI_INTENT_CATEGORIES],
    cases,
  };
}

function parseMechanicalFeatureIntent(prompt: string): { feature: MechanicalCoreFeatureId | null; issues: string[] } {
  const normalized = prompt.normalize('NFKC').toLocaleLowerCase('en-US');
  const matches = MECHANICAL_CORE_30_FEATURES.flatMap(feature => {
    const aliases = Object.values(FEATURE_LANGUAGE[feature]);
    const alias = aliases.filter(value => normalized.includes(value.toLocaleLowerCase('en-US')))
      .sort((left, right) => right.length - left.length)[0];
    return alias ? [{ feature, alias }] : [];
  }).sort((left, right) => right.alias.length - left.alias.length);
  if (!matches.length) return { feature: null, issues: ['feature_intent_not_parsed'] };
  const mostSpecific = matches[0]!;
  const ambiguous = matches.find(item => item.feature !== mostSpecific.feature && item.alias.length === mostSpecific.alias.length);
  return ambiguous
    ? { feature: null, issues: [`ambiguous_feature_intent:${mostSpecific.feature}:${ambiguous.feature}`] }
    : { feature: mostSpecific.feature, issues: [] };
}

function exactNextQuestion(gate: ReturnType<typeof buildGuidedRequirementGate>): string | null {
  if (!gate.nextInput) return null;
  const action = gate.nextInput.reason === 'CONFLICT' ? 'Confirm one value for' : 'Provide';
  return `${action} ${gate.nextInput.label} (${gate.nextInput.domain}.${gate.nextInput.key}).`;
}

export function evaluateMechanicalAiIntentCase(item: MechanicalAiIntentCorpusCase): MechanicalAiIntentCaseResult {
  const parsed = parseMechanicalFeatureIntent(item.prompt);
  const parseStatus: QualificationStatus = parsed.feature === item.feature && parsed.issues.length === 0 ? 'PASS' : 'FAIL';
  const brief = buildGuidedDesignBrief({
    prompt: item.prompt,
    requestedStage: 'exact',
    selectedDomains: ['mechanical'],
    inputs: seedGuidedBriefInputs(item.prompt, 'mechanical'),
  });
  const gate = buildGuidedRequirementGate(brief);
  const requirementStatus: GateStatus = gate.ready ? 'PASS' : 'BLOCKED';
  const revision = sha256Bytes(`${item.caseId}\0${item.prompt}`);
  const candidate = createAiCanonicalCandidate({
    id: `local-qualification:${item.caseId}`,
    kind: 'intent',
    baseRevision: revision,
    summary: `Local deterministic qualification for ${item.feature}`,
    payload: {
      intents: [{
        kind: 'add_feature',
        featureType: parsed.feature ?? item.feature,
        params: { qualificationOnly: true },
      }],
    },
    requirementGate: gate,
    now: '2026-08-13T00:00:00.000Z',
  });
  const guard = guardAiCanonicalCandidate(candidate, revision);
  const candidateStatus: GateStatus = guard.allowed && candidate.state === 'PREVIEW'
    ? 'PASS'
    : candidate.state === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
  const geometryEligible = parseStatus === 'PASS'
    && gate.ready
    && guard.allowed
    && parsed.feature !== null
    && isMechanicalCoreFeatureId(parsed.feature)
    && MECHANICAL_CORE_AI_EDITABLE_FEATURES.has(parsed.feature);
  const geometryBlockers = [
    ...(parseStatus === 'FAIL' ? ['parse_failed'] : []),
    ...(!gate.ready ? ['requirements_gate_blocked'] : []),
    ...(!guard.allowed ? ['candidate_validation_blocked'] : []),
    ...(parsed.feature && !MECHANICAL_CORE_AI_EDITABLE_FEATURES.has(parsed.feature) ? ['feature_not_ai_editable'] : []),
  ];
  const expectedReady = item.expectedRequirementOutcome === 'READY';
  const assertions = [
    ...(parseStatus !== 'PASS' ? ['feature_parse_mismatch'] : []),
    ...(gate.ready !== expectedReady ? [`requirements_expected_${item.expectedRequirementOutcome.toLowerCase()}`] : []),
    ...(expectedReady && candidateStatus !== 'PASS' ? ['candidate_expected_pass'] : []),
    ...(!expectedReady && candidateStatus !== 'BLOCKED' ? ['candidate_expected_blocked'] : []),
    ...(expectedReady && !geometryEligible ? ['geometry_expected_eligible'] : []),
    ...(!expectedReady && geometryEligible ? ['geometry_expected_blocked'] : []),
  ];
  return {
    caseId: item.caseId,
    category: item.category,
    expectedFeature: item.feature,
    parsedFeature: parsed.feature,
    expectedRequirementOutcome: item.expectedRequirementOutcome,
    parse: { status: parseStatus, issues: parsed.issues },
    requirementsGate: {
      status: requirementStatus,
      ready: gate.ready,
      issues: gate.issues,
      nextQuestion: exactNextQuestion(gate),
    },
    candidateValidation: {
      status: candidateStatus,
      state: candidate.state === 'PREVIEW' ? 'PREVIEW' : 'BLOCKED',
      issues: guard.issues,
    },
    geometry: {
      eligibility: geometryEligible ? 'ELIGIBLE' : 'BLOCKED',
      execution: 'NOT_RUN',
      blockers: geometryBlockers,
    },
    verification: {
      eligibility: 'BLOCKED',
      execution: 'NOT_RUN',
      blockers: ['geometry_not_executed'],
    },
    qualification: { status: assertions.length === 0 ? 'PASS' : 'FAIL', assertions },
  };
}

export function buildMechanicalAiIntentLocalQualification(generatedAt = new Date().toISOString()) {
  const corpus = buildMechanicalAiIntentCorpus();
  const cases = corpus.cases.map(evaluateMechanicalAiIntentCase);
  const categoryCounts = Object.fromEntries(MECHANICAL_AI_INTENT_CATEGORIES.map(category => [
    category,
    cases.filter(item => item.category === category).length,
  ])) as Record<MechanicalAiIntentCategory, number>;
  const summary = {
    total: cases.length,
    categoryCounts,
    parsePass: cases.filter(item => item.parse.status === 'PASS').length,
    requirementsReady: cases.filter(item => item.requirementsGate.status === 'PASS').length,
    negativeCorrectlyBlocked: cases.filter(item => item.expectedRequirementOutcome === 'BLOCKED' && item.requirementsGate.status === 'BLOCKED').length,
    candidatePass: cases.filter(item => item.candidateValidation.status === 'PASS').length,
    candidateBlocked: cases.filter(item => item.candidateValidation.status === 'BLOCKED').length,
    geometryEligible: cases.filter(item => item.geometry.eligibility === 'ELIGIBLE').length,
    geometryBlocked: cases.filter(item => item.geometry.eligibility === 'BLOCKED').length,
    geometryExecution: { PASS: 0, FAIL: 0, NOT_RUN: cases.filter(item => item.geometry.execution === 'NOT_RUN').length },
    verificationEligibility: { ELIGIBLE: 0, BLOCKED: cases.filter(item => item.verification.eligibility === 'BLOCKED').length },
    verificationExecution: { PASS: 0, FAIL: 0, NOT_RUN: cases.filter(item => item.verification.execution === 'NOT_RUN').length },
    expectedOutcomePass: cases.filter(item => item.qualification.status === 'PASS').length,
    expectedOutcomeFail: cases.filter(item => item.qualification.status === 'FAIL').length,
  };
  const localQualificationPass = summary.total === 150
    && Object.values(summary.categoryCounts).every(count => count === 30)
    && summary.parsePass === 150
    && summary.requirementsReady === 90
    && summary.negativeCorrectlyBlocked === 60
    && summary.candidatePass === 90
    && summary.candidateBlocked === 60
    && summary.geometryEligible === 90
    && summary.geometryExecution.NOT_RUN === 150
    && summary.verificationExecution.NOT_RUN === 150
    && summary.expectedOutcomePass === 150;
  return {
    corpus,
    results: {
      schema: MECHANICAL_AI_INTENT_RESULTS_SCHEMA,
      generatedAt,
      executionBoundary: {
        parser: 'LOCAL_DETERMINISTIC',
        aiModelCall: 'NOT_RUN',
        geometry: 'NOT_RUN',
        verification: 'NOT_RUN',
      },
      cases,
      summary,
      localQualification: {
        status: localQualificationPass ? 'PASS' : 'FAIL',
        scope: 'parse_requirements_candidate_and_eligibility_only',
      },
      commercialCampaign: {
        status: 'NOT_RUN',
        releaseEligible: false,
        blockers: [
          'real_ai_model_campaign_not_run',
          'geometry_execution_not_run',
          'verification_execution_not_run',
          'external_commercial_receipt_not_evaluated',
        ],
      },
    },
  } as const;
}

function option(args: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  return args.find(item => item.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function repositoryPath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replaceAll('\\', '/');
}

function sourceBinding(relativePath: string) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const bytes = fs.readFileSync(absolutePath);
  return { path: relativePath.replaceAll('\\', '/'), ...canonicalTextBinding(bytes) };
}

export function writeMechanicalAiIntentLocalQualification(
  outputDirectory: string,
  generatedAt = new Date().toISOString(),
) {
  const bundle = buildMechanicalAiIntentLocalQualification(generatedAt);
  const output = path.resolve(outputDirectory);
  fs.mkdirSync(output, { recursive: true });
  const corpusPath = path.join(output, 'corpus.json');
  const resultsPath = path.join(output, 'results.json');
  const receiptPath = path.join(output, 'receipt.json');
  const corpusText = canonicalJson(bundle.corpus);
  const resultsText = canonicalJson(bundle.results);
  fs.writeFileSync(corpusPath, corpusText);
  fs.writeFileSync(resultsPath, resultsText);
  const receipt = {
    schema: MECHANICAL_AI_INTENT_RECEIPT_SCHEMA,
    generatedAt,
    textCanonicalization: TEXT_BINDING_CANONICALIZATION,
    qualificationClass: 'LOCAL_DETERMINISTIC_NO_GEOMETRY',
    sourceBindings: [
      sourceBinding('scripts/mechanical-ai-intent-local-qualification.ts'),
      sourceBinding('src/lib/ai/guidedDesignBrief.ts'),
      sourceBinding('src/lib/ai/aiCanonicalCandidate.ts'),
      sourceBinding('src/lib/ai/mechanicalCoreFeatureContract.ts'),
    ],
    artifactBindings: [
      { path: repositoryPath(corpusPath), ...canonicalTextBinding(corpusText) },
      { path: repositoryPath(resultsPath), ...canonicalTextBinding(resultsText) },
    ],
    summary: bundle.results.summary,
    localQualification: bundle.results.localQualification,
    commercialCampaign: bundle.results.commercialCampaign,
    claimBoundary: 'This receipt proves deterministic local intake qualification only. It does not prove an AI model call, geometry creation, CAD verification, manufacturing fitness, or commercial release readiness.',
  };
  const receiptText = canonicalJson(receipt);
  fs.writeFileSync(receiptPath, receiptText);
  fs.writeFileSync(path.join(output, 'receipt.sha256'), `${canonicalTextSha256(receiptText)}  receipt.json\n`);
  return { output, corpusPath, resultsPath, receiptPath, receipt };
}

export function main(args = process.argv.slice(2)): number {
  const output = option(args, 'output')
    ?? 'docs/evidence/cad-independent/local/mechanical-ai-intent-qualification-260813';
  const generatedAt = option(args, 'generated-at') ?? new Date().toISOString();
  const written = writeMechanicalAiIntentLocalQualification(output, generatedAt);
  process.stdout.write(`${JSON.stringify({
    ok: written.receipt.localQualification.status === 'PASS',
    output: repositoryPath(written.output),
    total: written.receipt.summary.total,
    localQualification: written.receipt.localQualification.status,
    commercialCampaign: written.receipt.commercialCampaign.status,
    geometryExecution: written.receipt.summary.geometryExecution,
    verificationExecution: written.receipt.summary.verificationExecution,
  })}\n`);
  return written.receipt.localQualification.status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[mechanical-ai-intent-local-qualification] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
