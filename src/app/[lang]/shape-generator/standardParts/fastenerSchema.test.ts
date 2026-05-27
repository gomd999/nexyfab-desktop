import { describe, it, expect } from 'vitest';
import {
  coarsePitch,
  buildFastener,
  fastenerDesignation,
  validateFastener,
} from './fastenerSchema';

describe('coarsePitch', () => {
  it('M6 is 1.0', () => expect(coarsePitch(6)).toBe(1.0));
  it('M10 is 1.5', () => expect(coarsePitch(10)).toBe(1.5));
  it('throws for unsupported diameter', () => expect(() => coarsePitch(7)).toThrow());
});

describe('buildFastener', () => {
  it('fills standard + pitch defaults', () => {
    const f = buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25 });
    expect(f.standard).toBe('ISO');
    expect(f.thread.pitchMm).toBe(1.0);
    expect(f.material).toBe('steel-8.8');
    expect(f.designation).toContain('4014');
    expect(f.designation).toContain('M6');
    expect(f.designation).toContain('25');
  });

  it('encodes non-coarse pitch in designation', () => {
    const f = buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25, pitchMm: 0.75 });
    expect(f.designation).toContain('×0.75');
  });

  it('omits pitch suffix when pitch is coarse', () => {
    const f = buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25, pitchMm: 1.0 });
    expect(f.designation).not.toContain('×0.75');
  });
});

describe('fastenerDesignation', () => {
  it('button-head socket uses 7380 tag', () => {
    const f = buildFastener({ kind: 'button-head', diameterMm: 5, lengthMm: 12 });
    expect(f.designation).toContain('7380');
  });

  it('flat washer uses 7089 tag', () => {
    const f = buildFastener({ kind: 'flat-washer', diameterMm: 6, lengthMm: 1 });
    expect(f.designation).toContain('7089');
  });
});

describe('validateFastener', () => {
  it('returns no errors for valid bolt', () => {
    const f = buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25 });
    expect(validateFastener(f)).toEqual([]);
  });

  it('flags bolt with length below diameter', () => {
    const f = buildFastener({ kind: 'hex-bolt', diameterMm: 10, lengthMm: 5 });
    const e = validateFastener(f);
    expect(e.some(x => /stud/i.test(x))).toBe(true);
  });

  it('flags zero pitch', () => {
    const f = buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25 });
    f.thread.pitchMm = 0;
    expect(validateFastener(f).length).toBeGreaterThan(0);
  });
});
