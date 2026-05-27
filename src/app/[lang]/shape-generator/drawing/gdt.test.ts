import { describe, it, expect } from 'vitest';
import {
  GDT_SYMBOLS,
  GDT_MODIFIERS,
  formatFeatureControlFrame,
  formatBasicDimension,
  formatReferenceDimension,
  gdtSymbolsByCategory,
  type FeatureControlFrame,
} from './gdt';

describe('GDT_SYMBOLS coverage (ASME Y14.5)', () => {
  it('has all 14 standard characteristics', () => {
    expect(GDT_SYMBOLS).toHaveLength(14);
  });

  it('groups into the five ASME categories with correct counts', () => {
    const g = gdtSymbolsByCategory();
    expect(g.form).toHaveLength(4);
    expect(g.profile).toHaveLength(2);
    expect(g.orientation).toHaveLength(3);
    expect(g.location).toHaveLength(3);
    expect(g.runout).toHaveLength(2);
  });

  it('flags legacy ASME Y14.5-2018 deprecations', () => {
    expect(GDT_SYMBOLS.find(s => s.id === 'concentricity')?.legacyAsme).toBe(true);
    expect(GDT_SYMBOLS.find(s => s.id === 'symmetry')?.legacyAsme).toBe(true);
    expect(GDT_SYMBOLS.find(s => s.id === 'position')?.legacyAsme).toBeUndefined();
  });

  it('marks orientation/location/runout symbols as datum-required', () => {
    for (const s of GDT_SYMBOLS) {
      if (s.category === 'orientation' || s.category === 'runout') {
        expect(s.requiresDatum).toBe(true);
      }
    }
  });

  it('position is the only symbol with implicit diameter prefix', () => {
    const withDia = GDT_SYMBOLS.filter(s => s.needsDiameter);
    expect(withDia).toHaveLength(1);
    expect(withDia[0].id).toBe('position');
  });
});

describe('GDT_MODIFIERS coverage', () => {
  it('includes the 4 high-frequency modifiers and 3 less common', () => {
    const ids = GDT_MODIFIERS.map(m => m.id);
    expect(ids).toContain('mmc');
    expect(ids).toContain('lmc');
    expect(ids).toContain('rfs');
    expect(ids).toContain('projected');
    expect(ids).toContain('freeState');
    expect(ids).toContain('tangentPlane');
    expect(ids).toContain('independency');
  });

  it('marks projected tolerance zone as length-carrying', () => {
    expect(GDT_MODIFIERS.find(m => m.id === 'projected')?.carriesLength).toBe(true);
    expect(GDT_MODIFIERS.find(m => m.id === 'mmc')?.carriesLength).toBeUndefined();
  });
});

describe('formatFeatureControlFrame', () => {
  it('renders position with MMC and three datums (classic hole pattern)', () => {
    const f: FeatureControlFrame = {
      symbolId: 'position',
      tolerance: 0.1,
      modifier: 'mmc',
      datums: ['A', 'B', 'C'],
    };
    expect(formatFeatureControlFrame(f)).toBe('⊕ ⌀0.1 Ⓜ A B C');
  });

  it('omits absent datum slots', () => {
    const f: FeatureControlFrame = {
      symbolId: 'parallelism',
      tolerance: 0.05,
      datums: ['A', undefined, undefined],
    };
    expect(formatFeatureControlFrame(f)).toBe('∥ 0.05 A');
  });

  it('writes projected tolerance length after the Ⓟ symbol', () => {
    const f: FeatureControlFrame = {
      symbolId: 'position',
      tolerance: 0.2,
      modifier: 'projected',
      modifierLength: 25,
      datums: ['A'],
    };
    expect(formatFeatureControlFrame(f)).toBe('⊕ ⌀0.2 Ⓟ25 A');
  });

  it('honours an explicit diameter override even when symbol lacks it', () => {
    const f: FeatureControlFrame = {
      symbolId: 'parallelism',
      tolerance: 0.1,
      diameter: true,
      datums: ['A'],
    };
    expect(formatFeatureControlFrame(f)).toBe('∥ ⌀0.1 A');
  });

  it('renders composite frame with pattern + feature-relating rows', () => {
    const f: FeatureControlFrame = {
      symbolId: 'position',
      tolerance: 0.4,
      datums: ['A', 'B', 'C'],
      secondRow: {
        tolerance: 0.1,
        diameter: true,
        datums: ['A'],
      },
    };
    expect(formatFeatureControlFrame(f)).toBe('⊕ ⌀0.4 A B C | ⌀0.1 A');
  });

  it('returns empty string for an unknown symbol id', () => {
    const f = { symbolId: 'nonexistent' as never, tolerance: 0.1 };
    expect(formatFeatureControlFrame(f)).toBe('');
  });
});

describe('basic / reference dimensions', () => {
  it('wraps basic dimensions in the rectangle glyph', () => {
    expect(formatBasicDimension(25)).toBe('⎕25⎕');
  });

  it('wraps reference dimensions in parentheses', () => {
    expect(formatReferenceDimension(50.4)).toBe('(50.4)');
  });
});
