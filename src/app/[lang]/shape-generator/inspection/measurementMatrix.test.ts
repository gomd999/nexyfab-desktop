import { describe, it, expect } from 'vitest';
import {
  buildMeasurementMatrix,
  rollupCost,
  summarize,
  type Feature,
} from './measurementMatrix';

function feature(id: string, category: Feature['category'], criticality: Feature['criticality']): Feature {
  return { id, description: id, category, criticality };
}

describe('buildMeasurementMatrix', () => {
  it('empty input → empty matrix', () => {
    expect(buildMeasurementMatrix([])).toEqual([]);
  });

  it('critical dimension → CMM primary', () => {
    const m = buildMeasurementMatrix([feature('h1', 'dimension', 'critical')]);
    expect(m[0]!.primaryMethod).toBe('cmm');
  });

  it('minor dimension → vernier primary', () => {
    const m = buildMeasurementMatrix([feature('h1', 'dimension', 'minor')]);
    expect(m[0]!.primaryMethod).toBe('vernier');
  });

  it('thread → thread-gauge', () => {
    const m = buildMeasurementMatrix([feature('t1', 'thread', 'minor')]);
    expect(m[0]!.primaryMethod).toBe('thread-gauge');
  });

  it('gd&t-form → CMM with profilometer alternate', () => {
    const m = buildMeasurementMatrix([feature('f1', 'gd&t-form', 'major')]);
    expect(m[0]!.primaryMethod).toBe('cmm');
    expect(m[0]!.alternateMethods).toContain('profilometer');
  });

  it('critical → 100% inspection by default', () => {
    const m = buildMeasurementMatrix([feature('h1', 'dimension', 'critical')]);
    expect(m[0]!.frequency).toBe('100%');
  });

  it('minor → aql-2.5 by default', () => {
    const m = buildMeasurementMatrix([feature('h1', 'dimension', 'minor')]);
    expect(m[0]!.frequency).toBe('aql-2.5');
  });

  it('critical takes longer to inspect', () => {
    const critical = buildMeasurementMatrix([feature('h1', 'dimension', 'critical')]);
    const minor = buildMeasurementMatrix([feature('h2', 'dimension', 'minor')]);
    expect(critical[0]!.estimatedTimePerInspectionSec).toBeGreaterThan(minor[0]!.estimatedTimePerInspectionSec);
  });

  it('tolerance for form → FLT0.05', () => {
    const m = buildMeasurementMatrix([feature('f1', 'gd&t-form', 'major')]);
    expect(m[0]!.tolerance).toBe('FLT0.05');
  });

  it('custom frequency override', () => {
    const m = buildMeasurementMatrix([feature('h1', 'dimension', 'critical')], {
      frequencyByCriticality: { critical: 'first-article' },
    });
    expect(m[0]!.frequency).toBe('first-article');
  });
});

describe('rollupCost', () => {
  it('empty matrix → zero', () => {
    const r = rollupCost([]);
    expect(r.totalRows).toBe(0);
    expect(r.estimatedTotalSecPerPart).toBe(0);
  });

  it('counts critical features', () => {
    const m = buildMeasurementMatrix([
      feature('h1', 'dimension', 'critical'),
      feature('h2', 'dimension', 'minor'),
    ]);
    const r = rollupCost(m);
    expect(r.criticalCount).toBe(1);
  });

  it('method usage tracks primaryMethod counts', () => {
    const m = buildMeasurementMatrix([
      feature('h1', 'dimension', 'critical'),
      feature('h2', 'dimension', 'critical'),
      feature('t1', 'thread', 'minor'),
    ]);
    const r = rollupCost(m);
    expect(r.methodUsage['cmm']).toBe(2);
    expect(r.methodUsage['thread-gauge']).toBe(1);
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const s = summarize([]);
    expect(s.rowCount).toBe(0);
  });

  it('reports counts', () => {
    const m = buildMeasurementMatrix([
      feature('h1', 'dimension', 'critical'),
      feature('h2', 'dimension', 'major'),
    ]);
    const s = summarize(m);
    expect(s.rowCount).toBe(2);
    expect(s.criticalCount).toBe(1);
  });

  it('primary method count is unique methods', () => {
    const m = buildMeasurementMatrix([
      feature('h1', 'dimension', 'critical'),
      feature('h2', 'thread', 'major'),
    ]);
    const s = summarize(m);
    expect(s.primaryMethodCount).toBeGreaterThanOrEqual(2);
  });
});
