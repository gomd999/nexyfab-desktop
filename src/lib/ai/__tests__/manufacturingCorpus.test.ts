import { describe, expect, it } from 'vitest';
import {
  MANUFACTURING_CORPUS_V1,
  summarizeCorpusSources,
  validateManufacturingCorpus,
  validateManufacturingCorpusCase,
  type ManufacturingCorpusCase,
} from '../manufacturingCorpus';

describe('manufacturing corpus governance', () => {
  it('keeps the initial baseline valid and makes its provenance visible', () => {
    expect(validateManufacturingCorpus(MANUFACTURING_CORPUS_V1)).toEqual([]);
    expect(summarizeCorpusSources(MANUFACTURING_CORPUS_V1)).toMatchObject({
      customer_failure: 0,
      synthetic: 6,
      internal_dogfood: 2,
    });
  });

  it('rejects customer input without a hash or with unconsented raw content', () => {
    const customerCase: ManufacturingCorpusCase = {
      ...MANUFACTURING_CORPUS_V1[0],
      id: 'customer-001',
      source: 'customer_failure',
      sourceReference: 'nf_failure_log:signature-only',
      rawInputRetained: false,
    };
    const fields = validateManufacturingCorpusCase(customerCase).map(issue => issue.field);
    expect(fields).toContain('inputHash');
    expect(fields).toContain('testInput');
  });

  it('requires the full geometric handoff for a verified result', () => {
    const incomplete = {
      ...MANUFACTURING_CORPUS_V1[0],
      requiredGates: ['intent_complete'],
    } satisfies ManufacturingCorpusCase;
    expect(validateManufacturingCorpusCase(incomplete).map(issue => issue.message)).toContain(
      'Verified cases must require step_roundtrip.',
    );
  });

  it('rejects duplicate ids and fewer than five AI repetitions', () => {
    const shortRun = { ...MANUFACTURING_CORPUS_V1[0], repeatCount: 1 };
    const issues = validateManufacturingCorpus([shortRun, shortRun]);
    expect(issues.some(issue => issue.field === 'repeatCount')).toBe(true);
    expect(issues.some(issue => issue.message === 'Case ids must be unique.')).toBe(true);
  });
});
