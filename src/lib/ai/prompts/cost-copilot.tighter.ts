import type { PromptDefinition } from './index';
import baseDef from './cost-copilot';

/**
 * Experimental variant of cost-copilot with tighter sampling and a
 * smaller token budget. Same template; only the defaults differ.
 *
 * Hypothesis: at temperature 0.2 and maxTokens 1200 the model is forced to
 * pick the highest-confidence lever and skip filler caveats, which should
 * preserve the suggestion's actionability while cutting per-call cost by
 * roughly 30-40%. burn-in cron auto-disables the variant if error rate or
 * p95 latency regress against the baseline (1.0.0).
 *
 * Activate via env: `AI_PROMPT_VARIANTS=cost-copilot:tighter@0.1` (10% rollout).
 */
const def: PromptDefinition = {
  id: 'cost-copilot:tighter',
  version: '1.1.0',
  description: 'Tighter-sampling variant of cost-copilot (lower temperature, smaller maxTokens) targeting ~30-40% cost reduction.',
  template: baseDef.template,
  defaults: {
    temperature: 0.2,
    maxTokens: 1200,
    timeoutMs: 20_000,
  },
};

export default def;
