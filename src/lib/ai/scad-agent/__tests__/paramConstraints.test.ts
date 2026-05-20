import { describe, it, expect } from 'vitest';
import { checkParameterConstraints } from '../paramConstraints';
import type { IntentInput } from '@/lib/openscad-render/intentToScad';

describe('checkParameterConstraints · intra-shape', () => {
  it('rejects box with non-positive dimension', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 0, depth_mm: 20 },
    };
    const r = checkParameterConstraints(intent);
    expect(r.ok).toBe(false);
    expect(r.violations[0].code).toBe('box-non-positive');
    expect(r.violations[0].path).toBe('params.height_mm');
  });

  it('accepts a normal box', () => {
    const r = checkParameterConstraints({
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('rejects pipe with inner ≥ outer diameter', () => {
    const r = checkParameterConstraints({
      shapeId: 'pipe',
      params: { outer_diameter_mm: 20, inner_diameter_mm: 25, length_mm: 100 },
    });
    expect(r.ok).toBe(false);
    expect(r.violations[0].code).toBe('pipe-inner-ge-outer');
  });

  it('warns on inverted cone (top > base)', () => {
    const r = checkParameterConstraints({
      shapeId: 'cone',
      params: { base_diameter_mm: 20, top_diameter_mm: 30, height_mm: 50 },
    });
    expect(r.ok).toBe(true); // warning only
    expect(r.violations.some(v => v.code === 'cone-top-greater-than-base')).toBe(true);
  });

  it('warns on self-intersecting torus', () => {
    const r = checkParameterConstraints({
      shapeId: 'torus',
      params: { major_diameter_mm: 50, minor_diameter_mm: 30 }, // 30 >= 50/2=25
    });
    expect(r.violations.some(v => v.code === 'torus-self-intersect')).toBe(true);
  });

  it('rejects zero / negative cylinder diameter', () => {
    expect(checkParameterConstraints({
      shapeId: 'cylinder',
      params: { diameter_mm: 0, height_mm: 50 },
    }).ok).toBe(false);
  });
});

describe('checkParameterConstraints · feature-vs-shape', () => {
  it('rejects hole larger than the smallest box extent', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'hole', params: { diameter_mm: 25 } }], // 25 > min extent 20
    };
    const r = checkParameterConstraints(intent);
    expect(r.ok).toBe(false);
    expect(r.violations[0].code).toBe('hole-larger-than-shape');
    expect(r.violations[0].suggestion).toContain('diameter_mm ≤');
  });

  it('accepts hole smaller than the smallest extent', () => {
    const r = checkParameterConstraints({
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'hole', params: { diameter_mm: 10 } }],
    });
    expect(r.ok).toBe(true);
  });

  it('warns on fillet ≥ half the smallest extent', () => {
    const r = checkParameterConstraints({
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'fillet', params: { radius_mm: 15 } }], // 15 ≥ 20/2
    });
    expect(r.violations.some(v => v.code === 'fillet-too-large')).toBe(true);
  });

  it('rejects shell thickness ≥ half the smallest extent', () => {
    const r = checkParameterConstraints({
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'shell', params: { thickness_mm: 15 } }],
    });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.code === 'shell-thickness-exceeds-half-extent')).toBe(true);
  });

  it('warns on very thin shells (< 0.5mm)', () => {
    const r = checkParameterConstraints({
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'shell', params: { thickness_mm: 0.3 } }],
    });
    expect(r.violations.some(v => v.code === 'shell-thickness-thin')).toBe(true);
  });
});

describe('checkParameterConstraints · feature-vs-feature', () => {
  it('warns on duplicate adjacent patterns with identical params', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 100, height_mm: 50, depth_mm: 50 },
      features: [
        { type: 'linearPattern', params: { count: 5, spacing_mm: 10 } },
        { type: 'linearPattern', params: { count: 5, spacing_mm: 10 } },
      ],
    };
    const r = checkParameterConstraints(intent);
    expect(r.violations.some(v => v.code === 'duplicate-pattern')).toBe(true);
  });

  it('does not flag two patterns with different params', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 100, height_mm: 50, depth_mm: 50 },
      features: [
        { type: 'linearPattern', params: { count: 5, spacing_mm: 10 } },
        { type: 'linearPattern', params: { count: 3, spacing_mm: 20 } },
      ],
    };
    const r = checkParameterConstraints(intent);
    expect(r.violations.some(v => v.code === 'duplicate-pattern')).toBe(false);
  });
});

describe('checkParameterConstraints · ok contract', () => {
  it('ok=true when only warnings, no errors', () => {
    const r = checkParameterConstraints({
      shapeId: 'cone',
      params: { base_diameter_mm: 20, top_diameter_mm: 30, height_mm: 50 },
    });
    expect(r.ok).toBe(true);
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.violations.every(v => v.severity === 'warning')).toBe(true);
  });

  it('ok=false when any violation is severity=error', () => {
    const r = checkParameterConstraints({
      shapeId: 'box',
      params: { width_mm: -10, height_mm: 50, depth_mm: 20 },
    });
    expect(r.ok).toBe(false);
  });
});
