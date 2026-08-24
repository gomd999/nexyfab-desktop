import type { AiDesignScreenActionId, AiDesignScreenBindingV1 } from './aiDesignScreenBinding';

export const AI_DESIGN_SCREEN_EFFECT_SCHEMA = 'nexyfab.ai-design-screen-effect.v1' as const;

export type AiDesignScreenEffectCommand =
  | 'OPEN_MODEL_SELECTOR'
  | 'OPEN_INPUT_SHEET'
  | 'START_GENERATION'
  | 'SELECT_CANDIDATE'
  | 'APPLY_CANDIDATE_TO_SESSION'
  | 'OPEN_GAUGE_NUMERIC_INPUT'
  | 'PREVIEW_DIRECT_EDIT'
  | 'SUBMIT_DIRECT_EDIT_TO_PRECISION'
  | 'REQUEST_PRECISION_VERIFICATION'
  | 'OPEN_VERIFICATION_EVIDENCE'
  | 'CANCEL_ACTIVE_OPERATION'
  | 'RESUME_ACTIVE_OPERATION';

export interface AiDesignScreenEffectV1 {
  schema: typeof AI_DESIGN_SCREEN_EFFECT_SCHEMA;
  effectId: string;
  actionId: AiDesignScreenActionId;
  command: AiDesignScreenEffectCommand;
  boundary: 'local-ui' | 'ai-design-runtime' | 'precision-cad';
  projectId: string;
  revisionToken: string;
  expectedRuntimeRevision: number;
  references: {
    candidateId: string | null;
    gaugeId: string | null;
    modelId: string | null;
    proposalId: string | null;
  };
  mutation: 'none' | 'session-only' | 'preview-only' | 'exact-cad-request';
  preservesCadSelection: true;
  explicitCommitRequired: boolean;
}

export type AiDesignScreenDispatchResult =
  | { ok: true; effect: AiDesignScreenEffectV1 }
  | { ok: false; error: string };

const COMMANDS: Record<AiDesignScreenActionId, Pick<AiDesignScreenEffectV1, 'command' | 'boundary' | 'mutation' | 'explicitCommitRequired'>> = {
  'select-model': { command: 'OPEN_MODEL_SELECTOR', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false },
  'provide-input': { command: 'OPEN_INPUT_SHEET', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false },
  generate: { command: 'START_GENERATION', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false },
  'select-candidate': { command: 'SELECT_CANDIDATE', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false },
  'apply-candidate': { command: 'APPLY_CANDIDATE_TO_SESSION', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: true },
  'open-numeric-input': { command: 'OPEN_GAUGE_NUMERIC_INPUT', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false },
  'preview-direct-edit': { command: 'PREVIEW_DIRECT_EDIT', boundary: 'ai-design-runtime', mutation: 'preview-only', explicitCommitRequired: false },
  'confirm-direct-edit': { command: 'SUBMIT_DIRECT_EDIT_TO_PRECISION', boundary: 'precision-cad', mutation: 'exact-cad-request', explicitCommitRequired: true },
  'request-precision': { command: 'REQUEST_PRECISION_VERIFICATION', boundary: 'precision-cad', mutation: 'exact-cad-request', explicitCommitRequired: true },
  'inspect-verification': { command: 'OPEN_VERIFICATION_EVIDENCE', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false },
  cancel: { command: 'CANCEL_ACTIVE_OPERATION', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false },
  resume: { command: 'RESUME_ACTIVE_OPERATION', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false },
};

const REQUIRED_REFERENCE: Partial<Record<AiDesignScreenActionId, keyof AiDesignScreenEffectV1['references']>> = {
  'select-candidate': 'candidateId',
  'apply-candidate': 'candidateId',
  'open-numeric-input': 'gaugeId',
  'preview-direct-edit': 'gaugeId',
  'confirm-direct-edit': 'proposalId',
};

/** Converts a rendered action into one bounded effect; it never executes CAD. */
export function dispatchAiDesignScreenAction(input: {
  binding: AiDesignScreenBindingV1;
  actionId: AiDesignScreenActionId;
  effectId: string;
  expectedRuntimeRevision: number;
  references?: Partial<AiDesignScreenEffectV1['references']>;
}): AiDesignScreenDispatchResult {
  const rendered = input.binding.actions.find(action => action.id === input.actionId);
  if (!rendered) return { ok: false, error: 'screen_action_not_rendered' };
  if (!rendered.enabled) return { ok: false, error: rendered.reason ?? 'screen_action_disabled' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(input.effectId) || !Number.isSafeInteger(input.expectedRuntimeRevision) || input.expectedRuntimeRevision < 0) return { ok: false, error: 'screen_effect_identity_invalid' };
  const references = {
    candidateId: input.references?.candidateId ?? null,
    gaugeId: input.references?.gaugeId ?? null,
    modelId: input.references?.modelId ?? input.binding.modelSelector.selectedModelId,
    proposalId: input.references?.proposalId ?? null,
  };
  const required = REQUIRED_REFERENCE[input.actionId];
  if (required && !references[required]?.trim()) return { ok: false, error: `screen_effect_reference_required:${required}` };
  return {
    ok: true,
    effect: {
      schema: AI_DESIGN_SCREEN_EFFECT_SCHEMA,
      effectId: input.effectId,
      actionId: input.actionId,
      ...COMMANDS[input.actionId],
      projectId: input.binding.projectId,
      revisionToken: input.binding.revisionToken,
      expectedRuntimeRevision: input.expectedRuntimeRevision,
      references,
      preservesCadSelection: true,
    },
  };
}

