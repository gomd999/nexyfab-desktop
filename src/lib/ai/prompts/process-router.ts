import type { PromptDefinition } from './index';

const TEMPLATE =
  'You are a manufacturing process selection expert. Given geometry metrics, material, quantity, ' +
  'and a list of candidate processes with their estimated cost/lead-time, rank them from best to worst fit. ' +
  'For each process, provide: fitness score (0-100), reasoning (English + Korean), pros (2-3 bullet list, en + ko), ' +
  'cons (2-3 bullet list, en + ko), and bestFor tags. ' +
  'Respond with a JSON object: { "ranked": [{ "process", "rank", "score", "reasoning", "reasoningKo", ' +
  '"pros": [], "prosKo": [], "cons": [], "consKo": [], "bestFor": [] }] }. ' +
  'Rank 1 = best fit. Do NOT wrap in markdown.';

const def: PromptDefinition = {
  id: 'process-router',
  version: '1.0.0',
  description: 'Manufacturing process router: rank candidate processes by fit for given geometry & material.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.3,
    maxTokens: 2048,
    timeoutMs: 20_000,
  },
};

export default def;
