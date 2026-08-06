export const COMPLEX_PRODUCT_FAMILIES = ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'interior'] as const;
export type ComplexBenchmarkFamily = typeof COMPLEX_PRODUCT_FAMILIES[number];

export interface ComplexBenchmarkCase {
  caseId: string;
  family: ComplexBenchmarkFamily;
  holdoutGroup: string;
  sourceHash: string;
  sourceKind: 'standard_corpus' | 'manual_derived' | 'internal_dogfood' | 'customer_failure';
  split: 'holdout';
  expectedDefinitions: number;
  expectedOccurrences: number;
  requiredChecks: Array<'dimensions' | 'features' | 'parts' | 'assembly' | 'step_roundtrip'>;
}

export interface ComplexBenchmarkRun {
  caseId: string;
  repeat: number;
  usedForTuning: false;
  requiredGatesPassed: boolean;
  falseVerified: boolean;
  dimensions: { passed: number; total: number };
  features: { passed: number; total: number };
  parts: { passed: number; total: number };
  assembly: { passed: number; total: number };
}

export interface ComplexFamilyBenchmarkReport {
  family: ComplexBenchmarkFamily;
  independentCases: number;
  measuredCases: number;
  minimumRepeats: number;
  gatePassRate: number | null;
  dimensionalAccuracy: number | null;
  featureAccuracy: number | null;
  partAccuracy: number | null;
  assemblyAccuracy: number | null;
  falseVerified: number;
  eligible: boolean;
  blockers: string[];
}

export interface ComplexBenchmarkReport { families: ComplexFamilyBenchmarkReport[]; eligibleFamilies: ComplexBenchmarkFamily[]; allFamiliesEligible: boolean }

const SHA = /^[a-f0-9]{64}$/;
const ratio = (passed: number, total: number) => total > 0 ? passed / total : null;
const validCount = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function validateComplexBenchmarkCases(cases: readonly ComplexBenchmarkCase[]): string[] {
  const issues: string[] = [], ids = new Set<string>(), familyByGroup = new Map<string, ComplexBenchmarkFamily>();
  for (const item of cases) {
    if (!item.caseId.trim() || ids.has(item.caseId)) issues.push(`Duplicate or empty caseId: ${item.caseId || '(empty)'}.`); ids.add(item.caseId);
    if (!COMPLEX_PRODUCT_FAMILIES.includes(item.family)) issues.push(`${item.caseId}: unsupported family.`);
    if (item.split !== 'holdout') issues.push(`${item.caseId}: complex accuracy cases must remain holdout.`);
    if (!SHA.test(item.sourceHash)) issues.push(`${item.caseId}: sourceHash must be a raw SHA-256.`);
    if (!item.holdoutGroup.trim()) issues.push(`${item.caseId}: holdoutGroup is required.`);
    const prior = familyByGroup.get(item.holdoutGroup); if (prior && prior !== item.family) issues.push(`${item.caseId}: holdout group crosses product families.`); else familyByGroup.set(item.holdoutGroup, item.family);
    if (![item.expectedDefinitions, item.expectedOccurrences].every(value => Number.isSafeInteger(value) && value > 0) || item.expectedOccurrences < item.expectedDefinitions) issues.push(`${item.caseId}: expected definition/occurrence counts are invalid.`);
    const required = new Set(item.requiredChecks); for (const check of ['dimensions', 'features', 'parts', 'assembly', 'step_roundtrip'] as const) if (!required.has(check)) issues.push(`${item.caseId}: missing required check ${check}.`);
  }
  return issues;
}

export function buildComplexBenchmarkReport(cases: readonly ComplexBenchmarkCase[], runs: readonly ComplexBenchmarkRun[]): ComplexBenchmarkReport {
  const issues = validateComplexBenchmarkCases(cases); if (issues.length) throw new TypeError(issues.join(' '));
  const caseById = new Map(cases.map(item => [item.caseId, item]));
  const validRuns = runs.filter(run => caseById.has(run.caseId) && Number.isSafeInteger(run.repeat) && run.repeat >= 1 && run.repeat <= 5 && run.usedForTuning === false
    && [run.dimensions, run.features, run.parts, run.assembly].every(metric => validCount(metric.passed) && validCount(metric.total) && metric.passed <= metric.total));
  const families = COMPLEX_PRODUCT_FAMILIES.map(family => {
    const familyCases = cases.filter(item => item.family === family), ids = new Set(familyCases.map(item => item.caseId));
    const familyRuns = validRuns.filter(run => ids.has(run.caseId));
    const byCase = new Map<string, ComplexBenchmarkRun[]>(); for (const run of familyRuns) byCase.set(run.caseId, [...(byCase.get(run.caseId) ?? []), run]);
    const uniqueRepeats = [...byCase.values()].map(items => new Set(items.map(item => item.repeat)).size);
    const sum = (key: 'dimensions' | 'features' | 'parts' | 'assembly', field: 'passed' | 'total') => familyRuns.reduce((total, run) => total + run[key][field], 0);
    const gatePassRate = ratio(familyRuns.filter(run => run.requiredGatesPassed).length, familyRuns.length);
    const metrics = {
      dimensionalAccuracy: ratio(sum('dimensions', 'passed'), sum('dimensions', 'total')),
      featureAccuracy: ratio(sum('features', 'passed'), sum('features', 'total')),
      partAccuracy: ratio(sum('parts', 'passed'), sum('parts', 'total')),
      assemblyAccuracy: ratio(sum('assembly', 'passed'), sum('assembly', 'total')),
    };
    const falseVerified = familyRuns.filter(run => run.falseVerified).length, blockers: string[] = [];
    if (familyCases.length < 20) blockers.push(`Need 20 independent holdout cases; have ${familyCases.length}.`);
    if (byCase.size !== familyCases.length) blockers.push(`Every case must be measured; measured ${byCase.size}/${familyCases.length}.`);
    const minimumRepeats = familyCases.length ? Math.min(...familyCases.map(item => new Set((byCase.get(item.caseId) ?? []).map(run => run.repeat)).size)) : 0;
    if (minimumRepeats < 5) blockers.push(`Every case needs five unique repeats; minimum is ${minimumRepeats}.`);
    if (gatePassRate !== 1) blockers.push(`Required gate pass rate must be 100%; current is ${gatePassRate === null ? 'not measured' : `${(gatePassRate * 100).toFixed(1)}%`}.`);
    for (const [name, value] of Object.entries(metrics)) if (value === null || value < 0.95) blockers.push(`${name} must be at least 95%; current is ${value === null ? 'not measured' : `${(value * 100).toFixed(1)}%`}.`);
    if (falseVerified) blockers.push(`False verified must be zero; current is ${falseVerified}.`);
    return { family, independentCases: familyCases.length, measuredCases: byCase.size, minimumRepeats, gatePassRate, ...metrics, falseVerified, eligible: blockers.length === 0, blockers };
  });
  return { families, eligibleFamilies: families.filter(item => item.eligible).map(item => item.family), allFamiliesEligible: families.every(item => item.eligible) };
}
