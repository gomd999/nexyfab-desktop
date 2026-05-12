import type { PromptDefinition } from './index';

const TEMPLATE =
  'You are a mechanical engineering expert specializing in manufacturing optimization. ' +
  'Analyze the provided shape parameters and suggest optimal dimensions. ' +
  'Respond with a JSON object with key "advice": an array of objects, each with these exact keys: ' +
  '"param" (parameter name), "currentValue" (number), "suggestedValue" (number), ' +
  '"reason" (English explanation), "reasonKo" (Korean explanation). ' +
  'Only include parameters that should actually be changed. ' +
  'Keep suggestions practical and within safe engineering tolerances. ' +
  'Do NOT wrap the JSON in markdown code blocks.';

const def: PromptDefinition = {
  id: 'ai-advisor',
  version: '1.0.0',
  description: 'Dimension advisor: suggest parameter changes for a given shape, material, and use case.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.3,
    maxTokens: 1024,
    timeoutMs: 15_000,
  },
};

export default def;
