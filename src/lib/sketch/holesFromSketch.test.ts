/**
 * holesFromSketch — end-to-end Phase 2.7 pipeline tests for holes.
 *
 * Pure unit tests, no DOM.
 */
import { describe, it, expect } from 'vitest';
import { holesFromSketch, type HoleRequest } from './holesFromSketch';
import type { SolverViewState } from './solverToProfile';

function rectWithCenters(): SolverViewState {
  // 20×10 rect outer profile + 2 inner sketch points at (5,5) and (15,5)
  // that the hole wizard can anchor to.
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 20, y: 0 },
      { id: 'p3', x: 20, y: 10 },
      { id: 'p4', x: 0, y: 10 },
      { id: 'h1', x: 5, y: 5 },
      { id: 'h2', x: 15, y: 5 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

const baseDrilledHole: HoleRequest = {
  pointId: 'h1',
  holeType: 'drilled',
  diameter: 4,
  depth: 8,
};

describe('holesFromSketch', () => {
  it('drilled hole on rect → SCAD difference() with parent + 1 hole', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [baseDrilledHole],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('difference()');
      expect(r.scad).toContain('linear_extrude'); // parent
      expect(r.scad).toContain('NEXYFAB:HOLE_CUT');
      expect(r.holeCount).toBe(1);
    }
  });

  it('multiple holes → all cylinders inside difference()', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [
        baseDrilledHole,
        { ...baseDrilledHole, pointId: 'h2', diameter: 6 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.holeCount).toBe(2);
      const cuts = (r.scad.match(/NEXYFAB:HOLE_CUT/g) ?? []).length;
      expect(cuts).toBe(2);
    }
  });

  it('blind counterbore emits drill body, conical tip, and counterbore', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [
        {
          pointId: 'h1',
          holeType: 'counterbore',
          diameter: 5,
          depth: 8,
          counterboreDiameter: 10,
          counterboreDepth: 3,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Main bore + drill tip + counterbore.
      const cylinderCount = (r.scad.match(/cylinder\(/g) ?? []).length;
      expect(cylinderCount).toBe(3);
      expect(r.scad).toContain('d1=0, d2=5');
    }
  });

  it('countersink hole emits bore + cone (d1/d2)', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [
        {
          pointId: 'h1',
          holeType: 'countersink',
          diameter: 5,
          depth: 8,
          countersinkAngleDegrees: 90,
          countersinkDepth: 3,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/d1=5/);
      expect(r.scad).toMatch(/d2=/);
      expect((r.scad.match(/cylinder\(/g) ?? [])).toHaveLength(3);
    }
  });

  it('infers through termination when requested depth reaches parent thickness', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [{ ...baseDrilledHole, depth: 10 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.scad.match(/cylinder\(/g) ?? [])).toHaveLength(1);
      expect(r.scad).not.toContain('d1=0');
      expect(r.scad).toMatch(/translate\(\[0, 0, -0\.01\]\) cylinder\(h=10\.02/);
    }
  });

  it('rejects a hole whose bore cannot fit inside the parent profile', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [{ ...baseDrilledHole, pointId: 'h1', diameter: 20 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/oversized|clearance/i);
  });

  it('missing pointId → ok=false with specific error', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [{ ...baseDrilledHole, pointId: 'nonexistent' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/nonexistent.*not found/i);
    }
  });

  it('non-positive extrudeDepth → ok=false', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 0,
      holes: [baseDrilledHole],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/extrudeDepth.*positive/);
  });

  it('empty holes array → ok=false', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least 1/);
  });

  it('no closed loop → ok=false (open profile)', () => {
    const open: SolverViewState = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
      ],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
    };
    const r = holesFromSketch(open, { extrudeDepth: 10, holes: [baseDrilledHole] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/closed loop|dangling/i);
  });

  it('invalid hole dimensions surface with hole index prefix', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [
        baseDrilledHole, // valid
        { pointId: 'h2', holeType: 'drilled', diameter: -1, depth: 5 }, // invalid
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/hole 2.*diameter/i);
  });

  it('output is deterministic — same input → same SCAD', () => {
    const r1 = holesFromSketch(rectWithCenters(), { extrudeDepth: 10, holes: [baseDrilledHole] });
    const r2 = holesFromSketch(rectWithCenters(), { extrudeDepth: 10, holes: [baseDrilledHole] });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.scad).toBe(r2.scad);
    }
  });

  it('hole resolves to the (x,y) coordinates of the sketch point', () => {
    const r = holesFromSketch(rectWithCenters(), {
      extrudeDepth: 10,
      holes: [{ ...baseDrilledHole, pointId: 'h2' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // h2 is at (15, 5) — the translate should reflect that.
      expect(r.scad).toMatch(/translate\(\[15,\s*5,\s*0\]\)/);
    }
  });
});
