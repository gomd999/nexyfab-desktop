import { describe, expect, it } from 'vitest';
import { MANUFACTURING_CORPUS_V1, type ManufacturingCorpusCase } from '../manufacturingCorpus';
import { buildManufacturingKpiReport, type ManufacturingEvalRun } from '../manufacturingKpi';

describe('manufacturing sales KPI', () => {
  it('reports unmeasured families honestly and blocks expansion', () => {
    const report = buildManufacturingKpiReport(MANUFACTURING_CORPUS_V1, []);
    expect(report.measuredRuns).toBe(0);
    expect(report.families.every(family => family.eligibleForExpansion === false)).toBe(true);
    expect(report.families.every(family => family.gatePassRate === null)).toBe(true);
  });

  it('detects a false verified result as a release-critical KPI', () => {
    const concept = MANUFACTURING_CORPUS_V1.find(item => item.expectedOutcome === 'concept_only')!;
    const run: ManufacturingEvalRun = {
      caseId: concept.id, run: 1, actualOutcome: 'verified', gatesPassed: true,
      dimensionChecks: 1, dimensionChecksPassed: 1, featureChecks: 1, featureChecksPassed: 1,
    };
    const report = buildManufacturingKpiReport([concept], [run]);
    expect(report.overallFalseVerified).toBe(1);
    expect(report.families[0].blockers).toContain('False verified count must be zero; current is 1.');
  });

  it('requires all cases, five runs, perfect gates and >=95% dimension/feature accuracy', () => {
    const corpus: ManufacturingCorpusCase[] = Array.from({ length: 20 }, (_, index) => ({
      ...MANUFACTURING_CORPUS_V1[0], id: `plate-${index + 1}`, productFamily: 'plate',
    }));
    const runs: ManufacturingEvalRun[] = corpus.flatMap(item => Array.from({ length: 5 }, (_, index) => ({
      caseId: item.id, run: index + 1, actualOutcome: item.expectedOutcome, gatesPassed: true,
      dimensionChecks: 10, dimensionChecksPassed: 10, featureChecks: 10, featureChecksPassed: 10,
    })));
    expect(buildManufacturingKpiReport(corpus, runs).families[0]).toMatchObject({
      independentCases: 20, measuredCases: 20, minimumRunsPerCase: 5,
      gatePassRate: 1, dimensionalAccuracy: 1, featureAccuracy: 1,
      eligibleForExpansion: true,
    });
  });

  it('ignores run records whose case id is not in the governed corpus', () => {
    const report = buildManufacturingKpiReport(MANUFACTURING_CORPUS_V1, [{
      caseId: 'unknown', run: 1, actualOutcome: 'verified', gatesPassed: true,
      dimensionChecks: 1, dimensionChecksPassed: 1, featureChecks: 1, featureChecksPassed: 1,
    }]);
    expect(report.measuredRuns).toBe(0);
  });
});
