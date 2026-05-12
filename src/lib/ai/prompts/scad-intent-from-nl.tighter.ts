import type { PromptDefinition } from './index';
import baseDef from './scad-intent-from-nl';

/**
 * Experimental variant of scad-intent-from-nl with stricter sampling.
 * Same template; only the defaults differ. Activate per-rollout via
 * `AI_PROMPT_VARIANTS=scad-intent-from-nl:tighter@0.5`.
 */
const def: PromptDefinition = {
  id: 'scad-intent-from-nl:tighter',
  version: '1.1.0',
  description: 'Tighter-sampling variant of scad-intent-from-nl (lower temperature, smaller maxTokens) for benchmark comparison.',
  template: baseDef.template,
  defaults: {
    temperature: 0.0,
    maxTokens: 600,
    timeoutMs: 30_000,
  },
};

export default def;
