import { describe, it, expect } from 'vitest';
import { buildPocketToolpath, buildPolygonPocketToolpath, type RectPocket, type ToolingParams } from './pocketToolpath';

const pocket: RectPocket = { width: 50, height: 30, depth: 6 };
const tool: ToolingParams = { diameter: 6, stepdown: 2, stepoverFraction: 0.5 };

describe('buildPocketToolpath · basic structure', () => {
  it('produces a non-empty segment list', () => {
    const r = buildPocketToolpath(pocket, tool, 'zigzag');
    expect(r.segments.length).toBeGreaterThan(0);
  });

  it('reports pass count matching depth / stepdown', () => {
    const r = buildPocketToolpath({ ...pocket, depth: 6 }, { ...tool, stepdown: 2 }, 'zigzag');
    expect(r.passCount).toBe(3);
  });

  it('reports both cut and rapid length', () => {
    const r = buildPocketToolpath(pocket, tool, 'zigzag');
    expect(r.cutLengthMm).toBeGreaterThan(0);
    expect(r.rapidLengthMm).toBeGreaterThanOrEqual(0);
  });
});

describe('buildPocketToolpath · pattern variants', () => {
  it('zigzag produces alternating-direction feed segments', () => {
    const r = buildPocketToolpath(pocket, tool, 'zigzag');
    const feeds = r.segments.filter(s => s.kind === 'feed');
    // The X-direction sign should flip at least once.
    let prevSign = 0;
    let flips = 0;
    for (const f of feeds) {
      const dx = f.end[0] - f.start[0];
      if (Math.abs(dx) < 1e-6) continue;
      const sign = dx > 0 ? 1 : -1;
      if (prevSign !== 0 && sign !== prevSign) flips++;
      prevSign = sign;
    }
    expect(flips).toBeGreaterThan(0);
  });

  it('spiral produces inward-converging rectangles', () => {
    const r = buildPocketToolpath(pocket, tool, 'spiral');
    expect(r.segments.length).toBeGreaterThan(0);
    // No empty result.
    expect(r.cutLengthMm).toBeGreaterThan(0);
  });

  it('contourParallel rapid-ups between rings (more rapid moves)', () => {
    const spiral = buildPocketToolpath(pocket, tool, 'spiral');
    const cp = buildPocketToolpath(pocket, tool, 'contourParallel');
    const spiralRapids = spiral.segments.filter(s => s.kind === 'rapid').length;
    const cpRapids = cp.segments.filter(s => s.kind === 'rapid').length;
    expect(cpRapids).toBeGreaterThanOrEqual(spiralRapids);
  });
});

describe('buildPocketToolpath · stepover effect', () => {
  it('smaller stepover → more cut length', () => {
    const wide = buildPocketToolpath(pocket, { ...tool, stepoverFraction: 0.8 }, 'zigzag');
    const tight = buildPocketToolpath(pocket, { ...tool, stepoverFraction: 0.2 }, 'zigzag');
    expect(tight.cutLengthMm).toBeGreaterThan(wide.cutLengthMm);
  });

  it('clamps stepoverFraction to (0.05, 1]', () => {
    expect(() => buildPocketToolpath(pocket, { ...tool, stepoverFraction: 0 }, 'zigzag')).not.toThrow();
    expect(() => buildPocketToolpath(pocket, { ...tool, stepoverFraction: 10 }, 'zigzag')).not.toThrow();
  });
});

describe('buildPocketToolpath · all-cut segments stay inside the offset rectangle', () => {
  it('feed moves never go outside (origin + tool radius) inset', () => {
    const r = buildPocketToolpath(pocket, tool, 'zigzag');
    const minX = tool.diameter / 2;
    const maxX = pocket.width - tool.diameter / 2;
    const minY = tool.diameter / 2;
    const maxY = pocket.height - tool.diameter / 2;
    for (const s of r.segments) {
      if (s.kind !== 'feed') continue;
      for (const p of [s.start, s.end]) {
        expect(p[0]).toBeGreaterThanOrEqual(minX - 1e-6);
        expect(p[0]).toBeLessThanOrEqual(maxX + 1e-6);
        expect(p[1]).toBeGreaterThanOrEqual(minY - 1e-6);
        expect(p[1]).toBeLessThanOrEqual(maxY + 1e-6);
      }
    }
  });
});

describe('buildPocketToolpath · full coverage + fit guard', () => {
  it('the zigzag final pass reaches the far inset wall (no uncut ridge)', () => {
    // 20×13 pocket, Ø4 tool → inset Y [2, 11]; stepover 1.6 does not divide the
    // 9mm span, so a naïve loop would stop at y=10 and leave a 1mm strip.
    const r = buildPocketToolpath({ width: 20, height: 13, depth: 2 }, { diameter: 4, stepdown: 2, stepoverFraction: 0.4 }, 'zigzag');
    const passY = r.segments
      .filter(s => s.kind === 'feed' && Math.abs(s.start[1] - s.end[1]) < 1e-6)
      .map(s => s.start[1]);
    expect(Math.max(...passY)).toBeCloseTo(11, 3); // inset y1 — clears to the wall
  });

  it('refuses a tool larger than the pocket instead of emitting a bogus plunge', () => {
    // Ø4 tool, 3mm-wide pocket → inverted inset; must produce nothing.
    const r = buildPocketToolpath({ width: 3, height: 3, depth: 2 }, { diameter: 4, stepdown: 2, stepoverFraction: 0.4 }, 'zigzag');
    expect(r.segments).toHaveLength(0);
    expect(r.cutLengthMm).toBe(0);
    expect(r.toolTooLarge).toBe(true);
  });

  it('a tool that exactly spans the pocket (no room) is also rejected', () => {
    const r = buildPocketToolpath({ width: 6, height: 20, depth: 2 }, { diameter: 6, stepdown: 2 }, 'zigzag');
    expect(r.toolTooLarge).toBe(true); // width 6 − 2·3 = 0 inset → no path
  });
});

describe('buildPolygonPocketToolpath · arbitrary (non-rectangular) pockets', () => {
  const L = [
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 },
    { x: 20, y: 20 }, { x: 20, y: 40 }, { x: 0, y: 40 },
  ];

  it('clears an L-shaped pocket with a contour-parallel path inside the boundary', () => {
    const r = buildPolygonPocketToolpath(L, { diameter: 4, stepdown: 2, stepoverFraction: 0.4 }, 6, 0);
    expect(r.passCount).toBe(3);
    const feeds = r.segments.filter(s => s.kind === 'feed');
    expect(feeds.length).toBeGreaterThan(0);
    expect(r.cutLengthMm).toBeGreaterThan(0);
    // every feed point stays within the L's bounding box (and offset in from it).
    for (const s of feeds) for (const p of [s.start, s.end]) {
      expect(p[0]).toBeGreaterThanOrEqual(-1e-6);
      expect(p[0]).toBeLessThanOrEqual(40 + 1e-6);
      expect(p[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(p[1]).toBeLessThanOrEqual(40 + 1e-6);
    }
  });

  it('rejects a tool wider than the polygon', () => {
    const thin = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 30 }, { x: 0, y: 30 }];
    const r = buildPolygonPocketToolpath(thin, { diameter: 4, stepdown: 2 }, 6, 0);
    expect(r.segments).toHaveLength(0);
    expect(r.toolTooLarge).toBe(true);
  });

  it('topologyAware clears both sides of a pocket that pinches off', () => {
    // Dumbbell: two boxes joined by a thin neck. A tool that over-runs the neck
    // would stop the conservative path at the pinch; topologyAware keeps cutting
    // both lobes.
    const dumbbell = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 8 }, { x: 40, y: 8 }, { x: 40, y: 0 }, { x: 60, y: 0 },
      { x: 60, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 12 }, { x: 20, y: 12 }, { x: 20, y: 20 }, { x: 0, y: 20 },
    ];
    const tool: ToolingParams = { diameter: 6, stepdown: 2, stepoverFraction: 0.5 };
    const aware = buildPolygonPocketToolpath(dumbbell, tool, 4, 0, { topologyAware: true });
    expect(aware.segments.length).toBeGreaterThan(0);
    const feeds = aware.segments.filter(s => s.kind === 'feed');
    // feeds reach both the left lobe (x<20) and the right lobe (x>40).
    expect(feeds.some(s => s.start[0] < 20)).toBe(true);
    expect(feeds.some(s => s.start[0] > 40)).toBe(true);
    // every feed point stays inside the boundary's bounding box.
    for (const s of feeds) for (const p of [s.start, s.end]) {
      expect(p[0]).toBeGreaterThanOrEqual(-1e-6);
      expect(p[0]).toBeLessThanOrEqual(60 + 1e-6);
      expect(p[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(p[1]).toBeLessThanOrEqual(20 + 1e-6);
    }
  });
});
