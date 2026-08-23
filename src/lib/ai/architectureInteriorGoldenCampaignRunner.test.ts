import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_INTERIOR_GOLDEN_POLICY,
  ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS,
  type ArchitectureInteriorGoldenRun,
} from './architectureInteriorGoldenScenarios';
import {
  architectureInteriorGoldenEvidence,
  createArchitectureInteriorGoldenCampaignState,
  evaluateArchitectureInteriorGoldenCampaign,
  resumeArchitectureInteriorGoldenCampaignState,
  runArchitectureInteriorGoldenCampaign,
} from './architectureInteriorGoldenCampaignRunner';

const hash = (value: string) => value.repeat(64).slice(0, 64);
const inputs = Object.fromEntries(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.map((scenario, scenarioIndex) => [scenario.id, Object.fromEntries(scenario.authoritativeInputs.map((item, inputIndex) => [item.id, hash(`${scenarioIndex}${inputIndex}`)]))]));
const approvals = Object.fromEntries(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.map((scenario, index) => [scenario.id, [{ reviewerId: 'reviewer-a', approvalReceiptHash: hash(`${index + 1}a`), approved: true as const }, { reviewerId: 'reviewer-b', approvalReceiptHash: hash(`${index + 1}b`), approved: true as const }]]));
const goodRun = (campaign: number, repeat: number, falseVerified = false): ArchitectureInteriorGoldenRun => ({ campaign, repeat, usedForTuning: false, requiredGatesPassed: true, accuracy: 0.98, falseVerified });
const expectedSlotCount = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.length * ARCHITECTURE_INTERIOR_GOLDEN_POLICY.campaigns * ARCHITECTURE_INTERIOR_GOLDEN_POLICY.repeatsPerCampaign;

describe('architecture/interior golden campaign runner', () => {
  it('creates deterministic 3 × 5 slots per scenario and resumes only with the same suite hash', () => {
    const first = createArchitectureInteriorGoldenCampaignState({ inputSourceHashes: inputs, approvals });
    const second = createArchitectureInteriorGoldenCampaignState({ inputSourceHashes: structuredClone(inputs), approvals });
    expect(first.suiteHash).toBe(second.suiteHash);
    expect(first.slots).toHaveLength(expectedSlotCount);
    expect(first.slots[0]).toMatchObject({ scenarioId: 'arch-single-storey-small-office', campaign: 1, repeat: 1, status: 'pending' });
    expect(() => resumeArchitectureInteriorGoldenCampaignState(first, { inputSourceHashes: { ...inputs, [ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0]!.id]: { ...inputs[ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0]!.id], 'office-brief': hash('changed') } }, approvals })).toThrow('suite_hash_mismatch');
  });

  it('checkpoints, resumes interrupted slots, and evaluates complete evidence', async () => {
    const initial = createArchitectureInteriorGoldenCampaignState({ inputSourceHashes: inputs, approvals });
    const interrupted = { ...initial, slots: initial.slots.map((slot, index) => index === 0 ? { ...slot, status: 'running' as const, attempts: 1 } : slot) };
    const checkpoints: string[] = [];
    const final = await runArchitectureInteriorGoldenCampaign(interrupted, async ({ campaign, repeat }) => goodRun(campaign, repeat), { onCheckpoint: state => { checkpoints.push(state.slots.find(slot => slot.status === 'running')?.key ?? 'done'); } });
    expect(checkpoints.length).toBeGreaterThan(expectedSlotCount);
    expect(final.slots.every(slot => slot.status === 'completed')).toBe(true);
    expect(final.results).toHaveLength(expectedSlotCount);
    expect(architectureInteriorGoldenEvidence(final)).toHaveLength(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.length);
    const reports = evaluateArchitectureInteriorGoldenCampaign(final);
    expect(reports.every(report => report.eligible === false)).toBe(true);
  }, 20_000);

  it('rejects duplicate, missing, and extra slots before execution', () => {
    const state = createArchitectureInteriorGoldenCampaignState({ inputSourceHashes: inputs, approvals });
    const duplicate = { ...state, slots: [...state.slots.slice(0, -1), state.slots[0]!] };
    expect(() => resumeArchitectureInteriorGoldenCampaignState(duplicate, { inputSourceHashes: inputs, approvals })).toThrow('slot_duplicate');
    const missing = { ...state, slots: state.slots.slice(0, -1) };
    expect(() => resumeArchitectureInteriorGoldenCampaignState(missing, { inputSourceHashes: inputs, approvals })).toThrow('slot_missing');
    const extra = { ...state, slots: [...state.slots, { ...state.slots[0]!, key: 'unexpected:1:1', scenarioId: 'unexpected' }] };
    expect(() => resumeArchitectureInteriorGoldenCampaignState(extra, { inputSourceHashes: inputs, approvals })).toThrow('slot_extra_or_identity_invalid');
  });

  it('detects result, slot hash, and suite hash tampering during evaluation', async () => {
    const state = createArchitectureInteriorGoldenCampaignState({ inputSourceHashes: inputs, approvals });
    const final = await runArchitectureInteriorGoldenCampaign(state, async ({ campaign, repeat }) => goodRun(campaign, repeat));
    const resultTampered = structuredClone(final);
    resultTampered.results[0]!.run.accuracy = .5;
    expect(evaluateArchitectureInteriorGoldenCampaign(resultTampered).every(report => report.blockers.some(blocker => blocker.startsWith('result_binding_invalid:')))).toBe(true);
    const suiteTampered = structuredClone(final);
    (suiteTampered.inputSourceHashes as Record<string, Record<string, string>>)[ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0]!.id]!['office-brief'] = hash('changed');
    expect(evaluateArchitectureInteriorGoldenCampaign(suiteTampered).every(report => report.blockers.includes('suite_hash_mismatch'))).toBe(true);
  });

  it('keeps falseVerified as evidence but fails promotion, and rejects tuning contamination', async () => {
    const state = createArchitectureInteriorGoldenCampaignState({ inputSourceHashes: inputs, approvals });
    const final = await runArchitectureInteriorGoldenCampaign(state, async ({ campaign, repeat }) => goodRun(campaign, repeat, true));
    expect(evaluateArchitectureInteriorGoldenCampaign(final).every(report => report.blockers.includes('false_verified'))).toBe(true);
    const contaminated = createArchitectureInteriorGoldenCampaignState({ inputSourceHashes: inputs, approvals });
    const result = await runArchitectureInteriorGoldenCampaign(contaminated, async ({ campaign, repeat }) => ({ ...goodRun(campaign, repeat), usedForTuning: true }) as unknown as ArchitectureInteriorGoldenRun, { maximumAttemptsPerSlot: 1 });
    expect(result.results).toHaveLength(0);
    expect(evaluateArchitectureInteriorGoldenCampaign(result).every(report => report.eligible === false)).toBe(true);
  }, 20_000);
});
