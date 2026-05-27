import { describe, it, expect } from 'vitest';
import {
  generateHatch,
  generateMultipleRegions,
  summarize,
  MATERIAL_STYLES,
  type Vec2,
} from './crossHatchGenerator';

const square: Vec2[] = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

describe('MATERIAL_STYLES', () => {
  it('steel = 45°, no cross', () => {
    expect(MATERIAL_STYLES.steel.primaryAngleDeg).toBe(45);
    expect(MATERIAL_STYLES.steel.cross).toBe(false);
  });

  it('aluminum has cross', () => {
    expect(MATERIAL_STYLES.aluminum.cross).toBe(true);
  });

  it('insulation uses zigzag', () => {
    expect(MATERIAL_STYLES.insulation.lineStyle).toBe('zigzag');
  });
});

describe('generateHatch', () => {
  it('degenerate boundary → no segments', () => {
    const r = generateHatch([{ x: 0, y: 0 }, { x: 1, y: 0 }], 'steel');
    expect(r.segments).toEqual([]);
  });

  it('steel hatch produces segments', () => {
    const r = generateHatch(square, 'steel');
    expect(r.segments.length).toBeGreaterThan(0);
  });

  it('cross-hatch material has 2x more segments roughly', () => {
    const steel = generateHatch(square, 'steel');
    const alu = generateHatch(square, 'aluminum');
    expect(alu.segments.length).toBeGreaterThan(steel.segments.length);
  });

  it('cross flag set on cross set', () => {
    const r = generateHatch(square, 'aluminum');
    expect(r.segments.some(s => s.cross)).toBe(true);
    expect(r.segments.some(s => !s.cross)).toBe(true);
  });

  it('total length positive', () => {
    const r = generateHatch(square, 'steel');
    expect(r.totalLengthMm).toBeGreaterThan(0);
  });

  it('pitch override produces fewer segments', () => {
    const fine = generateHatch(square, 'steel', { pitchMm: 1 });
    const coarse = generateHatch(square, 'steel', { pitchMm: 10 });
    expect(coarse.segments.length).toBeLessThan(fine.segments.length);
  });

  it('plastic uses dashed style', () => {
    const r = generateHatch(square, 'plastic');
    expect(r.style.lineStyle).toBe('dashed');
  });

  it('all segments lie within bounding box', () => {
    const r = generateHatch(square, 'steel');
    for (const s of r.segments) {
      expect(s.start.x).toBeGreaterThanOrEqual(-1);
      expect(s.start.x).toBeLessThanOrEqual(101);
      expect(s.end.x).toBeGreaterThanOrEqual(-1);
      expect(s.end.x).toBeLessThanOrEqual(101);
    }
  });
});

describe('generateMultipleRegions', () => {
  it('returns one result per region', () => {
    const results = generateMultipleRegions([
      { boundary: square, material: 'steel' },
      { boundary: square, material: 'aluminum' },
    ]);
    expect(results).toHaveLength(2);
  });
});

describe('summarize', () => {
  it('reports counts + cross flag', () => {
    const r = generateHatch(square, 'aluminum');
    const s = summarize('aluminum', r);
    expect(s.hasCross).toBe(true);
    expect(s.segmentCount).toBeGreaterThan(0);
  });

  it('material code echoed', () => {
    const r = generateHatch(square, 'steel');
    expect(summarize('steel', r).material).toBe('steel');
  });
});
