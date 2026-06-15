/**
 * revolveProfile — IR builder + SCAD serializer tests.
 */
import { describe, it, expect } from 'vitest';
import { buildRevolveFromLoop, revolveToScad } from './revolveProfile';
import { extractClosedLoops, type ProfileInput, type ProfilePoint } from '@/lib/sketch/sketchProfile';

function indexById(pts: ReadonlyArray<ProfilePoint>): ReadonlyMap<string, ProfilePoint> {
  return new Map(pts.map((p) => [p.id, p]));
}

/** A rect entirely on the +X side of the Y axis (revolve around Y → cylinder shell). */
function rightOfYAxisRect(): ProfileInput {
  return {
    points: [
      { id: 'p1', x: 5, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 8 },
      { id: 'p4', x: 5, y: 8 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

const Y_AXIS = { a: { x: 0, y: 0 }, b: { x: 0, y: 1 } };

describe('buildRevolveFromLoop', () => {
  it('builds a full revolve around the Y axis from a right-of-axis rect', () => {
    const inp = rightOfYAxisRect();
    const { loops } = extractClosedLoops(inp);
    const f = buildRevolveFromLoop(loops[0]!, indexById(inp.points), { axis: Y_AXIS });
    expect(f.kind).toBe('revolve');
    expect(f.angleDegrees).toBe(360);
    expect(f.loop.length).toBe(4);
    expect(f.mode).toBe('add');
    // All x coords should be ≥ 5 (perpendicular distance from Y axis).
    for (const p of f.loop) {
      expect(p.x).toBeGreaterThanOrEqual(5 - 1e-9);
    }
  });

  it('partial angle (180°) accepted', () => {
    const inp = rightOfYAxisRect();
    const { loops } = extractClosedLoops(inp);
    const f = buildRevolveFromLoop(loops[0]!, indexById(inp.points), { axis: Y_AXIS, angleDegrees: 180 });
    expect(f.angleDegrees).toBe(180);
  });

  it('rejects out-of-range angle', () => {
    const inp = rightOfYAxisRect();
    const { loops } = extractClosedLoops(inp);
    const idx = indexById(inp.points);
    expect(() => buildRevolveFromLoop(loops[0]!, idx, { axis: Y_AXIS, angleDegrees: 0 })).toThrow(/angle/);
    expect(() => buildRevolveFromLoop(loops[0]!, idx, { axis: Y_AXIS, angleDegrees: 361 })).toThrow(/angle/);
  });

  it('rejects coincident axis points', () => {
    const inp = rightOfYAxisRect();
    const { loops } = extractClosedLoops(inp);
    expect(() =>
      buildRevolveFromLoop(loops[0]!, indexById(inp.points), {
        axis: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      }),
    ).toThrow(/coincident/);
  });

  it('rejects profile straddling the axis', () => {
    // Rect from x=-3 to x=5, with Y axis as revolve axis — straddles.
    const inp: ProfileInput = {
      points: [
        { id: 'p1', x: -3, y: 0 },
        { id: 'p2', x: 5, y: 0 },
        { id: 'p3', x: 5, y: 4 },
        { id: 'p4', x: -3, y: 4 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p4' },
        { id: 'l4', p1: 'p4', p2: 'p1' },
      ],
    };
    const { loops } = extractClosedLoops(inp);
    expect(() =>
      buildRevolveFromLoop(loops[0]!, indexById(inp.points), { axis: Y_AXIS }),
    ).toThrow(/straddles/);
  });
});

describe('revolveToScad', () => {
  it('full revolve emits rotate_extrude with no angle clause', () => {
    const inp = rightOfYAxisRect();
    const { loops } = extractClosedLoops(inp);
    const f = buildRevolveFromLoop(loops[0]!, indexById(inp.points), { axis: Y_AXIS });
    const scad = revolveToScad(f);
    expect(scad).toMatch(/rotate_extrude\(\)/);
    expect(scad).toMatch(/polygon\(\[/);
  });

  it('partial sweep emits angle= clause', () => {
    const inp = rightOfYAxisRect();
    const { loops } = extractClosedLoops(inp);
    const f = buildRevolveFromLoop(loops[0]!, indexById(inp.points), { axis: Y_AXIS, angleDegrees: 270 });
    const scad = revolveToScad(f);
    expect(scad).toMatch(/rotate_extrude\(angle=270\)/);
  });

  it('cut mode prepends NEXYFAB:REVOLVE_CUT marker', () => {
    const inp = rightOfYAxisRect();
    const { loops } = extractClosedLoops(inp);
    const f = buildRevolveFromLoop(loops[0]!, indexById(inp.points), { axis: Y_AXIS, mode: 'cut' });
    const scad = revolveToScad(f);
    expect(scad.startsWith('// NEXYFAB:REVOLVE_CUT')).toBe(true);
  });

  it('output is deterministic', () => {
    const inp = rightOfYAxisRect();
    const { loops } = extractClosedLoops(inp);
    const f1 = buildRevolveFromLoop(loops[0]!, indexById(inp.points), { axis: Y_AXIS });
    const f2 = buildRevolveFromLoop(loops[0]!, indexById(inp.points), { axis: Y_AXIS });
    expect(revolveToScad(f1)).toBe(revolveToScad(f2));
  });
});
