/**
 * loftFromSketch — end-to-end Phase 2.2 pipeline tests for loft.
 *
 * Mirror of revolveFromSketch.test.ts. Pure unit tests, no DOM.
 *
 * Phase 1 limitation: all sections must have matching point counts. The
 * easiest way to satisfy this is to loft the same sketch across multiple
 * z planes (the modal's default mode).
 */
import { describe, it, expect } from 'vitest';
import { loftFromSketch } from './loftFromSketch';
import type { SolverViewState } from './solverToProfile';

function rect(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 10 },
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

function triangle(): SolverViewState {
  return {
    points: [
      { id: 't1', x: 0, y: 0 },
      { id: 't2', x: 10, y: 0 },
      { id: 't3', x: 5, y: 8 },
    ],
    lines: [
      { id: 'tl1', p1: 't1', p2: 't2' },
      { id: 'tl2', p1: 't2', p2: 't3' },
      { id: 'tl3', p1: 't3', p2: 't1' },
    ],
  };
}

describe('loftFromSketch', () => {
  it('2 sections (same sketch) at z=0,10 → SCAD with skin call', () => {
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 0 },
        { source: 'current', z: 10 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      expect(r.scad).toContain('skin');
      expect(r.loop.points.length).toBe(4);
    }
  });

  it('mode=cut wraps the skin with the CUT marker', () => {
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 0 },
        { source: 'current', z: 10 },
      ],
      mode: 'cut',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scad).toContain('NEXYFAB:LOFT_CUT');
  });

  it('3 sections at z=0,5,10 → all z values present in SCAD', () => {
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 0 },
        { source: 'current', z: 5 },
        { source: 'current', z: 10 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Three profiles lifted to z=0, z=5, z=10.
      expect(r.scad).toMatch(/,\s*0\]/);
      expect(r.scad).toMatch(/,\s*5\]/);
      expect(r.scad).toMatch(/,\s*10\]/);
    }
  });

  it('rejects <2 sections', () => {
    const r = loftFromSketch(rect(), {
      sections: [{ source: 'current', z: 0 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least 2 sections/);
  });

  it('rejects empty sections', () => {
    const r = loftFromSketch(rect(), { sections: [] });
    expect(r.ok).toBe(false);
  });

  it('rejects non-monotonic z order', () => {
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 10 },
        { source: 'current', z: 5 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/monotonically/);
  });

  it('rejects duplicate z (must be strictly ascending)', () => {
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 5 },
        { source: 'current', z: 5 },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects non-finite z', () => {
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 0 },
        { source: 'current', z: Number.NaN },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/finite/);
  });

  it('no closed loop in primary sketch → ok=false', () => {
    const open: SolverViewState = {
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
    };
    const r = loftFromSketch(open, {
      sections: [
        { source: 'current', z: 0 },
        { source: 'current', z: 10 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/closed|dangling/i);
  });

  it('empty primary sketch → ok=false', () => {
    const r = loftFromSketch({ points: [], lines: [] }, {
      sections: [
        { source: 'current', z: 0 },
        { source: 'current', z: 10 },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('mismatched section point counts (rect 4-pt + triangle 3-pt) → ok=false', () => {
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 0 },
        { source: 'external', sketch: triangle(), z: 10 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/point count/i);
  });

  it('passes through featureName option (appears in SCAD comment)', () => {
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 0 },
        { source: 'current', z: 10 },
      ],
      featureName: 'TaperShell',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scad).toContain('(TaperShell)');
  });

  it('external sketch with matching point count works', () => {
    // Two rect sketches with different IDs but same 4-point count.
    const other: SolverViewState = {
      points: [
        { id: 'a', x: 2, y: 2 },
        { id: 'b', x: 8, y: 2 },
        { id: 'c', x: 8, y: 8 },
        { id: 'd', x: 2, y: 8 },
      ],
      lines: [
        { id: 'la', p1: 'a', p2: 'b' },
        { id: 'lb', p1: 'b', p2: 'c' },
        { id: 'lc', p1: 'c', p2: 'd' },
        { id: 'ld', p1: 'd', p2: 'a' },
      ],
    };
    const r = loftFromSketch(rect(), {
      sections: [
        { source: 'current', z: 0 },
        { source: 'external', sketch: other, z: 12 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scad).toContain('skin');
  });
});
