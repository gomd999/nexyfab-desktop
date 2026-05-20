import { describe, it, expect } from 'vitest';
import {
  layoutText,
  extrudeText,
  summarizeLayout,
  buildTestFont,
} from './parametricTypography';

describe('layoutText', () => {
  it('empty text → empty layout', () => {
    const r = layoutText(buildTestFont(), { text: '' });
    expect(r.glyphLoops).toHaveLength(0);
  });

  it('single A produces one glyph', () => {
    const r = layoutText(buildTestFont(), { text: 'A', heightMm: 10 });
    expect(r.glyphLoops).toHaveLength(1);
    expect(r.glyphLoops[0]!.length).toBeGreaterThan(0);
  });

  it('multi-character advances cursor', () => {
    const r = layoutText(buildTestFont(), { text: 'AB', heightMm: 10 });
    expect(r.glyphOrigins).toHaveLength(2);
    expect(r.glyphOrigins[1]!.x).toBeGreaterThan(r.glyphOrigins[0]!.x);
  });

  it('newline starts a new line', () => {
    const r = layoutText(buildTestFont(), { text: 'A\nB', heightMm: 10 });
    expect(r.lineWidths.length).toBeGreaterThan(1);
    expect(r.glyphOrigins[1]!.y).toBeLessThan(r.glyphOrigins[0]!.y);
  });

  it('respects heightMm', () => {
    const small = layoutText(buildTestFont(), { text: 'A', heightMm: 5 });
    const large = layoutText(buildTestFont(), { text: 'A', heightMm: 50 });
    const smallH = small.bbox.max.y - small.bbox.min.y;
    const largeH = large.bbox.max.y - large.bbox.min.y;
    expect(largeH).toBeCloseTo(smallH * 10, 1);
  });

  it('missing glyph falls back', () => {
    const r = layoutText(buildTestFont(), { text: 'Z', heightMm: 10 });
    expect(r.glyphLoops).toHaveLength(1);
  });

  it('tracking adds spacing', () => {
    const noTracking = layoutText(buildTestFont(), { text: 'AB', heightMm: 10, trackingMm: 0 });
    const withTracking = layoutText(buildTestFont(), { text: 'AB', heightMm: 10, trackingMm: 5 });
    expect(withTracking.glyphOrigins[1]!.x).toBeGreaterThan(noTracking.glyphOrigins[1]!.x);
  });

  it('wrapping respects maxWidth', () => {
    const r = layoutText(buildTestFont(), { text: 'AAAAA', heightMm: 10, maxWidthMm: 12 });
    expect(r.lineWidths.length).toBeGreaterThan(1);
  });
});

describe('extrudeText', () => {
  it('produces positions + indices', () => {
    const layout = layoutText(buildTestFont(), { text: 'A', heightMm: 10 });
    const mesh = extrudeText(layout, 5);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
  });

  it('mesh has top and bottom rings', () => {
    const layout = layoutText(buildTestFont(), { text: 'A', heightMm: 10 });
    const mesh = extrudeText(layout, 5);
    const vertCount = mesh.positions.length / 3;
    // For each glyph loop with N points, we get 2N verts.
    expect(vertCount % 2).toBe(0);
  });

  it('depth controls Z extent', () => {
    const layout = layoutText(buildTestFont(), { text: 'A', heightMm: 10 });
    const thin = extrudeText(layout, 1);
    const thick = extrudeText(layout, 10);
    expect(Math.max(...thick.positions.filter((_, i) => i % 3 === 2)))
      .toBeGreaterThan(Math.max(...thin.positions.filter((_, i) => i % 3 === 2)));
  });
});

describe('summarizeLayout', () => {
  it('counts glyphs + loops + points', () => {
    const layout = layoutText(buildTestFont(), { text: 'AB', heightMm: 10 });
    const s = summarizeLayout(layout);
    expect(s.glyphCount).toBe(2);
    expect(s.totalPointCount).toBeGreaterThan(0);
  });

  it('lineCount reflects newlines', () => {
    const layout = layoutText(buildTestFont(), { text: 'A\nB', heightMm: 10 });
    expect(summarizeLayout(layout).lineCount).toBeGreaterThan(1);
  });
});
