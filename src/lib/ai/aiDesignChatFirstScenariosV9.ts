export const AI_DESIGN_CHAT_FIRST_SCENARIO_SCHEMA = 'nexyfab.ai-design-chat-first-scenario.v9' as const;
export const AI_DESIGN_CHAT_FIRST_SCENARIO_RUN_SCHEMA = 'nexyfab.ai-design-chat-first-scenario-run.v9' as const;

export interface AiDesignChatFirstScenarioStepV9 {
  id: string;
  surface: 'chat' | '2d' | '3d' | 'split' | 'mobile-sheet' | 'precision-boundary';
  action: string;
  expected: string;
  evidenceRequired: readonly string[];
}

export interface AiDesignChatFirstScenarioV9 {
  schema: typeof AI_DESIGN_CHAT_FIRST_SCENARIO_SCHEMA;
  id: string;
  title: string;
  device: 'desktop' | 'mobile';
  inputs: readonly ('text' | 'drawing_2d' | 'image_or_sketch' | 'existing_3d')[];
  steps: readonly AiDesignChatFirstScenarioStepV9[];
  authority: {
    aiDesignConceptOnly: true;
    precisionCadExactRequired: boolean;
    browserCannotAuthorPass: true;
  };
}

export interface AiDesignChatFirstScenarioRunV9 {
  schema: typeof AI_DESIGN_CHAT_FIRST_SCENARIO_RUN_SCHEMA;
  scenarioId: string;
  nextStepIndex: number;
  status: 'NOT_RUN' | 'RUNNING' | 'PASS' | 'FAIL';
  completedStepIds: readonly string[];
  evidenceCodes: readonly string[];
  failureCode: string | null;
  externalRendererEvidenceAttached: boolean;
  precisionReceiptAttached: boolean;
  manufacturingReleaseReady: false;
}

const step = (id: string, surface: AiDesignChatFirstScenarioStepV9['surface'], action: string, expected: string, evidenceRequired: readonly string[]): AiDesignChatFirstScenarioStepV9 => ({ id, surface, action, expected, evidenceRequired });

export const AI_DESIGN_CHAT_FIRST_SCENARIOS_V9: readonly AiDesignChatFirstScenarioV9[] = [
  {
    schema: AI_DESIGN_CHAT_FIRST_SCENARIO_SCHEMA,
    id: 'text-to-synchronized-2d-3d', title: 'Text to synchronized 2D and 3D concept editing', device: 'desktop', inputs: ['text'],
    steps: [
      step('submit-text', 'chat', 'Submit a bounded synthetic brief', 'Understanding card is the only recommended next action', ['chat_card_rendered', 'checkpoint_bound']),
      step('choose-candidate', 'chat', 'Compare and choose one concept', 'Selection remains stable in both views', ['candidate_selected', 'selection_id_stable']),
      step('open-split', 'split', 'Open 2D and 3D together', 'Both views show the same concept revision', ['renderer_2d_visible', 'renderer_3d_visible', 'revision_match']),
      step('preview-gauge', 'split', 'Adjust a gauge and preview', 'Both views update without persisting exact CAD', ['preview_only', 'two_d_three_d_sync']),
      step('request-precision', 'precision-boundary', 'Explicitly request Precision CAD', 'A bounded request is emitted; no browser-authored PASS', ['explicit_commit', 'precision_request_id']),
    ],
    authority: { aiDesignConceptOnly: true, precisionCadExactRequired: true, browserCannotAuthorPass: true },
  },
  {
    schema: AI_DESIGN_CHAT_FIRST_SCENARIO_SCHEMA,
    id: 'drawing-to-3d-ambiguity-resolution', title: '2D drawing to 3D with explicit ambiguity resolution', device: 'desktop', inputs: ['drawing_2d'],
    steps: [
      step('upload-drawing', 'chat', 'Attach a rights-cleared synthetic drawing', 'Drawing becomes a non-authoritative intake source', ['rights_policy_pass', 'drawing_source_bound']),
      step('show-ambiguity', '2d', 'Select an ambiguously mapped dimension', 'The sync result is NEEDS_INPUT and no target is guessed', ['needs_input', 'no_automatic_mapping']),
      step('confirm-mapping', 'chat', 'Choose the intended feature mapping', 'Mapping is explicit and revision-bound', ['user_mapping_confirmed', 'mapping_revision_bound']),
      step('preview-3d', 'split', 'Preview the derived 3D concept', '2D selection and 3D feature remain linked', ['renderer_2d_visible', 'renderer_3d_visible', 'selection_id_stable']),
    ],
    authority: { aiDesignConceptOnly: true, precisionCadExactRequired: false, browserCannotAuthorPass: true },
  },
  {
    schema: AI_DESIGN_CHAT_FIRST_SCENARIO_SCHEMA,
    id: 'existing-3d-text-edit-updates-2d', title: 'Existing 3D plus text change with 2D update preview', device: 'desktop', inputs: ['existing_3d', 'text'],
    steps: [
      step('select-3d', '3d', 'Select a stable feature', 'Chat context shows the selected feature without raw geometry', ['selection_id_stable', 'no_geometry_in_chat_event']),
      step('describe-change', 'chat', 'Describe a bounded parameter change', 'A change-preview card explains scope and impact', ['change_card_rendered', 'impact_explained']),
      step('preview-drawing', 'split', 'Preview the gauge change', 'The corresponding 2D dimension preview updates', ['preview_only', 'three_d_to_two_d_sync']),
      step('reject-or-apply', 'chat', 'Reject or explicitly apply the concept change', 'No implicit commit occurs', ['explicit_choice', 'revision_cas']),
    ],
    authority: { aiDesignConceptOnly: true, precisionCadExactRequired: false, browserCannotAuthorPass: true },
  },
  {
    schema: AI_DESIGN_CHAT_FIRST_SCENARIO_SCHEMA,
    id: 'mobile-interruption-recovery', title: 'Mobile chat-first preview interruption and recovery', device: 'mobile', inputs: ['drawing_2d', 'existing_3d'],
    steps: [
      step('start-in-chat', 'chat', 'Open the workspace', 'Chat is primary and the canvas opens full-screen on demand', ['mobile_chat_primary', 'touch_targets_44px']),
      step('open-canvas-sheet', 'mobile-sheet', 'Open 2D/3D canvas and gauge sheet', 'Focus is trapped and primary actions remain sticky', ['focus_trap', 'sticky_actions', 'gesture_arbitration']),
      step('interrupt-preview', 'mobile-sheet', 'Background the app during preview', 'Uncommitted preview is discarded or saved only as a draft token', ['no_implicit_commit', 'resume_token_bound']),
      step('resume-server-state', 'chat', 'Reconnect and resume', 'Server revision is refreshed before mutation', ['server_state_refreshed', 'selection_restored']),
    ],
    authority: { aiDesignConceptOnly: true, precisionCadExactRequired: false, browserCannotAuthorPass: true },
  },
  {
    schema: AI_DESIGN_CHAT_FIRST_SCENARIO_SCHEMA,
    id: 'model-fallback-preserves-selection', title: 'Model fallback preserves synchronized CAD selection', device: 'desktop', inputs: ['existing_3d'],
    steps: [
      step('select-feature', 'split', 'Select a linked 2D/3D feature', 'Stable selection IDs are recorded', ['selection_id_stable']),
      step('trigger-fallback', 'chat', 'Run a deterministic provider fallback fixture', 'The model change and reason are visible', ['fallback_receipt', 'fallback_reason_visible']),
      step('verify-selection', 'split', 'Return to the visual workspace', '2D and 3D selection and revision are unchanged', ['selection_preserved', 'revision_match']),
    ],
    authority: { aiDesignConceptOnly: true, precisionCadExactRequired: false, browserCannotAuthorPass: true },
  },
] as const;

const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function createAiDesignChatFirstScenarioRun(scenarioId: string): AiDesignChatFirstScenarioRunV9 {
  if (!AI_DESIGN_CHAT_FIRST_SCENARIOS_V9.some(scenario => scenario.id === scenarioId)) throw new Error('chat_first_scenario_unknown');
  return {
    schema: AI_DESIGN_CHAT_FIRST_SCENARIO_RUN_SCHEMA,
    scenarioId, nextStepIndex: 0, status: 'NOT_RUN', completedStepIds: [], evidenceCodes: [], failureCode: null,
    externalRendererEvidenceAttached: false, precisionReceiptAttached: false, manufacturingReleaseReady: false,
  };
}

export function advanceAiDesignChatFirstScenarioRun(run: AiDesignChatFirstScenarioRunV9, input: {
  stepId: string;
  evidenceCodes: readonly string[];
  outcome: 'PASS' | 'FAIL';
  externalRendererEvidenceAttached?: boolean;
  precisionReceiptAttached?: boolean;
  failureCode?: string;
}): AiDesignChatFirstScenarioRunV9 {
  const scenario = AI_DESIGN_CHAT_FIRST_SCENARIOS_V9.find(candidate => candidate.id === run.scenarioId);
  if (!scenario || run.schema !== AI_DESIGN_CHAT_FIRST_SCENARIO_RUN_SCHEMA) throw new Error('chat_first_scenario_run_invalid');
  if (run.status === 'PASS' || run.status === 'FAIL') throw new Error('chat_first_scenario_run_terminal');
  const expected = scenario.steps[run.nextStepIndex];
  if (!expected || input.stepId !== expected.id) throw new Error(`chat_first_scenario_step_out_of_order:${expected?.id ?? 'complete'}`);
  if (input.evidenceCodes.some(code => !SAFE_CODE.test(code))) throw new Error('chat_first_scenario_evidence_invalid');
  const evidence = [...new Set([...run.evidenceCodes, ...input.evidenceCodes])];
  const externalRendererEvidenceAttached = run.externalRendererEvidenceAttached || input.externalRendererEvidenceAttached === true;
  const precisionReceiptAttached = run.precisionReceiptAttached || input.precisionReceiptAttached === true;
  if (input.outcome === 'FAIL') return {
    ...run, status: 'FAIL', evidenceCodes: evidence, failureCode: input.failureCode && SAFE_CODE.test(input.failureCode) ? input.failureCode : 'scenario_step_failed',
    externalRendererEvidenceAttached, precisionReceiptAttached,
  };
  const missing = expected.evidenceRequired.filter(code => !input.evidenceCodes.includes(code));
  if (missing.length) throw new Error(`chat_first_scenario_evidence_missing:${missing.join(',')}`);
  const nextStepIndex = run.nextStepIndex + 1;
  const last = nextStepIndex === scenario.steps.length;
  const rendererEvidenceRequired = scenario.steps.some(item => item.evidenceRequired.some(code => code.startsWith('renderer_')));
  const precisionEvidenceRequired = scenario.authority.precisionCadExactRequired;
  const canPass = last && (!rendererEvidenceRequired || externalRendererEvidenceAttached) && (!precisionEvidenceRequired || precisionReceiptAttached);
  return {
    ...run,
    nextStepIndex,
    completedStepIds: [...run.completedStepIds, input.stepId],
    evidenceCodes: evidence,
    externalRendererEvidenceAttached,
    precisionReceiptAttached,
    status: canPass ? 'PASS' : 'RUNNING',
    failureCode: last && !canPass ? 'external_evidence_pending' : null,
  };
}

/** Promotes a completed headless run only after separately produced renderer/Precision evidence arrives. */
export function attachAiDesignChatFirstScenarioEvidence(run: AiDesignChatFirstScenarioRunV9, input: {
  externalRendererEvidenceAttached?: boolean;
  precisionReceiptAttached?: boolean;
}): AiDesignChatFirstScenarioRunV9 {
  const scenario = AI_DESIGN_CHAT_FIRST_SCENARIOS_V9.find(candidate => candidate.id === run.scenarioId);
  if (!scenario || run.status !== 'RUNNING' || run.nextStepIndex !== scenario.steps.length || run.failureCode !== 'external_evidence_pending') throw new Error('chat_first_scenario_not_awaiting_evidence');
  const externalRendererEvidenceAttached = run.externalRendererEvidenceAttached || input.externalRendererEvidenceAttached === true;
  const precisionReceiptAttached = run.precisionReceiptAttached || input.precisionReceiptAttached === true;
  const rendererEvidenceRequired = scenario.steps.some(item => item.evidenceRequired.some(code => code.startsWith('renderer_')));
  const canPass = (!rendererEvidenceRequired || externalRendererEvidenceAttached) && (!scenario.authority.precisionCadExactRequired || precisionReceiptAttached);
  return {
    ...run,
    externalRendererEvidenceAttached,
    precisionReceiptAttached,
    status: canPass ? 'PASS' : 'RUNNING',
    failureCode: canPass ? null : 'external_evidence_pending',
  };
}

export function validateAiDesignChatFirstScenarios(scenarios: readonly AiDesignChatFirstScenarioV9[] = AI_DESIGN_CHAT_FIRST_SCENARIOS_V9): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (scenario.schema !== AI_DESIGN_CHAT_FIRST_SCENARIO_SCHEMA || ids.has(scenario.id)) issues.push(`scenario_identity_invalid:${scenario.id}`);
    ids.add(scenario.id);
    if (!scenario.steps.length || new Set(scenario.steps.map(item => item.id)).size !== scenario.steps.length) issues.push(`scenario_steps_invalid:${scenario.id}`);
    if (scenario.device === 'mobile' && !scenario.steps.some(item => item.surface === 'mobile-sheet')) issues.push(`scenario_mobile_sheet_missing:${scenario.id}`);
    if (scenario.authority.precisionCadExactRequired && !scenario.steps.some(item => item.surface === 'precision-boundary')) issues.push(`scenario_precision_boundary_missing:${scenario.id}`);
    if (!scenario.authority.aiDesignConceptOnly || !scenario.authority.browserCannotAuthorPass) issues.push(`scenario_authority_invalid:${scenario.id}`);
  }
  return issues;
}
