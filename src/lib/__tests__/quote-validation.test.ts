import { describe, it, expect } from 'vitest';
import { validateQuoteInput, QuoteValidationError } from '../quote-validation';

const validGeo = {
  volume_cm3: 100,
  surface_area_cm2: 200,
  bbox: { w: 50, h: 50, d: 50 },
};

const validBody = {
  geometry: validGeo,
  material: 'aluminum_6061',
  process: 'cnc',
  quantity: 10,
  finishType: 'none',
  tolerance: 'it9',
};

describe('validateQuoteInput', () => {
  it('accepts a normal request', () => {
    const r = validateQuoteInput(validBody);
    expect(r.volume_cm3).toBe(100);
    expect(r.quantity).toBe(10);
    expect(r.complexity).toBe(5); // default
  });

  it('rejects non-finite volume', () => {
    expect(() => validateQuoteInput({ ...validBody, geometry: { ...validGeo, volume_cm3: Infinity } }))
      .toThrow(QuoteValidationError);
    expect(() => validateQuoteInput({ ...validBody, geometry: { ...validGeo, volume_cm3: NaN } }))
      .toThrow(QuoteValidationError);
  });

  it('rejects volume larger than bbox (geometry inconsistency)', () => {
    expect(() => validateQuoteInput({
      ...validBody,
      geometry: { volume_cm3: 10000, surface_area_cm2: 200, bbox: { w: 10, h: 10, d: 10 } },
    })).toThrow(/bbox/);
  });

  it('rejects impossibly small surface area (below sphere minimum)', () => {
    // A 100 cm³ solid has minimum surface ~104 cm² (sphere). 10 is impossible.
    expect(() => validateQuoteInput({
      ...validBody,
      geometry: { ...validGeo, surface_area_cm2: 10 },
    })).toThrow(/surface/);
  });

  it('rejects unknown material', () => {
    expect(() => validateQuoteInput({ ...validBody, material: 'unobtanium' }))
      .toThrow(/material/);
  });

  it('rejects unknown process', () => {
    expect(() => validateQuoteInput({ ...validBody, process: 'laser_warlord' }))
      .toThrow(/process/);
  });

  it('clamps quantity to 1..100000', () => {
    expect(validateQuoteInput({ ...validBody, quantity: -5 }).quantity).toBe(1);
    expect(validateQuoteInput({ ...validBody, quantity: 0 }).quantity).toBe(1);
    expect(validateQuoteInput({ ...validBody, quantity: 999999 }).quantity).toBe(100_000);
  });

  it('clamps complexity to 1..10', () => {
    expect(validateQuoteInput({ ...validBody, aiAnalysis: { complexity: 99 } }).complexity).toBe(10);
    expect(validateQuoteInput({ ...validBody, aiAnalysis: { complexity: -5 } }).complexity).toBe(1);
  });

  it('rejects volume under the manufacturing floor', () => {
    expect(() => validateQuoteInput({
      ...validBody,
      geometry: { ...validGeo, volume_cm3: 0.001 },
    })).toThrow(/volume_cm3/);
  });

  it('rejects oversized bbox', () => {
    expect(() => validateQuoteInput({
      ...validBody,
      geometry: { ...validGeo, bbox: { w: 5000, h: 50, d: 50 } },
    })).toThrow(/bbox/);
  });
});
