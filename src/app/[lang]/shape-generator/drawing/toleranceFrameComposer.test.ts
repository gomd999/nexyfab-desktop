import { describe, it, expect } from 'vitest';
import {
  composeFrame,
  composeBatch,
  parseFrame,
  summarize,
  UNICODE_SYMBOLS,
  ASCII_FALLBACK,
  type ToleranceFrame,
} from './toleranceFrameComposer';

function pos(value: number, datums: string[] = ['A', 'B', 'C']): ToleranceFrame {
  return {
    symbol: 'position',
    toleranceValue: value,
    diameter: true,
    datums: datums.map(d => ({ letter: d })),
  };
}

describe('composeFrame', () => {
  it('position unicode contains ⌖ + Ø', () => {
    const r = composeFrame(pos(0.1));
    expect(r.text).toContain('⌖');
    expect(r.text).toContain('Ø0.1');
  });

  it('ASCII fallback', () => {
    const r = composeFrame(pos(0.1), { unicode: false, separator: ' | ' });
    expect(r.text).toContain('POS');
    expect(r.text).not.toContain('⌖');
  });

  it('material modifier Ⓜ added', () => {
    const r = composeFrame({ ...pos(0.1), materialModifier: 'M' });
    expect(r.text).toContain('Ⓜ');
  });

  it('datum modifier appended', () => {
    const r = composeFrame({ ...pos(0.1), datums: [{ letter: 'A', modifier: 'M' }, { letter: 'B' }, { letter: 'C' }] });
    expect(r.text).toContain('AⓂ');
  });

  it('flatness without datums → ok', () => {
    const r = composeFrame({ symbol: 'flatness', toleranceValue: 0.05, diameter: false, datums: [] });
    expect(r.warnings).toEqual([]);
  });

  it('position without datums → warning', () => {
    const r = composeFrame({ symbol: 'position', toleranceValue: 0.1, diameter: true, datums: [] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('position with full DRF → hasFullDrf true', () => {
    const r = composeFrame(pos(0.1));
    expect(r.hasFullDrf).toBe(true);
  });

  it('Ø on flatness → warning', () => {
    const r = composeFrame({ symbol: 'flatness', toleranceValue: 0.05, diameter: true, datums: [] });
    expect(r.warnings.some(w => w.includes('Ø'))).toBe(true);
  });

  it('separator option respected', () => {
    const r = composeFrame(pos(0.1), { unicode: true, separator: ', ' });
    expect(r.text).toContain(', ');
  });
});

describe('composeBatch', () => {
  it('returns one result per frame', () => {
    const r = composeBatch([pos(0.1), pos(0.2)]);
    expect(r).toHaveLength(2);
  });
});

describe('parseFrame', () => {
  it('round trips position symbol', () => {
    const r = composeFrame(pos(0.1));
    const parsed = parseFrame(r.text);
    expect(parsed?.symbol).toBe('position');
    expect(parsed?.toleranceValue).toBeCloseTo(0.1, 3);
  });

  it('returns null on invalid', () => {
    expect(parseFrame('garbage')).toBeNull();
  });
});

describe('summarize', () => {
  it('reports text + warning count', () => {
    const r = composeFrame(pos(0.1));
    const s = summarize(r);
    expect(s.text).toBe(r.text);
    expect(s.warningCount).toBe(r.warnings.length);
  });
});

describe('SYMBOLS tables', () => {
  it('UNICODE has matching ASCII fallback', () => {
    for (const key of Object.keys(UNICODE_SYMBOLS)) {
      expect(ASCII_FALLBACK[key as keyof typeof UNICODE_SYMBOLS]).toBeDefined();
    }
  });
});
