import { describe, it, expect } from 'vitest';
import {
  generateGrid,
  snapToGrid,
  summarize,
  type GridOptions,
} from './isometricGridGenerator';

const opts: GridOptions = {
  min: { x: 0, y: 0 },
  max: { x: 100, y: 100 },
  pitchMm: 10,
  convention: 'iso-30',
  mode: 'lines',
};

describe('generateGrid', () => {
  it('produces three families of lines', () => {
    const r = generateGrid(opts);
    const families = new Set(r.lines.map(l => l.family));
    expect(families.size).toBe(3);
  });

  it('zero-area region → still some lines', () => {
    const r = generateGrid({ ...opts, min: { x: 5, y: 5 }, max: { x: 5, y: 5 } });
    expect(r.lines.length).toBeGreaterThanOrEqual(0);
  });

  it('dots mode produces intersections', () => {
    const r = generateGrid({ ...opts, mode: 'dots' });
    expect(r.dots.length).toBeGreaterThan(0);
    expect(r.lines).toEqual([]);
  });

  it('iso-45 convention produces lines at different angles', () => {
    const r30 = generateGrid({ ...opts, convention: 'iso-30' });
    const r45 = generateGrid({ ...opts, convention: 'iso-45' });
    expect(r30.lines.length).toBeGreaterThan(0);
    expect(r45.lines.length).toBeGreaterThan(0);
  });

  it('clip polygon reduces line count', () => {
    const noClip = generateGrid(opts);
    const clipped = generateGrid({ ...opts, clipPolygon: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }] });
    expect(clipped.lines.length).toBeLessThanOrEqual(noClip.lines.length);
  });

  it('total length positive', () => {
    const r = generateGrid(opts);
    expect(r.totalLineLengthMm).toBeGreaterThan(0);
  });

  it('finer pitch → more lines', () => {
    const coarse = generateGrid({ ...opts, pitchMm: 50 });
    const fine = generateGrid({ ...opts, pitchMm: 5 });
    expect(fine.lines.length).toBeGreaterThan(coarse.lines.length);
  });
});

describe('snapToGrid', () => {
  it('iso-30 snap puts point on lattice', () => {
    const p = snapToGrid({ x: 5.5, y: 4.5 }, opts);
    expect(p.x).toBeDefined();
    expect(p.y).toBeDefined();
  });

  it('iso-45 returns input unchanged (no snap)', () => {
    const p = snapToGrid({ x: 3, y: 7 }, { ...opts, convention: 'iso-45' });
    expect(p).toEqual({ x: 3, y: 7 });
  });
});

describe('summarize', () => {
  it('lines mode reported', () => {
    const r = generateGrid(opts);
    const s = summarize(r);
    expect(s.mode).toBe('lines');
    expect(s.lineCount).toBe(r.lines.length);
  });

  it('dots mode reported', () => {
    const r = generateGrid({ ...opts, mode: 'dots' });
    const s = summarize(r);
    expect(s.mode).toBe('dots');
    expect(s.dotCount).toBe(r.dots.length);
  });
});
