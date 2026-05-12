import type { PromptDefinition } from './index';

const TEMPLATE =
  'You analyze manufacturing design spec changes between two revisions. ' +
  'Given prev and next spec objects, return JSON: { ' +
  '"diffs": [{field, fieldKo, prev, next, impact("high"|"medium"|"low"), impactKo}], ' +
  '"costImpact": "increase"|"decrease"|"neutral"|"unknown", "costImpactKo", ' +
  '"leadImpact": "increase"|"decrease"|"neutral"|"unknown", "leadImpactKo", ' +
  '"reRfqRequired": boolean, "reRfqReason"(EN), "reRfqReasonKo"(KR), ' +
  '"actions": string[], "actionsKo": string[], ' +
  '"summary"(EN), "summaryKo"(KR), "affectedRfqs": string[] }. ' +
  'Be concise and focus on manufacturing impact. No markdown.';

const def: PromptDefinition = {
  id: 'change-detector',
  version: '1.0.0',
  description: 'Revision diff analyzer: identifies impact, re-RFQ need, and actions between two spec revisions.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.2,
    maxTokens: 2000,
    timeoutMs: 20_000,
  },
};

export default def;
