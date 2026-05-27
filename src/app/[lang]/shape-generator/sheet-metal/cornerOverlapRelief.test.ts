import { describe, it, expect } from 'vitest';
import {
  generateRelief,
  reliefArea,
  suggestShape,
  summarize,
} from './cornerOverlapRelief';

const baseBend = { bendRadiusMm: 2, bendAngleDeg: 90 };

describe('generateRelief', () => {
  it('rectangular shape produces 4 vertices', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 1.5, shape: 'rectangular' });
    expect(r.geometry.vertices).toHaveLength(4);
  });

  it('V-notch produces 3 vertices', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 1.5, shape: 'V-notch' });
    expect(r.geometry.vertices).toHaveLength(3);
  });

  it('obround produces > 4 vertices', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 1.5, shape: 'obround' });
    expect(r.geometry.vertices.length).toBeGreaterThan(4);
  });

  it('explicit width overrides minimum', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 1.5, shape: 'rectangular', reliefWidthMm: 10 });
    expect(r.geometry.widthMm).toBe(10);
  });

  it('width below minimum flags meetsMinimum=false', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 5, shape: 'rectangular', reliefWidthMm: 0.5 });
    expect(r.meetsMinimum).toBe(false);
  });

  it('depth = max(bendA, bendB) + thickness', () => {
    const r = generateRelief({
      bendA: { bendRadiusMm: 3, bendAngleDeg: 90 },
      bendB: { bendRadiusMm: 5, bendAngleDeg: 90 },
      materialThicknessMm: 1,
      shape: 'rectangular',
    });
    expect(r.geometry.depthMm).toBe(6);
  });

  it('zero thickness → warning', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 0, shape: 'rectangular' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('reliefArea', () => {
  it('rectangular area = w × d', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 1.5, shape: 'rectangular', reliefWidthMm: 5 });
    expect(reliefArea(r.geometry)).toBeCloseTo(5 * r.geometry.depthMm, 3);
  });

  it('V-notch area = 0.5 × base × depth', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 1.5, shape: 'V-notch' });
    const expected = 0.5 * 2 * Math.tan(Math.PI / 4) * r.geometry.depthMm * r.geometry.depthMm;
    expect(reliefArea(r.geometry)).toBeCloseTo(expected, 3);
  });
});

describe('suggestShape', () => {
  it('thin → V-notch', () => {
    expect(suggestShape({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 0.5 }).shape).toBe('V-notch');
  });

  it('mid-gauge → rectangular', () => {
    expect(suggestShape({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 1.5 }).shape).toBe('rectangular');
  });

  it('thick → obround', () => {
    expect(suggestShape({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 4 }).shape).toBe('obround');
  });
});

describe('summarize', () => {
  it('reports shape + width', () => {
    const r = generateRelief({ bendA: baseBend, bendB: baseBend, materialThicknessMm: 1.5, shape: 'rectangular' });
    const s = summarize(r);
    expect(s.shape).toBe('rectangular');
    expect(s.widthMm).toBe(r.geometry.widthMm);
  });
});
