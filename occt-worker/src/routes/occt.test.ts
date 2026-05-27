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
  validateMirrorParams,
  validatePatternParams,
  validateSweepParams,
  validateLoftParams,
} = _testing;

const okHost = { host: { w: 10, h: 10, d: 10 } };

describe('validateBooleanParams — W16 chained input', () => {
  it('accepts sourceR2Key as alternative to host', () => {
    const out = validateBooleanParams({
      params: {
        sourceR2Key: 'occt-ops/test-user/extrude/abc.step',
        toolShape: 0, r: 5,
      },
    }, 'test-user');
    expect(out.sourceR2Key).toBe('occt-ops/test-user/extrude/abc.step');
    expect(out.host).toBeUndefined();
  });
  it('rejects sourceR2Key for cross-user prefix', () => {
    expect(() => validateBooleanParams({
      params: {
        sourceR2Key: 'occt-ops/other-user/extrude/abc.step',
        toolShape: 0, r: 5,
      },
    }, 'test-user')).toThrow(/per-user scope/);
  });
  it('rejects when both host and sourceR2Key present', () => {
    expect(() => validateBooleanParams({
      params: {
        ...okHost,
        sourceR2Key: 'occt-ops/test-user/x.step',
        toolShape: 0, r: 5,
      },
    }, 'test-user')).toThrow(/exactly one of/);
  });
});

describe('validateBooleanParams — W17 shape-vs-shape tool', () => {
  it('accepts toolSourceR2Key as alternative to primitive tool', () => {
    const out = validateBooleanParams({
      params: {
        ...okHost,
        toolSourceR2Key: 'occt-ops/test-user/extrude/tool.step',
      },
    }, 'test-user');
    expect(out.toolSourceR2Key).toBe('occt-ops/test-user/extrude/tool.step');
    expect(out.toolShape).toBeUndefined();
    expect(out.r).toBeUndefined();
  });

  it('rejects both primitive tool AND toolSourceR2Key', () => {
    expect(() => validateBooleanParams({
      params: {
        ...okHost,
        toolShape: 0, r: 5,
        toolSourceR2Key: 'occt-ops/test-user/x.step',
      },
    }, 'test-user')).toThrow(/cannot set both/);
  });

  it('rejects missing tool entirely', () => {
    expect(() => validateBooleanParams({
      params: { ...okHost },
    }, 'test-user')).toThrow(/tool required/);
  });

  it('rejects cross-user toolSourceR2Key prefix', () => {
    expect(() => validateBooleanParams({
      params: {
        ...okHost,
        toolSourceR2Key: 'occt-ops/other-user/x.step',
      },
    }, 'test-user')).toThrow(/per-user scope/);
  });

  it('accepts shape-vs-shape (host R2 + tool R2)', () => {
    const out = validateBooleanParams({
      params: {
        sourceR2Key: 'occt-ops/test-user/extrude/host.step',
        toolSourceR2Key: 'occt-ops/test-user/extrude/tool.step',
        type: 'cut',
      },
    }, 'test-user');
    expect(out.sourceR2Key).toBeDefined();
    expect(out.toolSourceR2Key).toBeDefined();
    expect(out.host).toBeUndefined();
  });
});

describe('validateBooleanParams', () => {
  it('accepts a minimal valid body', () => {
    const out = validateBooleanParams({ params: { ...okHost, toolShape: 0, r: 1 } }, 'test-user');
    expect(out.r).toBe(1);
    expect(out.host?.w).toBe(10);
  });
  it('rejects missing body', () => {
    expect(() => validateBooleanParams(null, 'test-user')).toThrow(/body must be a JSON/);
  });
  it('rejects bad type', () => {
    expect(() => validateBooleanParams({
      params: { ...okHost, toolShape: 0, r: 1, type: 'invalid' },
    }, 'test-user')).toThrow(/type must be cut/);
  });
  it('rejects out-of-range r', () => {
    expect(() => validateBooleanParams({
      params: { ...okHost, toolShape: 0, r: -1 },
    }, 'test-user')).toThrow(/r out of range/);
  });
});

describe('validateFilletParams', () => {
  it('accepts valid', () => {
    const out = validateFilletParams({ params: { ...okHost, radius: 1, edges: 'vertical' } }, 'test-user');
    expect(out.radius).toBe(1);
    expect(out.edges).toBe('vertical');
  });
  it('defaults edges to undefined (handler reads as "all")', () => {
    const out = validateFilletParams({ params: { ...okHost, radius: 0.5 } }, 'test-user');
    expect(out.edges).toBeUndefined();
  });
  it('rejects bad edges scope', () => {
    expect(() => validateFilletParams({
      params: { ...okHost, radius: 1, edges: 'sideways' },
    }, 'test-user')).toThrow(/edges must be one of/);
  });
  it('rejects missing radius', () => {
    expect(() => validateFilletParams({ params: okHost }, 'test-user')).toThrow(/radius/);
  });
});

describe('validateChamferParams', () => {
  it('accepts valid', () => {
    const out = validateChamferParams({ params: { ...okHost, distance: 2 } }, 'test-user');
    expect(out.distance).toBe(2);
  });
  it('rejects bad edges scope', () => {
    expect(() => validateChamferParams({
      params: { ...okHost, distance: 1, edges: 'diagonal' },
    }, 'test-user')).toThrow(/edges must be one of/);
  });
});

describe('validateExtrudeParams', () => {
  it('accepts rectangle profile + height', () => {
    const out = validateExtrudeParams({
      params: { profile: { kind: 'rectangle', width: 20, height2D: 10 }, height: 5 },
    }, 'test-user');
    expect(out.profile.kind).toBe('rectangle');
    expect(out.height).toBe(5);
    expect(out.plane).toBeUndefined();
  });
  it('accepts circle profile + plane override', () => {
    const out = validateExtrudeParams({
      params: { profile: { kind: 'circle', radius: 3 }, height: 5, plane: 'YZ' },
    }, 'test-user');
    if (out.profile.kind === 'circle') expect(out.profile.radius).toBe(3);
    else throw new Error('profile narrowing broke');
    expect(out.plane).toBe('YZ');
  });
  it('rejects missing profile', () => {
    expect(() => validateExtrudeParams({ params: { height: 5 } }, 'test-user')).toThrow(/profile required/);
  });
  it('rejects unknown profile kind', () => {
    expect(() => validateExtrudeParams({
      params: { profile: { kind: 'triangle', r: 1 }, height: 5 },
    }, 'test-user')).toThrow(/profile.kind/);
  });
  it('rejects bad plane', () => {
    expect(() => validateExtrudeParams({
      params: { profile: { kind: 'circle', radius: 1 }, height: 5, plane: 'XX' },
    }, 'test-user')).toThrow(/plane must be/);
  });
  it('accepts polygon profile (L-shape)', () => {
    const out = validateExtrudeParams({
      params: {
        profile: {
          kind: 'polygon',
          points: [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]],
        },
        height: 3,
      },
    }, 'test-user');
    expect(out.profile.kind).toBe('polygon');
    if (out.profile.kind === 'polygon') expect(out.profile.points).toHaveLength(6);
  });
  it('rejects polygon with < 3 points', () => {
    expect(() => validateExtrudeParams({
      params: { profile: { kind: 'polygon', points: [[0, 0], [10, 0]] }, height: 5 },
    }, 'test-user')).toThrow(/polygon needs ≥ 3 points/);
  });
  it('rejects polygon non-array point', () => {
    expect(() => validateExtrudeParams({
      params: { profile: { kind: 'polygon', points: [[0, 0], 'bad', [0, 10]] }, height: 5 },
    }, 'test-user')).toThrow(/must be \[x, y\]/);
  });
  it('rejects polygon out-of-range coord', () => {
    expect(() => validateExtrudeParams({
      params: { profile: { kind: 'polygon', points: [[0, 0], [10000, 0], [0, 10]] }, height: 5 },
    }, 'test-user')).toThrow(/out of \[/);
  });
  it('accepts svgPath rectangle (compiles to polygon)', () => {
    const out = validateExtrudeParams({
      params: {
        profile: { kind: 'svgPath', d: 'M 0,0 L 10,0 L 10,5 L 0,5 Z' },
        height: 3,
      },
    }, 'test-user');
    // svgPath compiles down to polygon — the worker handler doesn't
    // need a separate code path.
    expect(out.profile.kind).toBe('polygon');
    if (out.profile.kind === 'polygon') expect(out.profile.points).toHaveLength(4);
  });
  it('accepts svgPath with Bezier (W14 flattening)', () => {
    const out = validateExtrudeParams({
      params: {
        profile: { kind: 'svgPath', d: 'M 0,0 C 0,20 40,20 40,0 L 40,-5 L 0,-5 Z' },
        height: 3,
      },
    }, 'test-user');
    expect(out.profile.kind).toBe('polygon');
    if (out.profile.kind === 'polygon') {
      expect(out.profile.points.length).toBeGreaterThan(5);
    }
  });
  it('accepts svgPath with arc (W14 D3-5 flattening)', () => {
    const out = validateExtrudeParams({
      params: {
        profile: { kind: 'svgPath', d: 'M 10,0 A 10,10 0 0,0 0,10 L 0,0 Z' },
        height: 3,
      },
    }, 'test-user');
    expect(out.profile.kind).toBe('polygon');
    if (out.profile.kind === 'polygon') {
      // Quarter arc with default 0.1mm tolerance → ≥ 4 vertices.
      expect(out.profile.points.length).toBeGreaterThan(4);
    }
  });
  it('rejects svgPath out-of-range tolerance', () => {
    expect(() => validateExtrudeParams({
      params: {
        profile: { kind: 'svgPath', d: 'M 0,0 L 10,0 L 10,5 Z', tolerance: 0.0001 },
        height: 3,
      },
    }, 'test-user')).toThrow(/tolerance out of/);
  });
  it('rejects svgPath out-of-range vertex', () => {
    expect(() => validateExtrudeParams({
      params: {
        profile: { kind: 'svgPath', d: 'M 0,0 L 10000,0 L 0,10 Z' },
        height: 3,
      },
    }, 'test-user')).toThrow(/out of \[/);
  });
});

describe('validateRevolveParams', () => {
  it('accepts rectangle profile with defaults', () => {
    const out = validateRevolveParams({
      params: { profile: { kind: 'rectangle', width: 10, height2D: 4 } },
    }, 'test-user');
    expect(out.profile.kind).toBe('rectangle');
    expect(out.axis).toBeUndefined();
    expect(out.angle).toBeUndefined();
    expect(out.plane).toBeUndefined();
  });
  it('accepts circle profile + axis + angle', () => {
    const out = validateRevolveParams({
      params: { profile: { kind: 'circle', radius: 5 }, axis: 'Z', angle: 180 },
    }, 'test-user');
    expect(out.axis).toBe('Z');
    expect(out.angle).toBe(180);
  });
  it('rejects bad axis', () => {
    expect(() => validateRevolveParams({
      params: { profile: { kind: 'circle', radius: 1 }, axis: 'W' },
    }, 'test-user')).toThrow(/axis must be/);
  });
  it('rejects out-of-range angle', () => {
    expect(() => validateRevolveParams({
      params: { profile: { kind: 'circle', radius: 1 }, angle: 720 },
    }, 'test-user')).toThrow(/angle out of range/);
  });
});

describe('validateMirrorParams', () => {
  it('accepts each plane', () => {
    for (const plane of ['XY', 'YZ', 'XZ'] as const) {
      const out = validateMirrorParams({ params: { ...okHost, plane } }, 'test-user');
      expect(out.plane).toBe(plane);
    }
  });
  it('rejects bad plane', () => {
    expect(() => validateMirrorParams({ params: { ...okHost, plane: 'WW' } }, 'test-user'))
      .toThrow(/plane must be/);
  });
  it('rejects missing plane', () => {
    expect(() => validateMirrorParams({ params: okHost }, 'test-user')).toThrow(/plane must be/);
  });
});

describe('validatePatternParams', () => {
  it('accepts a linear pattern', () => {
    const out = validatePatternParams({
      params: { ...okHost, kind: 'linear', count: 4, spacing: 20, axis: 'X' },
    }, 'test-user');
    if (out.kind === 'linear') {
      expect(out.count).toBe(4);
      expect(out.spacing).toBe(20);
      expect(out.axis).toBe('X');
    } else throw new Error('kind narrowing broke');
  });
  it('accepts a circular pattern', () => {
    const out = validatePatternParams({
      params: { ...okHost, kind: 'circular', count: 6, totalAngleDeg: 360, axis: 'Z' },
    }, 'test-user');
    if (out.kind === 'circular') {
      expect(out.totalAngleDeg).toBe(360);
    } else throw new Error('kind narrowing broke');
  });
  it('rejects non-integer count', () => {
    expect(() => validatePatternParams({
      params: { ...okHost, kind: 'linear', count: 3.5, spacing: 10, axis: 'X' },
    }, 'test-user')).toThrow(/integer/);
  });
  it('rejects count < 2', () => {
    expect(() => validatePatternParams({
      params: { ...okHost, kind: 'linear', count: 1, spacing: 10, axis: 'X' },
    }, 'test-user')).toThrow(/out of range/);
  });
  it('rejects bad kind', () => {
    expect(() => validatePatternParams({
      params: { ...okHost, kind: 'radial', count: 3, spacing: 10, axis: 'X' },
    }, 'test-user')).toThrow(/kind must be/);
  });
});

describe('validateSweepParams', () => {
  it('accepts profile + 3D polyline path', () => {
    const out = validateSweepParams({
      params: {
        profile: { kind: 'circle', radius: 2 },
        path: [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
      },
    }, 'test-user');
    expect(out.path).toHaveLength(3);
    expect(out.profile.kind).toBe('circle');
  });
  it('rejects path with < 2 points', () => {
    expect(() => validateSweepParams({
      params: { profile: { kind: 'circle', radius: 2 }, path: [[0, 0, 0]] },
    }, 'test-user')).toThrow(/≥ 2 points/);
  });
  it('rejects non-3-tuple path entry', () => {
    expect(() => validateSweepParams({
      params: { profile: { kind: 'circle', radius: 2 }, path: [[0, 0], [10, 0]] },
    }, 'test-user')).toThrow(/\[x, y, z\]/);
  });
  it('rejects out-of-range path coord', () => {
    expect(() => validateSweepParams({
      params: {
        profile: { kind: 'circle', radius: 2 },
        path: [[0, 0, 0], [10000, 0, 0]],
      },
    }, 'test-user')).toThrow(/out of \[/);
  });
});

describe('validateLoftParams', () => {
  it('accepts 2 sections at different offsets', () => {
    const out = validateLoftParams({
      params: {
        sections: [
          { profile: { kind: 'circle', radius: 5 }, offset: 0 },
          { profile: { kind: 'circle', radius: 3 }, offset: 10 },
        ],
      },
    }, 'test-user');
    expect(out.sections).toHaveLength(2);
  });
  it('accepts 3+ sections (transition shape)', () => {
    const out = validateLoftParams({
      params: {
        sections: [
          { profile: { kind: 'rectangle', width: 20, height2D: 10 }, offset: 0 },
          { profile: { kind: 'circle', radius: 5 }, offset: 5 },
          { profile: { kind: 'circle', radius: 3 }, offset: 10 },
        ],
      },
    }, 'test-user');
    expect(out.sections).toHaveLength(3);
  });
  it('rejects < 2 sections', () => {
    expect(() => validateLoftParams({
      params: {
        sections: [{ profile: { kind: 'circle', radius: 5 }, offset: 0 }],
      },
    }, 'test-user')).toThrow(/≥ 2/);
  });
  it('rejects non-monotonic offsets', () => {
    expect(() => validateLoftParams({
      params: {
        sections: [
          { profile: { kind: 'circle', radius: 5 }, offset: 10 },
          { profile: { kind: 'circle', radius: 3 }, offset: 5 },
        ],
      },
    }, 'test-user')).toThrow(/strictly increasing/);
  });
});

describe('validateShellParams', () => {
  it('accepts valid with default openFace', () => {
    const out = validateShellParams({ params: { ...okHost, thickness: 1 } }, 'test-user');
    expect(out.thickness).toBe(1);
    expect(out.openFace).toBeUndefined();
  });
  it('accepts each face', () => {
    for (const face of ['top', 'bottom', 'front', 'back', 'left', 'right'] as const) {
      const out = validateShellParams({ params: { ...okHost, thickness: 1, openFace: face } }, 'test-user');
      expect(out.openFace).toBe(face);
    }
  });
  it('rejects bad openFace', () => {
    expect(() => validateShellParams({
      params: { ...okHost, thickness: 1, openFace: 'middle' },
    }, 'test-user')).toThrow(/openFace must be one of/);
  });
  it('rejects missing thickness', () => {
    expect(() => validateShellParams({ params: okHost }, 'test-user')).toThrow(/thickness/);
  });
});
