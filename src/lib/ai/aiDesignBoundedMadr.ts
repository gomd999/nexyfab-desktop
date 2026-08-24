import { serverEvidenceSha256 } from './serverEvidence';

export const AI_DESIGN_MADR_SESSION_SCHEMA = 'nexyfab.ai-design-bounded-madr-session.v1' as const;
export const AI_DESIGN_MADR_ROLES = ['architect', 'constraint', 'assembly', 'safety', 'cost'] as const;
export type AiDesignMadrRole = (typeof AI_DESIGN_MADR_ROLES)[number];
export type AiDesignMadrDecision = 'PROPOSE' | 'ACCEPT' | 'REJECT' | 'NEEDS_INPUT';
export type AiDesignMadrTermination = 'CONSENSUS_REACHED' | 'MAX_ROUNDS' | 'TIME_BUDGET' | 'CALL_BUDGET' | 'COST_BUDGET' | 'CANCELLED' | 'PROVIDER_FAILURE' | 'NEEDS_INPUT';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_TEXT = 4_000;

export interface AiDesignMadrBudgetV1 {
  maxRounds: number;
  maxCalls: number;
  maxCostUnits: number;
  maxDurationMs: number;
  maxConcurrency: number;
  maxRetriesPerRole: number;
  turnTimeoutMs: number;
}

export interface AiDesignMadrTurnInputV1 {
  sessionId: string;
  projectId: string;
  designSessionId: string;
  round: number;
  role: AiDesignMadrRole;
  candidateDigest: string;
  structureDigest: string | null;
  constraintDigest: string | null;
  knowledgeReceiptDigests: readonly string[];
  previousRoundDigest: string | null;
  modelSelectionReceiptDigest: string;
  signal: AbortSignal;
}

export interface AiDesignMadrTurnOutputV1 {
  decision: AiDesignMadrDecision;
  proposal: string;
  critique: string;
  rationale: string;
  riskCodes: readonly string[];
  requestedInputKeys: readonly string[];
  confidence: number;
  costUnits: number;
  modelId: string;
  exactAuthority: false;
  manufacturingAuthority: false;
}

export interface AiDesignMadrTurnRecordV1 extends Omit<AiDesignMadrTurnOutputV1, 'exactAuthority' | 'manufacturingAuthority'> {
  turnId: string;
  round: number;
  role: AiDesignMadrRole;
  attempt: number;
  inputDigest: string;
  outputDigest: string;
  modelSelectionReceiptDigest: string;
  completedAt: string;
  exactAuthority: false;
  manufacturingAuthority: false;
}

export interface AiDesignBoundedMadrSessionV1 {
  schema: typeof AI_DESIGN_MADR_SESSION_SCHEMA;
  sessionId: string;
  projectId: string;
  designSessionId: string;
  candidateDigest: string;
  budget: AiDesignMadrBudgetV1;
  status: 'PASS' | 'INCOMPLETE' | 'CANCELLED' | 'FAILED';
  termination: AiDesignMadrTermination;
  roundsCompleted: number;
  callsUsed: number;
  costUnitsUsed: number;
  turns: readonly AiDesignMadrTurnRecordV1[];
  unresolvedInputKeys: readonly string[];
  startedAt: string;
  completedAt: string;
  conceptOnly: true;
  exactAuthority: false;
  manufacturingAuthority: false;
  sessionDigest: string;
}

export type AiDesignMadrExecutor = (input: AiDesignMadrTurnInputV1) => Promise<AiDesignMadrTurnOutputV1>;

export interface AiDesignMadrRunInput {
  sessionId: string;
  projectId: string;
  designSessionId: string;
  candidateDigest: string;
  structureDigest: string | null;
  constraintDigest: string | null;
  knowledgeReceiptDigests: readonly string[];
  modelSelectionReceiptDigests: Readonly<Record<AiDesignMadrRole, string>>;
  budget: AiDesignMadrBudgetV1;
  requiredRoles?: readonly AiDesignMadrRole[];
}

export interface AiDesignMadrRecoveryProjectionV1 {
  sessionId: string;
  durableJobDisposition: 'SUCCEED' | 'WAIT_FOR_INPUT' | 'RETRYABLE_FAILURE' | 'NON_RETRYABLE_FAILURE' | 'CANCEL';
  uiRecoveryState: 'ready' | 'needs_input' | 'retry' | 'review' | 'cancelled';
  safeActions: readonly ('CONTINUE' | 'PROVIDE_INPUT' | 'RETRY' | 'OPEN_REVIEW' | 'RESTART')[];
  reason: AiDesignMadrTermination;
  exactAuthority: false;
  manufacturingAuthority: false;
}

export interface AiDesignMadrHoldoutCaseV1 {
  caseId: string;
  singleRoleQuality: number;
  multiRoleQuality: number;
  singleRoleLeakRisk: number;
  multiRoleLeakRisk: number;
  externalReviewDigest: string;
  externallyReviewed: boolean;
}

function validBudget(value: AiDesignMadrBudgetV1): boolean {
  return !!value && Number.isSafeInteger(value.maxRounds) && value.maxRounds >= 1 && value.maxRounds <= 20
    && Number.isSafeInteger(value.maxCalls) && value.maxCalls >= 1 && value.maxCalls <= 500
    && Number.isFinite(value.maxCostUnits) && value.maxCostUnits > 0 && value.maxCostUnits <= 1_000_000
    && Number.isSafeInteger(value.maxDurationMs) && value.maxDurationMs >= 100 && value.maxDurationMs <= 24 * 60 * 60_000
    && Number.isSafeInteger(value.maxConcurrency) && value.maxConcurrency >= 1 && value.maxConcurrency <= AI_DESIGN_MADR_ROLES.length
    && Number.isSafeInteger(value.maxRetriesPerRole) && value.maxRetriesPerRole >= 0 && value.maxRetriesPerRole <= 5
    && Number.isSafeInteger(value.turnTimeoutMs) && value.turnTimeoutMs >= 10 && value.turnTimeoutMs <= value.maxDurationMs;
}

function validOutput(value: AiDesignMadrTurnOutputV1): boolean {
  return !!value && ['PROPOSE', 'ACCEPT', 'REJECT', 'NEEDS_INPUT'].includes(value.decision)
    && [value.proposal, value.critique, value.rationale].every(item => typeof item === 'string' && item.length <= MAX_TEXT)
    && Array.isArray(value.riskCodes) && value.riskCodes.length <= 128 && value.riskCodes.every(item => CODE.test(item))
    && Array.isArray(value.requestedInputKeys) && value.requestedInputKeys.length <= 128 && value.requestedInputKeys.every(item => ID.test(item))
    && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
    && Number.isFinite(value.costUnits) && value.costUnits >= 0
    && ID.test(value.modelId ?? '') && value.exactAuthority === false && value.manufacturingAuthority === false;
}

function sessionMaterial(value: Omit<AiDesignBoundedMadrSessionV1, 'sessionDigest'> | AiDesignBoundedMadrSessionV1) {
  const { sessionDigest: _sessionDigest, ...rest } = value as AiDesignBoundedMadrSessionV1;
  return rest;
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('AI_DESIGN_MADR_TURN_TIMEOUT')); }, timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function mapBounded<T, R>(values: readonly T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length); let cursor = 0;
  const worker = async () => { while (cursor < values.length) { const index = cursor++; output[index] = await operation(values[index]!); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

function finalize(input: AiDesignMadrRunInput, startedAt: string, completedAt: string, turns: AiDesignMadrTurnRecordV1[], callsUsed: number, termination: AiDesignMadrTermination): AiDesignBoundedMadrSessionV1 {
  const unresolvedInputKeys = [...new Set(turns.flatMap(turn => turn.requestedInputKeys))].sort();
  const status: AiDesignBoundedMadrSessionV1['status'] = termination === 'CONSENSUS_REACHED' ? 'PASS' : termination === 'CANCELLED' ? 'CANCELLED' : termination === 'PROVIDER_FAILURE' ? 'FAILED' : 'INCOMPLETE';
  const base = {
    schema: AI_DESIGN_MADR_SESSION_SCHEMA,
    sessionId: input.sessionId, projectId: input.projectId, designSessionId: input.designSessionId, candidateDigest: input.candidateDigest,
    budget: structuredClone(input.budget), status, termination,
    roundsCompleted: turns.reduce((max, turn) => Math.max(max, turn.round), 0), callsUsed, costUnitsUsed: turns.reduce((sum, turn) => sum + turn.costUnits, 0),
    turns: structuredClone(turns), unresolvedInputKeys, startedAt, completedAt,
    conceptOnly: true as const, exactAuthority: false as const, manufacturingAuthority: false as const,
  };
  return Object.freeze({ ...base, sessionDigest: serverEvidenceSha256(base) });
}

/** Runs a finite, budgeted design review. Consensus is concept evidence, never engineering verification. */
export async function runBoundedAiDesignMadr(
  input: AiDesignMadrRunInput,
  executor: AiDesignMadrExecutor,
  options: { now?: () => Date; cancelled?: () => boolean } = {},
): Promise<AiDesignBoundedMadrSessionV1> {
  if (!ID.test(input.sessionId) || !ID.test(input.projectId) || !ID.test(input.designSessionId) || !SHA256.test(input.candidateDigest) || (input.structureDigest !== null && !SHA256.test(input.structureDigest)) || (input.constraintDigest !== null && !SHA256.test(input.constraintDigest)) || input.knowledgeReceiptDigests.length > 256 || input.knowledgeReceiptDigests.some(item => !SHA256.test(item)) || !validBudget(input.budget)) throw new Error('AI_DESIGN_MADR_INPUT_INVALID');
  const roles = [...new Set(input.requiredRoles ?? AI_DESIGN_MADR_ROLES)];
  if (!roles.length || roles.some(role => !AI_DESIGN_MADR_ROLES.includes(role)) || roles.some(role => !SHA256.test(input.modelSelectionReceiptDigests[role] ?? ''))) throw new Error('AI_DESIGN_MADR_ROLE_BINDING_INVALID');
  const clock = options.now ?? (() => new Date()); const started = clock(); const startedAt = started.toISOString(); const turns: AiDesignMadrTurnRecordV1[] = [];
  let previousRoundDigest: string | null = null; let termination: AiDesignMadrTermination = 'MAX_ROUNDS'; let costUnits = 0; let callsUsed = 0;
  for (let round = 1; round <= input.budget.maxRounds; round++) {
    if (options.cancelled?.()) { termination = 'CANCELLED'; break; }
    if (clock().getTime() - started.getTime() >= input.budget.maxDurationMs) { termination = 'TIME_BUDGET'; break; }
    if (callsUsed + roles.length > input.budget.maxCalls) { termination = 'CALL_BUDGET'; break; }
    let providerFailed = false; let roundFailureCode = '';
    const roundTurns = await mapBounded(roles, input.budget.maxConcurrency, async role => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= input.budget.maxRetriesPerRole + 1; attempt++) {
        if (options.cancelled?.()) throw new Error('AI_DESIGN_MADR_CANCELLED');
        if (callsUsed >= input.budget.maxCalls) throw new Error('AI_DESIGN_MADR_CALL_BUDGET');
        callsUsed += 1;
        try {
          const inputMaterial = { sessionId: input.sessionId, projectId: input.projectId, designSessionId: input.designSessionId, round, role, candidateDigest: input.candidateDigest, structureDigest: input.structureDigest, constraintDigest: input.constraintDigest, knowledgeReceiptDigests: [...input.knowledgeReceiptDigests].sort(), previousRoundDigest, modelSelectionReceiptDigest: input.modelSelectionReceiptDigests[role], attempt };
          const output = await withTimeout(signal => executor({ ...inputMaterial, signal }), input.budget.turnTimeoutMs);
          if (!validOutput(output)) throw new Error('AI_DESIGN_MADR_OUTPUT_INVALID');
          const outputDigest = serverEvidenceSha256(output);
          return Object.freeze({ turnId: `madr-turn:${serverEvidenceSha256({ inputMaterial, outputDigest }).slice(0, 48)}`, round, role, attempt, inputDigest: serverEvidenceSha256(inputMaterial), outputDigest, modelSelectionReceiptDigest: input.modelSelectionReceiptDigests[role], ...structuredClone(output), completedAt: clock().toISOString() }) as AiDesignMadrTurnRecordV1;
        } catch (error) { lastError = error; }
      }
      providerFailed = true; roundFailureCode = lastError instanceof Error ? lastError.message : 'AI_DESIGN_MADR_PROVIDER_FAILED';
      throw lastError instanceof Error ? lastError : new Error('AI_DESIGN_MADR_PROVIDER_FAILED');
    }).catch((error: unknown) => { roundFailureCode = error instanceof Error ? error.message : roundFailureCode; return [] as AiDesignMadrTurnRecordV1[]; });
    if (providerFailed || roundTurns.length !== roles.length) { termination = options.cancelled?.() || roundFailureCode === 'AI_DESIGN_MADR_CANCELLED' ? 'CANCELLED' : roundFailureCode === 'AI_DESIGN_MADR_CALL_BUDGET' ? 'CALL_BUDGET' : 'PROVIDER_FAILURE'; break; }
    const roundCost = roundTurns.reduce((sum, turn) => sum + turn.costUnits, 0);
    turns.push(...roundTurns); costUnits += roundCost; previousRoundDigest = serverEvidenceSha256(roundTurns.map(turn => turn.outputDigest));
    if (costUnits > input.budget.maxCostUnits) { termination = 'COST_BUDGET'; break; }
    if (roundTurns.some(turn => turn.decision === 'NEEDS_INPUT')) { termination = 'NEEDS_INPUT'; break; }
    const reviewers = roundTurns.filter(turn => turn.role !== 'architect');
    if (reviewers.length > 0 && reviewers.every(turn => turn.decision === 'ACCEPT') && roundTurns.every(turn => turn.decision !== 'REJECT')) { termination = 'CONSENSUS_REACHED'; break; }
    if (callsUsed >= input.budget.maxCalls) { termination = 'CALL_BUDGET'; break; }
  }
  return finalize(input, startedAt, clock().toISOString(), turns, callsUsed, termination);
}

export function validateAiDesignBoundedMadrSession(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['madr_session_not_object'];
  const session = value as AiDesignBoundedMadrSessionV1; const issues: string[] = [];
  if (session.schema !== AI_DESIGN_MADR_SESSION_SCHEMA || !ID.test(session.sessionId ?? '') || !ID.test(session.projectId ?? '') || !ID.test(session.designSessionId ?? '') || !SHA256.test(session.candidateDigest ?? '') || !validBudget(session.budget)) issues.push('madr_session_binding_invalid');
  if (!['PASS', 'INCOMPLETE', 'CANCELLED', 'FAILED'].includes(session.status) || !['CONSENSUS_REACHED', 'MAX_ROUNDS', 'TIME_BUDGET', 'CALL_BUDGET', 'COST_BUDGET', 'CANCELLED', 'PROVIDER_FAILURE', 'NEEDS_INPUT'].includes(session.termination)) issues.push('madr_session_status_invalid');
  if (!Array.isArray(session.turns) || session.turns.length > session.budget?.maxCalls || session.turns.some(turn => !ID.test(turn.turnId ?? '') || !AI_DESIGN_MADR_ROLES.includes(turn.role) || !['PROPOSE', 'ACCEPT', 'REJECT', 'NEEDS_INPUT'].includes(turn.decision) || !SHA256.test(turn.inputDigest ?? '') || !SHA256.test(turn.outputDigest ?? '') || !SHA256.test(turn.modelSelectionReceiptDigest ?? '') || turn.exactAuthority !== false || turn.manufacturingAuthority !== false)) issues.push('madr_session_turn_invalid');
  if (session.conceptOnly !== true || session.exactAuthority !== false || session.manufacturingAuthority !== false || !SHA256.test(session.sessionDigest ?? '')) issues.push('madr_session_authority_invalid');
  if (issues.length === 0 && session.sessionDigest !== serverEvidenceSha256(sessionMaterial(session))) issues.push('madr_session_digest_mismatch');
  return [...new Set(issues)];
}

/** Maps every finite MADR termination to a durable-worker and UI recovery outcome. */
export function projectAiDesignMadrRecovery(session: AiDesignBoundedMadrSessionV1): AiDesignMadrRecoveryProjectionV1 {
  const issues = validateAiDesignBoundedMadrSession(session);
  if (issues.length) throw new Error(`AI_DESIGN_MADR_SESSION_INVALID:${issues.join(',')}`);
  const outcome = session.termination === 'CONSENSUS_REACHED'
    ? { durableJobDisposition: 'SUCCEED' as const, uiRecoveryState: 'ready' as const, safeActions: ['CONTINUE'] as const }
    : session.termination === 'NEEDS_INPUT'
      ? { durableJobDisposition: 'WAIT_FOR_INPUT' as const, uiRecoveryState: 'needs_input' as const, safeActions: ['PROVIDE_INPUT'] as const }
      : session.termination === 'PROVIDER_FAILURE'
        ? { durableJobDisposition: 'RETRYABLE_FAILURE' as const, uiRecoveryState: 'retry' as const, safeActions: ['RETRY', 'OPEN_REVIEW'] as const }
        : session.termination === 'CANCELLED'
          ? { durableJobDisposition: 'CANCEL' as const, uiRecoveryState: 'cancelled' as const, safeActions: ['RESTART'] as const }
          : { durableJobDisposition: 'NON_RETRYABLE_FAILURE' as const, uiRecoveryState: 'review' as const, safeActions: ['OPEN_REVIEW', 'RESTART'] as const };
  return Object.freeze({ sessionId: session.sessionId, ...outcome, reason: session.termination, exactAuthority: false, manufacturingAuthority: false });
}

/** Keeps MADR opt-in until externally reviewed holdouts improve quality without increasing leak risk. */
export function assessAiDesignMadrHoldoutCampaign(
  cases: readonly AiDesignMadrHoldoutCaseV1[],
  policy: { minimumCases: number; minimumMeanQualityImprovement: number; maximumMeanLeakRiskIncrease: number },
) {
  if (!Number.isSafeInteger(policy.minimumCases) || policy.minimumCases < 1 || !Number.isFinite(policy.minimumMeanQualityImprovement)
    || !Number.isFinite(policy.maximumMeanLeakRiskIncrease) || policy.maximumMeanLeakRiskIncrease < 0) throw new Error('AI_DESIGN_MADR_HOLDOUT_POLICY_INVALID');
  if (cases.some(item => !ID.test(item.caseId) || ![item.singleRoleQuality, item.multiRoleQuality, item.singleRoleLeakRisk, item.multiRoleLeakRisk].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    || !SHA256.test(item.externalReviewDigest))) throw new Error('AI_DESIGN_MADR_HOLDOUT_CASE_INVALID');
  const eligible = cases.filter(item => item.externallyReviewed);
  const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const meanQualityImprovement = mean(eligible.map(item => item.multiRoleQuality - item.singleRoleQuality));
  const meanLeakRiskIncrease = mean(eligible.map(item => item.multiRoleLeakRisk - item.singleRoleLeakRisk));
  const defaultEnabled = eligible.length >= policy.minimumCases && meanQualityImprovement >= policy.minimumMeanQualityImprovement && meanLeakRiskIncrease <= policy.maximumMeanLeakRiskIncrease;
  return Object.freeze({
    caseCount: cases.length, externallyReviewedCaseCount: eligible.length,
    meanQualityImprovement: Number(meanQualityImprovement.toFixed(6)), meanLeakRiskIncrease: Number(meanLeakRiskIncrease.toFixed(6)),
    defaultEnabled, status: defaultEnabled ? 'PASS' as const : 'HOLD' as const,
    campaignDigest: serverEvidenceSha256({ cases: [...cases].sort((left, right) => left.caseId.localeCompare(right.caseId)), policy }),
    exactAuthority: false as const, manufacturingAuthority: false as const,
  });
}

export class InMemoryAiDesignMadrSessionStore {
  private readonly sessions = new Map<string, AiDesignBoundedMadrSessionV1>();
  constructor(private readonly mode: 'reference' | 'commercial' = 'reference') {}
  append(session: AiDesignBoundedMadrSessionV1): { ok: true } | { ok: false; issues: readonly string[] } {
    if (this.mode === 'commercial') throw new Error('AI_DESIGN_MADR_POSTGRES_REQUIRED');
    const issues = validateAiDesignBoundedMadrSession(session); if (issues.length) return { ok: false, issues };
    const prior = this.sessions.get(session.sessionId); if (prior) return prior.sessionDigest === session.sessionDigest ? { ok: true } : { ok: false, issues: ['madr_session_overwrite_forbidden'] };
    this.sessions.set(session.sessionId, structuredClone(session)); return { ok: true };
  }
  get(sessionId: string): AiDesignBoundedMadrSessionV1 | undefined { const session = this.sessions.get(sessionId); return session ? structuredClone(session) : undefined; }
}
