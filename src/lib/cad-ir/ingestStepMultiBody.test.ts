/**
 * ingestStepMultiBody.test.ts — multi-body STEP placement fidelity (verification gap #3).
 *
 * The pure-TS reader emits feature IRs in a LOCAL frame (an extrude starts at z=0), which
 * discards each solid's world Z. Harmless for one body, but it STACKED multi-body parts at
 * the origin so the combined bbox / centroid the reconstruction gate trusts were wrong.
 * These tests author 2-solid STEP fixtures by hand (no third-party binaries — the same
 * MANIFOLD_SOLID_BREP box emitter the assembly importer tests use) and prove:
 *   1. the combined bbox spans BOTH bodies at their real positions (not stacked at origin);
 *   2. a single-body fixture is measured exactly as before (unchanged);
 *   3. an unsupported instance transform (MAPPED_ITEM) is flagged APPROXIMATE, never a
 *      silently-wrong "faithful" bbox.
 */
import { describe, it, expect } from 'vitest';
import { writeStepHeader } from '@/lib/brep-bridge/stepWrite';
import { stepToIr } from './ingestStep';

interface Box {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}

/** Emit a minimal 6-face axis-aligned box MANIFOLD_SOLID_BREP; returns its entity id. */
function emitBox(add: (body: string) => number, box: Box): number {
  const { x0, y0, z0, x1, y1, z1 } = box;
  const pts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ].map((p) => add(`CARTESIAN_POINT('',(${p[0]!.toFixed(6)},${p[1]!.toFixed(6)},${p[2]!.toFixed(6)}))`));
  const verts = pts.map((cp) => add(`VERTEX_POINT('',#${cp})`));

  const dirZp = add(`DIRECTION('',(0.,0.,1.))`);
  const dirZn = add(`DIRECTION('',(0.,0.,-1.))`);
  const dirXp = add(`DIRECTION('',(1.,0.,0.))`);
  const dirXn = add(`DIRECTION('',(-1.,0.,0.))`);
  const dirYp = add(`DIRECTION('',(0.,1.,0.))`);
  const dirYn = add(`DIRECTION('',(0.,-1.,0.))`);
  const refXDir = add(`DIRECTION('',(1.,0.,0.))`);
  const refYDir = add(`DIRECTION('',(0.,1.,0.))`);

  const makePlane = (origin: number, normal: number, refDir: number): number => {
    const ax = add(`AXIS2_PLACEMENT_3D('',#${origin},#${normal},#${refDir})`);
    return add(`PLANE('',#${ax})`);
  };
  const plnBottom = makePlane(pts[0]!, dirZn, refXDir);
  const plnTop    = makePlane(pts[4]!, dirZp, refXDir);
  const plnFront  = makePlane(pts[0]!, dirYn, refXDir);
  const plnBack   = makePlane(pts[3]!, dirYp, refXDir);
  const plnLeft   = makePlane(pts[0]!, dirXn, refYDir);
  const plnRight  = makePlane(pts[1]!, dirXp, refYDir);

  const lineDir = add(`DIRECTION('',(1.,0.,0.))`);
  const lineVec = add(`VECTOR('',#${lineDir},1.0)`);
  const makeEdgeCurve = (vStart: number, vEnd: number): number => {
    const cp = add(`CARTESIAN_POINT('',(0.,0.,0.))`);
    const ln = add(`LINE('',#${cp},#${lineVec})`);
    return add(`EDGE_CURVE('',#${vStart},#${vEnd},#${ln},.T.)`);
  };

  const eBottom = [
    makeEdgeCurve(verts[0]!, verts[1]!), makeEdgeCurve(verts[1]!, verts[2]!),
    makeEdgeCurve(verts[2]!, verts[3]!), makeEdgeCurve(verts[3]!, verts[0]!),
  ];
  const eTop = [
    makeEdgeCurve(verts[4]!, verts[5]!), makeEdgeCurve(verts[5]!, verts[6]!),
    makeEdgeCurve(verts[6]!, verts[7]!), makeEdgeCurve(verts[7]!, verts[4]!),
  ];
  const eVert = [
    makeEdgeCurve(verts[0]!, verts[4]!), makeEdgeCurve(verts[1]!, verts[5]!),
    makeEdgeCurve(verts[2]!, verts[6]!), makeEdgeCurve(verts[3]!, verts[7]!),
  ];

  const oe = (ec: number, fwd: boolean): number =>
    add(`ORIENTED_EDGE('',*,*,#${ec},.${fwd ? 'T' : 'F'}.)`);
  const makeFace = (pln: number, oeList: number[]): number => {
    const loop = add(`EDGE_LOOP('',(${oeList.map((o) => `#${o}`).join(',')}))`);
    const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    return add(`ADVANCED_FACE('',(#${bound}),#${pln},.T.)`);
  };

  const faceBottom = makeFace(plnBottom, [oe(eBottom[0]!, true), oe(eBottom[1]!, true), oe(eBottom[2]!, true), oe(eBottom[3]!, true)]);
  const faceTop    = makeFace(plnTop,    [oe(eTop[0]!, true), oe(eTop[1]!, true), oe(eTop[2]!, true), oe(eTop[3]!, true)]);
  const faceFront  = makeFace(plnFront,  [oe(eBottom[0]!, true), oe(eVert[1]!, true), oe(eTop[0]!, false), oe(eVert[0]!, false)]);
  const faceBack   = makeFace(plnBack,   [oe(eBottom[2]!, false), oe(eVert[2]!, true), oe(eTop[2]!, true), oe(eVert[3]!, false)]);
  const faceLeft   = makeFace(plnLeft,   [oe(eBottom[3]!, true), oe(eVert[0]!, true), oe(eTop[3]!, false), oe(eVert[3]!, false)]);
  const faceRight  = makeFace(plnRight,  [oe(eBottom[1]!, true), oe(eVert[2]!, true), oe(eTop[1]!, false), oe(eVert[1]!, false)]);

  const shell = add(`CLOSED_SHELL('',(#${faceBottom},#${faceTop},#${faceFront},#${faceBack},#${faceLeft},#${faceRight}))`);
  return add(`MANIFOLD_SOLID_BREP('',#${shell})`);
}

/** Wrap DATA-section lines into a full STEP file (with mm units) via the shared header. */
function makeStep(build: (add: (body: string) => number) => void): string {
  const lines: string[] = [];
  let next = 1;
  const add = (body: string): number => {
    const id = next++;
    lines.push(`#${id}=${body};`);
    return id;
  };
  // Declared mm units so the reader reports declared mm (like a real exporter).
  add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  build(add);
  return `${writeStepHeader()}DATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

describe('stepToIr — multi-body placement fidelity', () => {
  it('combined bbox spans BOTH stacked bodies at real Z (not piled at the origin)', () => {
    // Two boxes sharing XY but 20 mm apart in Z: A z[0,5], B z[20,25].
    const step = makeStep((add) => {
      emitBox(add, { x0: 0, y0: 0, z0: 0, x1: 10, y1: 20, z1: 5 });
      emitBox(add, { x0: 0, y0: 0, z0: 20, x1: 10, y1: 20, z1: 25 });
    });
    const res = stepToIr(step, { path: 'stack.step', name: 'stack.step' });

    expect(res.ok).toBe(true);
    expect(res.meta.solids).toBe(2);
    expect(res.meta.meshed).toBe(2);

    const ext = res.ir!.extent!;
    // Z now spans the true 0..25, NOT the stacked-at-origin 0..5.
    expect(ext.bbox_min![2]).toBeCloseTo(0, 3);
    expect(ext.bbox_max![2]).toBeCloseTo(25, 3);
    expect(ext.size![0]).toBeCloseTo(10, 3);
    expect(ext.size![1]).toBeCloseTo(20, 3);
    expect(ext.size![2]).toBeCloseTo(25, 3);
    // Centroid (bbox centre) sits between the two bodies, not at z=2.5.
    expect(ext.centroid![2]).toBeCloseTo(12.5, 3);

    // Both bodies placed exactly → faithful, not flagged approximate.
    expect(res.ir!.parse.status).toBe('ok');
    expect(res.meta.warnings.some((w) => w.startsWith('multi_body_placed'))).toBe(true);
    expect(res.meta.warnings.some((w) => w.includes('approximate'))).toBe(false);
  });

  it('combined bbox spans bodies offset in X, Y and Z simultaneously', () => {
    const step = makeStep((add) => {
      emitBox(add, { x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 5 });
      emitBox(add, { x0: 30, y0: 0, z0: 20, x1: 40, y1: 10, z1: 25 });
    });
    const res = stepToIr(step, { path: 'spread.step', name: 'spread.step' });
    expect(res.ok).toBe(true);
    const size = res.ir!.extent!.size!;
    expect(size[0]).toBeCloseTo(40, 3); // X: 0..40
    expect(size[1]).toBeCloseTo(10, 3); // Y: 0..10
    expect(size[2]).toBeCloseTo(25, 3); // Z: 0..25 (would be 5 when stacked)
    // Volume is the sum of the two boxes (500 + 500), independent of placement.
    expect(res.ir!.mesh!.volume_mm3).toBeCloseTo(1000, 1);
  });

  it('single-body fixture is measured exactly as before (unchanged)', () => {
    const step = makeStep((add) => {
      emitBox(add, { x0: 0, y0: 0, z0: 0, x1: 10, y1: 20, z1: 5 });
    });
    const res = stepToIr(step, { path: 'one.step', name: 'one.step' });
    expect(res.ok).toBe(true);
    expect(res.meta.solids).toBe(1);
    const size = res.ir!.extent!.size!;
    expect(size[0]).toBeCloseTo(10, 3);
    expect(size[1]).toBeCloseTo(20, 3);
    expect(size[2]).toBeCloseTo(5, 3);
    expect(res.ir!.mesh!.watertight).toBe(true);
    expect(res.ir!.parse.status).toBe('ok');
    // No multi-body placement bookkeeping for a single solid.
    expect(res.meta.warnings.some((w) => w.includes('multi_body'))).toBe(false);
    expect(res.meta.warnings.some((w) => w.includes('placement_approximate'))).toBe(false);
  });

  it('single body authored off the origin in Z keeps its true extent (min/max carried)', () => {
    // A lone box at z[20,25]: the single-body convention still measures its real size.
    const step = makeStep((add) => {
      emitBox(add, { x0: 0, y0: 0, z0: 20, x1: 10, y1: 10, z1: 25 });
    });
    const res = stepToIr(step, { path: 'offset.step', name: 'offset.step' });
    expect(res.ok).toBe(true);
    expect(res.ir!.extent!.size![2]).toBeCloseTo(5, 3);
  });

  it('flags an unsupported MAPPED_ITEM instance transform as APPROXIMATE (never a silent wrong bbox)', () => {
    // One real box plus a MAPPED_ITEM: the pure-TS reader measures the base geometry only.
    const step = makeStep((add) => {
      const solid = emitBox(add, { x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 5 });
      const origin = add(`CARTESIAN_POINT('',(100.,0.,0.))`);
      const zdir = add(`DIRECTION('',(0.,0.,1.))`);
      const xdir = add(`DIRECTION('',(1.,0.,0.))`);
      const target = add(`AXIS2_PLACEMENT_3D('',#${origin},#${zdir},#${xdir})`);
      const repMap = add(`REPRESENTATION_MAP(#${target},#${solid})`);
      add(`MAPPED_ITEM('inst',#${repMap},#${target})`);
    });
    const res = stepToIr(step, { path: 'mapped.step', name: 'mapped.step' });

    // Still measurable (base geometry), but honestly flagged — NOT presented as faithful.
    expect(res.ok).toBe(true);
    expect(res.ir!.parse.status).toBe('partial');
    expect(
      res.meta.warnings.some((w) => w.includes('mapped_item_instancing_not_expanded')),
    ).toBe(true);
  });
});
