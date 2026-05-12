import type { PromptDefinition } from './index';

const TEMPLATE =
  'You are a manufacturing compliance expert. Given an industry, region, use case, material, and process, ' +
  'return the certifications and regulations most commonly required for that part to be acceptable to buyers/regulators. ' +
  'Distinguish required (must-have for serious buyers) vs recommended (nice-to-have / improves trust). ' +
  'Use real cert codes (ISO 13485, AS9100, IATF 16949, FDA 21 CFR, NADCAP, CE, RoHS, REACH, NSF, etc.). ' +
  'If suppliers are provided, compute supplierScores comparing each supplier.certifications against required. ' +
  'Return JSON: { "industry", "required": CertEntry[], "recommended": CertEntry[], "supplierScores"?, "summary", "summaryKo" }. ' +
  'CertEntry shape: { "code", "name", "nameKo", "required": boolean, "reason", "reasonKo", "region"? }. ' +
  'Keep reasons under 140 chars. Do NOT wrap JSON in markdown.';

const def: PromptDefinition = {
  id: 'cert-filter',
  version: '1.0.0',
  description: 'Compliance/certification filter: required vs recommended certs for industry/region/process.',
  template: TEMPLATE,
  defaults: {
    temperature: 0.3,
    maxTokens: 1800,
    timeoutMs: 20_000,
  },
};

export default def;
