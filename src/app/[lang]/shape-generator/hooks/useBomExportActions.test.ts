import { describe, expect, it } from 'vitest';
import { buildWorkspaceBomRows } from './useBomExportActions';

const metric = (w: number, volume: number) => ({
  bbox: { w, h: 20, d: 30 },
  volume_cm3: volume,
  surface_area_cm2: 50,
});

describe('buildWorkspaceBomRows', () => {
  it('combines assembly and cart work objects with stable row numbering', () => {
    const rows = buildWorkspaceBomRows({
      bomParts: [{ name: 'Frame', result: metric(10, 2) }],
      cartItems: [{ shapeId: 'shaft', shapeName: 'Shaft', ...metric(15, 3) }],
      effectiveResult: metric(99, 99),
      isSketchResult: false,
      selectedId: 'box',
      selectedShapeName: 'Box',
      materialId: 'steel',
    });

    expect(rows).toHaveLength(2);
    expect(rows.map(({ no, name, shape }) => ({ no, name, shape }))).toEqual([
      { no: 1, name: 'Frame', shape: 'Frame' },
      { no: 2, name: 'Shaft', shape: 'shaft' },
    ]);
    expect(rows[0]?.dimensions).toBe('10.0×20.0×30.0 mm');
    expect(rows[0]?.weight_g).toBeCloseTo(15.7);
  });

  it('falls back to the active sketch only when no assembly or cart rows exist', () => {
    const rows = buildWorkspaceBomRows({
      bomParts: [],
      cartItems: [],
      effectiveResult: metric(12, 4),
      isSketchResult: true,
      selectedId: 'box',
      selectedShapeName: 'Custom Sketch',
      materialId: 'aluminum',
    });

    expect(rows).toEqual([
      expect.objectContaining({ no: 1, name: 'Custom Sketch', shape: 'sketch', material: 'aluminum', quantity: 1 }),
    ]);
  });

  it('returns no export rows without a real assembly, cart, or active result', () => {
    expect(buildWorkspaceBomRows({
      bomParts: [],
      cartItems: [],
      effectiveResult: null,
      isSketchResult: false,
      selectedId: 'box',
      selectedShapeName: 'Box',
      materialId: 'steel',
    })).toEqual([]);
  });
});
