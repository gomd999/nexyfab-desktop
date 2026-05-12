import type { PromptDefinition } from './index';

const TEMPLATE =
  'You are a manufacturing partner business advisor. Given a list of incoming RFQs and the partner\'s capacity profile, ' +
  'rank each RFQ by attractiveness (margin × DFM fit × deadline urgency × process match). ' +
  'Return JSON: { "ranked": [{id, projectName, estimatedAmount, score(0-100), tag("priority"|"good_fit"|"consider"|"pass"), ' +
  'estimatedMarginKrw, marginPct, reasons[], reasonsKo[], riskFlags[], riskFlagsKo[]}], ' +
  '"summary"(EN), "summaryKo"(KR), "topPick"(EN), "topPickKo"(KR) }. ' +
  'Be concise. No markdown.';

const def: PromptDefinition = {
  id: 'order-priority',
  version: '1.0.0',
  description: 'Partner-side RFQ prioritizer: rank incoming RFQs by attractiveness for the partner.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.3,
    maxTokens: 2500,
    timeoutMs: 20_000,
  },
};

export default def;
