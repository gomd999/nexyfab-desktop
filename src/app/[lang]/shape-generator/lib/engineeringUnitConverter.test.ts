import { describe, it, expect } from 'vitest';
import {
  UNIT_LIBRARY,
  findUnit,
  listForQuantity,
  convert,
  parseQuantity,
  summarize,
} from './engineeringUnitConverter';

describe('findUnit', () => {
  it('finds mm', () => {
    const u = findUnit('mm');
    expect(u).not.toBeNull();
    expect(u!.quantity).toBe('length');
  });

  it('returns null for unknown', () => {
    expect(findUnit('xyz')).toBeNull();
  });
});

describe('listForQuantity', () => {
  it('returns all length units', () => {
    const list = listForQuantity('length');
    expect(list.length).toBeGreaterThan(3);
    for (const u of list) expect(u.quantity).toBe('length');
  });

  it('returns force units', () => {
    expect(listForQuantity('force').length).toBeGreaterThanOrEqual(3);
  });
});

describe('convert', () => {
  it('mm → m', () => {
    const r = convert(1000, 'mm', 'm');
    expect(r.value).toBeCloseTo(1, 5);
    expect(r.ok).toBe(true);
  });

  it('inch → mm', () => {
    const r = convert(1, 'in', 'mm');
    expect(r.value).toBeCloseTo(25.4, 5);
  });

  it('lbf → N', () => {
    const r = convert(1, 'lbf', 'N');
    expect(r.value).toBeCloseTo(4.448222, 4);
  });

  it('MPa → psi', () => {
    const r = convert(1, 'MPa', 'psi');
    expect(r.value).toBeCloseTo(145.0377, 1);
  });

  it('temperature: 0°C → 273.15 K', () => {
    const r = convert(0, 'degC', 'K');
    expect(r.value).toBeCloseTo(273.15, 2);
  });

  it('temperature: 100°C → 212°F', () => {
    const r = convert(100, 'degC', 'degF');
    expect(r.value).toBeCloseTo(212, 1);
  });

  it('unit mismatch reported', () => {
    const r = convert(1, 'mm', 'N');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('mismatch');
  });

  it('unknown source unit fails', () => {
    const r = convert(1, 'xyz', 'mm');
    expect(r.ok).toBe(false);
  });

  it('round trip is identity', () => {
    const r1 = convert(50, 'mm', 'in');
    const r2 = convert(r1.value, 'in', 'mm');
    expect(r2.value).toBeCloseTo(50, 5);
  });

  it('SI value reported', () => {
    const r = convert(2, 'm', 'mm');
    expect(r.siValue).toBeCloseTo(2, 5);
  });

  it('density g/cm³ → kg/m³', () => {
    const r = convert(7.85, 'g/cm^3', 'kg/m^3');
    expect(r.value).toBeCloseTo(7850, 1);
  });

  it('torque ft-lbf → Nm', () => {
    const r = convert(1, 'ft-lbf', 'Nm');
    expect(r.value).toBeCloseTo(1.3558, 3);
  });

  it('angle degrees → radians', () => {
    const r = convert(180, 'deg', 'rad');
    expect(r.value).toBeCloseTo(Math.PI, 5);
  });
});

describe('parseQuantity', () => {
  it('parses "120 lbf"', () => {
    const p = parseQuantity('120 lbf');
    expect(p).not.toBeNull();
    expect(p!.value).toBe(120);
    expect(p!.unit).toBe('lbf');
    expect(p!.quantity).toBe('force');
  });

  it('handles no space "5mm"', () => {
    const p = parseQuantity('5mm');
    expect(p).not.toBeNull();
    expect(p!.value).toBe(5);
    expect(p!.unit).toBe('mm');
  });

  it('handles negative', () => {
    const p = parseQuantity('-10 degC');
    expect(p).not.toBeNull();
    expect(p!.value).toBe(-10);
  });

  it('returns null for malformed text', () => {
    expect(parseQuantity('hello')).toBeNull();
  });

  it('returns null for unknown unit', () => {
    expect(parseQuantity('5 xyz')).toBeNull();
  });
});

describe('summarize', () => {
  it('total > 0', () => {
    const s = summarize();
    expect(s.totalUnits).toBe(UNIT_LIBRARY.length);
  });

  it('quantities include force, pressure, torque', () => {
    const s = summarize();
    expect(s.quantityCount).toBeGreaterThanOrEqual(10);
  });

  it('units per quantity sums to total', () => {
    const s = summarize();
    const sum = Object.values(s.unitsPerQuantity).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.totalUnits);
  });
});
