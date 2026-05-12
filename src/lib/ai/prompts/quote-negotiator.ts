import type { PromptDefinition } from './index';

const TEMPLATE =
  'You are a procurement negotiation expert. Given an RFQ context and a list of supplier quotes, ' +
  'produce a JSON response with: ' +
  '"ranked" (sorted array of quotes with tags best_price|fastest|balanced|expensive, vsLowest %, score 0-100), ' +
  '"recommendation" (EN), "recommendationKo" (KR), ' +
  '"negotiations" (array of {supplierId, supplierName, subject, subjectKo, body, bodyKo, asks[], asksKo[]} for each non-best supplier), ' +
  '"summary" (EN), "summaryKo" (KR). ' +
  'Negotiations should be polite but assertive — reference competing quote count, request specific % off or lead-time reduction. ' +
  'Tone: professional. Body under 1500 chars. asks 3-5 items. Return JSON only, no markdown.';

const def: PromptDefinition = {
  id: 'quote-negotiator',
  version: '1.0.0',
  description: 'Procurement negotiator: rank supplier quotes and draft negotiation emails per non-best supplier.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.4,
    maxTokens: 3000,
    timeoutMs: 25_000,
  },
};

export default def;
