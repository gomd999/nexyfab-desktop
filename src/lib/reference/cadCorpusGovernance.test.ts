import { describe, expect, it } from 'vitest';
import { CAD_GOLDEN_SCENARIOS } from './cadCorpusManifest';
import { classifyCadCorpusCandidate, corpusVerdict, isExcludedCorpusPath } from './cadCorpusGovernance';

describe('external CAD corpus governance', () => {
  it('routes neutral files to executable tracks without claiming native CAD support', () => {
    expect(classifyCadCorpusCandidate({ relativePath: 'NIST-PMI/model_ap242.step', sizeBytes: 1 })).toMatchObject({ support: 'executable', track: 'pmi' });
    expect(classifyCadCorpusCandidate({ relativePath: 'MeArm/robot.SLDASM', sizeBytes: 1 })).toMatchObject({ support: 'reference_only', track: 'motion' });
    expect(corpusVerdict(classifyCadCorpusCandidate({ relativePath: 'part.CATPart', sizeBytes: 1 }))).toBe('not_run');
  });

  it('excludes generated, secret, repository, and dependency paths', () => {
    expect(isExcludedCorpusPath('result/ir/a.json')).toBe(true);
    expect(isExcludedCorpusPath('.gate_work/a.step')).toBe(true);
    expect(isExcludedCorpusPath('.env')).toBe(true);
    expect(isExcludedCorpusPath('models/a.step')).toBe(false);
  });

  it('keeps every golden scenario quarantined from redistribution', () => {
    expect(CAD_GOLDEN_SCENARIOS.length).toBeGreaterThanOrEqual(8);
    expect(CAD_GOLDEN_SCENARIOS.every(item => item.redistribution === 'forbidden_until_proven')).toBe(true);
    expect(new Set(CAD_GOLDEN_SCENARIOS.map(item => item.id)).size).toBe(CAD_GOLDEN_SCENARIOS.length);
  });
});

