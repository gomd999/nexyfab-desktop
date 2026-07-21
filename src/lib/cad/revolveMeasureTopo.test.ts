/**
 * buildRevolveMeasureTopo — WB-1: real measured dimensions on revolve bodies
 * (coverage matrix ② 축류 A 승격).
 *
 * The adapter turns a RevolveFeature into the tessellated `NamedTopology` that
 * `measureDimension` consumes, exposing each rim as a circular cross-section
 * face `f.lat.{i}`. Every expected value below is derived BY HAND from the
 * profile geometry, NOT from re-running the code under test. Acceptance gate:
 * length ≤ 1e-6, degrees ≤ 1e-6.
 *
 * The whole point (생성≠검증): the measurer does its OWN circumcircle fit +
 * concyclicity check on the mesh's swept rim vertices — so a passing ⌀ proves
 * the tessellation vertices lie on the true circle, it is not an analytic
 * shortcut. The ⌀ carrier view is the axis-normal view ('front', whose viewDir
 * ∥ the revolve axis +Y); axial length is read on an axis-parallel view ('top').
 */
import { describe, it, expect } from 'vitest';
import { buildRevolveMeasureTopo } from './topoNaming';
import type { RevolveFeature } from './revolveProfile';
import type { Dimension } from '@/lib/drawing/dimension';
import { measureDimension, type MeasureResult } from '@/lib/drawing/measure';

function revolve(
  loop: { x: number; y: number }[],
  angleDegrees = 360,
): RevolveFeature {
  return { kind: 'revolve', loop, angleDegrees, mode: 'add' };
}

function dim(kind: Dimension['kind'], refs: string[], viewportId = 'vp'): Dimension {
  return { id: 'd', viewportId, kind, refs } as Dimension;
}

function expectOk(res: MeasureResult): asserts res is Extract<MeasureResult, { ok: true }> {
  if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
}

const EPS = 1e-6;

// Solid cylinder r=25, h=60: profile rectangle (0,0)-(25,0)-(25,60)-(0,60)
// revolved 360° about +Y. Off-axis profile vertices: i=1 (25,0) bottom rim,
// i=2 (25,60) top rim. On-axis i=0,3 sweep to points (no rim).
const cyl = buildRevolveMeasureTopo(revolve([
  { x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 60 }, { x: 0, y: 60 },
]));

describe('cylinder r=25 h=60 — outer ⌀ and axial length', () => {
  it('outer ⌀50 on the axis-normal view (front)', () => {
    const dia = measureDimension(dim('diametric', ['f.lat.1']), { topo: cyl, view: 'front' });
    expectOk(dia);
    expect(dia.value).toBeCloseTo(50, 6);
    expect(Math.abs(dia.value - 50)).toBeLessThanOrEqual(EPS);
    expect(dia.unit).toBe('mm');
    expect(dia.foreshortened).toBe(false); // face ∥ view plane ⇒ projected === true

    // Same rim as a radius.
    const rad = measureDimension(dim('radial', ['f.lat.1']), { topo: cyl, view: 'front' });
    expectOk(rad);
    expect(rad.value).toBeCloseTo(25, 6);

    // Top rim measures identically.
    const top = measureDimension(dim('diametric', ['f.lat.2']), { topo: cyl, view: 'front' });
    expectOk(top);
    expect(Math.abs(top.value - 50)).toBeLessThanOrEqual(EPS);
  });

  it('axial length 60 between the two rims (top view, edge-on disks)', () => {
    const len = measureDimension(dim('linear', ['f.lat.1', 'f.lat.2']), { topo: cyl, view: 'top' });
    expectOk(len);
    expect(len.value).toBeCloseTo(60, 6);
    expect(Math.abs(len.value - 60)).toBeLessThanOrEqual(EPS);
    expect(len.trueValue3D).toBeCloseTo(60, 6);
    expect(len.foreshortened).toBe(false);
  });
});

// Stepped shaft: ⌀50 for y∈[0,30], ⌀30 for y∈[30,60]. Profile (axis=Y, X≥0):
// (0,0)-(25,0)-(25,30)-(15,30)-(15,60)-(0,60). Off-axis vertices:
// i=1 (25,0), i=2 (25,30), i=3 (15,30), i=4 (15,60).
const step = buildRevolveMeasureTopo(revolve([
  { x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 30 },
  { x: 15, y: 30 }, { x: 15, y: 60 }, { x: 0, y: 60 },
]));

describe('stepped shaft — each ⌀ and the section lengths', () => {
  it('large section ⌀50 and small section ⌀30', () => {
    const big = measureDimension(dim('diametric', ['f.lat.1']), { topo: step, view: 'front' });
    expectOk(big);
    expect(Math.abs(big.value - 50)).toBeLessThanOrEqual(EPS);

    const small = measureDimension(dim('diametric', ['f.lat.4']), { topo: step, view: 'front' });
    expectOk(small);
    expect(Math.abs(small.value - 30)).toBeLessThanOrEqual(EPS);

    // The shoulder rim (i=3, r=15 at y=30) is the small ⌀ too.
    const shoulder = measureDimension(dim('diametric', ['f.lat.3']), { topo: step, view: 'front' });
    expectOk(shoulder);
    expect(Math.abs(shoulder.value - 30)).toBeLessThanOrEqual(EPS);
  });

  it('overall axial length 60 and large-section length 30', () => {
    const overall = measureDimension(dim('linear', ['f.lat.1', 'f.lat.4']), { topo: step, view: 'top' });
    expectOk(overall);
    expect(Math.abs(overall.value - 60)).toBeLessThanOrEqual(EPS);

    const section = measureDimension(dim('linear', ['f.lat.1', 'f.lat.2']), { topo: step, view: 'top' });
    expectOk(section);
    expect(Math.abs(section.value - 30)).toBeLessThanOrEqual(EPS);
  });
});

// Tube (annulus section) inner r=10, outer r=25: (10,0)-(25,0)-(25,40)-(10,40).
// Off-axis: i=0 (10,0), i=1 (25,0), i=2 (25,40), i=3 (10,40).
const tube = buildRevolveMeasureTopo(revolve([
  { x: 10, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 40 }, { x: 10, y: 40 },
]));

describe('tube — inner and outer ⌀', () => {
  it('bore ⌀20 (inner rim) and outer ⌀50', () => {
    const bore = measureDimension(dim('diametric', ['f.lat.0']), { topo: tube, view: 'front' });
    expectOk(bore);
    expect(Math.abs(bore.value - 20)).toBeLessThanOrEqual(EPS);

    const outer = measureDimension(dim('diametric', ['f.lat.1']), { topo: tube, view: 'front' });
    expectOk(outer);
    expect(Math.abs(outer.value - 50)).toBeLessThanOrEqual(EPS);
  });
});

// ─── explicit refusals (거부는 이유와 함께) ───────────────────────────────

describe('explicit refusals — never a fabricated value', () => {
  it('⌀ measured off the axis-normal view → oblique-in-view (no ellipse ⌀)', () => {
    // In top view the rim projects to a horizontal LINE, not a circle: the
    // disk is edge-on, not face-on. measure must refuse rather than invent one.
    const res = measureDimension(dim('diametric', ['f.lat.1']), { topo: cyl, view: 'top' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('oblique-in-view');
  });

  it('on-axis profile vertex has no rim name → unresolved-ref', () => {
    // i=0 (0,0) and i=3 (0,60) sweep to points; f.lat.0 does not exist here.
    const res = measureDimension(dim('diametric', ['f.lat.0']), { topo: cyl, view: 'front' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('unresolved-ref');
  });

  it('canonical-frame violation (x < 0) → adapter throws, no guessing', () => {
    expect(() => buildRevolveMeasureTopo(revolve([
      { x: 0, y: 0 }, { x: -25, y: 0 }, { x: -25, y: 60 }, { x: 0, y: 60 },
    ]))).toThrow(/canonical axis frame/);
  });

  it('angle out of (0,360] → adapter throws', () => {
    expect(() => buildRevolveMeasureTopo(revolve([
      { x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 60 }, { x: 0, y: 60 },
    ], 540))).toThrow(/angle must be in/);
  });
});

// ─── partial revolve: arc rim radius still measurable, concyclic ──────────

describe('partial revolve — arc rim radius', () => {
  it('120° sweep: rim radius 25 still fits (arc vertices concyclic)', () => {
    const partial = buildRevolveMeasureTopo(revolve([
      { x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 60 }, { x: 0, y: 60 },
    ], 120));
    const rad = measureDimension(dim('radial', ['f.lat.1']), { topo: partial, view: 'front' });
    expectOk(rad);
    expect(Math.abs(rad.value - 25)).toBeLessThanOrEqual(EPS);
  });
});
