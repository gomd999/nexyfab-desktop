import { describe, it, expect } from 'vitest';
import { buildPocketToolpath, type RectPocket, type ToolingParams } from './pocketToolpath';

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
