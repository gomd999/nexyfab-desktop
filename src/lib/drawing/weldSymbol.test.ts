import { describe, it, expect } from 'vitest';
import {
  WeldSymbol,
  validateWeldSymbol,
  formatWeldSymbol,
  weldRenderHint,
} from './weldSymbol';

function base(over: Partial<WeldSymbol> = {}): WeldSymbol {
  return {
    id: 'w1',
    viewportId: 'vp1',
    targetRef: 'edge-7',
    weldType: 'fillet',
    side: 'arrow',
    ...over,
  };
}

describe('formatWeldSymbol', () => {
  it('formats a simple fillet weld', () => {
    expect(formatWeldSymbol(base({ weldType: 'fillet', size: 6 }))).toBe(
      'fillet 6 (arrow)',
    );
  });

  it('formats a bevel weld on both sides', () => {
    expect(
      formatWeldSymbol(base({ weldType: 'bevel', size: 8, side: 'both' })),
    ).toBe('bevel 8 (both)');
  });

  it('formats size with length-pitch as L-P', () => {
    const s = formatWeldSymbol(
      base({ weldType: 'fillet', size: 6, length: 50, pitch: 100 }),
    );
    expect(s).toBe('fillet 6 50-100 (arrow)');
  });

  it('formats length without pitch as plain length', () => {
    expect(formatWeldSymbol(base({ size: 6, length: 50 }))).toBe(
      'fillet 6 50 (arrow)',
    );
  });

  it('includes field weld, all-around, and tail note', () => {
    const s = formatWeldSymbol(
      base({
        weldType: 'vee',
        size: 10,
        side: 'other',
        fieldWeld: true,
        allAround: true,
        tail: 'GMAW',
      }),
    );
    expect(s).toBe('vee 10 (other) all-around field [GMAW]');
  });
});

describe('validateWeldSymbol', () => {
  it('accepts a valid weld', () => {
    const r = validateWeldSymbol(base({ size: 6, length: 50, pitch: 100 }));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects an unknown weld type', () => {
    const r = validateWeldSymbol(
      base({ weldType: 'laser' as unknown as WeldSymbol['weldType'] }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('weldType'))).toBe(true);
  });

  it('rejects an unknown side', () => {
    const r = validateWeldSymbol(
      base({ side: 'left' as unknown as WeldSymbol['side'] }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('side'))).toBe(true);
  });

  it('rejects non-positive size', () => {
    const r = validateWeldSymbol(base({ size: 0 }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('size'))).toBe(true);
  });

  it('rejects pitch without length', () => {
    const r = validateWeldSymbol(base({ pitch: 100 }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('pitch requires length'))).toBe(true);
  });

  it('reports missing required ids', () => {
    const r = validateWeldSymbol(base({ id: '', targetRef: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('id is empty');
    expect(r.errors).toContain('targetRef is empty');
  });
});

describe('weldRenderHint', () => {
  it('maps side, symbol glyph, and annotations', () => {
    const h = weldRenderHint(
      base({ weldType: 'fillet', size: 6, length: 50, pitch: 100, fieldWeld: true }),
    );
    expect(h.sideGlyph).toBe('arrow');
    expect(h.symbol).toBe('\\');
    expect(h.annotations).toContain('size 6');
    expect(h.annotations).toContain('50-100');
    expect(h.annotations).toContain('field');
  });

  it('emits all-around and tail annotations and the spot glyph', () => {
    const h = weldRenderHint(
      base({ weldType: 'spot', side: 'both', allAround: true, tail: 'RSW' }),
    );
    expect(h.symbol).toBe('O');
    expect(h.sideGlyph).toBe('both');
    expect(h.annotations).toContain('all-around');
    expect(h.annotations).toContain('tail:RSW');
  });
});
