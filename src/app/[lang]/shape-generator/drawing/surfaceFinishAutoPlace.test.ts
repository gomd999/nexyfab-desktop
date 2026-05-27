import { describe, it, expect } from 'vitest';
import {
  placeSurfaceFinish,
  groupByRa,
  summarize,
  type SurfaceMeasurement,
} from './surfaceFinishAutoPlace';

function surface(id: string, ra: number, x0: number, y0: number, x1: number, y1: number, rz?: number): SurfaceMeasurement {
  const s: SurfaceMeasurement = {
    surfaceId: id,
    start: { x: x0, y: y0 },
    end: { x: x1, y: y1 },
    raMicron: ra,
    machined: true,
  };
  if (rz !== undefined) s.rzMicron = rz;
  return s;
}

describe('placeSurfaceFinish', () => {
  it('empty input → empty', () => {
    const r = placeSurfaceFinish([]);
    expect(r.symbols).toEqual([]);
    expect(r.defaultRaMicron).toBe(0);
  });

  it('modal Ra becomes default', () => {
    const r = placeSurfaceFinish([
      surface('a', 3.2, 0, 0, 10, 0),
      surface('b', 3.2, 0, 0, 10, 0),
      surface('c', 1.6, 0, 0, 10, 0),
    ]);
    expect(r.defaultRaMicron).toBe(3.2);
  });

  it('symbols matching default are suppressed', () => {
    const r = placeSurfaceFinish([
      surface('a', 3.2, 0, 0, 10, 0),
      surface('b', 3.2, 0, 0, 10, 0),
      surface('c', 1.6, 0, 0, 10, 0),
    ]);
    const suppressed = r.symbols.filter(s => s.useDefaultNote).map(s => s.surfaceId);
    expect(suppressed).toContain('a');
    expect(suppressed).toContain('b');
  });

  it('non-default symbols emitted', () => {
    const r = placeSurfaceFinish([
      surface('a', 3.2, 0, 0, 10, 0),
      surface('b', 3.2, 0, 0, 10, 0),
      surface('c', 0.8, 0, 0, 10, 0),
    ]);
    const drawn = r.symbols.filter(s => !s.useDefaultNote).map(s => s.surfaceId);
    expect(drawn).toContain('c');
  });

  it('default note text contains the Ra value', () => {
    const r = placeSurfaceFinish([surface('a', 3.2, 0, 0, 10, 0)]);
    expect(r.defaultNote).toContain('3.20');
  });

  it('text format Ra X.XX', () => {
    const r = placeSurfaceFinish([surface('a', 1.6, 0, 0, 10, 0)]);
    expect(r.symbols[0]!.text).toContain('Ra 1.60');
  });

  it('includes Rz when provided', () => {
    const r = placeSurfaceFinish([surface('a', 1.6, 0, 0, 10, 0, 6.3)]);
    expect(r.symbols[0]!.text).toContain('Rz');
  });

  it('rotation matches surface line angle', () => {
    const r = placeSurfaceFinish([surface('a', 1.6, 0, 0, 10, 0)]);
    expect(r.symbols[0]!.rotationDeg).toBeCloseTo(0, 3);
  });

  it('apex on the centre of the surface line', () => {
    const r = placeSurfaceFinish([surface('a', 1.6, 0, 0, 10, 0)]);
    expect(r.symbols[0]!.apex).toEqual({ x: 5, y: 0 });
  });

  it('NMR tag when machined=false', () => {
    const r = placeSurfaceFinish([{
      surfaceId: 'a', start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
      raMicron: 1.6, machined: false,
    }]);
    expect(r.symbols[0]!.text).toContain('NMR');
  });
});

describe('groupByRa', () => {
  it('groups by ra and sorts desc', () => {
    const groups = groupByRa([
      surface('a', 3.2, 0, 0, 10, 0),
      surface('b', 3.2, 0, 0, 10, 0),
      surface('c', 1.6, 0, 0, 10, 0),
    ]);
    expect(groups[0]!.ra).toBe(3.2);
    expect(groups[0]!.count).toBe(2);
  });

  it('fractions sum to 1', () => {
    const groups = groupByRa([
      surface('a', 3.2, 0, 0, 10, 0),
      surface('c', 1.6, 0, 0, 10, 0),
    ]);
    const sum = groups.reduce((s, g) => s + g.fraction, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('summarize', () => {
  it('reports drawn vs suppressed', () => {
    const r = placeSurfaceFinish([
      surface('a', 3.2, 0, 0, 10, 0),
      surface('b', 3.2, 0, 0, 10, 0),
      surface('c', 0.8, 0, 0, 10, 0),
    ]);
    const s = summarize(r);
    expect(s.symbolsDrawnCount + s.symbolsSuppressedCount).toBe(3);
  });
});
