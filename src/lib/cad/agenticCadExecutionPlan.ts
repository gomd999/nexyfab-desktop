import { Sha256 } from '@aws-crypto/sha256-js';
import {
  canonicalCadConsumerDraftJson,
  type CanonicalCadArtifactBinding,
  type CanonicalCadDomain,
  type CanonicalCadResourceBudget,
  type CanonicalCadRevisionRef,
  type CanonicalCadRiskClass,
} from './canonicalCadV2ConsumerDraft';
import {
  AGENTIC_CAD_TOOL_REGISTRY_HASH,
  getAgenticCadToolDescriptor,
  type AgenticCadToolId,
  type AgenticCadToolPermission,
  type AgenticCadToolSideEffect,
} from './agenticCadToolRegistry';
import { FEATURE_REGISTRY_HASH } from './featureRegistry';

export const AGENTIC_CAD_EXECUTION_PLAN_SCHEMA =
  'nexyfab.precision-cad.agent-execution-plan-consumer-draft.v1' as const;
export const AGENTIC_CAD_DRY_RUN_RECEIPT_SCHEMA =
  'nexyfab.precision-cad.agent-dry-run-receipt-consumer-draft.v1' as const;
export const AGENTIC_CAD_POLICY_RECEIPT_SCHEMA =
  'nexyfab.precision-cad.agent-policy-receipt-consumer-draft.v1' as const;
export const AGENTIC_CAD_APPROVAL_CANDIDATE_SCHEMA =
  'nexyfab.precision-cad.agent-approval-candidate-consumer-draft.v1' as const;

export interface AgenticCadPlanInputArtifact extends CanonicalCadArtifactBinding {
  schema: string;
}

export interface AgenticCadPlanStep {
  stepId: string;
  toolId: AgenticCadToolId;
  toolVersion: 1;
  input: AgenticCadPlanInputArtifact;
  dependencies: string[];
  expectedChangedObjectIds: string[];
  expectedOutputArtifactIds: string[];
  riskClass: CanonicalCadRiskClass;
  sideEffect: AgenticCadToolSideEffect;
  idempotencyKey: string | null;
  canonicalCommandSha256: string | null;
  featureRegistryHash: string | null;
  runtimeIdentitySha256: string | null;
  preflightReceiptSha256: string | null;
  resourceBudget: CanonicalCadResourceBudget;
  verifierIds: string[];
}

export interface AgenticCadExecutionPlan {
  schema: typeof AGENTIC_CAD_EXECUTION_PLAN_SCHEMA;
  contractVersion: 1;
  authority: 'CONSUMER_DRAFT';
  planId: string;
  planSha256: string;
  registryHash: string;
  projectId: string;
  documentId: string;
  domain: CanonicalCadDomain;
  baseRevision: CanonicalCadRevisionRef;
  lockSetSha256: string;
  agentIdentity: { agentId: string; modelId: string; promptSha256: string };
  steps: AgenticCadPlanStep[];
  highestRisk: CanonicalCadRiskClass;
  issuedAt: string;
  expiresAt: string;
  staleIf: { baseRevisionChanges: true; baseContentHashChanges: true; lockSetChanges: true; registryChanges: true };
  status: 'DRY_RUN_ONLY';
  release: 'HOLD';
}

export interface CreateAgenticCadPlanStepInput {
  stepId: string;
  toolId: AgenticCadToolId;
  input: AgenticCadPlanInputArtifact;
  dependencies?: string[];
  expectedChangedObjectIds?: string[];
  expectedOutputArtifactIds?: string[];
  idempotencyKey?: string | null;
  canonicalCommandSha256?: string | null;
  featureRegistryHash?: string | null;
  runtimeIdentitySha256?: string | null;
  preflightReceiptSha256?: string | null;
}

export interface CreateAgenticCadPlanInput {
  planId: string;
  projectId: string;
  documentId: string;
  domain: CanonicalCadDomain;
  baseRevision: CanonicalCadRevisionRef;
  lockSetSha256: string;
  agentIdentity: { agentId: string; modelId: string; promptSha256: string };
  steps: CreateAgenticCadPlanStepInput[];
  issuedAt: string;
  expiresAt: string;
}

export type AgenticCadDryRunStepStatus = 'PASS' | 'HOLD';
export type AgenticCadInvalidationScope =
  | 'exactGeometry' | 'nativeDocument' | 'analysis' | 'drawing'
  | 'quantity' | 'exchange' | 'qualification';

export interface AgenticCadDryRunStepOutcome {
  stepId: string;
  status: AgenticCadDryRunStepStatus;
  changedObjectIds: string[];
  invalidated: AgenticCadInvalidationScope[];
  findingCodes: string[];
  outputArtifacts: CanonicalCadArtifactBinding[];
  evidenceSha256: string;
}

export interface AgenticCadDryRunStepReceipt extends AgenticCadDryRunStepOutcome {
  toolId: AgenticCadToolId;
  inputSha256: string;
  canonicalCommandSha256: string | null;
}

export interface AgenticCadDryRunReceipt {
  schema: typeof AGENTIC_CAD_DRY_RUN_RECEIPT_SCHEMA;
  authority: 'SANDBOX_EVIDENCE_ONLY';
  planId: string;
  planSha256: string;
  registryHash: string;
  baseRevision: CanonicalCadRevisionRef;
  status: AgenticCadDryRunStepStatus;
  steps: AgenticCadDryRunStepReceipt[];
  createdAt: string;
  verification: 'NOT_AUTHORITATIVE';
  release: 'HOLD';
  receiptSha256: string;
}

export type AgenticCadPolicyStatus =
  | 'READ_ONLY_READY'
  | 'DRY_RUN_REQUIRED'
  | 'SANDBOX_COMPLETE'
  | 'AWAITING_HUMAN_APPROVAL'
  | 'BLOCK';

export interface AgenticCadPolicyReceipt {
  schema: typeof AGENTIC_CAD_POLICY_RECEIPT_SCHEMA;
  authority: 'POLICY_EVALUATION_ONLY';
  planId: string | null;
  planSha256: string | null;
  registryHash: string;
  status: AgenticCadPolicyStatus;
  issues: string[];
  evaluatedAt: string;
  dryRunReceiptSha256: string | null;
  authoritativeCommit: 'NOT_AUTHORIZED';
  release: 'HOLD';
  receiptSha256: string;
}

export interface AgenticCadPolicyContext {
  currentRevision: CanonicalCadRevisionRef;
  currentLockSetSha256: string;
  evaluatedAt: string;
  permissions: AgenticCadToolPermission[];
  dryRunReceipt?: unknown;
}

export interface AgenticCadApprovalCandidate {
  schema: typeof AGENTIC_CAD_APPROVAL_CANDIDATE_SCHEMA;
  authority: 'UNTRUSTED_CANDIDATE';
  planId: string;
  planSha256: string;
  policyReceiptSha256: string;
  dryRunReceiptSha256: string;
  humanActorId: string;
  approvalScope: string;
  approvedStepIds: string[];
  issuedAt: string;
  expiresAt: string;
  status: 'AWAITING_TRUSTED_AUTHORITY';
  authoritativeCommit: 'NOT_AUTHORIZED';
  release: 'HOLD';
  candidateSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FINDING = /^[A-Z][A-Z0-9_:-]{0,127}$/;
const SCHEMA = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const DOMAINS = new Set<CanonicalCadDomain>(['mechanical', 'building', 'interior', 'civil', 'landscape', 'coordination']);
const INVALIDATIONS = new Set<AgenticCadInvalidationScope>(['exactGeometry', 'nativeDocument', 'analysis', 'drawing', 'quantity', 'exchange', 'qualification']);
const RISKS: readonly CanonicalCadRiskClass[] = ['R0', 'R1', 'R2', 'R3', 'R4'];
const PLAN_KEYS = ['schema', 'contractVersion', 'authority', 'planId', 'planSha256', 'registryHash', 'projectId', 'documentId', 'domain', 'baseRevision', 'lockSetSha256', 'agentIdentity', 'steps', 'highestRisk', 'issuedAt', 'expiresAt', 'staleIf', 'status', 'release'] as const;
const STEP_KEYS = ['stepId', 'toolId', 'toolVersion', 'input', 'dependencies', 'expectedChangedObjectIds', 'expectedOutputArtifactIds', 'riskClass', 'sideEffect', 'idempotencyKey', 'canonicalCommandSha256', 'featureRegistryHash', 'runtimeIdentitySha256', 'preflightReceiptSha256', 'resourceBudget', 'verifierIds'] as const;
const DRY_KEYS = ['schema', 'authority', 'planId', 'planSha256', 'registryHash', 'baseRevision', 'status', 'steps', 'createdAt', 'verification', 'release', 'receiptSha256'] as const;
const DRY_STEP_KEYS = ['stepId', 'toolId', 'status', 'changedObjectIds', 'invalidated', 'findingCodes', 'outputArtifacts', 'evidenceSha256', 'inputSha256', 'canonicalCommandSha256'] as const;
const POLICY_KEYS = ['schema', 'authority', 'planId', 'planSha256', 'registryHash', 'status', 'issues', 'evaluatedAt', 'dryRunReceiptSha256', 'authoritativeCommit', 'release', 'receiptSha256'] as const;
const POLICY_STATUSES = new Set<AgenticCadPolicyStatus>(['READ_ONLY_READY', 'DRY_RUN_REQUIRED', 'SANDBOX_COMPLETE', 'AWAITING_HUMAN_APPROVAL', 'BLOCK']);

function sha256(value: string): string {
  const hash = new Sha256();
  hash.update(value);
  return Array.from(hash.digestSync(), byte => byte.toString(16).padStart(2, '0')).join('');
}

function hashDomain(domain: string, value: unknown): string {
  return sha256(`${domain}\n${canonicalCadConsumerDraftJson(value)}`);
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every(key => typeof key === 'string' && Boolean(Object.getOwnPropertyDescriptor(value, key)?.enumerable)
    && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isDataArray(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype) return false;
  return Reflect.ownKeys(value).every(key => key === 'length' || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)
    && Boolean(Object.getOwnPropertyDescriptor(value, key)?.enumerable) && 'value' in Object.getOwnPropertyDescriptor(value, key)!));
}

function isStringArray(value: unknown, maximum: number, pattern = ID): value is string[] {
  return isDataArray(value, maximum) && value.every(item => typeof item === 'string' && pattern.test(item))
    && new Set(value).size === value.length;
}

function sameRevision(left: unknown, right: unknown): boolean {
  if (!isDataRecord(left) || !isDataRecord(right)) return false;
  return left.revisionId === right.revisionId && left.sequence === right.sequence && left.contentSha256 === right.contentSha256;
}

function validateRevision(value: unknown, path: string, issues: string[]): void {
  if (!isDataRecord(value) || !exactKeys(value, ['revisionId', 'sequence', 'contentSha256'])
    || typeof value.revisionId !== 'string' || !ID.test(value.revisionId)
    || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0
    || typeof value.contentSha256 !== 'string' || !SHA256.test(value.contentSha256)) issues.push(`${path}:invalid`);
}

function validateArtifact(value: unknown, path: string, withSchema: boolean, issues: string[]): void {
  const keys = withSchema ? ['artifactId', 'contentSha256', 'schema'] : ['artifactId', 'contentSha256'];
  if (!isDataRecord(value) || !exactKeys(value, keys)
    || typeof value.artifactId !== 'string' || !ID.test(value.artifactId)
    || typeof value.contentSha256 !== 'string' || !SHA256.test(value.contentSha256)
    || (withSchema && (typeof value.schema !== 'string' || !SCHEMA.test(value.schema)))) issues.push(`${path}:invalid`);
}

function validateBudget(value: unknown, path: string, issues: string[]): void {
  if (!isDataRecord(value) || !exactKeys(value, ['timeoutMs', 'memoryMb', 'maxIterations', 'maxRetries'])) {
    issues.push(`${path}:invalid`);
    return;
  }
  if (!Number.isSafeInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > 300_000
    || !Number.isSafeInteger(value.memoryMb) || Number(value.memoryMb) < 16 || Number(value.memoryMb) > 8_192
    || !Number.isSafeInteger(value.maxIterations) || Number(value.maxIterations) < 1 || Number(value.maxIterations) > 10_000
    || !Number.isSafeInteger(value.maxRetries) || Number(value.maxRetries) < 0 || Number(value.maxRetries) > 5) issues.push(`${path}:invalid`);
}

function planUnsigned(plan: AgenticCadExecutionPlan): Omit<AgenticCadExecutionPlan, 'planSha256'> {
  const { planSha256: _ignored, ...unsigned } = plan;
  void _ignored;
  return unsigned;
}

export function hashAgenticCadExecutionPlan(plan: AgenticCadExecutionPlan): string {
  return hashDomain('nexyfab.precision-cad.agent-execution-plan.sha256.v1', planUnsigned(plan));
}

export function createAgenticCadExecutionPlan(input: CreateAgenticCadPlanInput): AgenticCadExecutionPlan {
  const steps: AgenticCadPlanStep[] = input.steps.map(candidate => {
    const descriptor = getAgenticCadToolDescriptor(candidate.toolId);
    if (!descriptor) throw new Error(`unknown_agent_tool:${candidate.toolId}`);
    return {
      stepId: candidate.stepId,
      toolId: descriptor.toolId,
      toolVersion: descriptor.version,
      input: structuredClone(candidate.input),
      dependencies: structuredClone(candidate.dependencies ?? []),
      expectedChangedObjectIds: structuredClone(candidate.expectedChangedObjectIds ?? []),
      expectedOutputArtifactIds: structuredClone(candidate.expectedOutputArtifactIds ?? []),
      riskClass: descriptor.riskClass,
      sideEffect: descriptor.sideEffect,
      idempotencyKey: candidate.idempotencyKey ?? null,
      canonicalCommandSha256: candidate.canonicalCommandSha256 ?? null,
      featureRegistryHash: candidate.featureRegistryHash ?? null,
      runtimeIdentitySha256: candidate.runtimeIdentitySha256 ?? null,
      preflightReceiptSha256: candidate.preflightReceiptSha256 ?? null,
      resourceBudget: structuredClone(descriptor.resourceBudget),
      verifierIds: [...descriptor.verifierIds],
    };
  });
  const plan: AgenticCadExecutionPlan = {
    schema: AGENTIC_CAD_EXECUTION_PLAN_SCHEMA,
    contractVersion: 1,
    authority: 'CONSUMER_DRAFT',
    planId: input.planId,
    planSha256: '',
    registryHash: AGENTIC_CAD_TOOL_REGISTRY_HASH,
    projectId: input.projectId,
    documentId: input.documentId,
    domain: input.domain,
    baseRevision: structuredClone(input.baseRevision),
    lockSetSha256: input.lockSetSha256,
    agentIdentity: structuredClone(input.agentIdentity),
    steps,
    highestRisk: steps.reduce<CanonicalCadRiskClass>((highest, step) => RISKS.indexOf(step.riskClass) > RISKS.indexOf(highest) ? step.riskClass : highest, 'R0'),
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    staleIf: { baseRevisionChanges: true, baseContentHashChanges: true, lockSetChanges: true, registryChanges: true },
    status: 'DRY_RUN_ONLY',
    release: 'HOLD',
  };
  plan.planSha256 = hashAgenticCadExecutionPlan(plan);
  const issues = validateAgenticCadExecutionPlan(plan);
  if (issues.length) throw new Error(`invalid_agent_execution_plan:${issues.join(',')}`);
  return plan;
}

export function validateAgenticCadExecutionPlan(input: unknown): string[] {
  const issues: string[] = [];
  try {
    if (!isDataRecord(input) || !exactKeys(input, PLAN_KEYS)) return ['plan:keys'];
    const plan = input as unknown as AgenticCadExecutionPlan;
    if (plan.schema !== AGENTIC_CAD_EXECUTION_PLAN_SCHEMA || plan.contractVersion !== 1 || plan.authority !== 'CONSUMER_DRAFT') issues.push('plan:contract');
    for (const [name, value] of [['planId', plan.planId], ['projectId', plan.projectId], ['documentId', plan.documentId]] as const) if (typeof value !== 'string' || !ID.test(value)) issues.push(`plan:${name}`);
    if (typeof plan.planSha256 !== 'string' || !SHA256.test(plan.planSha256)) issues.push('plan:hash');
    if (plan.registryHash !== AGENTIC_CAD_TOOL_REGISTRY_HASH) issues.push('plan:registryHash');
    if (!DOMAINS.has(plan.domain)) issues.push('plan:domain');
    validateRevision(plan.baseRevision, 'plan:baseRevision', issues);
    if (typeof plan.lockSetSha256 !== 'string' || !SHA256.test(plan.lockSetSha256)) issues.push('plan:lockSetSha256');
    if (!isDataRecord(plan.agentIdentity) || !exactKeys(plan.agentIdentity, ['agentId', 'modelId', 'promptSha256'])
      || typeof plan.agentIdentity.agentId !== 'string' || !ID.test(plan.agentIdentity.agentId)
      || typeof plan.agentIdentity.modelId !== 'string' || !ID.test(plan.agentIdentity.modelId)
      || typeof plan.agentIdentity.promptSha256 !== 'string' || !SHA256.test(plan.agentIdentity.promptSha256)) issues.push('plan:agentIdentity');
    if (!isDataArray(plan.steps, 64) || plan.steps.length === 0) issues.push('plan:steps');
    else {
      const prior = new Set<string>();
      for (const [index, step] of plan.steps.entries()) {
        const path = `plan:steps[${index}]`;
        if (!isDataRecord(step) || !exactKeys(step, STEP_KEYS)) { issues.push(`${path}:keys`); continue; }
        if (typeof step.stepId !== 'string' || !ID.test(step.stepId) || prior.has(step.stepId)) issues.push(`${path}:stepId`);
        const descriptor = typeof step.toolId === 'string' ? getAgenticCadToolDescriptor(step.toolId) : null;
        if (!descriptor || step.toolVersion !== descriptor.version || step.riskClass !== descriptor.riskClass
          || step.sideEffect !== descriptor.sideEffect || canonicalCadConsumerDraftJson(step.resourceBudget) !== canonicalCadConsumerDraftJson(descriptor.resourceBudget)
          || canonicalCadConsumerDraftJson(step.verifierIds) !== canonicalCadConsumerDraftJson(descriptor.verifierIds)) issues.push(`${path}:descriptorDrift`);
        else if (!descriptor.domains.includes(plan.domain)) issues.push(`${path}:domain`);
        validateArtifact(step.input, `${path}:input`, true, issues);
        if (descriptor && step.input.schema !== descriptor.inputSchema) issues.push(`${path}:inputSchema`);
        if (!isStringArray(step.dependencies, 64) || step.dependencies.some(dependency => !prior.has(dependency))) issues.push(`${path}:dependencies`);
        if (!isStringArray(step.expectedChangedObjectIds, 10_000)) issues.push(`${path}:expectedChangedObjectIds`);
        if (!isStringArray(step.expectedOutputArtifactIds, 256)) issues.push(`${path}:expectedOutputArtifactIds`);
        if (descriptor?.idempotency === 'REQUIRED' ? (typeof step.idempotencyKey !== 'string' || !ID.test(step.idempotencyKey)) : step.idempotencyKey !== null) issues.push(`${path}:idempotencyKey`);
        if (descriptor?.executionMode === 'AUTHORITATIVE' ? (typeof step.canonicalCommandSha256 !== 'string' || !SHA256.test(step.canonicalCommandSha256)) : step.canonicalCommandSha256 !== null) issues.push(`${path}:canonicalCommandSha256`);
        if (step.toolId === 'feature.commit') {
          if (step.featureRegistryHash !== FEATURE_REGISTRY_HASH) issues.push(`${path}:featureRegistryHash`);
          if (typeof step.runtimeIdentitySha256 !== 'string' || !SHA256.test(step.runtimeIdentitySha256)) issues.push(`${path}:runtimeIdentitySha256`);
          if (typeof step.preflightReceiptSha256 !== 'string' || !SHA256.test(step.preflightReceiptSha256)) issues.push(`${path}:preflightReceiptSha256`);
        } else if (step.featureRegistryHash !== null || step.runtimeIdentitySha256 !== null || step.preflightReceiptSha256 !== null) issues.push(`${path}:exactBindingForbidden`);
        validateBudget(step.resourceBudget, `${path}:resourceBudget`, issues);
        if (!isStringArray(step.verifierIds, 32)) issues.push(`${path}:verifierIds`);
        if (typeof step.stepId === 'string') prior.add(step.stepId);
      }
      const highest = plan.steps.reduce<CanonicalCadRiskClass>((current, step) => isDataRecord(step) && RISKS.includes(step.riskClass as CanonicalCadRiskClass)
        && RISKS.indexOf(step.riskClass as CanonicalCadRiskClass) > RISKS.indexOf(current) ? step.riskClass as CanonicalCadRiskClass : current, 'R0');
      if (plan.highestRisk !== highest) issues.push('plan:highestRisk');
    }
    const issued = Date.parse(plan.issuedAt); const expires = Date.parse(plan.expiresAt);
    if (typeof plan.issuedAt !== 'string' || !RFC3339.test(plan.issuedAt) || typeof plan.expiresAt !== 'string' || !RFC3339.test(plan.expiresAt)
      || !Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 3_600_000) issues.push('plan:timing');
    if (!isDataRecord(plan.staleIf) || !exactKeys(plan.staleIf, ['baseRevisionChanges', 'baseContentHashChanges', 'lockSetChanges', 'registryChanges'])
      || Object.values(plan.staleIf).some(value => value !== true)) issues.push('plan:staleIf');
    if (plan.status !== 'DRY_RUN_ONLY' || plan.release !== 'HOLD') issues.push('plan:promotionBlocked');
    if (typeof plan.planSha256 === 'string' && SHA256.test(plan.planSha256)) {
      try { if (hashAgenticCadExecutionPlan(plan) !== plan.planSha256) issues.push('plan:hashMismatch'); } catch { issues.push('plan:hashMismatch'); }
    }
  } catch {
    return ['plan:unreadable'];
  }
  return [...new Set(issues)].slice(0, 256);
}

function dryRunUnsigned(receipt: AgenticCadDryRunReceipt): Omit<AgenticCadDryRunReceipt, 'receiptSha256'> {
  const { receiptSha256: _ignored, ...unsigned } = receipt;
  void _ignored;
  return unsigned;
}

export function hashAgenticCadDryRunReceipt(receipt: AgenticCadDryRunReceipt): string {
  return hashDomain('nexyfab.precision-cad.agent-dry-run-receipt.sha256.v1', dryRunUnsigned(receipt));
}

export function createAgenticCadDryRunReceipt(
  plan: AgenticCadExecutionPlan,
  outcomes: AgenticCadDryRunStepOutcome[],
  createdAt: string,
): AgenticCadDryRunReceipt {
  const planIssues = validateAgenticCadExecutionPlan(plan);
  if (planIssues.length) throw new Error(`invalid_agent_execution_plan:${planIssues.join(',')}`);
  if (outcomes.length !== plan.steps.length) throw new Error('dry_run_step_count_mismatch');
  const byId = new Map(outcomes.map(outcome => [outcome.stepId, outcome]));
  if (byId.size !== outcomes.length) throw new Error('dry_run_step_duplicate');
  const steps: AgenticCadDryRunStepReceipt[] = plan.steps.map(step => {
    const outcome = byId.get(step.stepId);
    if (!outcome) throw new Error(`dry_run_step_missing:${step.stepId}`);
    const expected = [...step.expectedChangedObjectIds].sort().join('|');
    const actual = [...new Set(outcome.changedObjectIds)].sort().join('|');
    const expectedOutputs = [...step.expectedOutputArtifactIds].sort().join('|');
    const actualOutputs = [...new Set(outcome.outputArtifacts.map(artifact => artifact.artifactId))].sort().join('|');
    const mismatch = expected !== actual;
    const outputMismatch = expectedOutputs !== actualOutputs;
    return {
      ...structuredClone(outcome),
      status: mismatch || outputMismatch ? 'HOLD' : outcome.status,
      findingCodes: [...new Set([
        ...outcome.findingCodes,
        ...(mismatch ? ['DRY_RUN_CHANGED_SET_MISMATCH'] : []),
        ...(outputMismatch ? ['DRY_RUN_OUTPUT_SET_MISMATCH'] : []),
      ])].sort(),
      toolId: step.toolId,
      inputSha256: step.input.contentSha256,
      canonicalCommandSha256: step.canonicalCommandSha256,
    };
  });
  const receipt: AgenticCadDryRunReceipt = {
    schema: AGENTIC_CAD_DRY_RUN_RECEIPT_SCHEMA,
    authority: 'SANDBOX_EVIDENCE_ONLY',
    planId: plan.planId,
    planSha256: plan.planSha256,
    registryHash: plan.registryHash,
    baseRevision: structuredClone(plan.baseRevision),
    status: steps.every(step => step.status === 'PASS') ? 'PASS' : 'HOLD',
    steps,
    createdAt,
    verification: 'NOT_AUTHORITATIVE',
    release: 'HOLD',
    receiptSha256: '',
  };
  receipt.receiptSha256 = hashAgenticCadDryRunReceipt(receipt);
  const issues = validateAgenticCadDryRunReceipt(receipt, plan);
  if (issues.length) throw new Error(`invalid_agent_dry_run_receipt:${issues.join(',')}`);
  return receipt;
}

export function validateAgenticCadDryRunReceipt(input: unknown, plan?: AgenticCadExecutionPlan): string[] {
  const issues: string[] = [];
  try {
    if (!isDataRecord(input) || !exactKeys(input, DRY_KEYS)) return ['dryRun:keys'];
    const receipt = input as unknown as AgenticCadDryRunReceipt;
    if (receipt.schema !== AGENTIC_CAD_DRY_RUN_RECEIPT_SCHEMA || receipt.authority !== 'SANDBOX_EVIDENCE_ONLY'
      || receipt.verification !== 'NOT_AUTHORITATIVE' || receipt.release !== 'HOLD') issues.push('dryRun:contract');
    for (const [name, value] of [['planId', receipt.planId]] as const) if (typeof value !== 'string' || !ID.test(value)) issues.push(`dryRun:${name}`);
    if (typeof receipt.planSha256 !== 'string' || !SHA256.test(receipt.planSha256) || receipt.registryHash !== AGENTIC_CAD_TOOL_REGISTRY_HASH) issues.push('dryRun:binding');
    validateRevision(receipt.baseRevision, 'dryRun:baseRevision', issues);
    if (!['PASS', 'HOLD'].includes(receipt.status)) issues.push('dryRun:status');
    if (!isDataArray(receipt.steps, 64) || receipt.steps.length === 0) issues.push('dryRun:steps');
    else {
      const ids = new Set<string>();
      receipt.steps.forEach((step, index) => {
        const path = `dryRun:steps[${index}]`;
        if (!isDataRecord(step) || !exactKeys(step, DRY_STEP_KEYS)) { issues.push(`${path}:keys`); return; }
        if (typeof step.stepId !== 'string' || !ID.test(step.stepId) || ids.has(step.stepId)) issues.push(`${path}:stepId`); else ids.add(step.stepId);
        if (!getAgenticCadToolDescriptor(String(step.toolId))) issues.push(`${path}:toolId`);
        if (!['PASS', 'HOLD'].includes(String(step.status))) issues.push(`${path}:status`);
        if (!isStringArray(step.changedObjectIds, 10_000)) issues.push(`${path}:changedObjectIds`);
        if (!isDataArray(step.invalidated, 7) || step.invalidated.some(value => !INVALIDATIONS.has(value as AgenticCadInvalidationScope)) || new Set(step.invalidated).size !== step.invalidated.length) issues.push(`${path}:invalidated`);
        if (!isStringArray(step.findingCodes, 128, FINDING)) issues.push(`${path}:findingCodes`);
        if (!isDataArray(step.outputArtifacts, 64)) issues.push(`${path}:outputArtifacts`); else step.outputArtifacts.forEach((artifact, artifactIndex) => validateArtifact(artifact, `${path}:outputArtifacts[${artifactIndex}]`, false, issues));
        if (typeof step.evidenceSha256 !== 'string' || !SHA256.test(step.evidenceSha256) || typeof step.inputSha256 !== 'string' || !SHA256.test(step.inputSha256)
          || (step.canonicalCommandSha256 !== null && (typeof step.canonicalCommandSha256 !== 'string' || !SHA256.test(step.canonicalCommandSha256)))) issues.push(`${path}:hashes`);
      });
      if ((receipt.status === 'PASS') !== receipt.steps.every(step => isDataRecord(step) && step.status === 'PASS')) issues.push('dryRun:aggregateStatus');
    }
    if (typeof receipt.createdAt !== 'string' || !RFC3339.test(receipt.createdAt) || !Number.isFinite(Date.parse(receipt.createdAt))) issues.push('dryRun:createdAt');
    if (typeof receipt.receiptSha256 !== 'string' || !SHA256.test(receipt.receiptSha256)) issues.push('dryRun:hash');
    else { try { if (hashAgenticCadDryRunReceipt(receipt) !== receipt.receiptSha256) issues.push('dryRun:hashMismatch'); } catch { issues.push('dryRun:hashMismatch'); } }
    if (plan) {
      if (validateAgenticCadExecutionPlan(plan).length || receipt.planId !== plan.planId || receipt.planSha256 !== plan.planSha256
        || receipt.registryHash !== plan.registryHash || !sameRevision(receipt.baseRevision, plan.baseRevision)
        || receipt.steps.length !== plan.steps.length) issues.push('dryRun:planBinding');
      else for (const [index, step] of receipt.steps.entries()) {
        const planned = plan.steps[index]!;
        if (step.stepId !== planned.stepId || step.toolId !== planned.toolId || step.inputSha256 !== planned.input.contentSha256
          || step.canonicalCommandSha256 !== planned.canonicalCommandSha256) issues.push(`dryRun:steps[${index}]:planBinding`);
        if (step.status === 'PASS' && (
          [...step.changedObjectIds].sort().join('|') !== [...planned.expectedChangedObjectIds].sort().join('|')
          || [...step.outputArtifacts.map(artifact => artifact.artifactId)].sort().join('|') !== [...planned.expectedOutputArtifactIds].sort().join('|')
        )) issues.push(`dryRun:steps[${index}]:planBinding`);
      }
    }
  } catch {
    return ['dryRun:unreadable'];
  }
  return [...new Set(issues)].slice(0, 256);
}

function policyUnsigned(receipt: AgenticCadPolicyReceipt): Omit<AgenticCadPolicyReceipt, 'receiptSha256'> {
  const { receiptSha256: _ignored, ...unsigned } = receipt;
  void _ignored;
  return unsigned;
}

export function hashAgenticCadPolicyReceipt(receipt: AgenticCadPolicyReceipt): string {
  return hashDomain('nexyfab.precision-cad.agent-policy-receipt.sha256.v1', policyUnsigned(receipt));
}

function policyReceipt(input: Omit<AgenticCadPolicyReceipt, 'receiptSha256'>): AgenticCadPolicyReceipt {
  const receipt: AgenticCadPolicyReceipt = { ...input, receiptSha256: '' };
  receipt.receiptSha256 = hashAgenticCadPolicyReceipt(receipt);
  return receipt;
}

export function evaluateAgenticCadExecutionPlan(input: unknown, context: AgenticCadPolicyContext): AgenticCadPolicyReceipt {
  const evaluatedAt = isDataRecord(context) && typeof context.evaluatedAt === 'string' ? context.evaluatedAt : '1970-01-01T00:00:00.000Z';
  const base = {
    schema: AGENTIC_CAD_POLICY_RECEIPT_SCHEMA,
    authority: 'POLICY_EVALUATION_ONLY' as const,
    registryHash: AGENTIC_CAD_TOOL_REGISTRY_HASH,
    evaluatedAt,
    authoritativeCommit: 'NOT_AUTHORIZED' as const,
    release: 'HOLD' as const,
  };
  const planIssues = validateAgenticCadExecutionPlan(input);
  if (planIssues.length) return policyReceipt({ ...base, planId: null, planSha256: null, status: 'BLOCK', issues: planIssues, dryRunReceiptSha256: null });
  const plan = input as AgenticCadExecutionPlan;
  const issues: string[] = [];
  try {
    if (!isDataRecord(context) || !exactKeys(context, ['currentRevision', 'currentLockSetSha256', 'evaluatedAt', 'permissions', ...(Object.hasOwn(context, 'dryRunReceipt') ? ['dryRunReceipt'] : [])])) issues.push('context:invalid');
    validateRevision(context.currentRevision, 'context:currentRevision', issues);
    if (!sameRevision(plan.baseRevision, context.currentRevision)) issues.push('policy:staleBaseRevision');
    if (context.currentLockSetSha256 !== plan.lockSetSha256) issues.push('policy:staleLockSet');
    if (typeof context.evaluatedAt !== 'string' || !RFC3339.test(context.evaluatedAt)) issues.push('context:evaluatedAt');
    else {
      const now = Date.parse(context.evaluatedAt);
      if (now < Date.parse(plan.issuedAt)) issues.push('policy:notYetValid');
      if (now >= Date.parse(plan.expiresAt)) issues.push('policy:expired');
    }
    if (!isStringArray(context.permissions, 16, /^[A-Z][A-Z_]{0,63}$/)) issues.push('context:permissions');
    else for (const step of plan.steps) {
      const descriptor = getAgenticCadToolDescriptor(step.toolId)!;
      if (!context.permissions.includes(descriptor.permission)) issues.push(`policy:permission:${descriptor.permission}`);
      if (descriptor.riskClass === 'R4' || descriptor.approvalPolicy === 'GOVERNED_ONLY') issues.push(`policy:governedOnly:${step.stepId}`);
    }
  } catch {
    issues.push('context:unreadable');
  }
  if (issues.length) return policyReceipt({ ...base, planId: plan.planId, planSha256: plan.planSha256, status: 'BLOCK', issues: [...new Set(issues)], dryRunReceiptSha256: null });

  const requiresDryRun = plan.steps.some(step => step.riskClass !== 'R0');
  if (!requiresDryRun) return policyReceipt({ ...base, planId: plan.planId, planSha256: plan.planSha256, status: 'READ_ONLY_READY', issues: [], dryRunReceiptSha256: null });
  if (context.dryRunReceipt === undefined) return policyReceipt({ ...base, planId: plan.planId, planSha256: plan.planSha256, status: 'DRY_RUN_REQUIRED', issues: [], dryRunReceiptSha256: null });
  const dryIssues = validateAgenticCadDryRunReceipt(context.dryRunReceipt, plan);
  if (dryIssues.length) return policyReceipt({ ...base, planId: plan.planId, planSha256: plan.planSha256, status: 'BLOCK', issues: dryIssues, dryRunReceiptSha256: null });
  const dryRun = context.dryRunReceipt as AgenticCadDryRunReceipt;
  if (dryRun.status !== 'PASS') return policyReceipt({ ...base, planId: plan.planId, planSha256: plan.planSha256, status: 'BLOCK', issues: ['policy:dryRunHold'], dryRunReceiptSha256: dryRun.receiptSha256 });
  const approvalRequired = plan.steps.some(step => step.riskClass === 'R2' || step.riskClass === 'R3');
  return policyReceipt({
    ...base,
    planId: plan.planId,
    planSha256: plan.planSha256,
    status: approvalRequired ? 'AWAITING_HUMAN_APPROVAL' : 'SANDBOX_COMPLETE',
    issues: [],
    dryRunReceiptSha256: dryRun.receiptSha256,
  });
}

export function validateAgenticCadPolicyReceipt(
  input: unknown,
  plan?: AgenticCadExecutionPlan,
  dryRunReceipt?: AgenticCadDryRunReceipt,
): string[] {
  const issues: string[] = [];
  try {
    if (!isDataRecord(input) || !exactKeys(input, POLICY_KEYS)) return ['policyReceipt:keys'];
    const receipt = input as unknown as AgenticCadPolicyReceipt;
    if (receipt.schema !== AGENTIC_CAD_POLICY_RECEIPT_SCHEMA
      || receipt.authority !== 'POLICY_EVALUATION_ONLY'
      || receipt.registryHash !== AGENTIC_CAD_TOOL_REGISTRY_HASH
      || receipt.authoritativeCommit !== 'NOT_AUTHORIZED'
      || receipt.release !== 'HOLD') issues.push('policyReceipt:contract');
    if (!POLICY_STATUSES.has(receipt.status)) issues.push('policyReceipt:status');
    const nullPlan = receipt.planId === null && receipt.planSha256 === null;
    const boundPlan = typeof receipt.planId === 'string' && ID.test(receipt.planId)
      && typeof receipt.planSha256 === 'string' && SHA256.test(receipt.planSha256);
    if (!nullPlan && !boundPlan) issues.push('policyReceipt:planBinding');
    if (nullPlan && receipt.status !== 'BLOCK') issues.push('policyReceipt:planBinding');
    if (!isDataArray(receipt.issues, 256)
      || receipt.issues.some(issue => typeof issue !== 'string' || issue.length < 1 || issue.length > 192 || /[\u0000-\u001f\u007f]/.test(issue))
      || new Set(receipt.issues).size !== receipt.issues.length) issues.push('policyReceipt:issues');
    else if ((receipt.status === 'BLOCK') !== (receipt.issues.length > 0)) issues.push('policyReceipt:aggregateStatus');
    if (typeof receipt.evaluatedAt !== 'string' || !RFC3339.test(receipt.evaluatedAt) || !Number.isFinite(Date.parse(receipt.evaluatedAt))) issues.push('policyReceipt:evaluatedAt');
    if (receipt.dryRunReceiptSha256 !== null && (typeof receipt.dryRunReceiptSha256 !== 'string' || !SHA256.test(receipt.dryRunReceiptSha256))) issues.push('policyReceipt:dryRunBinding');
    if ((receipt.status === 'READ_ONLY_READY' || receipt.status === 'DRY_RUN_REQUIRED') && receipt.dryRunReceiptSha256 !== null) issues.push('policyReceipt:dryRunBinding');
    if ((receipt.status === 'SANDBOX_COMPLETE' || receipt.status === 'AWAITING_HUMAN_APPROVAL') && receipt.dryRunReceiptSha256 === null) issues.push('policyReceipt:dryRunBinding');
    if (typeof receipt.receiptSha256 !== 'string' || !SHA256.test(receipt.receiptSha256)) issues.push('policyReceipt:hash');
    else if (hashAgenticCadPolicyReceipt(receipt) !== receipt.receiptSha256) issues.push('policyReceipt:hashMismatch');

    if (plan) {
      if (validateAgenticCadExecutionPlan(plan).length
        || receipt.planId !== plan.planId
        || receipt.planSha256 !== plan.planSha256
        || receipt.registryHash !== plan.registryHash) issues.push('policyReceipt:planBinding');
      const approvalRequired = plan.steps.some(step => step.riskClass === 'R2' || step.riskClass === 'R3');
      const dryRunRequired = plan.steps.some(step => step.riskClass !== 'R0');
      if (receipt.status === 'READ_ONLY_READY' && dryRunRequired) issues.push('policyReceipt:statusBinding');
      if (receipt.status === 'SANDBOX_COMPLETE' && (!dryRunRequired || approvalRequired)) issues.push('policyReceipt:statusBinding');
      if (receipt.status === 'AWAITING_HUMAN_APPROVAL' && !approvalRequired) issues.push('policyReceipt:statusBinding');
    }
    if (dryRunReceipt) {
      if (validateAgenticCadDryRunReceipt(dryRunReceipt, plan).length
        || receipt.dryRunReceiptSha256 !== dryRunReceipt.receiptSha256) issues.push('policyReceipt:dryRunBinding');
      if ((receipt.status === 'SANDBOX_COMPLETE' || receipt.status === 'AWAITING_HUMAN_APPROVAL') && dryRunReceipt.status !== 'PASS') issues.push('policyReceipt:statusBinding');
    }
  } catch {
    return ['policyReceipt:unreadable'];
  }
  return [...new Set(issues)].slice(0, 256);
}

export function createAgenticCadApprovalCandidate(input: {
  plan: AgenticCadExecutionPlan;
  policyReceipt: AgenticCadPolicyReceipt;
  humanActorId: string;
  approvalScope: string;
  approvedStepIds: string[];
  issuedAt: string;
  expiresAt: string;
}): AgenticCadApprovalCandidate {
  const { plan, policyReceipt } = input;
  if (validateAgenticCadExecutionPlan(plan).length || policyReceipt.status !== 'AWAITING_HUMAN_APPROVAL'
    || policyReceipt.planSha256 !== plan.planSha256 || !policyReceipt.dryRunReceiptSha256
    || !ID.test(input.humanActorId) || !input.approvalScope.trim() || input.approvalScope.length > 512
    || !isStringArray(input.approvedStepIds, 64) || input.approvedStepIds.length !== plan.steps.length
    || input.approvedStepIds.some((stepId, index) => stepId !== plan.steps[index]?.stepId)
    || !RFC3339.test(input.issuedAt) || !RFC3339.test(input.expiresAt)
    || Date.parse(input.expiresAt) <= Date.parse(input.issuedAt) || Date.parse(input.expiresAt) - Date.parse(input.issuedAt) > 900_000) {
    throw new Error('invalid_agent_approval_candidate');
  }
  const unsigned: Omit<AgenticCadApprovalCandidate, 'candidateSha256'> = {
    schema: AGENTIC_CAD_APPROVAL_CANDIDATE_SCHEMA,
    authority: 'UNTRUSTED_CANDIDATE',
    planId: plan.planId,
    planSha256: plan.planSha256,
    policyReceiptSha256: policyReceipt.receiptSha256,
    dryRunReceiptSha256: policyReceipt.dryRunReceiptSha256,
    humanActorId: input.humanActorId,
    approvalScope: input.approvalScope,
    approvedStepIds: structuredClone(input.approvedStepIds),
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    status: 'AWAITING_TRUSTED_AUTHORITY',
    authoritativeCommit: 'NOT_AUTHORIZED',
    release: 'HOLD',
  };
  return { ...unsigned, candidateSha256: hashDomain('nexyfab.precision-cad.agent-approval-candidate.sha256.v1', unsigned) };
}
