import { describe, it, expect } from 'vitest';
import {
  generate,
  summarize,
  type BreakLineInput,
} from './breakLineGenerator';

const base: BreakLineInput = {
  axisStart: { x: 0, y: 0 },
  axisEnd: { x: 100, y: 0 },
  widthMm: 20,
  breakStartFrac: 0.4,
  breakEndFrac: 0.6,
  style: 'zigzag',
};

describe('generate', () => {
  it('zero-length axis → warning', () => {
    const r = generate({ ...base, axisEnd: { x: 0, y: 0 } });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zigzag emits two break symbols', () => {
    const r = generate(base);
    expect(r.breakSymbols).toHaveLength(2);
  });

  it('removed length = (t1−t0) × axis length', () => {
    const r = generate(base);
    expect(r.removedLengthMm).toBeCloseTo(0.2 * 100, 6);
  });

  it('drawn length = axis − removed', () => {
    const r = generate(base);
    expect(r.drawnLengthMm).toBeCloseTo(100 - 20, 6);
  });

  it('cylindrical style produces S-curve polylines', () => {
    const r = generate({ ...base, style: 'cylindrical' });
    expect(r.breakSymbols[0]!.length).toBeGreaterThan(4);
  });

  it('freehand style produces wavy polylines', () => {
    const r = generate({ ...base, style: 'freehand' });
    expect(r.breakSymbols[0]!.length).toBeGreaterThan(8);
  });

  it('breakEnd ≤ breakStart → warning', () => {
    const r = generate({ ...base, breakStartFrac: 0.6, breakEndFrac: 0.4 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero width → warning', () => {
    const r = generate({ ...base, widthMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('symbols span the part width', () => {
    const r = generate(base);
    // zigzag first symbol covers from -half to +half perpendicular (y here)
    const ys = r.breakSymbols[0]!.map(p => p.y);
    const span = Math.max(...ys) - Math.min(...ys);
    expect(span).toBeCloseTo(20, 0);
  });

  it('style preserved in result', () => {
    expect(generate({ ...base, style: 'freehand' }).style).toBe('freehand');
  });
});

describe('summarize', () => {
  it('reports style + lengths', () => {
    const r = generate(base);
    const s = summarize(r);
    expect(s.style).toBe('zigzag');
    expect(s.removedLengthMm).toBe(r.removedLengthMm);
  });
});
