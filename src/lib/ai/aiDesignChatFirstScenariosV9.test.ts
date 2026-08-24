import { describe, expect, it } from 'vitest';
import {
  AI_DESIGN_CHAT_FIRST_SCENARIOS_V9,
  advanceAiDesignChatFirstScenarioRun,
  attachAiDesignChatFirstScenarioEvidence,
  createAiDesignChatFirstScenarioRun,
  validateAiDesignChatFirstScenarios,
} from './aiDesignChatFirstScenariosV9';

describe('AI Design chat-first V9 scenarios', () => {
  it('covers the five required desktop/mobile flows with safe authority', () => {
    expect(AI_DESIGN_CHAT_FIRST_SCENARIOS_V9.map(scenario => scenario.id)).toEqual([
      'text-to-synchronized-2d-3d',
      'drawing-to-3d-ambiguity-resolution',
      'existing-3d-text-edit-updates-2d',
      'mobile-interruption-recovery',
      'model-fallback-preserves-selection',
    ]);
    expect(validateAiDesignChatFirstScenarios()).toEqual([]);
    expect(AI_DESIGN_CHAT_FIRST_SCENARIOS_V9.every(scenario => scenario.authority.aiDesignConceptOnly && scenario.authority.browserCannotAuthorPass)).toBe(true);
  });

  it('enforces scenario step order and complete evidence for every step', () => {
    const scenario = AI_DESIGN_CHAT_FIRST_SCENARIOS_V9[1]!;
    let run = createAiDesignChatFirstScenarioRun(scenario.id);
    expect(() => advanceAiDesignChatFirstScenarioRun(run, { stepId: scenario.steps[1]!.id, evidenceCodes: scenario.steps[1]!.evidenceRequired, outcome: 'PASS' })).toThrow('chat_first_scenario_step_out_of_order');
    expect(() => advanceAiDesignChatFirstScenarioRun(run, { stepId: scenario.steps[0]!.id, evidenceCodes: [], outcome: 'PASS' })).toThrow('chat_first_scenario_evidence_missing');
    for (const item of scenario.steps) run = advanceAiDesignChatFirstScenarioRun(run, { stepId: item.id, evidenceCodes: item.evidenceRequired, outcome: 'PASS', externalRendererEvidenceAttached: true });
    expect(run).toMatchObject({ status: 'PASS', nextStepIndex: scenario.steps.length, externalRendererEvidenceAttached: true, manufacturingReleaseReady: false });
  });

  it('does not pass a renderer/Precision scenario until independent evidence is attached', () => {
    const scenario = AI_DESIGN_CHAT_FIRST_SCENARIOS_V9[0]!;
    let run = createAiDesignChatFirstScenarioRun(scenario.id);
    for (const item of scenario.steps) run = advanceAiDesignChatFirstScenarioRun(run, { stepId: item.id, evidenceCodes: item.evidenceRequired, outcome: 'PASS' });
    expect(run).toMatchObject({ status: 'RUNNING', failureCode: 'external_evidence_pending', externalRendererEvidenceAttached: false, precisionReceiptAttached: false });
    expect(attachAiDesignChatFirstScenarioEvidence(run, { externalRendererEvidenceAttached: true }).status).toBe('RUNNING');
    expect(attachAiDesignChatFirstScenarioEvidence(run, { externalRendererEvidenceAttached: true, precisionReceiptAttached: true }).status).toBe('PASS');

    let evidenced = createAiDesignChatFirstScenarioRun(scenario.id);
    for (const [index, item] of scenario.steps.entries()) evidenced = advanceAiDesignChatFirstScenarioRun(evidenced, {
      stepId: item.id, evidenceCodes: item.evidenceRequired, outcome: 'PASS',
      externalRendererEvidenceAttached: index === scenario.steps.length - 1,
      precisionReceiptAttached: index === scenario.steps.length - 1,
    });
    expect(evidenced.status).toBe('PASS');
  });

  it('records a fail-closed terminal outcome', () => {
    const scenario = AI_DESIGN_CHAT_FIRST_SCENARIOS_V9[4]!;
    const run = createAiDesignChatFirstScenarioRun(scenario.id);
    const failed = advanceAiDesignChatFirstScenarioRun(run, { stepId: scenario.steps[0]!.id, evidenceCodes: [], outcome: 'FAIL', failureCode: 'selection_not_preserved' });
    expect(failed).toMatchObject({ status: 'FAIL', failureCode: 'selection_not_preserved', manufacturingReleaseReady: false });
    expect(() => advanceAiDesignChatFirstScenarioRun(failed, { stepId: scenario.steps[0]!.id, evidenceCodes: [], outcome: 'FAIL' })).toThrow('chat_first_scenario_run_terminal');
  });
});
