/**
 * K4 — hole realization gate: explicit hole demands in the request must
 * materialize as subtracted round features in the composed intent.
 */
import { describe, expect, it } from 'vitest';
import { extractHoleSpec, gateHoleRealization } from './hole-realization.mjs';

const subCyl = (diameter: number, extra: Record<string, unknown> = {}) =>
  ({ kind: 'cylinder', op: 'subtract', diameter, height: 10, ...extra });

describe('extractHoleSpec', () => {
  it('parses Korean count + phi diameter', () => {
    expect(extractHoleSpec('베이스 플레이트에 Φ8 구멍 4개')).toEqual([
      { count: 4, diameter: 8, source: expect.stringContaining('Φ8') },
    ]);
  });
  it('parses NxD combo and metric thread nominal', () => {
    expect(extractHoleSpec('4x M6 홀 가공')).toEqual([
      { count: 4, diameter: 6, source: expect.any(String) },
    ]);
  });
  it('parses count-only and diameter-only demands', () => {
    expect(extractHoleSpec('구멍 3개 뚫어줘')).toEqual([
      { count: 3, diameter: null, source: expect.any(String) },
    ]);
    expect(extractHoleSpec('지름 12 구멍이 필요하다')).toEqual([
      { count: null, diameter: 12, source: expect.any(String) },
    ]);
  });
  it('skips negated clauses and hole-free text', () => {
    expect(extractHoleSpec('구멍 없이 매끈한 판재')).toEqual([]);
    expect(extractHoleSpec('100x50x10 플레이트')).toEqual([]);
  });
});

describe('gateHoleRealization', () => {
  const spec = [{ count: 4, diameter: 8, source: 'Φ8 구멍 4개' }];

  it('passes when subtract cylinders realize the demand (incl. patterns)', () => {
    const four = { features: [subCyl(8), subCyl(8), subCyl(8), subCyl(8)] };
    expect(gateHoleRealization(four, spec)).toEqual([]);
    const patterned = { features: [subCyl(8, { pattern: { type: 'circular', count: 4 } })] };
    expect(gateHoleRealization(patterned, spec)).toEqual([]);
  });

  it('fails when holes are missing, wrong-diameter, or additive', () => {
    expect(gateHoleRealization({ features: [] }, spec)).toHaveLength(1);
    expect(gateHoleRealization({ features: [subCyl(20), subCyl(20)] }, spec)).toHaveLength(1);
    const additive = { features: [{ kind: 'cylinder', op: 'add', diameter: 8, height: 10 }] };
    expect(gateHoleRealization(additive, spec)).toHaveLength(1);
  });

  it('count-only demand accepts any round subtract; empty spec never gates', () => {
    expect(gateHoleRealization({ features: [subCyl(5), subCyl(9)] }, [{ count: 2, diameter: null, source: 'x' }])).toEqual([]);
    expect(gateHoleRealization({ features: [] }, [])).toEqual([]);
  });
});
