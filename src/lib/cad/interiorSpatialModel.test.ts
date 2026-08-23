import { describe, expect, it } from 'vitest';
import {
  buildInteriorSpatialAssembly,
  interiorViewerParts,
  normalizeInteriorSpatialParameters,
  type InteriorSpatialParameters,
} from './interiorSpatialModel';

const defaults: InteriorSpatialParameters = {
  width: 8000,
  depth: 6000,
  ceilingHeight: 2700,
  doorWidth: 1000,
  exitCount: 1,
  rows: 2,
  cols: 3,
  furniture: null,
};

describe('interiorSpatialModel', () => {
  it('builds one semantic source for plan, viewer and checker', () => {
    const assembly = buildInteriorSpatialAssembly(defaults);
    expect(assembly.roomBounds).toEqual({ W: 8000, D: 6000 });
    expect(assembly.floorAreaM2).toBe(48);
    expect(assembly.exits).toEqual([{ x: 4000, y: 0, widthMm: 1000 }]);
    expect(assembly.parts.filter(part => part.role === 'wall')).toHaveLength(4);
    expect(assembly.furniture.find(row => row.id === 'seating')?.count).toBe(24);
  });

  it('keeps a visible door gap while preserving semantic wall openings', () => {
    const assembly = buildInteriorSpatialAssembly(defaults);
    const viewer = interiorViewerParts(assembly);
    const semanticFront = assembly.parts.find(part => part.id === 'wall_front');
    expect(semanticFront?.type).toBe('wall_with_openings');
    expect(viewer.some(part => part.id === 'wall_front')).toBe(false);
    expect(viewer.filter(part => part.id.startsWith('wall_front_segment'))).toHaveLength(2);
  });

  it('clamps unsafe dimensions and furniture coordinates without inventing verification', () => {
    const normalized = normalizeInteriorSpatialParameters({
      ...defaults,
      width: Number.NaN,
      depth: 1200,
      exitCount: 9,
      furniture: [{ kind: 'sofa', x: 999_999, y: -2 }],
    });
    expect(normalized.width).toBe(8000);
    expect(normalized.depth).toBe(2000);
    expect(normalized.exitCount).toBe(2);
    expect(normalized.furniture).toEqual([{ kind: 'sofa', x: 6200, y: 0 }]);
  });
});
