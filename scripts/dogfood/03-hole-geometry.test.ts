/**
 * DOGFOOD 03 — where do the holes actually END UP?
 *
 * 02 showed `difference(plate, hole)` emitting a hole whose Z span is
 * [-depth, +0.01] while the plate occupies [0, +depth]. If that is right,
 * the Hole wizard (live product surface, `holesFromSketch`) produces a part
 * with NO holes in it, and nothing warns.
 */
import { describe, it, expect } from 'vitest';
import { extrudeToScad, buildExtrudeFromLoop, type ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildHoleFeature, holeToScad } from '@/lib/cad/holeProfile';
import { holesFromSketch } from '@/lib/sketch/holesFromSketch';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

function plate(depth: number): ExtrudeFeature {
  const pts = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 80 }, { x: 0, y: 80 }];
  const withIds = pts.map((p, i) => ({ id: `pt${i}`, ...p }));
  return buildExtrudeFromLoop(
    { points: withIds.map((p) => p.id), lines: [], signedArea: 9600 } as never,
    new Map(withIds.map((p) => [p.id, p])),
    { depth, mode: 'add', direction: 'one_sided' },
  );
}

describe('DOGFOOD 03 — hole Z placement', () => {
  it('plate SCAD vs hole SCAD Z ranges', () => {
    const p = plate(10);
    console.log('PLATE SCAD:\n' + extrudeToScad(p));
    const h = buildHoleFeature({
      center: { x: 15, y: 15 }, holeType: 'drilled', diameter: 9, depth: 10,
    });
    console.log('HOLE SCAD:\n' + holeToScad(h, p.depth));
    expect(holeToScad(h, p.depth)).toContain('translate([0, 0, -0.01]) cylinder(h=10.02');
    console.log('>>> plate occupies z = [0, 10]; host-aware hole spans [-0.01, 10.01]');
  });

  it('the LIVE Hole wizard bridge: holesFromSketch', () => {
    const sketch: SolverViewState = {
      points: [
        { id: 'a', x: 0, y: 0 }, { id: 'b', x: 120, y: 0 },
        { id: 'c', x: 120, y: 80 }, { id: 'd', x: 0, y: 80 },
        { id: 'h1', x: 15, y: 15 }, { id: 'h2', x: 105, y: 15 },
        { id: 'h3', x: 105, y: 65 }, { id: 'h4', x: 15, y: 65 },
      ],
      lines: [
        { id: 'l1', p1: 'a', p2: 'b' }, { id: 'l2', p1: 'b', p2: 'c' },
        { id: 'l3', p1: 'c', p2: 'd' }, { id: 'l4', p1: 'd', p2: 'a' },
      ],
    };
    const res = holesFromSketch(sketch, {
      extrudeDepth: 10,
      holes: ['h1', 'h2', 'h3', 'h4'].map((pointId) => ({
        pointId, holeType: 'drilled' as const, diameter: 9, depth: 10,
      })),
    });
    if (!res.ok) {
      console.log('holesFromSketch FAILED:', res.error);
      return;
    }
    console.log('holesFromSketch SCAD:\n' + res.scad);
    console.log('holeCount =', res.holeCount);
    expect(res.scad).toContain('translate([0, 0, -0.01]) cylinder(h=10.02');
  });

  it('hole point that is NOT in the sketch — is the error useful?', () => {
    const sketch: SolverViewState = {
      points: [
        { id: 'a', x: 0, y: 0 }, { id: 'b', x: 120, y: 0 },
        { id: 'c', x: 120, y: 80 }, { id: 'd', x: 0, y: 80 },
      ],
      lines: [
        { id: 'l1', p1: 'a', p2: 'b' }, { id: 'l2', p1: 'b', p2: 'c' },
        { id: 'l3', p1: 'c', p2: 'd' }, { id: 'l4', p1: 'd', p2: 'a' },
      ],
    };
    const res = holesFromSketch(sketch, {
      extrudeDepth: 10,
      holes: [{ pointId: 'p_center', holeType: 'drilled', diameter: 9, depth: 10 }],
    });
    console.log('missing-point error:', res.ok ? 'OK?!' : res.error);
  });

  it('hole BIGGER than the plate — does anything object?', () => {
    const sketch: SolverViewState = {
      points: [
        { id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 },
        { id: 'c', x: 40, y: 40 }, { id: 'd', x: 0, y: 40 },
        { id: 'ctr', x: 20, y: 20 },
      ],
      lines: [
        { id: 'l1', p1: 'a', p2: 'b' }, { id: 'l2', p1: 'b', p2: 'c' },
        { id: 'l3', p1: 'c', p2: 'd' }, { id: 'l4', p1: 'd', p2: 'a' },
      ],
    };
    const res = holesFromSketch(sketch, {
      extrudeDepth: 10,
      // d=200 on a 40x40 plate, and depth 500 on a 10mm plate.
      holes: [{ pointId: 'ctr', holeType: 'drilled', diameter: 200, depth: 500 }],
    });
    console.log('oversized hole accepted?', res.ok, res.ok ? '' : res.error);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/oversized|clearance/i);
  });
});
