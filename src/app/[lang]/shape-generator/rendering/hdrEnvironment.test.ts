import { describe, it, expect } from 'vitest';
import {
  HDR_PRESETS,
  findHdrPreset,
  listHdrPresets,
  PMREM_PRESETS,
  pmremConfigFor,
  MAX_HDR_DIMENSION,
} from './hdrEnvironment';

describe('HDR_PRESETS · catalogue', () => {
  it('ships at least 5 curated environments covering common moods', () => {
    expect(HDR_PRESETS.length).toBeGreaterThanOrEqual(5);
    const moods = new Set(HDR_PRESETS.map(p => p.mood));
    expect(moods.has('studio')).toBe(true);
    expect(moods.has('outdoor')).toBe(true);
  });

  it('every preset has the required fields populated', () => {
    for (const p of HDR_PRESETS) {
      expect(p.id).toMatch(/.+/);
      expect(p.hdrUrl).toMatch(/\.hdr$/);
      expect(p.thumbUrl.length).toBeGreaterThan(0);
      expect(p.swatch).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(typeof p.defaultExposure).toBe('number');
    }
  });

  it('preset ids are unique', () => {
    const ids = HDR_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('findHdrPreset', () => {
  it('returns the preset matching the id', () => {
    const p = findHdrPreset('studio-softbox');
    expect(p?.id).toBe('studio-softbox');
  });

  it('returns null for unknown id', () => {
    expect(findHdrPreset('ghost')).toBeNull();
  });
});

describe('listHdrPresets', () => {
  it('returns the full catalogue when no mood given', () => {
    expect(listHdrPresets().length).toBe(HDR_PRESETS.length);
  });

  it('"all" matches the full catalogue', () => {
    expect(listHdrPresets('all').length).toBe(HDR_PRESETS.length);
  });

  it('filters by mood', () => {
    const outdoor = listHdrPresets('outdoor');
    expect(outdoor.length).toBeGreaterThan(0);
    expect(outdoor.every(p => p.mood === 'outdoor')).toBe(true);
  });

  it('returns empty for moods with no presets', () => {
    expect(listHdrPresets('sunset').length).toBeGreaterThan(0); // sunset HAS one
  });
});

describe('PMREM_PRESETS', () => {
  it('three quality tiers in ascending cubemap size', () => {
    expect(PMREM_PRESETS.preview.cubeSize).toBeLessThan(PMREM_PRESETS.standard.cubeSize);
    expect(PMREM_PRESETS.standard.cubeSize).toBeLessThan(PMREM_PRESETS.hiQuality.cubeSize);
  });

  it('hi-quality has more roughness levels than preview', () => {
    expect(PMREM_PRESETS.hiQuality.levels).toBeGreaterThan(PMREM_PRESETS.preview.levels);
  });
});

describe('pmremConfigFor', () => {
  it('returns the requested tier when known', () => {
    expect(pmremConfigFor('preview')).toEqual(PMREM_PRESETS.preview);
    expect(pmremConfigFor('hiQuality')).toEqual(PMREM_PRESETS.hiQuality);
  });

  it('falls back to standard for unknown quality strings', () => {
    expect(pmremConfigFor('eight-million-rays')).toEqual(PMREM_PRESETS.standard);
  });
});

describe('MAX_HDR_DIMENSION', () => {
  it('is a sane upper bound (≥ 1024)', () => {
    expect(MAX_HDR_DIMENSION).toBeGreaterThanOrEqual(1024);
  });
});
