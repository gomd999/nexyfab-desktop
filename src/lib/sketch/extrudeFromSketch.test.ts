/**
 * extrudeFromSketch — end-to-end Phase 2.A pipeline tests.
 */
import { describe, it, expect } from 'vitest';
import { extrudeFromSketch } from './extrudeFromSketch';
import type { SolverViewState } from './solverToProfile';

function rect(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 20, y: 0 },
      { id: 'p3', x: 20, y: 10 },
      { id: 'p4', x: 0, y: 10 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

describe('extrudeFromSketch', () => {
  it('rect sketch + depth=8 → SCAD with linear_extrude polygon', () => {
    const r = extrudeFromSketch(rect(), { depth: 8 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('linear_extrude(height=8');
      expect(r.scad).toContain('polygon([');
      // 4 rect corners present.
      expect(r.scad).toMatch(/\[0,\s*0\]/);
      expect(r.scad).toMatch(/\[20,\s*0\]/);
      expect(r.scad).toMatch(/\[20,\s*10\]/);
      expect(r.scad).toMatch(/\[0,\s*10\]/);
      expect(r.loop.points.length).toBe(4);
    }
  });

  it('no closed loop → ok=false with clear error message', () => {
    const open: SolverViewState = {
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
    };
    const r = extrudeFromSketch(open, { depth: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/dangling/i);
    }
  });

  it('empty sketch → ok=false', () => {
    const empty: SolverViewState = { points: [], lines: [] };
    const r = extrudeFromSketch(empty, { depth: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/closed profile/i);
    }
  });

  it('multiple loops: picks the largest-area one as the outer profile', () => {
    // Two separate rects: small (5×5) + large (20×10).
    const state: SolverViewState = {
      points: [
        // small rect (area 25)
        { id: 'sa', x: 0, y: 0 },
        { id: 'sb', x: 5, y: 0 },
        { id: 'sc', x: 5, y: 5 },
        { id: 'sd', x: 0, y: 5 },
        // large rect (area 200), offset in x
        { id: 'la', x: 100, y: 0 },
        { id: 'lb', x: 120, y: 0 },
        { id: 'lc', x: 120, y: 10 },
        { id: 'ld', x: 100, y: 10 },
      ],
      lines: [
        { id: 'sl1', p1: 'sa', p2: 'sb' },
        { id: 'sl2', p1: 'sb', p2: 'sc' },
        { id: 'sl3', p1: 'sc', p2: 'sd' },
        { id: 'sl4', p1: 'sd', p2: 'sa' },
        { id: 'll1', p1: 'la', p2: 'lb' },
        { id: 'll2', p1: 'lb', p2: 'lc' },
        { id: 'll3', p1: 'lc', p2: 'ld' },
        { id: 'll4', p1: 'ld', p2: 'la' },
      ],
    };
    const r = extrudeFromSketch(state, { depth: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Large rect loop selected (area 200, vs small 25).
      expect(Math.abs(r.loop.signedArea)).toBeCloseTo(200, 5);
    }
  });

  it('depth=0 → ok=false (extrude IR validation)', () => {
    const r = extrudeFromSketch(rect(), { depth: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/positive/);
  });

  it('passes through draft/direction/mode options', () => {
    const r = extrudeFromSketch(rect(), {
      depth: 5,
      direction: 'midplane',
      mode: 'cut',
      featureName: 'Pocket',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('center=true');
      expect(r.scad).toContain('NEXYFAB:EXTRUDE_CUT');
      expect(r.scad).toContain('(Pocket)');
    }
  });
});
