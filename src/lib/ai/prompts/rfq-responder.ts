import type { PromptDefinition } from './index';

const TEMPLATE =
  'You assist a manufacturing partner in drafting a quote response to an incoming RFQ. ' +
  'Given the RFQ brief and the partner capacity profile, produce a realistic Korean-market quote with: ' +
  '(1) estimatedAmountKrw — total quote in KRW, rounded to nearest 1000; ' +
  '(2) estimatedDays — lead time in calendar days including QC/dispatch; ' +
  '(3) note (EN) + noteKo (KR) — 2-3 sentences explaining what is included; ' +
  '(4) breakdown — 3-5 line items {label, labelKo, amountKrw} summing close to the total; ' +
  '(5) caveats / caveatsKo — risks (budget mismatch, low DFM, missing certs, capacity) the partner should review; ' +
  '(6) confidence 0..1. ' +
  'Use the partner hourlyRateKrw and materialMargin if provided; else assume 80,000 KRW/hr and 35% material margin. ' +
  'Return JSON only. Do NOT wrap in markdown.';

const def: PromptDefinition = {
  id: 'rfq-responder',
  version: '1.0.0',
  description: 'Partner-side RFQ response drafter: estimated amount, lead time, breakdown, caveats, confidence.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.4,
    maxTokens: 1600,
    timeoutMs: 20_000,
  },
};

export default def;
