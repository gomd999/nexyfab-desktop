import { describe, it, expect } from 'vitest';
import {
  detectDuplicates,
  splitByReference,
  classifySeverity,
  summarize,
  type Dimension,
} from './dimensionReuseDetector';

function dim(id: string, feature: string, value: number, view: string, primary: boolean = false, kind: Dimension['kind'] = 'linear', plus: number = 0.1, minus: number = 0.1): Dimension {
  return { id, featureId: feature, nominal: value, tolerancePlus: plus, toleranceMinus: minus, viewId: view, isPrimaryView: primary, kind };
}

describe('detectDuplicates', () => {
  it('empty → no groups', () => {
    expect(detectDuplicates([]).groups).toEqual([]);
  });

  it('unique dims → no groups', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1'),
      dim('d2', 'F2', 20, 'V1'),
    ]);
    expect(r.groups).toEqual([]);
  });

  it('two dims of same feature → 1 group', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1'),
      dim('d2', 'F1', 10, 'V2'),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.duplicateCount).toBe(1);
  });

  it('recommended keep = primary view if present', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1', false),
      dim('d2', 'F1', 10, 'V2', true),
    ]);
    expect(r.groups[0]!.recommendedKeep).toBe('d2');
  });

  it('recommended keep = non-reference if no primary', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1', false, 'reference'),
      dim('d2', 'F1', 10, 'V2', false, 'linear'),
    ]);
    expect(r.groups[0]!.recommendedKeep).toBe('d2');
  });

  it('different tolerance → not duplicate', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1', false, 'linear', 0.1, 0.1),
      dim('d2', 'F1', 10, 'V2', false, 'linear', 0.2, 0.2),
    ]);
    expect(r.groups).toEqual([]);
  });

  it('different nominal → not duplicate', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1'),
      dim('d2', 'F1', 11, 'V2'),
    ]);
    expect(r.groups).toEqual([]);
  });

  it('three+ same feature → recommendedDelete has 2', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1', true),
      dim('d2', 'F1', 10, 'V2'),
      dim('d3', 'F1', 10, 'V3'),
    ]);
    expect(r.groups[0]!.recommendedDelete).toHaveLength(2);
  });
});

describe('splitByReference', () => {
  it('separates reference-only groups', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1', false, 'reference'),
      dim('d2', 'F1', 10, 'V2', false, 'reference'),
    ]);
    const split = splitByReference(r);
    expect(split.referenceOnly).toHaveLength(1);
    expect(split.hardDuplicates).toHaveLength(0);
  });

  it('mixed group goes to hard duplicates', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1', false, 'linear'),
      dim('d2', 'F1', 10, 'V2', false, 'reference'),
    ]);
    const split = splitByReference(r);
    expect(split.hardDuplicates).toHaveLength(1);
  });
});

describe('classifySeverity', () => {
  it('3-way reuse → critical', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1'),
      dim('d2', 'F1', 10, 'V2'),
      dim('d3', 'F1', 10, 'V3'),
    ]);
    expect(classifySeverity(r)[0]!.severity).toBe('critical');
  });

  it('2-way reuse → warn', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1'),
      dim('d2', 'F1', 10, 'V2'),
    ]);
    expect(classifySeverity(r)[0]!.severity).toBe('warn');
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1'),
      dim('d2', 'F1', 10, 'V2'),
    ]);
    const s = summarize(r);
    expect(s.totalDimensions).toBe(2);
    expect(s.duplicateCount).toBe(1);
  });

  it('criticalCount tallies', () => {
    const r = detectDuplicates([
      dim('d1', 'F1', 10, 'V1'),
      dim('d2', 'F1', 10, 'V2'),
      dim('d3', 'F1', 10, 'V3'),
    ]);
    expect(summarize(r).criticalCount).toBe(1);
  });
});
