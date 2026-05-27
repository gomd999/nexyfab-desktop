import { describe, it, expect } from 'vitest';
import {
  pickSheet,
  estimateMultiViewBounds,
  summarize,
  ISO_SIZES,
  ANSI_SIZES,
} from './sheetFormatPicker';

describe('pickSheet ISO', () => {
  it('tiny content → A4', () => {
    const r = pickSheet({ widthMm: 100, heightMm: 50 }, { standard: 'iso' });
    expect(r.size.format).toBe('A4');
    expect(r.fits).toBe(true);
  });

  it('A3 picked when A4 too small', () => {
    const r = pickSheet({ widthMm: 380, heightMm: 200 }, { standard: 'iso' });
    expect(r.size.format).toBe('A3');
  });

  it('uses portrait when content is tall', () => {
    const r = pickSheet({ widthMm: 100, heightMm: 250 }, { standard: 'iso' });
    expect(r.orientation).toBe('portrait');
  });

  it('large content → A0', () => {
    const r = pickSheet({ widthMm: 1100, heightMm: 700 }, { standard: 'iso' });
    expect(r.size.format).toBe('A0');
  });

  it('does not fit anywhere → fits=false', () => {
    const r = pickSheet({ widthMm: 5000, heightMm: 5000 }, { standard: 'iso' });
    expect(r.fits).toBe(false);
  });

  it('packing density is fraction', () => {
    const r = pickSheet({ widthMm: 100, heightMm: 50 }, { standard: 'iso' });
    expect(r.packingDensity).toBeGreaterThan(0);
    expect(r.packingDensity).toBeLessThan(1);
  });

  it('usable area accounts for title block', () => {
    const r = pickSheet({ widthMm: 100, heightMm: 50 }, {
      standard: 'iso', titleBlockHeightMm: 60, marginMm: 10, titleBlockWidthMm: 170, allowRotation: true,
    });
    expect(r.usableHeightMm).toBeLessThan(r.size.heightMm);
  });
});

describe('pickSheet ANSI', () => {
  it('tiny content → ANSI-A', () => {
    const r = pickSheet({ widthMm: 100, heightMm: 50 }, { standard: 'ansi' });
    expect(r.size.format).toBe('ANSI-A');
  });

  it('ANSI-B picked for medium content', () => {
    const r = pickSheet({ widthMm: 350, heightMm: 150 }, { standard: 'ansi' });
    expect(r.size.format).toBe('ANSI-B');
  });
});

describe('estimateMultiViewBounds', () => {
  it('empty → 0×0', () => {
    expect(estimateMultiViewBounds([])).toEqual({ widthMm: 0, heightMm: 0 });
  });

  it('single view fills its own bbox', () => {
    const b = estimateMultiViewBounds([{ id: 'v1', widthMm: 100, heightMm: 50 }], 0);
    expect(b.widthMm).toBeGreaterThanOrEqual(100);
  });

  it('multiple views produce a larger bbox', () => {
    const b = estimateMultiViewBounds([
      { id: 'v1', widthMm: 100, heightMm: 50 },
      { id: 'v2', widthMm: 100, heightMm: 50 },
      { id: 'v3', widthMm: 100, heightMm: 50 },
      { id: 'v4', widthMm: 100, heightMm: 50 },
    ], 10);
    expect(b.widthMm).toBeGreaterThan(100);
    expect(b.heightMm).toBeGreaterThan(50);
  });
});

describe('sheet size constants', () => {
  it('ISO sizes sorted ascending by area', () => {
    for (let i = 1; i < ISO_SIZES.length; i++) {
      const prev = ISO_SIZES[i - 1]!;
      const curr = ISO_SIZES[i]!;
      expect(curr.widthMm * curr.heightMm).toBeGreaterThan(prev.widthMm * prev.heightMm);
    }
  });

  it('ANSI sizes sorted ascending', () => {
    for (let i = 1; i < ANSI_SIZES.length; i++) {
      const prev = ANSI_SIZES[i - 1]!;
      const curr = ANSI_SIZES[i]!;
      expect(curr.widthMm * curr.heightMm).toBeGreaterThan(prev.widthMm * prev.heightMm);
    }
  });
});

describe('summarize', () => {
  it('reports format + orientation + usable area', () => {
    const r = pickSheet({ widthMm: 100, heightMm: 50 }, { standard: 'iso' });
    const s = summarize(r);
    expect(s.format).toBe('A4');
    expect(s.usableAreaMm2).toBeGreaterThan(0);
  });

  it('fits flag passed through', () => {
    const r = pickSheet({ widthMm: 5000, heightMm: 5000 }, { standard: 'iso' });
    expect(summarize(r).fits).toBe(false);
  });
});
