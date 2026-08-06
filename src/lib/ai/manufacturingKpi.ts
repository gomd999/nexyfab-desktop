import type { CorpusExpectedOutcome, CorpusProductFamily, ManufacturingCorpusCase } from './manufacturingCorpus';

export interface ManufacturingEvalRun {
  caseId: string;
  run: number;
  actualOutcome: CorpusExpectedOutcome;
  gatesPassed: boolean;
  dimensionChecks: number;
  dimensionChecksPassed: number;
  featureChecks: number;
  featureChecksPassed: number;
}

export interface FamilyKpi {
  productFamily: CorpusProductFamily;
  independentCases: number;
  measuredCases: number;
  totalRuns: number;
  minimumRunsPerCase: number;
  gatePassRate: number | null;
  dimensionalAccuracy: number | null;
  featureAccuracy: number | null;
  falseVerified: number;
  outcomeAccuracy: number | null;
  customerFailureCases: number;
  eligibleForExpansion: boolean;
  blockers: string[];
}

export interface ManufacturingKpiReport {
  generatedFromCases: number;
  measuredRuns: number;
  families: FamilyKpi[];
  overallFalseVerified: number;
}

const ratio = (passed: number, total: number): number | null => total > 0 ? passed / total : null;

/** Sales expansion thresholds from docs/ai-manufacturing-sales-scope.md. */
export function buildManufacturingKpiReport(
  corpus: ManufacturingCorpusCase[],
  runs: ManufacturingEvalRun[],
): ManufacturingKpiReport {
  const caseById = new Map(corpus.map(item => [item.id, item]));
  const validRuns = runs.filter(run => caseById.has(run.caseId));
  const families = [...new Set(corpus.map(item => item.productFamily))].sort();
  const familyReports = families.map(productFamily => {
    const cases = corpus.filter(item => item.productFamily === productFamily);
    const caseIds = new Set(cases.map(item => item.id));
    const familyRuns = validRuns.filter(run => caseIds.has(run.caseId));
    const runsByCase = new Map<string, ManufacturingEvalRun[]>();
    for (const run of familyRuns) runsByCase.set(run.caseId, [...(runsByCase.get(run.caseId) ?? []), run]);
    const measuredCases = [...runsByCase.values()].filter(value => value.length > 0).length;
    const minimumRunsPerCase = cases.length > 0
      ? Math.min(...cases.map(item => runsByCase.get(item.id)?.length ?? 0))
      : 0;
    const gatePassRate = ratio(familyRuns.filter(run => run.gatesPassed).length, familyRuns.length);
    const dimensionChecks = familyRuns.reduce((sum, run) => sum + run.dimensionChecks, 0);
    const dimensionPassed = familyRuns.reduce((sum, run) => sum + run.dimensionChecksPassed, 0);
    const featureChecks = familyRuns.reduce((sum, run) => sum + run.featureChecks, 0);
    const featurePassed = familyRuns.reduce((sum, run) => sum + run.featureChecksPassed, 0);
    const falseVerified = familyRuns.filter(run => {
      const expected = caseById.get(run.caseId)?.expectedOutcome;
      return run.actualOutcome === 'verified' && expected !== 'verified';
    }).length;
    const outcomeCorrect = familyRuns.filter(run => caseById.get(run.caseId)?.expectedOutcome === run.actualOutcome).length;
    const dimensionalAccuracy = ratio(dimensionPassed, dimensionChecks);
    const featureAccuracy = ratio(featurePassed, featureChecks);
    const outcomeAccuracy = ratio(outcomeCorrect, familyRuns.length);
    const customerFailureCases = cases.filter(item => item.source === 'customer_failure').length;
    const blockers: string[] = [];
    if (cases.length < 20) blockers.push(`Need at least 20 independent cases; have ${cases.length}.`);
    if (measuredCases !== cases.length) blockers.push(`Every case must be measured; measured ${measuredCases}/${cases.length}.`);
    if (minimumRunsPerCase < 5) blockers.push(`Every case needs at least 5 runs; minimum is ${minimumRunsPerCase}.`);
    if (gatePassRate !== 1) blockers.push(`G0-G9 pass rate must be 100%; current is ${gatePassRate === null ? 'not measured' : `${(gatePassRate * 100).toFixed(1)}%`}.`);
    if (dimensionalAccuracy === null || dimensionalAccuracy < 0.95) blockers.push(`Dimensional accuracy must be at least 95%; current is ${dimensionalAccuracy === null ? 'not measured' : `${(dimensionalAccuracy * 100).toFixed(1)}%`}.`);
    if (featureAccuracy === null || featureAccuracy < 0.95) blockers.push(`Feature accuracy must be at least 95%; current is ${featureAccuracy === null ? 'not measured' : `${(featureAccuracy * 100).toFixed(1)}%`}.`);
    if (falseVerified > 0) blockers.push(`False verified count must be zero; current is ${falseVerified}.`);
    return {
      productFamily, independentCases: cases.length, measuredCases, totalRuns: familyRuns.length,
      minimumRunsPerCase, gatePassRate, dimensionalAccuracy, featureAccuracy, falseVerified,
      outcomeAccuracy, customerFailureCases, eligibleForExpansion: blockers.length === 0, blockers,
    } satisfies FamilyKpi;
  });
  return {
    generatedFromCases: corpus.length,
    measuredRuns: validRuns.length,
    families: familyReports,
    overallFalseVerified: familyReports.reduce((sum, family) => sum + family.falseVerified, 0),
  };
}
