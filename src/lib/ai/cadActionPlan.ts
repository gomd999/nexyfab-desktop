import { normalizeMechanicalVocabulary } from './mechanicalVocabulary';
import { selectCadTools, type CadToolSelection } from './cadToolSelector';
import { interpretCadRequest, type CadInterpretationContract } from './cadInterpretationContract';
import type { EngChatActionPayload } from '@/lib/engChatActionPayload';

export type CadActionPlan = {
  schema: 'nexyfab.cad-action-plan.v1';
  operation: 'create_part' | 'create_assembly' | 'reply' | 'wiring' | 'calculation';
  canonicalTerms: string[];
  steps: Array<'normalize' | 'generate' | 'verify' | 'export'>;
  confidence: number;
  needsConfirmation: boolean;
  ambiguities: string[];
  tools: CadToolSelection[];
  /** Pre-action interpretation; consumers must honor its mutation gate. */
  interpretation: CadInterpretationContract;
};

/** Build an auditable plan envelope without changing the existing action contract. */
export function buildCadActionPlan(message: string, action: EngChatActionPayload): CadActionPlan {
  const vocabulary = normalizeMechanicalVocabulary(message);
  const tools = selectCadTools(message, vocabulary.hits);
  const interpretation = interpretCadRequest(message);
  // Unknown products intentionally compose the generic planner and geometry
  // tools. They are not terminal "no template/vocabulary" failures.
  for (const tool of interpretation.candidates[0]?.tools ?? []) {
    if (tool === 'product-planner' && !tools.some(item => item.tool === 'product-planner')) {
      tools.unshift({ tool: 'product-planner', reason: 'generic parametric fallback for unknown product/template', confidence: 0.42 });
    }
  }
  const operation = action.type === 'scad' ? 'create_part'
    : action.type === 'assembly' ? 'create_assembly'
      : action.type === 'calc' ? 'calculation'
        : action.type;
  const needsConfirmation = action.type === 'reply' || !action.prompt?.trim() || interpretation.requiresConfirmation;
  return {
    schema: 'nexyfab.cad-action-plan.v1',
    operation,
    canonicalTerms: interpretation.vocabularyHits.map(hit => hit.canonical),
    steps: operation === 'reply' ? ['normalize'] : ['normalize', 'generate', 'verify', 'export'],
    confidence: interpretation.candidates.length ? Math.max(...interpretation.candidates.map(candidate => candidate.confidence)) : 0,
    needsConfirmation,
    ambiguities: [...new Set([
      ...vocabulary.ambiguities,
      ...interpretation.candidates.flatMap(candidate => candidate.ambiguities),
    ])],
    tools,
    interpretation,
  };
}
