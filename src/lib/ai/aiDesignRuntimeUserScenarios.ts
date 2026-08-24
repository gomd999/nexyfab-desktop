import type { AiDesignGenerationStage } from './aiDesignGenerationOrchestrator';
import type { DesignIntentInputKind } from './designIntentCheckpoint';

export const AI_DESIGN_RUNTIME_USER_SCENARIO_SCHEMA = 'nexyfab.ai-design-runtime-user-scenarios.v1' as const;

export interface AiDesignRuntimeUserScenario {
  id: string;
  title: string;
  inputKinds: readonly DesignIntentInputKind[];
  generationStages: readonly AiDesignGenerationStage[];
  requiredEvidence: readonly string[];
  expectedBoundaries: readonly ('ai-design-runtime' | 'precision-cad')[];
}

export const AI_DESIGN_RUNTIME_USER_SCENARIOS: readonly AiDesignRuntimeUserScenario[] = [
  {
    id: 'multimodal-runtime-persist-recover',
    title: 'Multimodal intake through durable candidate workspace recovery',
    inputKinds: ['text', 'image', 'sketch', 'drawing_2d', 'selection_3d'],
    generationStages: ['understanding', 'planning', 'candidate_generation', 'candidate_validation'],
    requiredEvidence: ['checkpoint_digest', 'model_receipt', 'candidate_evidence', 'session_state_hash'],
    expectedBoundaries: ['ai-design-runtime'],
  },
  {
    id: 'fallback-cancel-exact-resume',
    title: 'Explicit model fallback and exact-stage recovery',
    inputKinds: ['text'],
    generationStages: ['understanding'],
    requiredEvidence: ['fallback_reason', 'resume_stage', 'idempotent_action'],
    expectedBoundaries: ['ai-design-runtime'],
  },
  {
    id: 'gauge-to-precision-request-boundary',
    title: 'Auditable gauge edit through explicit Precision CAD request',
    inputKinds: ['text', 'selection_3d'],
    generationStages: ['understanding', 'planning', 'candidate_generation', 'candidate_validation'],
    requiredEvidence: ['candidate_evidence', 'gauge_preflight', 'base_revision', 'explicit_commit'],
    expectedBoundaries: ['ai-design-runtime', 'precision-cad'],
  },
];

export function validateAiDesignRuntimeUserScenarios(scenarios: readonly AiDesignRuntimeUserScenario[] = AI_DESIGN_RUNTIME_USER_SCENARIOS): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (!scenario.id || ids.has(scenario.id)) issues.push(`scenario_id_invalid:${scenario.id}`);
    ids.add(scenario.id);
    if (!scenario.title.trim() || !scenario.inputKinds.length || !scenario.generationStages.length || !scenario.requiredEvidence.length || !scenario.expectedBoundaries.length) issues.push(`scenario_incomplete:${scenario.id}`);
    if (scenario.expectedBoundaries.includes('precision-cad') && !scenario.requiredEvidence.includes('explicit_commit')) issues.push(`precision_commit_evidence_missing:${scenario.id}`);
  }
  return issues;
}

