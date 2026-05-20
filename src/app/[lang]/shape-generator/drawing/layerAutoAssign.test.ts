import { describe, it, expect } from 'vitest';
import {
  assignLayers,
  STANDARD_LAYERS,
  customizeMapping,
  resetMapping,
  summarize,
  type DrawingEntity,
} from './layerAutoAssign';

describe('assignLayers', () => {
  it('empty input → empty assignment', () => {
    const r = assignLayers([]);
    expect(r.entities).toEqual([]);
    expect(r.layersUsed).toEqual([]);
  });

  it('visible-edge → OBJECT layer', () => {
    const r = assignLayers([{ id: 'e1', type: 'visible-edge' }]);
    expect(r.entities[0]!.layer).toBe('OBJECT');
  });

  it('hidden-edge → HIDDEN layer with dashed style', () => {
    const r = assignLayers([{ id: 'e1', type: 'hidden-edge' }]);
    expect(r.entities[0]!.layer).toBe('HIDDEN');
    expect(r.entities[0]!.style).toBe('dashed');
  });

  it('centerline → CENTER with long-dash-dot', () => {
    const r = assignLayers([{ id: 'e1', type: 'centerline' }]);
    expect(r.entities[0]!.style).toBe('long-dash-dot');
  });

  it('dimension and extension-line both go to DIM', () => {
    const r = assignLayers([
      { id: 'e1', type: 'dimension' },
      { id: 'e2', type: 'extension-line' },
    ]);
    expect(r.entities[0]!.layer).toBe('DIM');
    expect(r.entities[1]!.layer).toBe('DIM');
  });

  it('construction layer is non-printable', () => {
    const r = assignLayers([{ id: 'e1', type: 'construction' }]);
    expect(r.entities[0]!.layer).toBe('CONSTRUCTION');
    expect(STANDARD_LAYERS.CONSTRUCTION!.printable).toBe(false);
  });

  it('layerCounts tracks usage', () => {
    const r = assignLayers([
      { id: 'a', type: 'visible-edge' },
      { id: 'b', type: 'visible-edge' },
      { id: 'c', type: 'hidden-edge' },
    ]);
    expect(r.layerCounts.OBJECT).toBe(2);
    expect(r.layerCounts.HIDDEN).toBe(1);
  });

  it('layersUsed has unique layers', () => {
    const r = assignLayers([
      { id: 'a', type: 'visible-edge' },
      { id: 'b', type: 'visible-edge' },
    ]);
    expect(r.layersUsed).toHaveLength(1);
  });

  it('text + symbol both go to TEXT layer', () => {
    const r = assignLayers([
      { id: 'a', type: 'text' },
      { id: 'b', type: 'symbol' },
    ]);
    expect(r.entities[0]!.layer).toBe('TEXT');
    expect(r.entities[1]!.layer).toBe('TEXT');
  });

  it('leader goes to DIM', () => {
    const r = assignLayers([{ id: 'e1', type: 'leader' }]);
    expect(r.entities[0]!.layer).toBe('DIM');
  });
});

describe('customizeMapping + resetMapping', () => {
  it('customize re-routes entity type', () => {
    customizeMapping('visible-edge', 'PHANTOM');
    const r = assignLayers([{ id: 'e1', type: 'visible-edge' }]);
    expect(r.entities[0]!.layer).toBe('PHANTOM');
    resetMapping();
  });

  it('reset restores defaults', () => {
    customizeMapping('visible-edge', 'PHANTOM');
    resetMapping();
    const r = assignLayers([{ id: 'e1', type: 'visible-edge' }]);
    expect(r.entities[0]!.layer).toBe('OBJECT');
  });
});

describe('STANDARD_LAYERS', () => {
  it('OBJECT layer is thick', () => {
    expect(STANDARD_LAYERS.OBJECT!.lineWeight).toBe('thick');
  });

  it('CENTER layer is thin', () => {
    expect(STANDARD_LAYERS.CENTER!.lineWeight).toBe('thin');
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const r = assignLayers([]);
    const s = summarize(r);
    expect(s.totalEntities).toBe(0);
  });

  it('most-used layer reported', () => {
    const r = assignLayers([
      { id: 'a', type: 'visible-edge' },
      { id: 'b', type: 'visible-edge' },
      { id: 'c', type: 'hidden-edge' },
    ]);
    const s = summarize(r);
    expect(s.mostUsedLayer).toBe('OBJECT');
  });

  it('printable count excludes construction', () => {
    const entities: DrawingEntity[] = [
      { id: 'a', type: 'visible-edge' },
      { id: 'b', type: 'construction' },
    ];
    const r = assignLayers(entities);
    const s = summarize(r);
    expect(s.printableCount).toBe(1);
  });
});
