import { describe, it, expect } from 'vitest';
import {
  generateLouverPattern,
  computeCoverage,
  summarize,
  type PatternInput,
} from './louverPattern';

function basicInput(rows: number = 3, cols: number = 4): PatternInput {
  return {
    regionMin: { x: 0, y: 0 },
    regionMax: { x: 200, y: 150 },
    shape: {
      lengthMm: 30,
      widthMm: 10,
      cornerRadiusMm: 2,
      hingeAngleRad: 0,
      formDepthMm: 5,
    },
    rows,
    cols,
    staggered: false,
  };
}

describe('generateLouverPattern', () => {
  it('produces rows × cols louvers', () => {
    const r = generateLouverPattern(basicInput(3, 4));
    expect(r.louvers.length).toBe(12);
  });

  it('per-louver polyline has multiple points', () => {
    const r = generateLouverPattern(basicInput(1, 1));
    expect(r.polylines[0]!.cutPoints.length).toBeGreaterThan(3);
  });

  it('hinge line endpoints recorded', () => {
    const r = generateLouverPattern(basicInput(1, 1));
    const p = r.polylines[0]!;
    expect(p.hingeStart).toBeDefined();
    expect(p.hingeEnd).toBeDefined();
  });

  it('total cut length positive', () => {
    const r = generateLouverPattern(basicInput());
    expect(r.totalCutLengthMm).toBeGreaterThan(0);
  });

  it('opening area sums per-louver', () => {
    const r = generateLouverPattern(basicInput(2, 2));
    expect(r.totalOpeningAreaMm2).toBeCloseTo(4 * 30 * 10, 1);
  });

  it('airflow area scales with form depth', () => {
    const shallow = generateLouverPattern({ ...basicInput(), shape: { ...basicInput().shape, formDepthMm: 1 } });
    const deep = generateLouverPattern({ ...basicInput(), shape: { ...basicInput().shape, formDepthMm: 10 } });
    expect(deep.airflowAreaMm2).toBeGreaterThan(shallow.airflowAreaMm2);
  });

  it('staggered alternates row offset', () => {
    const r = generateLouverPattern({ ...basicInput(2, 4), staggered: true });
    // First and second row should have different x of first louver.
    const row0x = r.louvers[0]!.center.x;
    const row1x = r.louvers[4]!.center.x;
    expect(row0x).not.toBe(row1x);
  });

  it('zero rows × cols → empty', () => {
    const r = generateLouverPattern(basicInput(0, 0));
    expect(r.louvers).toEqual([]);
  });

  it('louvers fit within region (after offset)', () => {
    const r = generateLouverPattern(basicInput());
    for (const l of r.louvers) {
      expect(l.center.x).toBeGreaterThanOrEqual(0);
      expect(l.center.x).toBeLessThanOrEqual(200);
    }
  });
});

describe('computeCoverage', () => {
  it('zero region → zero coverage', () => {
    const result = generateLouverPattern({
      ...basicInput(), regionMin: { x: 0, y: 0 }, regionMax: { x: 0, y: 0 },
    });
    const c = computeCoverage(result, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(c.regionAreaMm2).toBe(0);
  });

  it('open-area fraction reasonable', () => {
    const result = generateLouverPattern(basicInput());
    const c = computeCoverage(result, { x: 0, y: 0 }, { x: 200, y: 150 });
    expect(c.openAreaFraction).toBeGreaterThan(0);
    expect(c.openAreaFraction).toBeLessThan(1);
  });

  it('density per area positive', () => {
    const result = generateLouverPattern(basicInput());
    const c = computeCoverage(result, { x: 0, y: 0 }, { x: 200, y: 150 });
    expect(c.louverDensityPerMm2).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = generateLouverPattern(basicInput(3, 4));
    const s = summarize(r, false);
    expect(s.louverCount).toBe(12);
    expect(s.airflowAreaMm2).toBeGreaterThan(0);
  });

  it('staggered flag forwarded', () => {
    const s = summarize(generateLouverPattern(basicInput()), true);
    expect(s.isStaggered).toBe(true);
  });
});
