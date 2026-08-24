import type { DesignIntentInputKind } from './designIntentCheckpoint';

export const AI_DESIGN_USER_SCENARIO_SCHEMA = 'nexyfab.ai-design-user-scenario.v1' as const;

export interface AiDesignUserScenarioV1 {
  schema: typeof AI_DESIGN_USER_SCENARIO_SCHEMA;
  id: string;
  title: string;
  inputKinds: readonly DesignIntentInputKind[];
  presentation: 'desktop' | 'mobile';
  steps: readonly string[];
  expectedRegions: readonly string[];
  precisionCadBoundary: readonly string[];
}

export const AI_DESIGN_USER_SCENARIOS: readonly AiDesignUserScenarioV1[] = [
  {
    schema: AI_DESIGN_USER_SCENARIO_SCHEMA,
    id: 'multimodal-to-verified-precision',
    title: 'Multimodal intake to verified precision result',
    inputKinds: ['text', 'image', 'sketch', 'drawing_2d', 'selection_3d'],
    presentation: 'desktop',
    steps: ['confirm-intent', 'generate-candidates', 'compare', 'direct-edit', 'request-precision', 'inspect-verification'],
    expectedRegions: ['header', 'intake', 'canvas', 'candidates', 'assistant', 'verification', 'action_bar'],
    precisionCadBoundary: ['execute-exact-cad', 'persist-idempotency', 'verify-geometry', 'emit-receipt'],
  },
  {
    schema: AI_DESIGN_USER_SCENARIO_SCHEMA,
    id: 'mobile-interruption-resume',
    title: 'Mobile direct-edit interruption and safe resume',
    inputKinds: ['drawing_2d', 'selection_3d'],
    presentation: 'mobile',
    steps: ['select', 'begin-gauge', 'go-offline', 'discard-draft', 'reconnect', 'resume-checkpoint'],
    expectedRegions: ['header', 'canvas', 'action_bar', 'mobile_sheet'],
    precisionCadBoundary: ['reject-uncommitted-draft', 'preserve-authoritative-revision'],
  },
  {
    schema: AI_DESIGN_USER_SCENARIO_SCHEMA,
    id: 'model-fallback-preserves-cad-selection',
    title: 'Model fallback does not change the CAD selection',
    inputKinds: ['selection_3d'],
    presentation: 'desktop',
    steps: ['select-cad-entity', 'request-model', 'show-fallback', 'retain-selection'],
    expectedRegions: ['header', 'canvas', 'assistant', 'action_bar'],
    precisionCadBoundary: ['retain-selection-reference'],
  },
] as const;

export function validateAiDesignUserScenarios(scenarios: readonly AiDesignUserScenarioV1[] = AI_DESIGN_USER_SCENARIOS): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (scenario.schema !== AI_DESIGN_USER_SCENARIO_SCHEMA || !scenario.id.trim() || !scenario.title.trim()) issues.push('invalid_scenario_header');
    if (ids.has(scenario.id)) issues.push(`duplicate_scenario:${scenario.id}`);
    ids.add(scenario.id);
    if (!scenario.inputKinds.length || !scenario.steps.length || !scenario.expectedRegions.length || !scenario.precisionCadBoundary.length) {
      issues.push(`incomplete_scenario:${scenario.id}`);
    }
    if (scenario.presentation === 'mobile' && !scenario.expectedRegions.includes('mobile_sheet')) issues.push(`mobile_sheet_missing:${scenario.id}`);
    if (scenario.presentation === 'desktop' && scenario.expectedRegions.includes('mobile_sheet')) issues.push(`desktop_mobile_sheet_forbidden:${scenario.id}`);
  }
  return [...new Set(issues)];
}
