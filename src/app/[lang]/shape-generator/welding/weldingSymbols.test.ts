import { describe, it, expect } from 'vitest';
import {
  formatWeldSymbol, parseShortSymbol, renderWeldSymbolSvg,
  WELD_GLYPH, type WeldSymbol,
} from './weldingSymbols';

describe('WELD_GLYPH', () => {
  it('covers all expected weld types', () => {
    expect(WELD_GLYPH.fillet).toBeTruthy();
    expect(WELD_GLYPH['v-groove']).toBeTruthy();
    expect(WELD_GLYPH.spot).toBeTruthy();
  });
});

describe('formatWeldSymbol', () => {
  it('formats fillet size on arrow side', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
    };
    const txt = formatWeldSymbol(s);
    expect(txt).toContain('6');
    expect(txt).toContain(WELD_GLYPH.fillet);
  });

  it('formats intermittent weld with length-pitch', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6, lengthMm: 50, pitchMm: 100 },
    };
    expect(formatWeldSymbol(s)).toContain('-50');
    expect(formatWeldSymbol(s)).toContain('×100');
  });

  it('includes all-around marker when set', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
      allAround: true,
    };
    expect(formatWeldSymbol(s)).toContain('⊙');
  });

  it('includes field-weld flag', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
      fieldWeld: true,
    };
    expect(formatWeldSymbol(s)).toContain('⚑');
  });

  it('includes tail text', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
      tail: 'GMAW',
    };
    expect(formatWeldSymbol(s)).toContain('GMAW');
  });

  it('both-sides shows arrow and other size', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
      otherSide: { sizeMm: 8 },
    };
    expect(formatWeldSymbol(s)).toContain('6');
    expect(formatWeldSymbol(s)).toContain('/8');
  });
});

describe('parseShortSymbol', () => {
  it('parses fillet with size', () => {
    const r = parseShortSymbol('6▷');
    expect(r?.type).toBe('fillet');
    expect(r?.arrowSide?.sizeMm).toBe(6);
  });

  it('parses v-groove', () => {
    const r = parseShortSymbol('5V');
    expect(r?.type).toBe('v-groove');
  });

  it('returns null for garbage input', () => {
    expect(parseShortSymbol('nonsense')).toBeNull();
  });

  it('parses length + pitch', () => {
    const r = parseShortSymbol('6▷ 50-100');
    expect(r?.arrowSide?.lengthMm).toBe(50);
    expect(r?.arrowSide?.pitchMm).toBe(100);
  });
});

describe('renderWeldSymbolSvg', () => {
  it('emits leader + reference line', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
    };
    const prims = renderWeldSymbolSvg(s, 100, 200);
    const lines = prims.filter(p => p.kind === 'line');
    expect(lines).toHaveLength(2);
  });

  it('emits text glyph for the size', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
    };
    const prims = renderWeldSymbolSvg(s, 100, 200);
    const text = prims.find(p => p.kind === 'text');
    expect(text).toBeDefined();
    expect(text!.text).toContain('6');
  });

  it('emits circle for all-around', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
      allAround: true,
    };
    const prims = renderWeldSymbolSvg(s, 100, 200);
    expect(prims.some(p => p.kind === 'circle')).toBe(true);
  });

  it('emits tail text when provided', () => {
    const s: WeldSymbol = {
      type: 'fillet',
      standard: 'AWS',
      arrowSide: { sizeMm: 6 },
      tail: 'GMAW',
    };
    const prims = renderWeldSymbolSvg(s, 100, 200);
    expect(prims.some(p => p.kind === 'text' && p.text === 'GMAW')).toBe(true);
  });
});
