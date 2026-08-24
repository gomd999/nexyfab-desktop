import { describe, expect, it } from 'vitest';
import { formatCadInstant, formatCadNumber, formatCadQuantity, type CanonicalInstant, type CanonicalQuantity } from './format';

describe('CAD locale-neutral display formatting', () => {
  it('does not mutate canonical quantities', () => {
    const q: CanonicalQuantity = { value: 12.5, unit: 'mm' };
    expect(formatCadQuantity(q, 'es')).toContain('mm');
    expect(q).toEqual({ value: 12.5, unit: 'mm' });
    for (const unit of ['mm', 'deg', 'kg', 's'] as const) expect(formatCadQuantity({ value: 2, unit }, 'en')).toContain(unit);
  });
  it('uses locale display rules only', () => {
    expect(formatCadNumber(12345.5, 'es')).toMatch(/12[.\u00a0]345,5/);
    expect(formatCadNumber(1234.5, 'ar')).toContain('1');
    expect(() => formatCadNumber(Number.NaN, 'en')).toThrow('invalid_canonical_number');
    expect(() => formatCadNumber(1, 'en', new Proxy({}, { ownKeys: () => { throw new Error('trap'); } }))).toThrow('invalid_number_options');
  });
  it('formats an ISO instant in its declared timezone', () => {
    const instant: CanonicalInstant = { iso: '2026-01-01T00:00:00.000Z', timezone: 'UTC' };
    expect(formatCadInstant(instant, 'en')).toMatch(/2026/);
    expect(instant).toEqual({ iso: '2026-01-01T00:00:00.000Z', timezone: 'UTC' });
    expect(() => formatCadInstant({ iso: '2026-01-01', timezone: 'UTC' }, 'en')).toThrow('invalid_canonical_instant');
    expect(() => formatCadInstant({ iso: '2026-02-30T00:00:00Z', timezone: 'UTC' }, 'en')).toThrow('invalid_canonical_instant');
    expect(() => formatCadInstant({ iso: '2026-01-01T00:00:00+24:00', timezone: 'UTC' }, 'en')).toThrow('invalid_canonical_instant');
    expect(() => formatCadInstant({ iso: instant.iso, timezone: 'Not/A_Zone' }, 'en')).toThrow('invalid_canonical_timezone');
    expect(() => formatCadQuantity(new Proxy({ value: 2, unit: 'mm' }, { getOwnPropertyDescriptor: () => { throw new Error('trap'); } }), 'en')).toThrow('invalid_canonical_quantity');
  });
});
