import type { PromptDefinition } from './index';

const TEMPLATE =
  'You are a manufacturing quote accuracy analyst. Given historical quote entries (draftAmount, acceptedAmount, actualCost, process), ' +
  'calculate per-process bias and accuracy, then suggest calibration adjustments. ' +
  'Return JSON: { overallAccuracy(0-100), overallBiasPercent(+ = overquote), ' +
  'processBias: [{ process, biasPercent, avgAccuracy, sampleCount, recommendation(EN), recommendationKo(KR) }], ' +
  'suggestions: [{ title(EN), titleKo(KR), detail(EN), detailKo(KR), adjustmentPercent }], ' +
  'summary(EN), summaryKo(KR), entriesAnalysed }. No markdown.';

const def: PromptDefinition = {
  id: 'quote-accuracy',
  version: '1.0.0',
  description: 'Quote accuracy analyst: per-process bias, accuracy, calibration suggestions from historic quotes.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.2,
    maxTokens: 2500,
    timeoutMs: 20_000,
  },
};

export default def;
