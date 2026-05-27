/**
 * Param-validator unit tests for the W11 D3-5 ops. Real OCCT smoke is
 * deferred to W12 soak — here we only verify that 400-vs-201 is
 * decided correctly before the pool is even touched.
 */

import { describe, it, expect } from 'vitest';
import { _testing } from './occt.js';

const {
  validateBooleanParams,
  validateFilletParams,
  validateChamferParams,
  validateShellParams,
  validateExtrudeParams,
  validateRevolveParams,
} = _testing;

const okHost = { host: { w: 10, h: 10, d: 10 } };

describe('validateBooleanParams', () => {
  it('accepts a minimal valid body', () => {
    const out = validateBooleanParams({ params: { ...okHost, toolShape: 0, r: 1 } });
    expect(out.r).toBe(1);
    expect(out.host.w).toBe(10);
  });
  it('rejects missing body', () => {
    expect(() => validateBooleanParams(null)).toThrow(/body must be a JSON/);
  });
  it('rejects bad type', () => {
    expect(() => validateBooleanParams({
      params: { ...okHost, toolShape: 0, r: 1, type: 'invalid' },
    })).toThrow(/type must be cut/);
  });
  it('rejects out-of-range r', () => {
    expect(() => validateBooleanParams({
      params: { ...okHost, toolShape: 0, r: -1 },
    })).toThrow(/r out of range/);
  });
});

describe('validateFilletParams', () => {
  it('accepts valid', () => {
    const out = validateFilletParams({ params: { ...okHost, radius: 1, edges: 'vertical' } });
    expect(out.radius).toBe(1);
    expect(out.edges).toBe('vertical');
  });
  it('defaults edges to undefined (handler reads as "all")', () => {
    const out = validateFilletParams({ params: { ...okHost, radius: 0.5 } });
    expect(out.edges).toBeUndefined();
  });
  it('rejects bad edges scope', () => {
    expect(() => validateFilletParams({
      params: { ...okHost, radius: 1, edges: 'sideways' },
    })).toThrow(/edges must be one of/);
  });
  it('rejects missing radius', () => {
    expect(() => validateFilletParams({ params: okHost })).toThrow(/radius/);
  });
});

describe('validateChamferParams', () => {
  it('accepts valid', () => {
    const out = validateChamferParams({ params: { ...okHost, distance: 2 } });
    expect(out.distance).toBe(2);
  });
  it('rejects bad edges scope', () => {
    expect(() => validateChamferParams({
      params: { ...okHost, distance: 1, edges: 'diagonal' },
    })).toThrow(/edges must be one of/);
  });
});

describe('validateExtrudeParams', () => {
  it('accepts rectangle profile + height', () => {
    const out = validateExtrudeParams({
      params: { profile: { kind: 'rectangle', width: 20, height2D: 10 }, height: 5 },
    });
    expect(out.profile.kind).toBe('rectangle');
    expect(out.height).toBe(5);
    expect(out.plane).toBeUndefined();
  });
  it('accepts circle profile + plane override', () => {
    const out = validateExtrudeParams({
      params: { profile: { kind: 'circle', radius: 3 }, height: 5, plane: 'YZ' },
    });
    if (out.profile.kind === 'circle') expect(out.profile.radius).toBe(3);
    else throw new Error('profile narrowing broke');
    expect(out.plane).toBe('YZ');
  });
  it('rejects missing profile', () => {
    expect(() => validateExtrudeParams({ params: { height: 5 } })).toThrow(/profile required/);
  });
  it('rejects unknown profile kind', () => {
    expect(() => validateExtrudeParams({
      params: { profile: { kind: 'triangle', r: 1 }, height: 5 },
    })).toThrow(/profile.kind/);
  });
  it('rejects bad plane', () => {
    expect(() => validateExtrudeParams({
      params: { profile: { kind: 'circle', radius: 1 }, height: 5, plane: 'XX' },
    })).toThrow(/plane must be/);
  });
});

describe('validateRevolveParams', () => {
  it('accepts rectangle profile with defaults', () => {
    const out = validateRevolveParams({
      params: { profile: { kind: 'rectangle', width: 10, height2D: 4 } },
    });
    expect(out.profile.kind).toBe('rectangle');
    expect(out.axis).toBeUndefined();
    expect(out.angle).toBeUndefined();
    expect(out.plane).toBeUndefined();
  });
  it('accepts circle profile + axis + angle', () => {
    const out = validateRevolveParams({
      params: { profile: { kind: 'circle', radius: 5 }, axis: 'Z', angle: 180 },
    });
    expect(out.axis).toBe('Z');
    expect(out.angle).toBe(180);
  });
  it('rejects bad axis', () => {
    expect(() => validateRevolveParams({
      params: { profile: { kind: 'circle', radius: 1 }, axis: 'W' },
    })).toThrow(/axis must be/);
  });
  it('rejects out-of-range angle', () => {
    expect(() => validateRevolveParams({
      params: { profile: { kind: 'circle', radius: 1 }, angle: 720 },
    })).toThrow(/angle out of range/);
  });
});

describe('validateShellParams', () => {
  it('accepts valid with default openFace', () => {
    const out = validateShellParams({ params: { ...okHost, thickness: 1 } });
    expect(out.thickness).toBe(1);
    expect(out.openFace).toBeUndefined();
  });
  it('accepts each face', () => {
    for (const face of ['top', 'bottom', 'front', 'back', 'left', 'right'] as const) {
      const out = validateShellParams({ params: { ...okHost, thickness: 1, openFace: face } });
      expect(out.openFace).toBe(face);
    }
  });
  it('rejects bad openFace', () => {
    expect(() => validateShellParams({
      params: { ...okHost, thickness: 1, openFace: 'middle' },
    })).toThrow(/openFace must be one of/);
  });
  it('rejects missing thickness', () => {
    expect(() => validateShellParams({ params: okHost })).toThrow(/thickness/);
  });
});
