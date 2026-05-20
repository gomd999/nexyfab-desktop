import { describe, it, expect } from 'vitest';
import {
  generateVariants,
  priceVariants,
  groupVariants,
  combineFilters,
  pairConstraint,
  variantsToCsv,
  type VariantAxis,
} from './configurationVariants';

describe('generateVariants — enum axes', () => {
  it('cartesian product of 2 enum axes', () => {
    const axes: VariantAxis[] = [
      { id: 'size', kind: 'enum', values: ['S', 'M', 'L'] },
      { id: 'color', kind: 'enum', values: ['red', 'blue'] },
    ];
    const r = generateVariants(axes);
    expect(r.variants).toHaveLength(6);
  });

  it('each variant has a unique id', () => {
    const axes: VariantAxis[] = [
      { id: 'size', kind: 'enum', values: ['S', 'M', 'L'] },
    ];
    const r = generateVariants(axes);
    const ids = new Set(r.variants.map(v => v.id));
    expect(ids.size).toBe(3);
  });

  it('boolean axis materializes false then true', () => {
    const axes: VariantAxis[] = [
      { id: 'logo', kind: 'boolean' },
    ];
    const r = generateVariants(axes);
    expect(r.variants).toHaveLength(2);
    expect(r.variants[0]!.values.logo).toBe(false);
    expect(r.variants[1]!.values.logo).toBe(true);
  });
});

describe('generateVariants — range axes', () => {
  it('emits range values at correct step', () => {
    const axes: VariantAxis[] = [
      { id: 'thickness', kind: 'range', min: 1, max: 3, step: 0.5 },
    ];
    const r = generateVariants(axes);
    expect(r.variants.map(v => v.values.thickness)).toEqual([1, 1.5, 2, 2.5, 3]);
  });
});

describe('generateVariants — derived axes', () => {
  it('derived axis is computed from primary', () => {
    const axes: VariantAxis[] = [
      { id: 'd', kind: 'range', min: 2, max: 6, step: 2 },
      { id: 'area', kind: 'derived', compute: (vals) => Math.PI * Math.pow((vals.d as number) / 2, 2) },
    ];
    const r = generateVariants(axes);
    expect(r.variants).toHaveLength(3);
    expect(r.variants[0]!.derived.area).toBeCloseTo(Math.PI, 5);
  });
});

describe('maxVariants cap + truncation', () => {
  it('hits cap and reports truncated', () => {
    const axes: VariantAxis[] = [
      { id: 'a', kind: 'range', min: 0, max: 99, step: 1 },
    ];
    const r = generateVariants(axes, { maxVariants: 10 });
    expect(r.variants).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });
});

describe('filter', () => {
  it('drops variants where filter returns false', () => {
    const axes: VariantAxis[] = [
      { id: 'size', kind: 'enum', values: ['S', 'M', 'L'] },
    ];
    const r = generateVariants(axes, { filter: (v) => v.values.size !== 'M' });
    expect(r.variants).toHaveLength(2);
    expect(r.filtered).toBe(1);
  });
});

describe('priceVariants', () => {
  it('attaches priceUsd to each variant', () => {
    const variants = generateVariants([
      { id: 'size', kind: 'enum', values: ['S', 'M', 'L'] },
    ]).variants;
    const priced = priceVariants(variants, { price: (v) => v.values.size === 'L' ? 30 : 10 });
    expect(priced.find(v => v.values.size === 'L')?.priceUsd).toBe(30);
  });

  it('mass + lead-time included when provided', () => {
    const variants = generateVariants([
      { id: 'size', kind: 'enum', values: ['S'] },
    ]).variants;
    const priced = priceVariants(variants, {
      price: () => 10,
      massGrams: () => 200,
      leadTimeDays: () => 5,
    });
    expect(priced[0]!.massGrams).toBe(200);
    expect(priced[0]!.leadTimeDays).toBe(5);
  });
});

describe('groupVariants', () => {
  it('groups by axis value', () => {
    const variants = generateVariants([
      { id: 'size', kind: 'enum', values: ['S', 'M', 'L'] },
      { id: 'color', kind: 'enum', values: ['red', 'blue'] },
    ]).variants;
    const priced = priceVariants(variants, { price: () => 10 });
    const g = groupVariants(priced, 'size');
    expect(g.groups.size).toBe(3);
    expect(g.groups.get('S')).toHaveLength(2);
  });
});

describe('filter helpers', () => {
  it('combineFilters → all must pass', () => {
    const f = combineFilters(
      (v) => v.values.a === 1,
      (v) => v.values.b !== 99,
    );
    expect(f({ id: 'x', values: { a: 1, b: 5 }, derived: {} })).toBe(true);
    expect(f({ id: 'x', values: { a: 1, b: 99 }, derived: {} })).toBe(false);
    expect(f({ id: 'x', values: { a: 2, b: 5 }, derived: {} })).toBe(false);
  });

  it('pairConstraint enforces dependent axis', () => {
    const f = pairConstraint('size', 'L', 'color', ['red']);
    expect(f({ id: 'x', values: { size: 'L', color: 'red' }, derived: {} })).toBe(true);
    expect(f({ id: 'x', values: { size: 'L', color: 'blue' }, derived: {} })).toBe(false);
    expect(f({ id: 'x', values: { size: 'M', color: 'blue' }, derived: {} })).toBe(true);
  });
});

describe('variantsToCsv', () => {
  it('emits header + one row per variant', () => {
    const variants = generateVariants([
      { id: 'size', kind: 'enum', values: ['S', 'M'] },
    ]).variants;
    const priced = priceVariants(variants, { price: () => 10 });
    const csv = variantsToCsv(priced);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('empty input returns empty string', () => {
    expect(variantsToCsv([])).toBe('');
  });
});
