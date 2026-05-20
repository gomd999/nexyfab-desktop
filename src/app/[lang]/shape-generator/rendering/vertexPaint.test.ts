import { describe, it, expect } from 'vitest';
import {
  PaintSession,
  falloffWeight,
  blendColor,
  type BrushSettings,
  type RGB,
} from './vertexPaint';

function gridVertices(): [number, number, number][] {
  // 3×3 grid at z=0.
  const v: [number, number, number][] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) v.push([i, j, 0]);
  return v;
}

function brush(color: RGB, radius: number = 1.5): BrushSettings {
  return { color, radiusMm: radius, falloff: 1, blendMode: 'replace', opacity: 1 };
}

describe('PaintSession — layers', () => {
  it('addLayer creates with base color', () => {
    const s = new PaintSession(gridVertices());
    const layer = s.addLayer('base', [1, 0, 0]);
    expect(layer.colors[0]).toEqual([1, 0, 0]);
  });

  it('setLayerOpacity clamps to [0, 1]', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('a');
    s.setLayerOpacity(l.id, 5);
    expect(s.getLayer(l.id)!.opacity).toBe(1);
  });

  it('toggleLayerVisibility flips hidden', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('a');
    s.toggleLayerVisibility(l.id);
    expect(s.getLayer(l.id)!.hidden).toBe(true);
  });
});

describe('PaintSession — applyStroke', () => {
  it('paints vertices within radius', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('base');
    s.applyStroke(l.id, brush([1, 0, 0], 1), [0, 0, 0]);
    // Vertex (0,0,0) directly under brush should be red-ish.
    expect(l.colors[0]![0]).toBeGreaterThan(0.5);
  });

  it('vertices outside radius untouched', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('base');
    s.applyStroke(l.id, brush([1, 0, 0], 0.5), [0, 0, 0]);
    // Vertex (2,2,0) is far away (~2.8), should remain white.
    expect(l.colors[8]).toEqual([1, 1, 1]);
  });

  it('stroke pushed to history', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('base');
    s.applyStroke(l.id, brush([1, 0, 0]), [0, 0, 0]);
    expect(s.strokes).toHaveLength(1);
  });
});

describe('PaintSession — undo/redo', () => {
  it('undo reverts vertex colors', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('base');
    const before = JSON.stringify(l.colors);
    s.applyStroke(l.id, brush([1, 0, 0]), [0, 0, 0]);
    s.undo();
    expect(JSON.stringify(l.colors)).toBe(before);
  });

  it('redo replays the stroke', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('base');
    s.applyStroke(l.id, brush([1, 0, 0]), [0, 0, 0]);
    s.undo();
    s.redo();
    expect(l.colors[0]![0]).toBeGreaterThan(0.5);
  });

  it('new stroke clears redo stack', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('base');
    s.applyStroke(l.id, brush([1, 0, 0]), [0, 0, 0]);
    s.undo();
    s.applyStroke(l.id, brush([0, 1, 0]), [0, 0, 0]);
    expect(s.redoStack).toHaveLength(0);
  });

  it('undo on empty history returns null', () => {
    const s = new PaintSession(gridVertices());
    expect(s.undo()).toBeNull();
  });
});

describe('PaintSession — composite', () => {
  it('hidden layers ignored', () => {
    const s = new PaintSession(gridVertices());
    const top = s.addLayer('top', [1, 0, 0]);
    top.hidden = true;
    const result = s.composite();
    expect(result[0]).toEqual([1, 1, 1]); // background only
  });

  it('layer opacity blends with background', () => {
    const s = new PaintSession(gridVertices());
    const top = s.addLayer('top', [1, 0, 0]);
    top.opacity = 0.5;
    const result = s.composite();
    expect(result[0]![0]).toBeCloseTo(1, 5); // bg(1) * 0.5 + red(1) * 0.5 = 1
    expect(result[0]![1]).toBeCloseTo(0.5, 5);
  });
});

describe('PaintSession — mergeLayerDown', () => {
  it('merges top into below + removes top', () => {
    const s = new PaintSession(gridVertices());
    s.addLayer('bottom', [0, 0, 0]);
    const top = s.addLayer('top', [1, 1, 1]);
    top.opacity = 1;
    s.mergeLayerDown(top.id);
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0]!.colors[0]).toEqual([1, 1, 1]);
  });

  it('top layer (index 0) cannot be merged down', () => {
    const s = new PaintSession(gridVertices());
    const l = s.addLayer('only');
    s.mergeLayerDown(l.id);
    expect(s.layers).toHaveLength(1);
  });
});

describe('falloffWeight', () => {
  it('distance 0 → weight = 1', () => {
    expect(falloffWeight(0, 1, 2)).toBe(1);
  });

  it('distance ≥ radius → 0', () => {
    expect(falloffWeight(1, 1, 1)).toBe(0);
    expect(falloffWeight(2, 1, 1)).toBe(0);
  });

  it('linear falloff at midpoint', () => {
    expect(falloffWeight(0.5, 1, 1)).toBeCloseTo(0.5, 5);
  });
});

describe('blendColor', () => {
  it('replace at weight 1 = brush color', () => {
    const r = blendColor([1, 1, 1], [1, 0, 0], 'replace', 1);
    expect(r).toEqual([1, 0, 0]);
  });

  it('multiply darkens', () => {
    const r = blendColor([1, 1, 1], [0, 0, 0], 'multiply', 1);
    expect(r[0]).toBe(0);
  });

  it('add saturates at 1', () => {
    const r = blendColor([0.8, 0.8, 0.8], [1, 1, 1], 'add', 1);
    expect(r[0]).toBe(1);
  });

  it('mix at weight 1 mixes 50%', () => {
    const r = blendColor([1, 1, 1], [0, 0, 0], 'mix', 1);
    expect(r[0]).toBeCloseTo(0.5, 5);
  });
});
