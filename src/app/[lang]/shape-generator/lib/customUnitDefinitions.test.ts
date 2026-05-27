import { describe, it, expect } from 'vitest';
import {
  createRegistry,
  defineUnit,
  getUnit,
  removeUnit,
  listUnits,
  convert,
  toJSON,
  fromJSON,
  summarize,
  BASE_UNITS,
} from './customUnitDefinitions';

describe('createRegistry', () => {
  it('starts with base units only', () => {
    const r = createRegistry();
    expect(r.units.size).toBe(0);
    expect(r.baseUnits.size).toBe(BASE_UNITS.length);
  });
});

describe('defineUnit', () => {
  it('creates a custom unit', () => {
    const r = createRegistry();
    const u = defineUnit(r, 'kgf-m', {
      label: 'kgf·m',
      composition: [{ baseSymbol: 'kgf', exponent: 1 }, { baseSymbol: 'm', exponent: 1 }],
    });
    expect(u.label).toBe('kgf·m');
    expect(r.units.has('kgf-m')).toBe(true);
  });

  it('explicitSiFactor override respected', () => {
    const r = createRegistry();
    const u = defineUnit(r, 'rpm', {
      label: 'rpm',
      composition: [{ baseSymbol: 'rev', exponent: 1 }, { baseSymbol: 'min', exponent: -1 }],
      explicitSiFactor: 2 * Math.PI / 60,
    });
    expect(u.explicitSiFactor).toBeCloseTo(2 * Math.PI / 60, 5);
  });

  it('single base unit inherits quantity', () => {
    const r = createRegistry();
    const u = defineUnit(r, 'm-only', {
      label: 'meter',
      composition: [{ baseSymbol: 'm', exponent: 1 }],
    });
    expect(u.quantity).toBe('length');
  });

  it('composite gets derived quantity', () => {
    const r = createRegistry();
    const u = defineUnit(r, 'N-m', {
      label: 'N·m',
      composition: [{ baseSymbol: 'N', exponent: 1 }, { baseSymbol: 'm', exponent: 1 }],
    });
    expect(u.quantity).toBe('derived');
  });
});

describe('getUnit + removeUnit + listUnits', () => {
  it('getUnit finds defined unit', () => {
    const r = createRegistry();
    defineUnit(r, 'x', { label: 'x', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    expect(getUnit(r, 'x')).not.toBeNull();
  });

  it('getUnit returns null for unknown', () => {
    expect(getUnit(createRegistry(), 'ghost')).toBeNull();
  });

  it('removeUnit removes', () => {
    const r = createRegistry();
    defineUnit(r, 'x', { label: 'x', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    expect(removeUnit(r, 'x')).toBe(true);
    expect(getUnit(r, 'x')).toBeNull();
  });

  it('listUnits returns all custom units', () => {
    const r = createRegistry();
    defineUnit(r, 'a', { label: 'a', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    defineUnit(r, 'b', { label: 'b', composition: [{ baseSymbol: 'kg', exponent: 1 }] });
    expect(listUnits(r)).toHaveLength(2);
  });
});

describe('convert', () => {
  it('converts between same-quantity units', () => {
    const r = createRegistry();
    defineUnit(r, 'm-only', { label: 'm', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    defineUnit(r, 'mm-only', { label: 'mm', composition: [{ baseSymbol: 'mm', exponent: 1 }] });
    const result = convert(r, 1, 'm-only', 'mm-only');
    expect(result.ok).toBe(true);
    expect(result.value).toBeCloseTo(1000, 2);
  });

  it('error on unknown source', () => {
    const r = createRegistry();
    defineUnit(r, 'm-only', { label: 'm', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    const result = convert(r, 1, 'ghost', 'm-only');
    expect(result.ok).toBe(false);
  });

  it('error on quantity mismatch', () => {
    const r = createRegistry();
    defineUnit(r, 'm-only', { label: 'm', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    defineUnit(r, 'kg-only', { label: 'kg', composition: [{ baseSymbol: 'kg', exponent: 1 }] });
    const result = convert(r, 1, 'm-only', 'kg-only');
    expect(result.ok).toBe(false);
  });

  it('SI value reported', () => {
    const r = createRegistry();
    defineUnit(r, 'mm-only', { label: 'mm', composition: [{ baseSymbol: 'mm', exponent: 1 }] });
    defineUnit(r, 'm-only', { label: 'm', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    const result = convert(r, 1000, 'mm-only', 'm-only');
    expect(result.siValue).toBeCloseTo(1, 3);
  });
});

describe('serialization', () => {
  it('toJSON round-trips via fromJSON', () => {
    const r1 = createRegistry();
    defineUnit(r1, 'x', { label: 'x', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    const json = toJSON(r1);
    const r2 = createRegistry();
    const count = fromJSON(r2, json);
    expect(count).toBe(1);
    expect(getUnit(r2, 'x')?.label).toBe('x');
  });

  it('malformed JSON → returns 0', () => {
    const r = createRegistry();
    expect(fromJSON(r, 'not json')).toBe(0);
  });
});

describe('summarize', () => {
  it('empty registry', () => {
    const s = summarize(createRegistry());
    expect(s.customUnitCount).toBe(0);
  });

  it('counts derived units', () => {
    const r = createRegistry();
    defineUnit(r, 'a', { label: 'a', composition: [{ baseSymbol: 'm', exponent: 1 }] });
    defineUnit(r, 'b', { label: 'b', composition: [{ baseSymbol: 'm', exponent: 1 }, { baseSymbol: 'kg', exponent: 1 }] });
    const s = summarize(r);
    expect(s.derivedCount).toBe(1);
  });
});
