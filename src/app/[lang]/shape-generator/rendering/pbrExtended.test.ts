import { describe, it, expect } from 'vitest';
import {
  EXTENDED_PRESETS,
  applyExtendedOverlay,
  sanitiseExtended,
  stripUndefined,
} from './pbrExtended';
import { MATERIAL_PRESETS, type MaterialPreset } from '../materials';

const aluminum = MATERIAL_PRESETS.find(p => p.id === 'aluminum')!;

describe('EXTENDED_PRESETS · catalogue', () => {
  it('ships the canonical advanced-BRDF presets', () => {
    for (const id of ['automotive_paint', 'brushed_aluminum', 'velvet', 'iridescent']) {
      expect(EXTENDED_PRESETS).toHaveProperty(id);
    }
  });

  it('automotive_paint has clearcoat lobe with low roughness', () => {
    const p = EXTENDED_PRESETS.automotive_paint;
    expect(p.clearcoat).toBe(1.0);
    expect(p.clearcoatRoughness).toBeLessThan(0.1);
  });

  it('brushed_aluminum carries anisotropy', () => {
    expect(EXTENDED_PRESETS.brushed_aluminum.anisotropy).toBeGreaterThan(0);
  });

  it('iridescent specifies a thin-film thickness in nanometres', () => {
    const p = EXTENDED_PRESETS.iridescent;
    expect(p.iridescence).toBe(1.0);
    expect(p.iridescenceThicknessNm).toBeGreaterThan(0);
  });
});

describe('applyExtendedOverlay', () => {
  it('preserves base material fields', () => {
    const ext = applyExtendedOverlay(aluminum, 'brushed_aluminum');
    expect(ext.id).toBe('aluminum');
    expect(ext.metalness).toBe(aluminum.metalness);
    expect(ext.roughness).toBe(aluminum.roughness);
  });

  it('overlays the extended fields onto the base', () => {
    const ext = applyExtendedOverlay(aluminum, 'brushed_aluminum');
    expect(ext.anisotropy).toBe(0.8);
  });

  it('a clearcoat overlay does not affect anisotropy', () => {
    const ext = applyExtendedOverlay(aluminum, 'automotive_paint');
    expect(ext.clearcoat).toBe(1.0);
    expect(ext.anisotropy).toBeUndefined();
  });
});

describe('sanitiseExtended', () => {
  it('clamps clearcoat to [0, 1]', () => {
    expect(sanitiseExtended({ clearcoat: 1.5 }).clearcoat).toBe(1);
    expect(sanitiseExtended({ clearcoat: -0.5 }).clearcoat).toBe(0);
  });

  it('clamps anisotropy to [-1, 1]', () => {
    expect(sanitiseExtended({ anisotropy: 2 }).anisotropy).toBe(1);
    expect(sanitiseExtended({ anisotropy: -2 }).anisotropy).toBe(-1);
  });

  it('rejects non-finite values (NaN, Infinity)', () => {
    expect(sanitiseExtended({ clearcoat: NaN }).clearcoat).toBeUndefined();
    expect(sanitiseExtended({ anisotropy: Infinity }).anisotropy).toBeUndefined();
  });

  it('rejects non-numeric values', () => {
    expect(sanitiseExtended({ clearcoat: 'shiny' as unknown as number }).clearcoat).toBeUndefined();
  });

  it('rejects iridescence IOR below 1', () => {
    expect(sanitiseExtended({ iridescenceIOR: 0.5 }).iridescenceIOR).toBeUndefined();
    expect(sanitiseExtended({ iridescenceIOR: 1.3 }).iridescenceIOR).toBe(1.3);
  });

  it('rejects non-positive thin-film thickness', () => {
    expect(sanitiseExtended({ iridescenceThicknessNm: 0 }).iridescenceThicknessNm).toBeUndefined();
    expect(sanitiseExtended({ iridescenceThicknessNm: -100 }).iridescenceThicknessNm).toBeUndefined();
  });

  it('preserves sheenColor string and rejects non-strings', () => {
    expect(sanitiseExtended({ sheenColor: '#abcdef' }).sheenColor).toBe('#abcdef');
    expect(sanitiseExtended({ sheenColor: 123 as unknown as string }).sheenColor).toBeUndefined();
  });
});

describe('stripUndefined', () => {
  it('removes undefined fields from the output', () => {
    const out = stripUndefined({ clearcoat: 1, clearcoatRoughness: undefined, sheen: 0.5 });
    expect(out).toEqual({ clearcoat: 1, sheen: 0.5 });
  });

  it('returns an empty object when all fields are undefined', () => {
    expect(stripUndefined({})).toEqual({});
  });
});

describe('integration · use overlay + sanitise', () => {
  it('user-supplied overrides survive sanitise + overlay merge', () => {
    const user = sanitiseExtended({
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      anisotropy: 0.3,
    });
    const merged: MaterialPreset & typeof user = { ...aluminum, ...user };
    expect(merged.clearcoat).toBe(0.5);
    expect(merged.anisotropy).toBe(0.3);
    expect(merged.metalness).toBe(aluminum.metalness);
  });
});
