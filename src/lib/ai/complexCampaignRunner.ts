import { createHash } from 'node:crypto';
import type { ComplexBenchmarkFamily } from './complexProductBenchmark';
import { resolveRequiredFamilies, validateComplexBenchmarkV2, type ComplexBenchmarkCaseV2, type ComplexBenchmarkRunV2 } from './complexProductBenchmarkV2';

export type CampaignSlotStatus = 'pending' | 'running' | 'completed' | 'failed';
export interface ComplexCampaignSlot { key: string; caseId: string; campaign: number; repeat: number; status: CampaignSlotStatus; attempts: number; resultHash: string | null; lastError: string | null; }
export interface ComplexCampaignState { schema: 'nexyfab.complex-campaign-state.v1'; suiteHash: string; campaigns: number; repeats: number; minimumCasesPerFamily: number; requiredFamilies: ComplexBenchmarkFamily[]; slots: ComplexCampaignSlot[]; results: ComplexBenchmarkRunV2[]; }
export interface ComplexCampaignRunnerOptions { campaigns?: number; repeats?: number; minimumCasesPerFamily?: number; requiredFamilies?: readonly ComplexBenchmarkFamily[]; maximumAttemptsPerSlot?: number; onCheckpoint?: (state: ComplexCampaignState) => void | Promise<void>; }
export type ComplexCampaignExecutor = (input: { caseValue: ComplexBenchmarkCaseV2; campaign: number; repeat: number; attempt: number }) => Promise<ComplexBenchmarkRunV2>;

const stableCases = (cases: readonly ComplexBenchmarkCaseV2[]) => [...cases].sort((a, b) => a.caseId.localeCompare(b.caseId));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const keyOf = (caseId: string, campaign: number, repeat: number) => `${caseId}:${campaign}:${repeat}`;

export function createComplexCampaignState(cases: readonly ComplexBenchmarkCaseV2[], options: ComplexCampaignRunnerOptions = {}): ComplexCampaignState {
  const campaigns = options.campaigns ?? 3, repeats = options.repeats ?? 5, minimum = options.minimumCasesPerFamily ?? 20;
  const requiredFamilies = resolveRequiredFamilies(options.requiredFamilies);
  const issues = validateComplexBenchmarkV2(cases, []); if (issues.length) throw new Error(issues.join(' '));
  if (![campaigns, repeats, minimum].every(value => Number.isInteger(value) && value > 0)) throw new Error('campaign_dimensions_invalid');
  for (const item of cases) {
    const required = item.assertions.filter(assertion => assertion.required);
    if (!required.length) throw new Error(`campaign_required_assertions_missing:${item.caseId}`);
    if (required.some(assertion => !assertion.kpiEligible || assertion.provenance === 'legacy-unreviewed')) throw new Error(`campaign_unapproved_assertions:${item.caseId}`);
  }
  for (const family of requiredFamilies) { const count = cases.filter(item => item.family === family).length; if (count < minimum) throw new Error(`campaign_family_cases_below_minimum:${family}:${count}/${minimum}`); }
  const ordered = stableCases(cases), slots = ordered.flatMap(caseValue => Array.from({ length: campaigns }, (_, campaign) => Array.from({ length: repeats }, (_, repeat): ComplexCampaignSlot => ({ key: keyOf(caseValue.caseId, campaign + 1, repeat + 1), caseId: caseValue.caseId, campaign: campaign + 1, repeat: repeat + 1, status: 'pending', attempts: 0, resultHash: null, lastError: null }))).flat());
  return { schema: 'nexyfab.complex-campaign-state.v1', suiteHash: hash({ cases: ordered, campaigns, repeats, minimumCasesPerFamily: minimum, requiredFamilies }), campaigns, repeats, minimumCasesPerFamily: minimum, requiredFamilies, slots, results: [] };
}

export function resumeComplexCampaignState(state: ComplexCampaignState, cases: readonly ComplexBenchmarkCaseV2[], options: ComplexCampaignRunnerOptions = {}): ComplexCampaignState {
  if (state?.schema !== 'nexyfab.complex-campaign-state.v1' || !Array.isArray(state.requiredFamilies) || !Number.isInteger(state.minimumCasesPerFamily) || state.minimumCasesPerFamily < 1 || !Number.isInteger(state.campaigns) || state.campaigns < 1 || !Number.isInteger(state.repeats) || state.repeats < 1 || !Array.isArray(state.slots) || !Array.isArray(state.results)) throw new Error('campaign_resume_suite_mismatch');
  const campaigns = options.campaigns ?? state.campaigns, repeats = options.repeats ?? state.repeats, minimumCasesPerFamily = options.minimumCasesPerFamily ?? state.minimumCasesPerFamily;
  const requiredFamilies = resolveRequiredFamilies(options.requiredFamilies ?? state.requiredFamilies);
  const expectedHash = hash({ cases: stableCases(cases), campaigns, repeats, minimumCasesPerFamily, requiredFamilies });
  if (state.schema !== 'nexyfab.complex-campaign-state.v1' || state.suiteHash !== expectedHash || campaigns !== state.campaigns || repeats !== state.repeats || minimumCasesPerFamily !== state.minimumCasesPerFamily || requiredFamilies.join('|') !== state.requiredFamilies.join('|')) throw new Error('campaign_resume_suite_mismatch');
  const results = new Map(state.results.map(item => [keyOf(item.caseId, item.campaign, item.repeat), item]));
  const slots = state.slots.map(slot => {
    const saved = results.get(slot.key);
    if (saved && hash(saved) !== slot.resultHash) throw new Error(`campaign_result_hash_mismatch:${slot.key}`);
    if (slot.status === 'completed' && !saved) throw new Error(`campaign_completed_result_missing:${slot.key}`);
    return slot.status === 'running' ? { ...slot, status: 'pending' as const, lastError: 'interrupted_before_checkpoint' } : slot;
  });
  return { ...state, slots };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
}

export async function runComplexCampaign(cases: readonly ComplexBenchmarkCaseV2[], executor: ComplexCampaignExecutor, initial?: ComplexCampaignState, options: ComplexCampaignRunnerOptions = {}): Promise<ComplexCampaignState> {
  let state = initial ? resumeComplexCampaignState(initial, cases, options) : createComplexCampaignState(cases, options);
  const maximumAttempts = Math.max(1, options.maximumAttemptsPerSlot ?? 3), byCase = new Map(cases.map(item => [item.caseId, item]));
  const checkpoint = async () => { await options.onCheckpoint?.(state); };
  for (let index = 0; index < state.slots.length; index++) {
    let slot = state.slots[index]!; if (slot.status === 'completed' || (slot.status === 'failed' && slot.attempts >= maximumAttempts)) continue;
    while (slot.attempts < maximumAttempts && slot.status !== 'completed') {
      slot = { ...slot, status: 'running', attempts: slot.attempts + 1, lastError: null }; state = { ...state, slots: state.slots.map((item, i) => i === index ? slot : item) }; await checkpoint();
      try {
        const result = await executor({ caseValue: byCase.get(slot.caseId)!, campaign: slot.campaign, repeat: slot.repeat, attempt: slot.attempts });
        if (result.subject !== 'ai_generation' || result.caseId !== slot.caseId || result.campaign !== slot.campaign || result.repeat !== slot.repeat || result.usedForTuning !== false) throw new Error('campaign_executor_result_identity_invalid');
        const issues = validateComplexBenchmarkV2(cases, [result]); if (issues.length) throw new Error(issues.join(' '));
        const resultHash = hash(result), results = [...state.results.filter(item => keyOf(item.caseId, item.campaign, item.repeat) !== slot.key), result];
        slot = { ...slot, status: 'completed', resultHash, lastError: null }; state = { ...state, results, slots: state.slots.map((item, i) => i === index ? slot : item) }; await checkpoint();
      } catch (error) {
        slot = { ...slot, status: 'failed', resultHash: null, lastError: error instanceof Error ? error.message : String(error) }; state = { ...state, slots: state.slots.map((item, i) => i === index ? slot : item) }; await checkpoint();
      }
    }
  }
  return state;
}
