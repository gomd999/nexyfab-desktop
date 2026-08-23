#!/usr/bin/env tsx
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MECHANICAL_CORE_30_FEATURES,
  evaluateMechanicalCoreFeatureClosedLoop,
  type MechanicalCoreFeatureClosedLoopReceiptV1,
} from '../src/lib/ai/mechanicalCoreFeatureContract';
import {
  evaluateMechanicalStepInteroperability,
  type MechanicalStepInteropReceiptV1,
} from '../src/lib/ai/mechanicalStepInteroperability';
import {
  buildMechanicalCoreFeatureLocalReadiness,
  type MechanicalCoreLocalReadinessPaths,
} from './mechanical-core-feature-local-closed-loop';

export const MECHANICAL_CORE_LOCAL_TO_COMMERCIAL_ADAPTER_SCHEMA =
  'nexyfab.mechanical-core-local-to-commercial-adapter.v1' as const;

export interface MechanicalCommercialContractPaths {
  featureReceipt: string;
  featureAssessment: string;
  interoperabilityReceipts: string;
  interoperabilityAssessment: string;
}

export const MECHANICAL_COMMERCIAL_CONTRACT_PATHS: Readonly<MechanicalCommercialContractPaths> = Object.freeze({
  featureReceipt: 'docs/evidence/cad-independent/external/mechanical-core-feature-closed-loop-receipt.json',
  featureAssessment: 'docs/evidence/cad-independent/mechanical-core-feature-closed-loop-assessment.json',
  interoperabilityReceipts: 'docs/evidence/cad-independent/external/mechanical-step-interoperability-receipts.json',
  interoperabilityAssessment: 'docs/evidence/cad-independent/mechanical-step-interoperability-assessment.json',
});

export interface MechanicalCoreLocalToCommercialPaths extends MechanicalCommercialContractPaths {
  localEvidenceInput: string;
  localAssessmentOutput: string;
  adapterAssessmentOutput: string;
}

export const MECHANICAL_CORE_LOCAL_TO_COMMERCIAL_PATHS: Readonly<MechanicalCoreLocalToCommercialPaths> = Object.freeze({
  ...MECHANICAL_COMMERCIAL_CONTRACT_PATHS,
  localEvidenceInput: 'docs/evidence/cad-independent/local/mechanical-core-feature-axis-evidence.json',
  localAssessmentOutput: 'docs/evidence/cad-independent/mechanical-core-feature-local-readiness-260813.json',
  adapterAssessmentOutput: 'docs/evidence/cad-independent/mechanical-core-local-to-commercial-adapter-assessment.json',
});

interface ArtifactBinding { path: string; sha256: string }
interface ContractSignoff { reviewerId: string; signedAt: string; targetHash: string; signature: string }
export interface FeatureEvidenceBundleV2 {
  schema: 'nexyfab.mechanical-core-feature-evidence-bundle.v2';
  evidenceRootId: string;
  receipt: MechanicalCoreFeatureClosedLoopReceiptV1;
  artifacts: { sourceEvidence: ArtifactBinding; nativeRunnerEvidence: ArtifactBinding };
  runner: ContractSignoff;
  validator: ContractSignoff;
}
interface StepTargetEvidenceV2 {
  target: string;
  artifacts: { source: ArtifactBinding; opened: ArtifactBinding; returned: ArtifactBinding; evidenceBundle: ArtifactBinding };
  operator: ContractSignoff;
}
interface StepEvidenceBundleV2 {
  schema: 'nexyfab.mechanical-step-interoperability-evidence-bundle.v3';
  evidenceRootId: string;
  receipts: MechanicalStepInteropReceiptV1[];
  evidence: StepTargetEvidenceV2[];
}
export interface ContractValidationContext {
  evidenceRoot?: string;
  trustedReviewers?: Record<string, { publicKey: string; roles: string[] }>;
  now?: number;
}

export interface MechanicalCoreLocalToCommercialAdapterResult {
  schema: typeof MECHANICAL_CORE_LOCAL_TO_COMMERCIAL_ADAPTER_SCHEMA;
  status: 'PASS' | 'HOLD';
  eligible: boolean;
  localCandidate: {
    status: string;
    eligible: boolean;
    passedFeatures: number;
    axisTotals: Record<string, number>;
    sourceEvidence: { path: string; sha256: string } | null;
  };
  requiredCases: 30;
  caseBinding: readonly {
    feature: string;
    localStatus: string;
    localPassedAxes: number;
    localRequiredAxes: number;
    commercialCasePresent: boolean;
  }[];
  commercial: {
    eligible: boolean;
    blockers: readonly string[];
    sourceReceipt: ArtifactBinding | null;
  };
  receipt: MechanicalCoreFeatureClosedLoopReceiptV1 | null;
}

const sha256 = (bytes: Uint8Array): string => crypto.createHash('sha256').update(bytes).digest('hex');
const render = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const SHA256 = /^[a-f0-9]{64}$/;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

function parseTrustedContractReviewers(raw = process.env.NEXYFAB_MECHANICAL_VALIDATOR_KEYS): Record<string, { publicKey: string; roles: string[] }> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, { publicKey: string; roles: string[] }>
      : {};
  } catch {
    return {};
  }
}

export function mechanicalContractSignoffPayload(role: string, signoff: Omit<ContractSignoff, 'signature'>): string {
  return canonical({ schema: 'nexyfab.mechanical-contract-signoff.v1', role, ...signoff });
}

export function mechanicalFeatureEvidenceTargetHash(bundle: Omit<FeatureEvidenceBundleV2, 'runner' | 'validator'>): string {
  return sha256(Buffer.from(canonical({
    schema: bundle.schema,
    evidenceRootId: bundle.evidenceRootId,
    receipt: bundle.receipt,
    artifacts: bundle.artifacts,
  })));
}

export function mechanicalStepEvidenceTargetHash(
  bundle: Pick<StepEvidenceBundleV2, 'schema' | 'evidenceRootId'>,
  receipt: MechanicalStepInteropReceiptV1,
  evidence: Omit<StepTargetEvidenceV2, 'operator'>,
): string {
  return sha256(Buffer.from(canonical({
    schema: bundle.schema,
    evidenceRootId: bundle.evidenceRootId,
    receipt,
    evidence,
  })));
}

function resolveInside(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error(`MECHANICAL_CONTRACT_PATH_INVALID:${relative}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relative.replaceAll('\\', '/').split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`MECHANICAL_CONTRACT_PATH_ESCAPE:${relative}`);
  }
  return resolved;
}

function optionalJson<T>(root: string, relative: string): { value: T; sha256: string } | null {
  const absolute = resolveInside(root, relative);
  if (!fs.existsSync(absolute)) return null;
  const bytes = fs.readFileSync(absolute);
  return { value: JSON.parse(bytes.toString('utf8')) as T, sha256: sha256(bytes) };
}

function safeExternalFile(evidenceRoot: string | undefined, binding: ArtifactBinding | undefined, extensions: readonly string[]): boolean {
  if (!evidenceRoot?.trim() || !binding || typeof binding.path !== 'string' || !SHA256.test(binding.sha256)) return false;
  const resolvedRoot = path.resolve(evidenceRoot);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) return false;
  const realRoot = fs.realpathSync(resolvedRoot);
  let absolute: string;
  try {
    absolute = resolveInside(realRoot, binding.path);
  } catch {
    return false;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) return false;
  const real = fs.realpathSync(absolute);
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return false;
  return extensions.includes(path.extname(real).toLowerCase()) && sha256(fs.readFileSync(real)) === binding.sha256;
}

function validSignoff(
  role: string,
  signoff: ContractSignoff | undefined,
  expectedTargetHash: string,
  trustedReviewers: Record<string, { publicKey: string; roles: string[] }>,
  now: number,
): boolean {
  const signedAt = Date.parse(signoff?.signedAt ?? '');
  if (!signoff || signoff.targetHash !== expectedTargetHash || !Number.isFinite(signedAt)
    || signedAt > now || now - signedAt > 90 * 24 * 60 * 60 * 1000) return false;
  const registration = trustedReviewers[signoff.reviewerId];
  if (!registration?.roles?.includes(role)) return false;
  try {
    const unsigned = {
      reviewerId: signoff.reviewerId,
      signedAt: signoff.signedAt,
      targetHash: signoff.targetHash,
    };
    return crypto.verify(null, Buffer.from(mechanicalContractSignoffPayload(role, unsigned)), registration.publicKey, Buffer.from(signoff.signature, 'base64'));
  } catch {
    return false;
  }
}

function validateFeatureBundle(bundle: FeatureEvidenceBundleV2 | null, context: Required<ContractValidationContext>): MechanicalCoreFeatureClosedLoopReceiptV1 | null {
  const generatedAt = Date.parse(bundle?.receipt?.generatedAt ?? '');
  if (bundle?.schema !== 'nexyfab.mechanical-core-feature-evidence-bundle.v2'
    || !SHA256.test(bundle?.evidenceRootId ?? '')
    || bundle.receipt?.sourceEvidenceSha256 !== bundle.artifacts?.sourceEvidence?.sha256
    || !Array.isArray(bundle.receipt?.cases)
    || bundle.receipt.cases.length !== MECHANICAL_CORE_30_FEATURES.length
    || new Set(bundle.receipt.cases.map(item => item?.feature)).size !== MECHANICAL_CORE_30_FEATURES.length
    || MECHANICAL_CORE_30_FEATURES.some(feature => !bundle.receipt.cases.some(item => item?.feature === feature))
    || !Number.isFinite(generatedAt) || generatedAt > context.now || context.now - generatedAt > 90 * 24 * 60 * 60 * 1000
    || !safeExternalFile(context.evidenceRoot, bundle.artifacts?.sourceEvidence, ['.json', '.zip', '.pdf'])
    || !safeExternalFile(context.evidenceRoot, bundle.artifacts?.nativeRunnerEvidence, ['.json', '.zip'])) return null;
  const targetHash = mechanicalFeatureEvidenceTargetHash(bundle);
  const runnerValid = validSignoff('feature-native-runner', bundle.runner, targetHash, context.trustedReviewers, context.now);
  const validatorValid = validSignoff('feature-validator', bundle.validator, targetHash, context.trustedReviewers, context.now);
  const runnerKey = context.trustedReviewers[bundle.runner?.reviewerId]?.publicKey;
  const validatorKey = context.trustedReviewers[bundle.validator?.reviewerId]?.publicKey;
  let distinctKeys = false;
  try {
    const fingerprint = (key: string) => sha256(crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }));
    distinctKeys = bundle.runner?.reviewerId !== bundle.validator?.reviewerId
      && Boolean(runnerKey && validatorKey)
      && fingerprint(runnerKey) !== fingerprint(validatorKey);
  } catch { distinctKeys = false; }
  return runnerValid && validatorValid && distinctKeys ? bundle.receipt : null;
}

export function validateMechanicalFeatureEvidenceBundle(
  bundle: FeatureEvidenceBundleV2 | null,
  validationContext: ContractValidationContext = {},
) {
  const context: Required<ContractValidationContext> = {
    evidenceRoot: validationContext.evidenceRoot ?? process.env.NEXYFAB_MECHANICAL_CONTRACT_EVIDENCE_ROOT ?? '',
    trustedReviewers: validationContext.trustedReviewers ?? parseTrustedContractReviewers(),
    now: validationContext.now ?? Date.now(),
  };
  const receipt = validateFeatureBundle(bundle, context);
  const decision = evaluateMechanicalCoreFeatureClosedLoop(receipt);
  const blockers = receipt
    ? decision.blockers
    : [bundle ? 'commercial_feature_bundle_external_binding_missing' : 'commercial_feature_bundle_missing'];
  return {
    eligible: Boolean(receipt && decision.eligible),
    receipt,
    blockers: [...new Set(blockers)],
  };
}

/**
 * Binds the local v1 axis result to the commercial v2 contract without
 * promoting it. Local axes provide an explicit 30-feature mapping, but only a
 * separately supplied, externally bound v2 bundle can produce a commercial
 * PASS (source bytes, native runner evidence, and validator signoff).
 */
export function adaptMechanicalCoreLocalEvidenceToCommercial(
  root: string,
  paths: MechanicalCoreLocalToCommercialPaths = MECHANICAL_CORE_LOCAL_TO_COMMERCIAL_PATHS,
  validationContext: ContractValidationContext = {},
): MechanicalCoreLocalToCommercialAdapterResult {
  const localPaths: MechanicalCoreLocalReadinessPaths = {
    evidenceInput: paths.localEvidenceInput,
    assessmentOutput: paths.localAssessmentOutput,
  };
  const local = buildMechanicalCoreFeatureLocalReadiness(root, localPaths);
  const bundle = optionalJson<FeatureEvidenceBundleV2>(root, paths.featureReceipt);
  const validated = validateMechanicalFeatureEvidenceBundle(bundle?.value ?? null, validationContext);
  const receipt = validated.receipt;
  const commercialDecision = evaluateMechanicalCoreFeatureClosedLoop(receipt);
  const blockers: string[] = [];
  blockers.push(...validated.blockers);
  if (!receipt) blockers.push('local_candidate_is_not_commercial_receipt');
  if (receipt && !commercialDecision.eligible) blockers.push(...commercialDecision.blockers);
  const receiptFeatures = new Set(receipt?.cases.map(item => item.feature) ?? []);
  const caseBinding = local.closedLoop.cases.map(item => ({
    feature: item.feature,
    localStatus: item.status,
    localPassedAxes: item.passedAxes,
    localRequiredAxes: item.requiredAxes,
    commercialCasePresent: receiptFeatures.has(item.feature),
  }));
  const uniqueBlockers = [...new Set(blockers)];
  return {
    schema: MECHANICAL_CORE_LOCAL_TO_COMMERCIAL_ADAPTER_SCHEMA,
    status: uniqueBlockers.length === 0 ? 'PASS' : 'HOLD',
    eligible: uniqueBlockers.length === 0,
    localCandidate: {
      status: local.status,
      eligible: local.eligible,
      passedFeatures: local.closedLoop.passedFeatures,
      axisTotals: local.closedLoop.axisTotals,
      sourceEvidence: local.sourceEvidence,
    },
    requiredCases: 30,
    caseBinding,
    commercial: {
      eligible: receipt ? commercialDecision.eligible : false,
      blockers: uniqueBlockers,
      sourceReceipt: bundle ? { path: paths.featureReceipt, sha256: bundle.sha256 } : null,
    },
    receipt,
  };
}

export function writeMechanicalCoreLocalToCommercialAdapterAssessment(
  root = process.cwd(),
  paths = MECHANICAL_CORE_LOCAL_TO_COMMERCIAL_PATHS,
  validationContext: ContractValidationContext = {},
) {
  const assessment = adaptMechanicalCoreLocalEvidenceToCommercial(root, paths, validationContext);
  const output = resolveInside(root, paths.adapterAssessmentOutput);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, render(assessment));
  return assessment;
}

function validateStepBundle(bundle: StepEvidenceBundleV2 | null, context: Required<ContractValidationContext>): MechanicalStepInteropReceiptV1[] {
  if (bundle?.schema !== 'nexyfab.mechanical-step-interoperability-evidence-bundle.v3' || !SHA256.test(bundle?.evidenceRootId ?? '')) return [];
  const evidenceByTarget = new Map(bundle.evidence?.map(item => [item.target, item]) ?? []);
  return (Array.isArray(bundle.receipts) ? bundle.receipts : []).filter(receipt => {
    const evidence = evidenceByTarget.get(receipt.target);
    if (!evidence || evidence.target !== receipt.target
      || evidence.artifacts.source.sha256 !== receipt.sourceArtifactSha256
      || evidence.artifacts.opened.sha256 !== receipt.openedArtifactSha256
      || evidence.artifacts.returned.sha256 !== receipt.returnedArtifactSha256
      || evidence.artifacts.evidenceBundle.sha256 !== receipt.evidenceBundleSha256
      || !safeExternalFile(context.evidenceRoot, evidence.artifacts.source, ['.step', '.stp'])
      || !safeExternalFile(context.evidenceRoot, evidence.artifacts.opened, ['.step', '.stp', '.sldasm', '.f3d', '.json', '.zip'])
      || !safeExternalFile(context.evidenceRoot, evidence.artifacts.returned, ['.step', '.stp'])
      || !safeExternalFile(context.evidenceRoot, evidence.artifacts.evidenceBundle, ['.json', '.zip', '.pdf'])) return false;
    const targetHash = mechanicalStepEvidenceTargetHash(bundle, receipt, { target: evidence.target, artifacts: evidence.artifacts });
    return evidence.operator.reviewerId === receipt.operatorId
      && evidence.operator.signedAt === receipt.executedAt
      && validSignoff(`step-${receipt.target}-operator`, evidence.operator, targetHash, context.trustedReviewers, context.now);
  });
}

export function buildMechanicalCommercialContractAssessments(
  root: string,
  paths = MECHANICAL_COMMERCIAL_CONTRACT_PATHS,
  generatedAt?: string,
  validationContext: ContractValidationContext = {},
) {
  const feature = optionalJson<FeatureEvidenceBundleV2>(root, paths.featureReceipt);
  const interoperability = optionalJson<StepEvidenceBundleV2>(root, paths.interoperabilityReceipts);
  const context: Required<ContractValidationContext> = {
    evidenceRoot: validationContext.evidenceRoot ?? process.env.NEXYFAB_MECHANICAL_CONTRACT_EVIDENCE_ROOT ?? '',
    trustedReviewers: validationContext.trustedReviewers ?? parseTrustedContractReviewers(),
    now: validationContext.now ?? Date.now(),
  };
  const verifiedFeatureReceipt = validateFeatureBundle(feature?.value ?? null, context);
  const verifiedStepReceipts = validateStepBundle(interoperability?.value ?? null, context);
  const assessedAt = generatedAt ?? [
    feature?.value?.receipt?.generatedAt,
    ...(interoperability?.value?.receipts ?? []).map(receipt => receipt?.executedAt),
  ].filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? null;
  const featureDecision = evaluateMechanicalCoreFeatureClosedLoop(verifiedFeatureReceipt);
  const interoperabilityDecision = evaluateMechanicalStepInteroperability(verifiedStepReceipts);
  return {
    feature: {
      ...featureDecision,
      generatedAt: assessedAt,
      sourceReceipt: feature ? { path: paths.featureReceipt, sha256: feature.sha256 } : null,
    },
    interoperability: {
      ...interoperabilityDecision,
      generatedAt: assessedAt,
      sourceReceipts: interoperability ? { path: paths.interoperabilityReceipts, sha256: interoperability.sha256 } : null,
    },
  };
}

export function writeMechanicalCommercialContractAssessments(
  root = process.cwd(),
  paths = MECHANICAL_COMMERCIAL_CONTRACT_PATHS,
) {
  const assessments = buildMechanicalCommercialContractAssessments(root, paths);
  const outputs = [
    [paths.featureAssessment, assessments.feature],
    [paths.interoperabilityAssessment, assessments.interoperability],
  ] as const;
  for (const [relative, value] of outputs) {
    const absolute = resolveInside(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, render(value));
  }
  return {
    ok: assessments.feature.eligible && assessments.interoperability.eligible,
    feature: assessments.feature,
    interoperability: assessments.interoperability,
  };
}

export function checkMechanicalCommercialContractAssessments(
  root = process.cwd(),
  paths = MECHANICAL_COMMERCIAL_CONTRACT_PATHS,
) {
  const assessments = buildMechanicalCommercialContractAssessments(root, paths);
  const expected = [
    [paths.featureAssessment, assessments.feature],
    [paths.interoperabilityAssessment, assessments.interoperability],
  ] as const;
  const stale = expected
    .filter(([relative, value]) => {
      const absolute = resolveInside(root, relative);
      return !fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== render(value);
    })
    .map(([relative]) => relative);
  const eligible = assessments.feature.eligible && assessments.interoperability.eligible;
  return { ok: stale.length === 0 && eligible, eligible, stale, ...assessments };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write-local-adapter')) {
    const result = writeMechanicalCoreLocalToCommercialAdapterAssessment();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 0;
  } else {
  const write = process.argv.includes('--write');
  const result = write
    ? writeMechanicalCommercialContractAssessments()
    : checkMechanicalCommercialContractAssessments();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = write || result.ok ? 0 : 1;
  }
}
