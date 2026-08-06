import { describe, expect, it } from 'vitest';
import { assessComplexProductAccuracy, classifyProductComplexity } from '../complexProductAccuracy';

const complex = {
  definitions: 12, instances: 36, maxAssemblyDepth: 3, interfacesRequired: 24, interfacesVerified: 24,
  exactPartsVerified: 12, expectedStepOccurrences: 36, measuredStepOccurrences: 36, movingInstances: 4,
};

describe('complex product accuracy gate', () => {
  it('classifies complexity deterministically and passes complete exact evidence', () => {
    expect(classifyProductComplexity(complex)).toBe('complex');
    expect(assessComplexProductAccuracy(complex)).toMatchObject({ complexity: 'complex', releaseReady: true });
  });

  it('blocks one missing interface and one flattened STEP occurrence', () => {
    const result = assessComplexProductAccuracy({ ...complex, interfacesVerified: 23, measuredStepOccurrences: 35 });
    expect(result.releaseReady).toBe(false);
    expect(result.gates.filter(gate => !gate.passed).map(gate => gate.id)).toEqual(['interfaces', 'step-occurrences']);
  });

  it('allows failed-part-only regeneration and rejects collateral regeneration', () => {
    const isolated = assessComplexProductAccuracy({ ...complex, repairIsolation: {
      applicable: true, failedPartIds: ['p7'], regeneratedPartIds: ['p7'], preservedVerifiedPartIds: ['p1', 'p2'], upstreamIntentChanged: false,
    } });
    expect(isolated.gates.find(gate => gate.id === 'repair-isolation')?.passed).toBe(true);
    const collateral = assessComplexProductAccuracy({ ...complex, repairIsolation: {
      applicable: true, failedPartIds: ['p7'], regeneratedPartIds: ['p7', 'p2'], preservedVerifiedPartIds: ['p1'], upstreamIntentChanged: false,
    } });
    expect(collateral.gates.find(gate => gate.id === 'repair-isolation')?.passed).toBe(false);
  });

  it('rejects invalid measurements instead of treating them as zero', () => {
    expect(() => assessComplexProductAccuracy({ ...complex, instances: Number.NaN })).toThrow(/counts/);
  });
});
