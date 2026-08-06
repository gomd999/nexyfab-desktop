import { describe, expect, it } from 'vitest';
import { evaluateCadHealing, type CadHealingMeasurement } from './cadHealingPolicy';

const measurement = (patch: Partial<CadHealingMeasurement> = {}): CadHealingMeasurement => ({ valid: true, solidCount: 1, absoluteVolume: 1000, faceCount: 6, edgeCount: 12, maxTolerance: 0.001, minEdgeLength: 1, ...patch });

describe('CAD healing approval policy', () => {
  it('distinguishes a recovered solid from an originally valid one', () => {
    const result = evaluateCadHealing({ before: measurement({ valid: false, solidCount: 0 }), after: measurement({ absoluteVolume: 1000.05 }), workingTolerance: 0.001, sewingTolerance: 0.01 });
    expect(result).toMatchObject({ accepted: true, classification: 'recovered', failureCodes: [] });
  });
  it('rejects excessive geometry or tolerance change', () => {
    const result = evaluateCadHealing({ before: measurement(), after: measurement({ absoluteVolume: 1010, maxTolerance: 0.02 }), workingTolerance: 0.001, sewingTolerance: 2 });
    expect(result).toMatchObject({ accepted: false, classification: 'rejected', failureCodes: ['HEALING_EXCEEDED_TOLERANCE'] });
    expect(result.checks.filter(check => !check.passed).map(check => check.id)).toEqual(['volume-change', 'max-tolerance', 'sewing-vs-min-edge']);
  });
});
