import { describe, it, expect } from 'vitest';
import {
  validateSurfaceFinish,
  formatSurfaceFinish,
  surfaceFinishRenderHint,
  type SurfaceFinishSymbol,
} from './surfaceFinishSymbol';

function base(overrides: Partial<SurfaceFinishSymbol> = {}): SurfaceFinishSymbol {
  return {
    id: 'sf1',
    viewportId: 'vp1',
    targetRef: 'face_12',
    kind: 'machining_required',
    ...overrides,
  };
}

describe('formatSurfaceFinish', () => {
  it('formats a single Ra max', () => {
    expect(formatSurfaceFinish(base({ raMax: 3.2 }))).toBe('Ra 3.2');
  });

  it('formats an Ra range with production method', () => {
    expect(
      formatSurfaceFinish(base({ raMin: 0.8, raMax: 3.2, productionMethod: 'milled' })),
    ).toBe('Ra 0.8..3.2 milled');
  });

  it('marks machining prohibited', () => {
    const out = formatSurfaceFinish(base({ kind: 'machining_prohibited' }));
    expect(out).toBe('machining prohibited');
  });

  it('includes lay and all-around indicators', () => {
    const out = formatSurfaceFinish(
      base({ raMax: 1.6, lay: 'X', allAround: true }),
    );
    expect(out).toContain('lay X');
    expect(out).toContain('all-around');
    expect(out).toContain('Ra 1.6');
  });

  it('includes sampling length', () => {
    expect(formatSurfaceFinish(base({ raMax: 3.2, samplingLength: 0.8 }))).toContain('L=0.8');
  });
});

describe('validateSurfaceFinish', () => {
  it('accepts a valid symbol', () => {
    const r = validateSurfaceFinish(base({ raMin: 0.4, raMax: 1.6, lay: '=' }));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects an unknown kind', () => {
    const r = validateSurfaceFinish(base({ kind: 'engraved' as never }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('unknown kind'))).toBe(true);
  });

  it('rejects raMin > raMax', () => {
    const r = validateSurfaceFinish(base({ raMin: 6.3, raMax: 1.6 }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('raMin'))).toBe(true);
  });

  it('rejects non-positive raMax', () => {
    const r = validateSurfaceFinish(base({ raMax: 0 }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('raMax must be > 0'))).toBe(true);
  });

  it('rejects unknown lay and empty refs', () => {
    const r = validateSurfaceFinish(
      base({ targetRef: '', lay: 'Z' as never }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('targetRef'))).toBe(true);
    expect(r.errors.some((e) => e.includes('unknown lay'))).toBe(true);
  });
});

describe('surfaceFinishRenderHint', () => {
  it('uses the machined glyph for machining_required', () => {
    expect(surfaceFinishRenderHint(base({ raMax: 3.2 })).glyph).toBe('machined');
  });

  it('uses the basic glyph for basic', () => {
    expect(surfaceFinishRenderHint(base({ kind: 'basic' })).glyph).toBe('basic');
  });

  it('uses the prohibited glyph for machining_prohibited', () => {
    expect(
      surfaceFinishRenderHint(base({ kind: 'machining_prohibited' })).glyph,
    ).toBe('prohibited');
  });

  it('stacks production method, Ra and lay lines', () => {
    const hint = surfaceFinishRenderHint(
      base({ productionMethod: 'ground', raMax: 0.8, lay: 'C' }),
    );
    expect(hint.lines).toEqual(['ground', 'Ra 0.8', 'lay C']);
  });
});
