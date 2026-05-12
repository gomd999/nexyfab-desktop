import type { PromptDefinition } from './index';

const TEMPLATE =
  'You are a manufacturing capacity matchmaker. Given a partner profile (processes, certs, idle days, hourly rate) ' +
  'and a list of open RFQs, rank the RFQs by fit and generate a short pitch email per match. ' +
  'Return JSON: { matches: [{ rfqId, projectName, matchScore(0-100), matchReasons[], matchReasonsKo[], ' +
  'estimatedMarginKrw(null if unknown), urgency("high"|"medium"|"low"), urgencyKo, ' +
  'pitchSubject, pitchBody, pitchSubjectKo, pitchBodyKo }], ' +
  'summary(EN), summaryKo(KR), idleWindowDays, totalMatched }. ' +
  'Sort matches by matchScore descending. No markdown.';

const def: PromptDefinition = {
  id: 'capacity-match',
  version: '1.0.0',
  description: 'Capacity matchmaker: rank open RFQs against a partner profile and draft pitch emails.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.25,
    maxTokens: 3000,
    timeoutMs: 25_000,
  },
};

export default def;
