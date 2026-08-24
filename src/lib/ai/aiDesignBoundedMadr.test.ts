import { describe, expect, it } from 'vitest';
import {
  AI_DESIGN_MADR_ROLES,
  InMemoryAiDesignMadrSessionStore,
  assessAiDesignMadrHoldoutCampaign,
  projectAiDesignMadrRecovery,
  runBoundedAiDesignMadr,
  validateAiDesignBoundedMadrSession,
  type AiDesignMadrRole,
  type AiDesignMadrTurnOutputV1,
} from './aiDesignBoundedMadr';

const hash = (character: string) => character.repeat(64);
const modelReceipts = Object.fromEntries(AI_DESIGN_MADR_ROLES.map((role, index) => [role, String(index + 1).repeat(64)])) as Record<AiDesignMadrRole, string>;
const budget = { maxRounds: 3, maxCalls: 30, maxCostUnits: 100, maxDurationMs: 5_000, maxConcurrency: 2, maxRetriesPerRole: 1, turnTimeoutMs: 500 };
const input = { sessionId: 'madr-1', projectId: 'project-1', designSessionId: 'session-1', candidateDigest: hash('a'), structureDigest: hash('b'), constraintDigest: hash('c'), knowledgeReceiptDigests: [hash('d')], modelSelectionReceiptDigests: modelReceipts, budget };

function output(role: AiDesignMadrRole, decision: AiDesignMadrTurnOutputV1['decision']): AiDesignMadrTurnOutputV1 {
  return { decision, proposal: role === 'architect' ? 'Use a modular concept.' : '', critique: role === 'architect' ? '' : `${role} review`, rationale: 'Bounded concept review rationale.', riskCodes: [], requestedInputKeys: [], confidence: 0.8, costUnits: 1, modelId: `model-${role}`, exactAuthority: false, manufacturingAuthority: false };
}

describe('bounded multi-agent design review', () => {
  it('reaches concept-only consensus within finite call, cost, time and concurrency budgets', async () => {
    let active = 0; let maxActive = 0;
    const session = await runBoundedAiDesignMadr(input, async turn => {
      active += 1; maxActive = Math.max(maxActive, active); await Promise.resolve(); active -= 1;
      return output(turn.role, turn.role === 'architect' ? 'PROPOSE' : 'ACCEPT');
    }, { now: () => new Date('2026-08-24T00:00:00.000Z') });
    expect(session).toMatchObject({ status: 'PASS', termination: 'CONSENSUS_REACHED', roundsCompleted: 1, callsUsed: 5, costUnitsUsed: 5, conceptOnly: true, exactAuthority: false, manufacturingAuthority: false });
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(validateAiDesignBoundedMadrSession(session)).toEqual([]);
    const store = new InMemoryAiDesignMadrSessionStore();
    expect(store.append(session)).toEqual({ ok: true }); expect(store.append(session)).toEqual({ ok: true });
  });

  it('surfaces unresolved human input instead of manufacturing consensus', async () => {
    const session = await runBoundedAiDesignMadr(input, async turn => turn.role === 'safety'
      ? { ...output(turn.role, 'NEEDS_INPUT'), requestedInputKeys: ['safety-category'] }
      : output(turn.role, turn.role === 'architect' ? 'PROPOSE' : 'ACCEPT'), { now: () => new Date('2026-08-24T00:00:00.000Z') });
    expect(session).toMatchObject({ status: 'INCOMPLETE', termination: 'NEEDS_INPUT', unresolvedInputKeys: ['safety-category'], exactAuthority: false });
    expect(projectAiDesignMadrRecovery(session)).toMatchObject({ durableJobDisposition: 'WAIT_FOR_INPUT', uiRecoveryState: 'needs_input', safeActions: ['PROVIDE_INPUT'] });
  });

  it('terminates on round, cost, cancellation and provider-failure bounds', async () => {
    const maxRounds = await runBoundedAiDesignMadr({ ...input, requiredRoles: ['architect', 'constraint'], budget: { ...budget, maxRounds: 2, maxCalls: 10 } }, async turn => output(turn.role, 'REJECT'), { now: () => new Date('2026-08-24T00:00:00.000Z') });
    expect(maxRounds).toMatchObject({ termination: 'MAX_ROUNDS', roundsCompleted: 2, callsUsed: 4 });
    const cost = await runBoundedAiDesignMadr({ ...input, budget: { ...budget, maxCostUnits: 2 } }, async turn => ({ ...output(turn.role, turn.role === 'architect' ? 'PROPOSE' : 'ACCEPT'), costUnits: 1 }), { now: () => new Date('2026-08-24T00:00:00.000Z') });
    expect(cost).toMatchObject({ termination: 'COST_BUDGET', status: 'INCOMPLETE', callsUsed: 5, costUnitsUsed: 5 });
    const cancelled = await runBoundedAiDesignMadr(input, async turn => output(turn.role, 'ACCEPT'), { cancelled: () => true, now: () => new Date('2026-08-24T00:00:00.000Z') });
    expect(cancelled).toMatchObject({ termination: 'CANCELLED', callsUsed: 0 });
    const failed = await runBoundedAiDesignMadr({ ...input, requiredRoles: ['architect'], budget: { ...budget, maxRetriesPerRole: 1 } }, async () => { throw new Error('provider_down'); }, { now: () => new Date('2026-08-24T00:00:00.000Z') });
    expect(failed).toMatchObject({ termination: 'PROVIDER_FAILURE', status: 'FAILED', callsUsed: 2 });
    expect(projectAiDesignMadrRecovery(failed)).toMatchObject({ durableJobDisposition: 'RETRYABLE_FAILURE', uiRecoveryState: 'retry' });
    const timedOut = await runBoundedAiDesignMadr({ ...input, requiredRoles: ['architect'], budget: { ...budget, maxRetriesPerRole: 0, turnTimeoutMs: 10 } }, async () => new Promise(() => undefined), { now: () => new Date('2026-08-24T00:00:00.000Z') });
    expect(timedOut).toMatchObject({ termination: 'PROVIDER_FAILURE', callsUsed: 1 });
  });

  it('keeps MADR disabled until external holdouts improve quality without increasing leak risk', () => {
    const cases = [0, 1, 2].map(index => ({
      caseId: `case-${index}`, singleRoleQuality: 0.6, multiRoleQuality: 0.75,
      singleRoleLeakRisk: 0.1, multiRoleLeakRisk: 0.1, externalReviewDigest: hash(String(index + 1)), externallyReviewed: index < 2,
    }));
    const policy = { minimumCases: 3, minimumMeanQualityImprovement: 0.1, maximumMeanLeakRiskIncrease: 0 };
    expect(assessAiDesignMadrHoldoutCampaign(cases, policy)).toMatchObject({ status: 'HOLD', defaultEnabled: false, externallyReviewedCaseCount: 2 });
    expect(assessAiDesignMadrHoldoutCampaign(cases.map(item => ({ ...item, externallyReviewed: true })), policy)).toMatchObject({ status: 'PASS', defaultEnabled: true, meanQualityImprovement: 0.15, meanLeakRiskIncrease: 0 });
  });
});
