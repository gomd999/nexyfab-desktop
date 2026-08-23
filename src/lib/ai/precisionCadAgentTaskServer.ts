import { serverEvidenceSha256 } from './serverEvidence';
import type { GenerationRunState } from './generationRunState';
import type { PrecisionCadGenerationBinding } from './precisionCadAgentTask';

/** Server-only verification of the client-carried generation binding. */
export function precisionCadGenerationBindingMatchesState(
  binding: PrecisionCadGenerationBinding,
  state: GenerationRunState,
  projectId: string,
): boolean {
  return binding.projectId === projectId
    && state.projectId === projectId
    && binding.runId === state.runId
    && binding.revision === state.revision
    && binding.stateSha256 === serverEvidenceSha256(state);
}
