import { describe, expect, it } from 'vitest';
import { buildComplexBenchmarkReport, type ComplexBenchmarkCase, type ComplexBenchmarkRun } from '../complexProductBenchmark';

const makeCases = (count: number): ComplexBenchmarkCase[] => Array.from({ length: count }, (_, index) => ({ caseId: `robot-${index + 1}`, family: 'robot', holdoutGroup: `robot-product-${index + 1}`, sourceHash: (index + 1).toString(16).padStart(64, '0'), sourceKind: 'standard_corpus', split: 'holdout', expectedDefinitions: 6, expectedOccurrences: 6, requiredChecks: ['dimensions', 'features', 'parts', 'assembly', 'step_roundtrip'] }));
const makeRuns = (cases: ComplexBenchmarkCase[], passed = 10): ComplexBenchmarkRun[] => cases.flatMap(item => Array.from({ length: 5 }, (_, index) => ({ caseId: item.caseId, repeat: index + 1, usedForTuning: false, requiredGatesPassed: true, falseVerified: false, dimensions: { passed, total: 10 }, features: { passed, total: 10 }, parts: { passed, total: 10 }, assembly: { passed, total: 10 } })));

describe('complex product benchmark', () => {
  it('reports every absent product family as unmeasured instead of averaging it away', () => {
    const report = buildComplexBenchmarkReport([], []);
    expect(report.allFamiliesEligible).toBe(false); expect(report.coreMechanicalEligible).toBe(false); expect(report.auxiliaryServicesEligible).toBe(false); expect(report.families).toHaveLength(8);
    expect(report.families.every(item => item.blockers.some(blocker => blocker.includes('have 0')))).toBe(true);
  });
  it('requires 20 holdouts, five runs and all four accuracy axes at 95%', () => {
    const cases = makeCases(20), report = buildComplexBenchmarkReport(cases, makeRuns(cases));
    expect(report.families.find(item => item.family === 'robot')).toMatchObject({ independentCases: 20, measuredCases: 20, minimumRepeats: 5, dimensionalAccuracy: 1, featureAccuracy: 1, partAccuracy: 1, assemblyAccuracy: 1, eligible: true });
  });
  it('keeps secondary interior evidence outside the mechanical launch signal', () => {
    const cases = makeCases(20), report = buildComplexBenchmarkReport(cases, makeRuns(cases));
    expect(report.families.find(item => item.family === 'robot')?.eligible).toBe(true);
    expect(report.auxiliaryServicesEligible).toBe(false);
    expect(report.allFamiliesEligible).toBe(false);
  });
  it('blocks a 94% assembly result even when the other metrics pass', () => {
    const cases = makeCases(20), runs = makeRuns(cases); runs.forEach(run => { run.assembly = { passed: 94, total: 100 }; });
    const robot = buildComplexBenchmarkReport(cases, runs).families.find(item => item.family === 'robot')!;
    expect(robot.eligible).toBe(false); expect(robot.blockers.some(item => item.includes('assemblyAccuracy'))).toBe(true);
  });
  it('rejects non-holdout or unhashed case declarations', () => {
    const bad = makeCases(1); bad[0] = { ...bad[0]!, split: 'training' as never, sourceHash: 'bad' };
    expect(() => buildComplexBenchmarkReport(bad, [])).toThrow(/holdout.*SHA-256/);
  });
});
