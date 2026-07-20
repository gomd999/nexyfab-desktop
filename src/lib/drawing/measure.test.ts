/**
 * measure — analytic cross-check tests (W3-C).
 *
 * Every expected value below is derived BY HAND from the fixture geometry
 * (box 100×60×30, wedge with a 45° edge, extruded 24-gon circle ⌀40), not by
 * re-running the code under test. Tolerance 1e-6 per the acceptance gate.
 */
import { describe, it, expect } from 'vitest';
import { buildExtrudeTopo } from '@/lib/cad/topoNaming';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { Dimension } from './dimension';
import { measureDimension, measureEdgeLength, type MeasureResult } from './measure';

// ─── fixtures ────────────────────────────────────────────────────────────

function extrude(loop: { x: number; y: number }[], depth: number): ExtrudeFeature {
  return { kind: 'extrude', loop, depth, direction: 'one_sided', mode: 'add' };
}

/** Box: profile rectangle 100×60 in XY (vertices 0..3 CCW), depth 30 in Z.
 *  Vertex 0 = (0,0), 1 = (100,0), 2 = (100,60), 3 = (0,60). */
const boxTopo = buildExtrudeTopo(
  extrude([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }], 30),
);

/** Wedge: right triangle (0,0)-(10,0)-(10,10); the 0↔2 edge is at 45° in XY. */
const wedgeTopo = buildExtrudeTopo(
  extrude([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 5),
);

/** Cylinder-ish: extruded regular 24-gon whose vertices lie EXACTLY on the
 *  circle r = 20 (featureMesh keeps profile vertices verbatim). */
const N = 24;
const R = 20;
const circleTopo = buildExtrudeTopo(
  extrude(
    Array.from({ length: N }, (_, i) => ({
      x: R * Math.cos((2 * Math.PI * i) / N),
      y: R * Math.sin((2 * Math.PI * i) / N),
    })),
    12,
  ),
);

function dim(kind: Dimension['kind'], refs: string[], viewportId = 'vp'): Dimension {
  return { id: 'd', viewportId, kind, refs } as Dimension;
}

function expectOk(res: MeasureResult): asserts res is Extract<MeasureResult, { ok: true }> {
  if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
}

const EPS = 1e-6;

// ─── linear ──────────────────────────────────────────────────────────────

describe('linear', () => {
  it('parallel vertical edges, front view → 100 (box width)', () => {
    // e.vert.0 (x=0) and e.vert.1 (x=100) project to vertical lines in front.
    const res = measureDimension(dim('linear', ['e.vert.0', 'e.vert.1']), {
      topo: boxTopo,
      view: 'front',
    });
    expectOk(res);
    expect(res.value).toBeCloseTo(100, 6);
    expect(res.valueBasis).toBe('projected');
    expect(res.unit).toBe('mm');
    // 3D perpendicular distance between the two vertical edges is also 100.
    expect(res.trueValue3D).toBeCloseTo(100, 6);
    expect(res.foreshortened).toBe(false);
  });

  it('parallel faces seen edge-on, top view → 60 (box depth of profile)', () => {
    // f.side.0 is the y=0 wall, f.side.2 the y=60 wall; both edge-on in top.
    const res = measureDimension(dim('linear', ['f.side.0', 'f.side.2']), {
      topo: boxTopo,
      view: 'top',
    });
    expectOk(res);
    expect(res.value).toBeCloseTo(60, 6);
    expect(res.trueValue3D).toBeCloseTo(60, 6);
    expect(res.foreshortened).toBe(false);
  });

  it('explicit x-axis between point-like refs, top view → 100', () => {
    // In top view e.vert.* project to points: (0,0) and (100,60).
    const res = measureDimension(
      dim('linear', ['e.vert.0', 'e.vert.2']),
      { topo: boxTopo, view: 'top' },
      { axis: 'x' },
    );
    expectOk(res);
    expect(res.value).toBeCloseTo(100, 6);
    // Axis components survive orthographic projection unchanged.
    expect(res.trueValue3D).toBeCloseTo(100, 6);
    expect(res.foreshortened).toBe(false);
  });

  it('auto axis on an oblique span → explicit not-axis-aligned failure', () => {
    const res = measureDimension(dim('linear', ['e.vert.0', 'e.vert.2']), {
      topo: boxTopo,
      view: 'top',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-axis-aligned');
  });

  it('front-facing face in a linear dimension → oblique-in-view failure', () => {
    // f.cap.top faces the camera in top view — it is not a line there.
    const res = measureDimension(dim('linear', ['f.cap.top', 'f.cap.bottom']), {
      topo: boxTopo,
      view: 'top',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('oblique-in-view');
  });
});

// ─── aligned ─────────────────────────────────────────────────────────────

describe('aligned', () => {
  it('point-like refs, top view → box diagonal √(100²+60²)', () => {
    const res = measureDimension(dim('aligned', ['e.vert.0', 'e.vert.2']), {
      topo: boxTopo,
      view: 'top',
    });
    expectOk(res);
    const diag = Math.hypot(100, 60); // 116.61903789690601
    expect(res.value).toBeCloseTo(diag, 6);
    // The two edges are parallel 3D lines (both along Z) at that distance.
    expect(res.trueValue3D).toBeCloseTo(diag, 6);
    expect(res.foreshortened).toBe(false);
  });

  it('iso view separates projected from true: e.vert.0 ↔ e.vert.2', () => {
    // Hand derivation for the iso basis (viewDir ∥ (-1,-1,-1), up seeded (0,0,1)):
    //   right = (-1,1,0)/√2, so the projected separation of Δ = (100,60,0)
    //   along the common perpendicular is |Δ·right| = 40/√2 = 20√2.
    // True 3D perpendicular distance stays the full diagonal √13600.
    const res = measureDimension(dim('aligned', ['e.vert.0', 'e.vert.2']), {
      topo: boxTopo,
      view: 'iso',
    });
    expectOk(res);
    expect(res.value).toBeCloseTo(20 * Math.SQRT2, 6); // 28.284271247461902
    expect(res.trueValue3D).toBeCloseTo(Math.hypot(100, 60), 6);
    expect(res.foreshortened).toBe(true);
  });

  it('non-parallel projected edges → explicit not-parallel failure', () => {
    // Front view: e.vert.0 is vertical, e.bottom.0-1 horizontal.
    const res = measureDimension(dim('aligned', ['e.vert.0', 'e.bottom.0-1']), {
      topo: boxTopo,
      view: 'front',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-parallel');
  });
});

// ─── radius / diameter ───────────────────────────────────────────────────

describe('radial / diametric', () => {
  it('circle ⌀40 cap face, top view → r=20 / ⌀=40', () => {
    const rad = measureDimension(dim('radial', ['f.cap.top']), {
      topo: circleTopo,
      view: 'top',
    });
    expectOk(rad);
    expect(rad.value).toBeCloseTo(20, 6);
    expect(rad.trueValue3D).toBeCloseTo(20, 6);
    expect(rad.foreshortened).toBe(false);

    const dia = measureDimension(dim('diametric', ['f.cap.top']), {
      topo: circleTopo,
      view: 'top',
    });
    expectOk(dia);
    expect(dia.value).toBeCloseTo(40, 6);
  });

  it('circular face in a non-normal view → oblique-in-view failure (no ellipse radius fabrication)', () => {
    const res = measureDimension(dim('radial', ['f.cap.top']), {
      topo: circleTopo,
      view: 'front',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('oblique-in-view');
  });

  it('square cap (4 concyclic vertices) → not-circular, not a fabricated ⌀', () => {
    const res = measureDimension(dim('radial', ['f.cap.top']), {
      topo: boxTopo,
      view: 'top',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-circular');
  });

  it('edge ref for radial → wrong-ref-type (mesh edges are straight)', () => {
    const res = measureDimension(dim('radial', ['e.vert.0']), {
      topo: circleTopo,
      view: 'top',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('wrong-ref-type');
  });
});

// ─── angular ─────────────────────────────────────────────────────────────

describe('angular', () => {
  it('wedge 45° edge vs its base, top view → 45°', () => {
    // e.bottom.0-1 runs (0,0)→(10,0); e.bottom.0-2 runs (0,0)→(10,10).
    const res = measureDimension(dim('angular', ['e.bottom.0-1', 'e.bottom.0-2']), {
      topo: wedgeTopo,
      view: 'top',
    });
    expectOk(res);
    expect(res.unit).toBe('deg');
    expect(res.value).toBeCloseTo(45, 6);
    expect(res.trueValue3D).toBeCloseTo(45, 6);
    expect(res.foreshortened).toBe(false);
  });

  it('same pair in front view: projected 0°, true 45° — foreshortening flagged', () => {
    // Both profile edges lie in z = 0; front view collapses Δy, so their
    // projections are collinear horizontals (projected angle 0).
    const res = measureDimension(dim('angular', ['e.bottom.0-1', 'e.bottom.0-2']), {
      topo: wedgeTopo,
      view: 'front',
    });
    expectOk(res);
    expect(res.value).toBeCloseTo(0, 6);
    expect(res.trueValue3D).toBeCloseTo(45, 6);
    expect(res.foreshortened).toBe(true);
  });

  it('edge that projects to a point → degenerate failure', () => {
    // e.vert.0 in top view is a point; no direction, no angle.
    const res = measureDimension(dim('angular', ['e.vert.0', 'e.bottom.0-1']), {
      topo: wedgeTopo,
      view: 'top',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('degenerate');
  });

  it('face ref → wrong-ref-type failure', () => {
    const res = measureDimension(dim('angular', ['f.cap.top', 'e.bottom.0-1']), {
      topo: wedgeTopo,
      view: 'top',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('wrong-ref-type');
  });
});

// ─── edge length (projected vs true primitive) ───────────────────────────

describe('measureEdgeLength', () => {
  it('45° slanted edge, front view: projected 10, true 10√2, foreshortened', () => {
    // e.bottom.0-2 runs (0,0,0)→(10,10,0): front view keeps only Δx = 10.
    const res = measureEdgeLength(wedgeTopo, 'front', 'e.bottom.0-2');
    expectOk(res);
    expect(res.value).toBeCloseTo(10, 6);
    expect(res.trueValue3D).toBeCloseTo(10 * Math.SQRT2, 6); // 14.142135623730951
    expect(res.foreshortened).toBe(true);
  });

  it('axis-parallel edge, front view: projected == true, not foreshortened', () => {
    const res = measureEdgeLength(wedgeTopo, 'front', 'e.bottom.0-1');
    expectOk(res);
    expect(res.value).toBeCloseTo(10, 6);
    expect(res.trueValue3D).toBeCloseTo(10, 6);
    expect(res.foreshortened).toBe(false);
  });

  it('true length is view-invariant while projected varies (top view of the slant)', () => {
    const res = measureEdgeLength(wedgeTopo, 'top', 'e.bottom.0-2');
    expectOk(res);
    expect(res.value).toBeCloseTo(10 * Math.SQRT2, 6); // in-plane in top view
    expect(res.trueValue3D).toBeCloseTo(10 * Math.SQRT2, 6);
    expect(res.foreshortened).toBe(false);
  });
});

// ─── explicit reference loss (W1-C 'lost' 사상) ─────────────────────────

describe('reference loss', () => {
  it('unknown name → unresolved-ref, never a value', () => {
    const res = measureDimension(dim('linear', ['e.vert.0', 'e.vert.99']), {
      topo: boxTopo,
      view: 'front',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('unresolved-ref');
      expect(res.detail).toContain('e.vert.99');
    }
  });

  it('composed-boolean name → unresolved-ref with the scope explanation', () => {
    const res = measureDimension(dim('linear', ['base/e.vert.0', 'e.vert.1']), {
      topo: boxTopo,
      view: 'front',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('unresolved-ref');
      expect(res.detail).toContain('composed-boolean');
    }
  });

  it('wrong ref count → wrong-ref-count', () => {
    const res = measureDimension(dim('linear', ['e.vert.0']), {
      topo: boxTopo,
      view: 'front',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('wrong-ref-count');
  });
});

// ─── precision gate: 1e-6 against analytic values ────────────────────────

describe('1e-6 precision gate', () => {
  const cases: Array<{ name: string; res: MeasureResult; expected: number }> = [
    {
      name: 'box width 100 (linear, front)',
      res: measureDimension(dim('linear', ['e.vert.0', 'e.vert.1']), { topo: boxTopo, view: 'front' }),
      expected: 100,
    },
    {
      name: 'box diagonal (aligned, top)',
      res: measureDimension(dim('aligned', ['e.vert.0', 'e.vert.2']), { topo: boxTopo, view: 'top' }),
      expected: Math.hypot(100, 60),
    },
    {
      name: 'circle radius 20 (radial, top)',
      res: measureDimension(dim('radial', ['f.cap.top']), { topo: circleTopo, view: 'top' }),
      expected: 20,
    },
    {
      name: 'circle diameter 40 (diametric, top)',
      res: measureDimension(dim('diametric', ['f.cap.top']), { topo: circleTopo, view: 'top' }),
      expected: 40,
    },
    {
      name: '45° wedge angle (angular, top)',
      res: measureDimension(dim('angular', ['e.bottom.0-1', 'e.bottom.0-2']), { topo: wedgeTopo, view: 'top' }),
      expected: 45,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expectOk(c.res);
      expect(Math.abs(c.res.value - c.expected)).toBeLessThanOrEqual(EPS);
    });
  }
});
