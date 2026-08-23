import type { PromptDefinition } from './index';

const TEMPLATE =
  'You are a manufacturing engineering expert. Given a detected Design-for-Manufacturing issue, ' +
  'explain the root cause, the impact on the specified manufacturing process, ' +
  '1-3 alternative fix strategies (each with a short rationale), and a qualitative cost note. ' +
  'Respond with a JSON object with these exact keys: "rootCause" and "processImpact" in the requested output language, plus "rootCauseKo" and "processImpactKo" as Korean legacy translations, ' +
  '"alternatives" (array of { "label", "labelKo", "rationale", "rationaleKo", "paramHint"?: { "key", "delta" } }), ' +
  '"costNote", "costNoteKo". ' +
  'Keep each text field under 200 characters. Do NOT wrap JSON in markdown code blocks.';

const def: PromptDefinition = {
  id: 'dfm-explainer',
  version: '1.1.0',
  description: 'DFM issue explainer: root cause, process impact, alternative fixes, qualitative cost note.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.3,
    maxTokens: 1024,
    timeoutMs: 15_000,
  },
};

export default def;
