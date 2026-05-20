import { describe, it, expect } from 'vitest';
import {
  ColorZoneManager,
  rgbToHex,
  hexToRgb,
  buildTriangleColors,
  PRINTER_PALETTE_BAMBU,
} from './colorZones';

describe('ColorZoneManager — CRUD', () => {
  it('createZone adds a zone', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'red', name: 'Red', color: { r: 1, g: 0, b: 0 } });
    expect(m.listZones()).toHaveLength(1);
  });

  it('removeZone drops the zone + unassigns its faces', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'R', color: { r: 1, g: 0, b: 0 } });
    m.assignFace('face1', 'r');
    m.removeZone('r');
    expect(m.listZones()).toHaveLength(0);
    expect(m.getZoneForFace('face1')).toBeNull();
  });

  it('getZone returns null for unknown id', () => {
    const m = new ColorZoneManager();
    expect(m.getZone('nope')).toBeNull();
  });
});

describe('ColorZoneManager — assignment', () => {
  it('assignFace links face → zone', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'R', color: { r: 1, g: 0, b: 0 } });
    m.assignFace('face1', 'r');
    expect(m.getZoneForFace('face1')?.id).toBe('r');
  });

  it('re-assigning moves face between zones', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'R', color: { r: 1, g: 0, b: 0 } });
    m.createZone({ id: 'b', name: 'B', color: { r: 0, g: 0, b: 1 } });
    m.assignFace('face1', 'r');
    m.assignFace('face1', 'b');
    expect(m.getZoneForFace('face1')?.id).toBe('b');
    expect(m.getZone('r')!.faceIds.size).toBe(0);
    expect(m.getZone('b')!.faceIds.size).toBe(1);
  });

  it('assignFaces batch returns one record per face', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'R', color: { r: 1, g: 0, b: 0 } });
    const records = m.assignFaces(['a', 'b', 'c'], 'r');
    expect(records).toHaveLength(3);
  });

  it('unassignFace orphans the face', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'R', color: { r: 1, g: 0, b: 0 } });
    m.assignFace('f1', 'r');
    m.unassignFace('f1');
    expect(m.getZoneForFace('f1')).toBeNull();
  });
});

describe('ColorZoneManager — undo', () => {
  it('undo reverses a single assignment', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'R', color: { r: 1, g: 0, b: 0 } });
    m.assignFace('f1', 'r');
    m.undo();
    expect(m.getZoneForFace('f1')).toBeNull();
  });

  it('undo restores previous zone after reassignment', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'R', color: { r: 1, g: 0, b: 0 } });
    m.createZone({ id: 'b', name: 'B', color: { r: 0, g: 0, b: 1 } });
    m.assignFace('f1', 'r');
    m.assignFace('f1', 'b');
    m.undo();
    expect(m.getZoneForFace('f1')?.id).toBe('r');
  });

  it('undo on empty history returns null', () => {
    const m = new ColorZoneManager();
    expect(m.undo()).toBeNull();
  });
});

describe('ColorZoneManager — serialization', () => {
  it('round-trips zones', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'Red', color: { r: 1, g: 0, b: 0 }, materialId: 'mat_red' });
    m.assignFace('f1', 'r');
    const json = m.serialize();
    const m2 = new ColorZoneManager();
    m2.load(json);
    expect(m2.listZones()).toHaveLength(1);
    expect(m2.getZoneForFace('f1')?.id).toBe('r');
    expect(m2.getZone('r')?.materialId).toBe('mat_red');
  });

  it('load rejects unknown version', () => {
    const m = new ColorZoneManager();
    expect(() => m.load({ version: 999, zones: [] })).toThrow();
  });
});

describe('rgbToHex / hexToRgb', () => {
  it('rgbToHex pads single-digit channels', () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
  });

  it('round-trips primary red', () => {
    const r = hexToRgb(rgbToHex({ r: 1, g: 0, b: 0 }));
    expect(r.r).toBeCloseTo(1, 2);
  });

  it('hexToRgb handles invalid input', () => {
    const r = hexToRgb('not-a-hex');
    expect(r).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('buildTriangleColors', () => {
  it('maps face ids to zone colors', () => {
    const m = new ColorZoneManager();
    m.createZone({ id: 'r', name: 'R', color: { r: 1, g: 0, b: 0 } });
    m.assignFace('f1', 'r');
    const colors = buildTriangleColors(['f1', 'unassigned', 'f1'], m, { r: 0.5, g: 0.5, b: 0.5 });
    expect(colors[0]!.r).toBe(1);
    expect(colors[1]!.r).toBe(0.5); // fallback
    expect(colors[2]!.r).toBe(1);
  });
});

describe('Standard palettes', () => {
  it('Bambu palette has 6 colors', () => {
    expect(Object.keys(PRINTER_PALETTE_BAMBU)).toHaveLength(6);
  });
});
