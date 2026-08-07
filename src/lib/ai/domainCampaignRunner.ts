import { createHash } from 'node:crypto';
import { buildDomainAccuracyEvidence, type DomainAccuracyCase, type DomainAccuracyRun } from './domainAccuracyEvidence';
import type { DomainAccuracyDomain } from './domainAccuracyProgram';

export type DomainCampaignSlotStatus = 'pending' | 'running' | 'completed' | 'failed';
export interface DomainCampaignSlot {
  key: string;
  caseId: string;
  campaign: number;
  repeat: number;
  status: DomainCampaignSlotStatus;
  attempts: number;
  resultHash: string | null;
  lastError: string | null;
}
export interface DomainCampaignState {
  schema: 'nexyfab.domain-campaign-state.v1';
  domain: DomainAccuracyDomain;
  suiteHash: string;
  campaigns: number;
  repeats: number;
  slots: DomainCampaignSlot[];
  results: DomainAccuracyRun[];
}
export interface DomainCampaignRunnerOptions {
  campaigns?: number;
  repeats?: number;
  minimumCases?: number;
  maximumAttemptsPerSlot?: number;
  onCheckpoint?: (state: DomainCampaignState) => void | Promise<void>;
}
export type DomainCampaignExecutor = (input: {
  caseValue: DomainAccuracyCase;
  campaign: number;
  repeat: number;
  attempt: number;
}) => Promise<DomainAccuracyRun>;

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const orderedCases = (cases: readonly DomainAccuracyCase[]) => [...cases].sort((a, b) => a.caseId.localeCompare(b.caseId));
const keyOf = (caseId: string, campaign: number, repeat: number) => `${caseId}:${campaign}:${repeat}`;

export function createDomainCampaignState(
  domain: DomainAccuracyDomain,
  cases: readonly DomainAccuracyCase[],
  options: DomainCampaignRunnerOptions = {},
): DomainCampaignState {
  const campaigns = options.campaigns ?? 3;
  const repeats = options.repeats ?? 5;
  const minimumCases = options.minimumCases ?? 20;
  if (![campaigns, repeats, minimumCases].every(value => Number.isInteger(value) && value > 0)) throw new Error('domain_campaign_dimensions_invalid');
  if (cases.length < minimumCases) throw new Error(`domain_campaign_cases_below_minimum:${cases.length}/${minimumCases}`);
  const integrity = buildDomainAccuracyEvidence(domain, cases, []);
  if (integrity.issues.length) throw new Error(`domain_campaign_case_integrity:${integrity.issues.join(',')}`);
  const ordered = orderedCases(cases);
  const slots = ordered.flatMap(caseValue => Array.from({ length: campaigns }, (_, campaign) =>
    Array.from({ length: repeats }, (_, repeat): DomainCampaignSlot => ({
      key: keyOf(caseValue.caseId, campaign + 1, repeat + 1),
      caseId: caseValue.caseId,
      campaign: campaign + 1,
      repeat: repeat + 1,
      status: 'pending',
      attempts: 0,
      resultHash: null,
      lastError: null,
    })),
  ).flat());
  return { schema: 'nexyfab.domain-campaign-state.v1', domain, suiteHash: digest(ordered), campaigns, repeats, slots, results: [] };
}

export function resumeDomainCampaignState(
  state: DomainCampaignState,
  domain: DomainAccuracyDomain,
  cases: readonly DomainAccuracyCase[],
): DomainCampaignState {
  if (state.schema !== 'nexyfab.domain-campaign-state.v1' || state.domain !== domain || state.suiteHash !== digest(orderedCases(cases))) {
    throw new Error('domain_campaign_resume_suite_mismatch');
  }
  const results = new Map(state.results.map(item => [keyOf(item.caseId, item.campaign, item.repeat), item]));
  const slots = state.slots.map(slot => {
    const saved = results.get(slot.key);
    if (saved && digest(saved) !== slot.resultHash) throw new Error(`domain_campaign_result_hash_mismatch:${slot.key}`);
    if (slot.status === 'completed' && !saved) throw new Error(`domain_campaign_completed_result_missing:${slot.key}`);
    return slot.status === 'running' ? { ...slot, status: 'pending' as const, lastError: 'interrupted_before_checkpoint' } : slot;
  });
  return { ...state, slots };
}

export async function runDomainCampaign(
  domain: DomainAccuracyDomain,
  cases: readonly DomainAccuracyCase[],
  executor: DomainCampaignExecutor,
  initial?: DomainCampaignState,
  options: DomainCampaignRunnerOptions = {},
): Promise<DomainCampaignState> {
  let state = initial ? resumeDomainCampaignState(initial, domain, cases) : createDomainCampaignState(domain, cases, options);
  const maximumAttempts = Math.max(1, options.maximumAttemptsPerSlot ?? 3);
  const byCase = new Map(cases.map(item => [item.caseId, item]));
  const checkpoint = async () => options.onCheckpoint?.(state);
  for (let index = 0; index < state.slots.length; index++) {
    let slot = state.slots[index]!;
    if (slot.status === 'completed' || (slot.status === 'failed' && slot.attempts >= maximumAttempts)) continue;
    while (slot.attempts < maximumAttempts && slot.status !== 'completed') {
      slot = { ...slot, status: 'running', attempts: slot.attempts + 1, lastError: null };
      state = { ...state, slots: state.slots.map((item, i) => i === index ? slot : item) };
      await checkpoint();
      try {
        const result = await executor({ caseValue: byCase.get(slot.caseId)!, campaign: slot.campaign, repeat: slot.repeat, attempt: slot.attempts });
        if (
          result.caseId !== slot.caseId || result.domain !== domain || result.campaign !== slot.campaign
          || result.repeat !== slot.repeat || result.usedForTuning !== false
        ) throw new Error('domain_campaign_executor_result_identity_invalid');
        const integrity = buildDomainAccuracyEvidence(domain, cases, [result]);
        if (integrity.issues.length) throw new Error(`domain_campaign_result_integrity:${integrity.issues.join(',')}`);
        const resultHash = digest(result);
        const results = [...state.results.filter(item => keyOf(item.caseId, item.campaign, item.repeat) !== slot.key), result];
        slot = { ...slot, status: 'completed', resultHash, lastError: null };
        state = { ...state, results, slots: state.slots.map((item, i) => i === index ? slot : item) };
        await checkpoint();
      } catch (error) {
        slot = { ...slot, status: 'failed', resultHash: null, lastError: error instanceof Error ? error.message : String(error) };
        state = { ...state, slots: state.slots.map((item, i) => i === index ? slot : item) };
        await checkpoint();
      }
    }
  }
  return state;
}
