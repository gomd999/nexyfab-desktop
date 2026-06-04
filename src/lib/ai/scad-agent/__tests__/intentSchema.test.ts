import { describe, it, expect } from 'vitest';
import { validateIntent } from '../intentSchema';

describe('validateIntent · shape allow-list', () => {
  it('accepts a clean box intent', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
    });
    expect(r.ok).toBe(true);
    expect(r.parsed?.shapeId).toBe('box');
    expect(r.parsed?.params.width_mm).toBe(50);
    expect(r.issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('rejects an unknown shapeId and routes to the composite fallback (W4)', () => {
    const r = validateIntent({
      shapeId: 'flying-saucer',
      params: { radius_mm: 100 },
    });
    expect(r.ok).toBe(false);
    expect(r.parsed).toBeNull();
    expect(r.issues[0].code).toBe('shape-id-unknown');
    expect(r.issues[0].hint).toContain('add_composite_intent');
    expect(r.suggestComposite).toBe(true);
  });

  it('does NOT flag composite for a known shape with bad params (W4 scoping)', () => {
    const r = validateIntent({ shapeId: 'box', params: 'not-an-object' });
    expect(r.ok).toBe(false);
    expect(r.suggestComposite).toBeFalsy(); // wrong params ≠ "needs composition"
  });

  it('rejects empty / non-string shapeId', () => {
    expect(validateIntent({ shapeId: '', params: {} }).issues[0].code).toBe('shape-id-missing');
    expect(validateIntent({ shapeId: 42, params: {} }).issues[0].code).toBe('shape-id-missing');
  });

  it('accepts BOSL2 shapes (gear, threadedRod)', () => {
    expect(validateIntent({ shapeId: 'gear', params: { teeth: 24 } }).ok).toBe(true);
    expect(validateIntent({ shapeId: 'threadedRod', params: { diameter_mm: 10 } }).ok).toBe(true);
  });
});

describe('validateIntent · top-level keys', () => {
  it('rejects non-object input', () => {
    expect(validateIntent('not an object').issues[0].code).toBe('not-object');
    expect(validateIntent(null).issues[0].code).toBe('not-object');
    expect(validateIntent([1, 2, 3]).issues[0].code).toBe('not-object');
  });

  it('flags unknown top-level keys as warnings (not errors)', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: 10, height_mm: 10, depth_mm: 10 },
      surpriseKey: 'value',
    });
    expect(r.ok).toBe(true);
    const warn = r.issues.find(i => i.code === 'unknown-key');
    expect(warn?.severity).toBe('warning');
    expect(warn?.path).toBe('surpriseKey');
  });
});

describe('validateIntent · params validation', () => {
  it('rejects params that is not an object', () => {
    const r = validateIntent({ shapeId: 'box', params: 'hello' });
    expect(r.issues.some(i => i.code === 'params-not-object')).toBe(true);
  });

  it('rejects non-finite param values', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: NaN, height_mm: Infinity, depth_mm: 10 },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.filter(i => i.code === 'param-non-finite' || i.code === 'param-not-numeric').length).toBeGreaterThan(0);
  });

  it('coerces numeric strings with a warning', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: '50', height_mm: 30, depth_mm: 20 },
    });
    expect(r.ok).toBe(true);
    expect(r.parsed?.params.width_mm).toBe(50);
    const w = r.issues.find(i => i.code === 'param-coerced-from-string');
    expect(w?.severity).toBe('warning');
  });

  it('rejects non-coercible string params', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: 'fifty', height_mm: 30, depth_mm: 20 },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'param-not-numeric' && i.path === 'params.width_mm')).toBe(true);
  });

  it('rejects object/array param values', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: { value: 50 }, height_mm: 30, depth_mm: 20 },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'param-not-numeric')).toBe(true);
  });
});

describe('validateIntent · features array', () => {
  it('accepts a valid features array', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: 100, height_mm: 50, depth_mm: 20 },
      features: [
        { type: 'hole', params: { diameter_mm: 8, depth_mm: 20 } },
        { type: 'fillet', params: { radius_mm: 2 } },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.parsed?.features).toHaveLength(2);
  });

  it('flags unknown feature types as warnings (forward compat)', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'magic-wand' }],
    });
    expect(r.ok).toBe(true);
    const w = r.issues.find(i => i.code === 'feature-type-unknown');
    expect(w?.severity).toBe('warning');
    expect(w?.hint).toContain('hole');
  });

  it('rejects features that is not an array', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: 10, height_mm: 10, depth_mm: 10 },
      features: { type: 'hole' },
    });
    expect(r.issues.some(i => i.code === 'features-not-array')).toBe(true);
  });

  it('rejects feature with missing type', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: 10, height_mm: 10, depth_mm: 10 },
      features: [{ params: { x: 1 } }],
    });
    expect(r.issues.some(i => i.code === 'feature-type-missing')).toBe(true);
  });

  it('preserves the enabled flag when supplied', () => {
    const r = validateIntent({
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [
        { type: 'hole', params: { diameter_mm: 5 }, enabled: false },
      ],
    });
    expect(r.parsed?.features?.[0].enabled).toBe(false);
  });
});

describe('validateIntent · facets', () => {
  it('accepts positive integer facets', () => {
    const r = validateIntent({
      shapeId: 'sphere',
      params: { diameter_mm: 30 },
      facets: 128,
    });
    expect(r.parsed?.facets).toBe(128);
  });

  it('rounds non-integer facets values', () => {
    const r = validateIntent({
      shapeId: 'sphere',
      params: { diameter_mm: 30 },
      facets: 32.7,
    });
    expect(r.parsed?.facets).toBe(33);
  });

  it('warns on negative or non-numeric facets but does not fail', () => {
    const r = validateIntent({
      shapeId: 'sphere',
      params: { diameter_mm: 30 },
      facets: -8,
    });
    expect(r.ok).toBe(true);
    expect(r.parsed?.facets).toBeUndefined();
    expect(r.issues.some(i => i.code === 'facets-invalid')).toBe(true);
  });
});
