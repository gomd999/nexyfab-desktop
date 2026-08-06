/**
 * extrudeProfile — IR builder + SCAD serializer tests.
 */
import { describe, it, expect } from 'vitest';
import { buildExtrudeFromLoop, extrudeToScad, type ExtrudeFeature } from './extrudeProfile';
import { extractClosedLoops, type ProfileInput, type ProfilePoint } from '@/lib/sketch/sketchProfile';

function rectInput(): ProfileInput {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 5 },
      { id: 'p4', x: 0, y: 5 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

function indexById(pts: ReadonlyArray<ProfilePoint>): ReadonlyMap<string, ProfilePoint> {
  return new Map(pts.map((p) => [p.id, p]));
}

describe('buildExtrudeFromLoop', () => {
  it('builds an extrude feature from a rect loop', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const f = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 7 });
    expect(f.kind).toBe('extrude');
    expect(f.loop.length).toBe(4);
    expect(f.depth).toBe(7);
    expect(f.mode).toBe('add');
    expect(f.direction).toBe('one_sided');
  });

  it('re-orients clockwise loop to CCW (signedArea ≥ 0)', () => {
    // A clockwise rect (negative signedArea).
    const inp: ProfileInput = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 0, y: 5 },
        { id: 'p3', x: 10, y: 5 },
        { id: 'p4', x: 10, y: 0 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p4' },
        { id: 'l4', p1: 'p4', p2: 'p1' },
      ],
    };
    const { loops } = extractClosedLoops(inp);
    const orig = loops[0]!;
    const f = buildExtrudeFromLoop(orig, indexById(inp.points), { depth: 3 });
    expect(f.loop.length).toBe(4);
    // Confirm orientation flipped if necessary: first point should be different
    // from original ordering OR same — but a recomputed signed area on f.loop
    // must be ≥ 0.
    let s = 0;
    for (let i = 0; i < f.loop.length; i++) {
      const a = f.loop[i]!;
      const b = f.loop[(i + 1) % f.loop.length]!;
      s += a.x * b.y - b.x * a.y;
    }
    expect(s / 2).toBeGreaterThanOrEqual(0);
  });

  it('rejects non-positive depth', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const idx = indexById(inp.points);
    expect(() => buildExtrudeFromLoop(loops[0]!, idx, { depth: 0 })).toThrow(/positive/);
    expect(() => buildExtrudeFromLoop(loops[0]!, idx, { depth: -5 })).toThrow(/positive/);
  });

  it('rejects out-of-range draft', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const idx = indexById(inp.points);
    expect(() => buildExtrudeFromLoop(loops[0]!, idx, { depth: 5, draftDegrees: 45 })).toThrow(/draft/);
    expect(() => buildExtrudeFromLoop(loops[0]!, idx, { depth: 5, draftDegrees: -90 })).toThrow(/draft/);
  });
});

describe('extrudeToScad', () => {
  it('positions the sketch plane when profileOffsetZ is present', () => {
    const f: ExtrudeFeature = { kind:'extrude',loop:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],depth:3,direction:'one_sided',mode:'add',profileOffsetZ:2 };
    expect(extrudeToScad(f)).toMatch(/^translate\(\[0,0,2\]\)/);
  });
  it('rect 10x5x7 emits linear_extrude polygon', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const f = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 7 });
    const scad = extrudeToScad(f);
    expect(scad).toMatch(/linear_extrude\(height=7,\s*center=false\)/);
    expect(scad).toMatch(/polygon\(\[/);
    // All 4 corners present.
    expect(scad).toMatch(/\[0,\s*0\]/);
    expect(scad).toMatch(/\[10,\s*0\]/);
    expect(scad).toMatch(/\[10,\s*5\]/);
    expect(scad).toMatch(/\[0,\s*5\]/);
  });

  it('midplane direction → center=true', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const f = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 4, direction: 'midplane' });
    const scad = extrudeToScad(f);
    expect(scad).toMatch(/center=true/);
  });

  it('two_sided direction → translate(-depth) + double height', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const f = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 3, direction: 'two_sided' });
    const scad = extrudeToScad(f);
    expect(scad).toMatch(/translate\(\[0,0,-3\]\)/);
    expect(scad).toMatch(/linear_extrude\(height=6/);
  });

  it('cut mode prepends NEXYFAB:EXTRUDE_CUT marker', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const f = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 2, mode: 'cut' });
    const scad = extrudeToScad(f);
    expect(scad.startsWith('// NEXYFAB:EXTRUDE_CUT')).toBe(true);
  });

  it('draft angle adds scale= clause within (0, 100]', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const f = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 2, draftDegrees: 5 });
    const scad = extrudeToScad(f);
    expect(scad).toMatch(/scale=/);
    // Extract scale value and assert it's < 1 (positive draft narrows top).
    const m = scad.match(/scale=([\d.]+)/);
    expect(m).not.toBeNull();
    const s = Number(m![1]);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('zero draft omits scale clause', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const f = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 2 });
    const scad = extrudeToScad(f);
    expect(scad).not.toMatch(/scale=/);
  });

  it('output is deterministic — same input → same string', () => {
    const inp = rectInput();
    const { loops } = extractClosedLoops(inp);
    const f1 = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 4 });
    const f2 = buildExtrudeFromLoop(loops[0]!, indexById(inp.points), { depth: 4 });
    expect(extrudeToScad(f1)).toBe(extrudeToScad(f2));
  });
});
