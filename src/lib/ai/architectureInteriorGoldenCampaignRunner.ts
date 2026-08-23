import { createHash } from 'node:crypto';
import {
  ARCHITECTURE_INTERIOR_GOLDEN_POLICY,
  ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS,
  evaluateArchitectureInteriorGoldenEvidence,
  type ArchitectureInteriorGoldenEvaluationEvidence,
  type ArchitectureInteriorGoldenEvaluationReport,
  type ArchitectureInteriorGoldenRun,
  type ArchitectureInteriorHoldoutApproval,
  type ArchitectureInteriorGoldenScenario,
} from './architectureInteriorGoldenScenarios';

export const ARCHITECTURE_INTERIOR_GOLDEN_CAMPAIGN_STATE_SCHEMA = 'nexyfab.architecture-interior-golden-campaign-state.v1' as const;

export type ArchitectureInteriorGoldenCampaignSlotStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ArchitectureInteriorGoldenCampaignSlot {
  key: string;
  scenarioId: string;
  campaign: number;
  repeat: number;
  status: ArchitectureInteriorGoldenCampaignSlotStatus;
  attempts: number;
  resultHash: string | null;
  lastError: string | null;
}

export interface ArchitectureInteriorGoldenCampaignResult {
  scenarioId: string;
  run: ArchitectureInteriorGoldenRun;
}

export interface ArchitectureInteriorGoldenCampaignState {
  schema: typeof ARCHITECTURE_INTERIOR_GOLDEN_CAMPAIGN_STATE_SCHEMA;
  suiteHash: string;
  releaseHash?: string;
  inputSourceHashes: Readonly<Record<string, Readonly<Record<string, string>>>>;
  approvals: Readonly<Record<string, readonly ArchitectureInteriorHoldoutApproval[]>>;
  slots: readonly ArchitectureInteriorGoldenCampaignSlot[];
  results: readonly ArchitectureInteriorGoldenCampaignResult[];
}

export interface ArchitectureInteriorGoldenCampaignInput {
  /** scenario id → authoritative input id → SHA-256 of the actual source. */
  inputSourceHashes: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Release/candidate identity that independent approvals must sign. */
  releaseHash?: string;
  approvals?: Readonly<Record<string, readonly ArchitectureInteriorHoldoutApproval[]>>;
}

export interface ArchitectureInteriorGoldenCampaignRunnerOptions {
  maximumAttemptsPerSlot?: number;
  onCheckpoint?: (state: ArchitectureInteriorGoldenCampaignState) => void | Promise<void>;
}

export type ArchitectureInteriorGoldenCampaignExecutor = (input: {
  scenario: ArchitectureInteriorGoldenScenario;
  campaign: number;
  repeat: number;
  attempt: number;
}) => Promise<ArchitectureInteriorGoldenRun>;

const SHA256 = /^[a-f0-9]{64}$/;
const STATUS = new Set<ArchitectureInteriorGoldenCampaignSlotStatus>(['pending', 'running', 'completed', 'failed']);
const scenarioById = new Map(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.map(scenario => [scenario.id, scenario]));

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function slotKey(scenarioId: string, campaign: number, repeat: number): string {
  return `${scenarioId}:${campaign}:${repeat}`;
}

function expectedSlots(): ArchitectureInteriorGoldenCampaignSlot[] {
  return ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.flatMap(scenario => Array.from(
    { length: ARCHITECTURE_INTERIOR_GOLDEN_POLICY.campaigns },
    (_, campaign) => Array.from(
      { length: ARCHITECTURE_INTERIOR_GOLDEN_POLICY.repeatsPerCampaign },
      (_, repeat) => ({
        key: slotKey(scenario.id, campaign + 1, repeat + 1),
        scenarioId: scenario.id,
        campaign: campaign + 1,
        repeat: repeat + 1,
        status: 'pending' as const,
        attempts: 0,
        resultHash: null,
        lastError: null,
      }),
    ),
  ).flat());
}

function canonicalInputHashes(inputSourceHashes: Readonly<Record<string, Readonly<Record<string, string>>>>): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.keys(inputSourceHashes).sort().map(scenarioId => [scenarioId, Object.fromEntries(Object.keys(inputSourceHashes[scenarioId] ?? {}).sort().map(inputId => [inputId, inputSourceHashes[scenarioId]![inputId]!]))]));
}

function suiteHash(input: ArchitectureInteriorGoldenCampaignInput): string {
  return hash({ scenarios: ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS, inputSourceHashes: canonicalInputHashes(input.inputSourceHashes), releaseHash: input.releaseHash ?? null });
}

function validateInputSourceHashes(inputSourceHashes: Readonly<Record<string, Readonly<Record<string, string>>>>): string[] {
  const issues: string[] = [];
  const scenarioIds = Object.keys(inputSourceHashes ?? {});
  if (scenarioIds.length !== ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.length || scenarioIds.some(id => !scenarioById.has(id))) issues.push('input_source_scenario_set_invalid');
  for (const scenario of ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS) {
    const values = inputSourceHashes?.[scenario.id] ?? {};
    const expectedIds = scenario.authoritativeInputs.map(item => item.id);
    const actualIds = Object.keys(values);
    if (actualIds.length !== expectedIds.length || actualIds.some(id => !expectedIds.includes(id))) issues.push(`input_source_ids_invalid:${scenario.id}`);
    for (const inputId of expectedIds) if (!SHA256.test(values[inputId] ?? '')) issues.push(`input_source_hash_invalid:${scenario.id}:${inputId}`);
  }
  return [...new Set(issues)];
}

function validateSlotSet(slots: readonly ArchitectureInteriorGoldenCampaignSlot[]): string[] {
  const expected = new Map(expectedSlots().map(slot => [slot.key, slot]));
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const slot of slots ?? []) {
    if (!slot || typeof slot !== 'object' || seen.has(slot.key)) { issues.push(`slot_duplicate:${slot?.key ?? 'unknown'}`); continue; }
    seen.add(slot.key);
    const expectedSlot = expected.get(slot.key);
    if (!expectedSlot || slot.scenarioId !== expectedSlot.scenarioId || slot.campaign !== expectedSlot.campaign || slot.repeat !== expectedSlot.repeat) issues.push(`slot_extra_or_identity_invalid:${slot.key}`);
    if (!STATUS.has(slot.status) || !Number.isSafeInteger(slot.attempts) || slot.attempts < 0 || slot.attempts > 3 || (slot.status === 'completed' && !SHA256.test(slot.resultHash ?? ''))) issues.push(`slot_contract_invalid:${slot.key}`);
  }
  for (const key of expected.keys()) if (!seen.has(key)) issues.push(`slot_missing:${key}`);
  return [...new Set(issues)];
}

function resultKey(item: ArchitectureInteriorGoldenCampaignResult): string {
  return slotKey(item.scenarioId, item.run.campaign, item.run.repeat);
}

function validateResults(state: ArchitectureInteriorGoldenCampaignState): string[] {
  const expected = new Set(expectedSlots().map(slot => slot.key));
  const slots = new Map((state.slots ?? []).map(slot => [slot.key, slot]));
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const item of state.results ?? []) {
    const key = resultKey(item);
    if (!scenarioById.has(item.scenarioId) || !expected.has(key) || seen.has(key)) issues.push(`result_duplicate_or_extra:${key}`);
    seen.add(key);
    if (item.run.usedForTuning !== false || !Number.isSafeInteger(item.run.campaign) || item.run.campaign < 1 || item.run.campaign > ARCHITECTURE_INTERIOR_GOLDEN_POLICY.campaigns || !Number.isSafeInteger(item.run.repeat) || item.run.repeat < 1 || item.run.repeat > ARCHITECTURE_INTERIOR_GOLDEN_POLICY.repeatsPerCampaign || typeof item.run.requiredGatesPassed !== 'boolean' || typeof item.run.falseVerified !== 'boolean' || !Number.isFinite(item.run.accuracy) || item.run.accuracy < 0 || item.run.accuracy > 1) issues.push(`result_contract_invalid:${key}`);
    const slot = slots.get(key);
    if (!slot || slot.status !== 'completed' || slot.resultHash !== hash(item)) issues.push(`result_binding_invalid:${key}`);
  }
  for (const slot of state.slots ?? []) {
    if (slot.status === 'completed' && !seen.has(slot.key)) issues.push(`completed_result_missing:${slot.key}`);
    if (slot.status !== 'completed' && seen.has(slot.key)) issues.push(`result_for_incomplete_slot:${slot.key}`);
  }
  return [...new Set(issues)];
}

function suiteInput(state: ArchitectureInteriorGoldenCampaignState): ArchitectureInteriorGoldenCampaignInput {
  return { inputSourceHashes: state.inputSourceHashes, releaseHash: state.releaseHash, approvals: state.approvals };
}

export function createArchitectureInteriorGoldenCampaignState(input: ArchitectureInteriorGoldenCampaignInput): ArchitectureInteriorGoldenCampaignState {
  const issues = validateInputSourceHashes(input.inputSourceHashes);
  if (input.releaseHash !== undefined && !SHA256.test(input.releaseHash)) issues.push('release_hash_invalid');
  if (issues.length) throw new Error(`architecture_interior_campaign_input_invalid:${issues.join(',')}`);
  return {
    schema: ARCHITECTURE_INTERIOR_GOLDEN_CAMPAIGN_STATE_SCHEMA,
    suiteHash: suiteHash(input),
    releaseHash: input.releaseHash,
    inputSourceHashes: structuredClone(canonicalInputHashes(input.inputSourceHashes)),
    approvals: structuredClone(input.approvals ?? {}),
    slots: expectedSlots(),
    results: [],
  };
}

export function resumeArchitectureInteriorGoldenCampaignState(state: ArchitectureInteriorGoldenCampaignState, input: ArchitectureInteriorGoldenCampaignInput): ArchitectureInteriorGoldenCampaignState {
  const issues = [
    ...(state?.schema === ARCHITECTURE_INTERIOR_GOLDEN_CAMPAIGN_STATE_SCHEMA ? [] : ['state_schema_invalid']),
    ...validateInputSourceHashes(input.inputSourceHashes),
    ...(input.releaseHash !== undefined && !SHA256.test(input.releaseHash) ? ['release_hash_invalid'] : []),
    ...(state?.suiteHash === suiteHash(input) ? [] : ['suite_hash_mismatch']),
    ...validateSlotSet(state?.slots ?? []),
    ...validateResults(state),
  ];
  if (issues.length) throw new Error(`architecture_interior_campaign_resume_invalid:${[...new Set(issues)].join(',')}`);
  const completed = new Set((state.results ?? []).map(resultKey));
  return {
    ...structuredClone(state),
    inputSourceHashes: structuredClone(canonicalInputHashes(input.inputSourceHashes)),
    releaseHash: input.releaseHash ?? state.releaseHash,
    approvals: structuredClone(input.approvals ?? state.approvals ?? {}),
    slots: state.slots.map(slot => slot.status === 'running' ? { ...slot, status: 'pending' as const, lastError: 'interrupted_before_checkpoint' } : slot).map(slot => completed.has(slot.key) ? { ...slot, status: 'completed' as const } : slot),
  };
}

export function architectureInteriorGoldenEvidence(state: ArchitectureInteriorGoldenCampaignState): ArchitectureInteriorGoldenEvaluationEvidence[] {
  return ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.map(scenario => ({
    scenarioId: scenario.id,
    inputSourceHashes: { ...(state.inputSourceHashes[scenario.id] ?? {}) },
    suiteHash: state.suiteHash,
    releaseHash: state.releaseHash,
    runs: state.results.filter(result => result.scenarioId === scenario.id).map(result => result.run),
    approvals: [...(state.approvals[scenario.id] ?? [])],
  }));
}

export function evaluateArchitectureInteriorGoldenCampaign(
  state: ArchitectureInteriorGoldenCampaignState,
  approvalOptions: Parameters<typeof evaluateArchitectureInteriorGoldenEvidence>[1] = {},
): ArchitectureInteriorGoldenEvaluationReport[] {
  const structuralIssues = [
    ...(state?.schema === ARCHITECTURE_INTERIOR_GOLDEN_CAMPAIGN_STATE_SCHEMA ? [] : ['state_schema_invalid']),
    ...validateInputSourceHashes(state?.inputSourceHashes ?? {}),
    ...(state?.suiteHash === suiteHash(suiteInput(state)) ? [] : ['suite_hash_mismatch']),
    ...validateSlotSet(state?.slots ?? []),
    ...validateResults(state),
  ];
  return architectureInteriorGoldenEvidence(state).map(evidence => {
    const report = evaluateArchitectureInteriorGoldenEvidence(evidence, approvalOptions);
    return structuralIssues.length ? { ...report, eligible: false, blockers: [...new Set([...structuralIssues, ...report.blockers])] } : report;
  });
}

export async function runArchitectureInteriorGoldenCampaign(
  initial: ArchitectureInteriorGoldenCampaignState,
  executor: ArchitectureInteriorGoldenCampaignExecutor,
  options: ArchitectureInteriorGoldenCampaignRunnerOptions = {},
): Promise<ArchitectureInteriorGoldenCampaignState> {
  const maximumAttempts = Math.max(1, Math.min(3, options.maximumAttemptsPerSlot ?? 3));
  let state = resumeArchitectureInteriorGoldenCampaignState(initial, suiteInput(initial));
  const checkpoint = async () => options.onCheckpoint?.(structuredClone(state));
  for (let index = 0; index < state.slots.length; index++) {
    let slot = state.slots[index]!;
    if (slot.status === 'completed' || (slot.status === 'failed' && slot.attempts >= maximumAttempts)) continue;
    const scenario = scenarioById.get(slot.scenarioId);
    if (!scenario) throw new Error(`architecture_interior_campaign_scenario_missing:${slot.scenarioId}`);
    while (slot.attempts < maximumAttempts && slot.status !== 'completed') {
      slot = { ...slot, status: 'running', attempts: slot.attempts + 1, lastError: null };
      state = { ...state, slots: state.slots.map((item, current) => current === index ? slot : item) };
      await checkpoint();
      try {
        const run = await executor({ scenario, campaign: slot.campaign, repeat: slot.repeat, attempt: slot.attempts });
        if (run.campaign !== slot.campaign || run.repeat !== slot.repeat || run.usedForTuning !== false || !Number.isFinite(run.accuracy) || run.accuracy < 0 || run.accuracy > 1) throw new Error('architecture_interior_campaign_executor_result_invalid');
        const result: ArchitectureInteriorGoldenCampaignResult = { scenarioId: slot.scenarioId, run: structuredClone(run) };
        const resultHash = hash(result);
        state = { ...state, results: [...state.results.filter(item => resultKey(item) !== slot.key), result], slots: state.slots.map((item, current) => current === index ? { ...slot, status: 'completed' as const, resultHash, lastError: null } : item) };
        slot = state.slots[index]!;
        await checkpoint();
      } catch (error) {
        slot = { ...slot, status: 'failed', resultHash: null, lastError: error instanceof Error ? error.message : String(error) };
        state = { ...state, slots: state.slots.map((item, current) => current === index ? slot : item) };
        await checkpoint();
      }
    }
  }
  return state;
}
