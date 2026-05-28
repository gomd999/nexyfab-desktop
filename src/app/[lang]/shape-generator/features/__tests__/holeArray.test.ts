import { describe, it, expect } from 'vitest';
import {
  expandHoleArray,
  validateHoleArray,
  createLinearArrayDefaults,
  createCircularArrayDefaults,
  createRectArrayDefaults,
  createManualArrayDefaults,
  createFromSketchArrayDefaults,
  resolveHoleSpec,
  defaultCountersinkAngle,
  DEFAULT_DRILL_TIP_ANGLE,
  HOLE_ARRAY_MAX_COUNT,
  type CatalogRowLite,
  type HoleArrayDefinition,
  type HoleStandardRef,
} from '../holeArray';

/**
 * Track C2 unit tests — covers all 5 expansion kinds + every validation
 * error code + the major termination edge cases. We deliberately do not
 * round to fewer decimals on circular positions (sin/cos drift is the
 * point) but assert with toBeCloseTo at 6 decimals.
 */

const SPEC: HoleStandardRef = { series: 'ISO', designation: 'M6', fitClass: 'normal' };

function withTerm(def: HoleArrayDefinition): HoleArrayDefinition {
  return def; // factories already seed through-termination
}

// ─── Linear ────────────────────────────────────────────────────────────────

describe('expandHoleArray — linear', () => {
  it('emits 4 positions along +X axis with dx=10', () => {
    const def = createLinearArrayDefaults('arr-1', SPEC);
    const pts = expandHoleArray(def);
    expect(pts).toHaveLength(4);
    expect(pts.map((p) => p.x)).toEqual([0, 10, 20, 30]);
    expect(pts.every((p) => p.y === 0)).toBe(true);
    expect(pts.every((p) => p.source === 'linear')).toBe(true);
  });

  it('emits a single position when count = 1', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 5, startY: 7, dx: 0, dy: 0, count: 1 } },
    };
    const pts = expandHoleArray(def);
    expect(pts).toEqual([{ id: 'arr-1#lin-0', x: 5, y: 7, source: 'linear' }]);
  });

  it('returns empty list for count = 0', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 1, dy: 0, count: 0 } },
    };
    expect(expandHoleArray(def)).toEqual([]);
  });

  it('returns empty list for negative count', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 1, dy: 0, count: -3 } },
    };
    expect(expandHoleArray(def)).toEqual([]);
  });

  it('handles diagonal step (dx + dy both non-zero)', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 5, dy: 5, count: 3 } },
    };
    const pts = expandHoleArray(def);
    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [5, 5],
      [10, 10],
    ]);
  });
});

// ─── Circular ──────────────────────────────────────────────────────────────

describe('expandHoleArray — circular', () => {
  it('emits 6 evenly spaced positions on a circle r=10 at origin', () => {
    const def = createCircularArrayDefaults('arr-1', SPEC); // r=20, count=6, start=0
    const pts = expandHoleArray(def);
    expect(pts).toHaveLength(6);
    // First point at (20, 0)
    expect(pts[0].x).toBeCloseTo(20, 6);
    expect(pts[0].y).toBeCloseTo(0, 6);
    // 4th point (index 3) at (-20, ~0)
    expect(pts[3].x).toBeCloseTo(-20, 6);
    expect(pts[3].y).toBeCloseTo(0, 6);
    expect(pts.every((p) => p.source === 'circular')).toBe(true);
  });

  it('respects non-zero centerX/centerY and startAngle', () => {
    const def: HoleArrayDefinition = {
      ...createCircularArrayDefaults('arr-1', SPEC),
      params: {
        kind: 'circular',
        data: { centerX: 100, centerY: 50, radius: 10, count: 4, startAngle: Math.PI / 2 },
      },
    };
    const pts = expandHoleArray(def);
    // First position at angle π/2 = (centerX + 0, centerY + 10) = (100, 60)
    expect(pts[0].x).toBeCloseTo(100, 6);
    expect(pts[0].y).toBeCloseTo(60, 6);
  });

  it('returns empty list for count = 0', () => {
    const def: HoleArrayDefinition = {
      ...createCircularArrayDefaults('arr-1', SPEC),
      params: {
        kind: 'circular',
        data: { centerX: 0, centerY: 0, radius: 10, count: 0, startAngle: 0 },
      },
    };
    expect(expandHoleArray(def)).toEqual([]);
  });
});

// ─── Rect ──────────────────────────────────────────────────────────────────

describe('expandHoleArray — rect', () => {
  it('emits a 2×3 grid in row-major order', () => {
    const def: HoleArrayDefinition = {
      ...createRectArrayDefaults('arr-1', SPEC),
      params: {
        kind: 'rect',
        data: { startX: 0, startY: 0, stepX: 10, stepY: 20, rows: 2, cols: 3 },
      },
    };
    const pts = expandHoleArray(def);
    expect(pts).toHaveLength(6);
    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [0, 0], [10, 0], [20, 0],
      [0, 20], [10, 20], [20, 20],
    ]);
  });

  it('returns empty list when rows=0', () => {
    const def: HoleArrayDefinition = {
      ...createRectArrayDefaults('arr-1', SPEC),
      params: {
        kind: 'rect',
        data: { startX: 0, startY: 0, stepX: 10, stepY: 10, rows: 0, cols: 3 },
      },
    };
    expect(expandHoleArray(def)).toEqual([]);
  });

  it('emits unique ids per row/col', () => {
    const def: HoleArrayDefinition = {
      ...createRectArrayDefaults('arr-1', SPEC),
      params: {
        kind: 'rect',
        data: { startX: 0, startY: 0, stepX: 10, stepY: 10, rows: 2, cols: 2 },
      },
    };
    const ids = expandHoleArray(def).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── From sketch ───────────────────────────────────────────────────────────

describe('expandHoleArray — fromSketch', () => {
  it('returns empty list when ctx omits resolveSketchPoints', () => {
    const def = createFromSketchArrayDefaults('arr-1', 'sketch-7', SPEC);
    expect(expandHoleArray(def)).toEqual([]);
  });

  it('returns empty list when the sketch is not found', () => {
    const def = createFromSketchArrayDefaults('arr-1', 'sketch-7', SPEC);
    expect(
      expandHoleArray(def, {
        resolveSketchPoints: () => undefined,
      }),
    ).toEqual([]);
  });

  it('passes sketch points through unchanged when no filter set', () => {
    const def = createFromSketchArrayDefaults('arr-1', 'sketch-7', SPEC);
    const out = expandHoleArray(def, {
      resolveSketchPoints: () => [
        { id: 'pt-a', x: 1, y: 2 },
        { id: 'pt-b', x: 3, y: 4 },
      ],
    });
    expect(out).toEqual([
      { id: 'pt-a', x: 1, y: 2, source: 'fromSketch' },
      { id: 'pt-b', x: 3, y: 4, source: 'fromSketch' },
    ]);
  });

  it('respects pointFilter when present', () => {
    const def: HoleArrayDefinition = {
      ...createFromSketchArrayDefaults('arr-1', 'sketch-7', SPEC),
      params: {
        kind: 'fromSketch',
        data: { sketchFeatureId: 'sketch-7', pointFilter: ['pt-b'] },
      },
    };
    const out = expandHoleArray(def, {
      resolveSketchPoints: () => [
        { id: 'pt-a', x: 1, y: 2 },
        { id: 'pt-b', x: 3, y: 4 },
        { id: 'pt-c', x: 5, y: 6 },
      ],
    });
    expect(out).toEqual([{ id: 'pt-b', x: 3, y: 4, source: 'fromSketch' }]);
  });
});

// ─── Manual ────────────────────────────────────────────────────────────────

describe('expandHoleArray — manual', () => {
  it('passes user points through and stamps source=manual', () => {
    const def: HoleArrayDefinition = {
      ...createManualArrayDefaults('arr-1', SPEC),
      params: {
        kind: 'manual',
        data: {
          points: [
            { id: 'a', x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      },
    };
    const out = expandHoleArray(def);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: 'a', x: 1, y: 2, source: 'manual' });
    // Auto-generated id should be deterministic
    expect(out[1]).toEqual({ id: 'arr-1#man-1', x: 3, y: 4, source: 'manual' });
  });

  it('returns empty when points is an empty array', () => {
    const def: HoleArrayDefinition = {
      ...createManualArrayDefaults('arr-1', SPEC),
      params: { kind: 'manual', data: { points: [] } },
    };
    expect(expandHoleArray(def)).toEqual([]);
  });
});

// ─── Clamping ──────────────────────────────────────────────────────────────

describe('expandHoleArray — bounding-box clamp', () => {
  it('drops positions outside the clamp box', () => {
    const def = createLinearArrayDefaults('arr-1', SPEC); // 4 holes at x=0,10,20,30
    const out = expandHoleArray(def, {
      clampBox: { minX: -5, maxX: 15, minY: -5, maxY: 5 },
    });
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.x)).toEqual([0, 10]);
  });

  it('keeps positions exactly on the clamp boundary', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 5, dy: 0, count: 3 } },
    };
    const out = expandHoleArray(def, {
      clampBox: { minX: 0, maxX: 10, minY: 0, maxY: 0 },
    });
    expect(out.map((p) => p.x)).toEqual([0, 5, 10]);
  });
});

// ─── Validation ────────────────────────────────────────────────────────────

describe('validateHoleArray — happy paths', () => {
  it('accepts a default linear array', () => {
    const def = createLinearArrayDefaults('arr-1', SPEC);
    expect(validateHoleArray(def)).toEqual({ ok: true });
  });

  it('accepts a default circular array', () => {
    const def = createCircularArrayDefaults('arr-1', SPEC);
    expect(validateHoleArray(def)).toEqual({ ok: true });
  });

  it('accepts a default rect array', () => {
    const def = createRectArrayDefaults('arr-1', SPEC);
    expect(validateHoleArray(def)).toEqual({ ok: true });
  });

  it('accepts a default manual array', () => {
    const def = createManualArrayDefaults('arr-1', SPEC);
    expect(validateHoleArray(def)).toEqual({ ok: true });
  });
});

describe('validateHoleArray — error codes', () => {
  it('flags ZERO_COUNT on linear count=0', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 1, dy: 0, count: 0 } },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'ZERO_COUNT')).toBe(true);
    }
  });

  it('flags NEGATIVE_COUNT', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 1, dy: 0, count: -1 } },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'NEGATIVE_COUNT')).toBe(true);
    }
  });

  it('flags NON_INTEGER_COUNT for fractional count', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 1, dy: 0, count: 2.5 } },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'NON_INTEGER_COUNT')).toBe(true);
    }
  });

  it('flags EXCESSIVE_COUNT past the soft cap', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 1, dy: 0, count: HOLE_ARRAY_MAX_COUNT + 1 } },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'EXCESSIVE_COUNT')).toBe(true);
    }
  });

  it('flags NAN_PARAM on NaN coords', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: NaN, startY: 0, dx: 1, dy: 0, count: 3 } },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'NAN_PARAM')).toBe(true);
    }
  });

  it('flags NEGATIVE_SPACING when linear count > 1 and dx=dy=0', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 0, dy: 0, count: 4 } },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'NEGATIVE_SPACING')).toBe(true);
    }
  });

  it('flags ZERO_RADIUS on circular radius=0', () => {
    const def: HoleArrayDefinition = {
      ...createCircularArrayDefaults('arr-1', SPEC),
      params: {
        kind: 'circular',
        data: { centerX: 0, centerY: 0, radius: 0, count: 4, startAngle: 0 },
      },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'ZERO_RADIUS')).toBe(true);
    }
  });

  it('flags NEGATIVE_RADIUS on circular radius<0', () => {
    const def: HoleArrayDefinition = {
      ...createCircularArrayDefaults('arr-1', SPEC),
      params: {
        kind: 'circular',
        data: { centerX: 0, centerY: 0, radius: -5, count: 4, startAngle: 0 },
      },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'NEGATIVE_RADIUS')).toBe(true);
    }
  });

  it('flags MISSING_SKETCH_POINTS on empty sketchFeatureId', () => {
    const def: HoleArrayDefinition = {
      ...createFromSketchArrayDefaults('arr-1', '', SPEC),
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'MISSING_SKETCH_POINTS')).toBe(true);
    }
  });

  it('flags EMPTY_MANUAL_POINTS on zero-length manual points', () => {
    const def: HoleArrayDefinition = {
      ...createManualArrayDefaults('arr-1', SPEC),
      params: { kind: 'manual', data: { points: [] } },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'EMPTY_MANUAL_POINTS')).toBe(true);
    }
  });

  it('flags TERMINATION_MISMATCH when kind != params.kind', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'blind',
      terminationParams: { kind: 'through' } as never,
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'TERMINATION_MISMATCH')).toBe(true);
    }
  });

  it('flags BLIND_DEPTH_MISSING when blind termination omits depth', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'blind',
      terminationParams: { kind: 'blind', depth: NaN },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'BLIND_DEPTH_MISSING')).toBe(true);
    }
  });

  it('flags NEGATIVE_DEPTH on blind depth <= 0', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'blind',
      terminationParams: { kind: 'blind', depth: -5 },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'NEGATIVE_DEPTH')).toBe(true);
    }
  });

  it('flags UPTOFACE_FACE_MISSING on upToFace without faceId', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'upToFace',
      terminationParams: { kind: 'upToFace', faceId: '' },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'UPTOFACE_FACE_MISSING')).toBe(true);
    }
  });

  it('accepts blind termination with positive depth', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'blind',
      terminationParams: { kind: 'blind', depth: 12 },
    };
    expect(validateHoleArray(def).ok).toBe(true);
  });

  it('accepts upToFace termination with non-empty faceId', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'upToFace',
      terminationParams: { kind: 'upToFace', faceId: 'face-7' },
    };
    expect(validateHoleArray(def).ok).toBe(true);
  });

  it('returns multiple errors in one pass (multi-field validation)', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      params: { kind: 'linear', data: { startX: NaN, startY: 0, dx: 0, dy: 0, count: 0 } },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // At least NAN_PARAM (startX) + ZERO_COUNT
      expect(res.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── F-HW-01 fixture (M3 × 4 cover plate corners) ──────────────────────────

describe('F-HW-01 fixture — M3 × 4 cover plate', () => {
  it('expands to the 4 corner positions described in spec §8.1', () => {
    // Spec §8.1: 100×60×5 plate, 4 × M3 through-all at (10,10), (90,10),
    // (10,50), (90,50). We model as a rect of 2 rows × 2 cols with
    // appropriate start + step.
    const def: HoleArrayDefinition = {
      id: 'F-HW-01',
      kind: 'rect',
      params: {
        kind: 'rect',
        data: { startX: 10, startY: 10, stepX: 80, stepY: 40, rows: 2, cols: 2 },
      },
      holeSpec: { series: 'ISO', designation: 'M3', fitClass: 'normal' },
      terminationKind: 'through',
      terminationParams: { kind: 'through' },
    };
    const out = expandHoleArray(withTerm(def));
    expect(out).toHaveLength(4);
    const xy = out.map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(xy).toEqual([
      [10, 10],
      [10, 50],
      [90, 10],
      [90, 50],
    ]);
    expect(validateHoleArray(def).ok).toBe(true);
  });
});

// ─── Track C3 — Termination tab + sub-type data model ──────────────────────

const M6_ROW: CatalogRowLite = {
  name: 'M6',
  nominal: 6,
  pitch: 1.0,
  tapDrill: 5.0,
  clearance: 6.6,
  fits: { close: 6.4, normal: 6.6, loose: 7.0 },
  counterboreDia: 11.0,
  counterboreDepth: 6.5,
  countersinkDia: 13.44,
  countersinkAngle: 90,
};

const ANSI_QUARTER20_ROW: CatalogRowLite = {
  name: '1/4-20',
  nominal: 0.25,
  tpi: 20,
  tapDrill: 5.11,
  clearance: 7.14,
  fits: { close: 6.91, normal: 7.14, loose: 7.54 },
  counterboreDia: 12.70,
  counterboreDepth: 6.76,
  countersinkDia: 13.08,
  countersinkAngle: 82,
};

describe('resolveHoleSpec — defaults from catalog', () => {
  it('drilled: uses fits.normal as diameter and default tip 118°', () => {
    const spec = resolveHoleSpec('drilled', { series: 'ISO', designation: 'M6', fitClass: 'normal' }, M6_ROW);
    expect(spec.kind).toBe('drilled');
    if (spec.kind === 'drilled') {
      expect(spec.diameter).toBe(6.6);
      expect(spec.drillTipAngle).toBe(DEFAULT_DRILL_TIP_ANGLE);
    }
  });

  it('drilled: close-fit yields a smaller diameter than normal', () => {
    const close = resolveHoleSpec('drilled', { series: 'ISO', designation: 'M6', fitClass: 'close' }, M6_ROW);
    const normal = resolveHoleSpec('drilled', { series: 'ISO', designation: 'M6', fitClass: 'normal' }, M6_ROW);
    if (close.kind === 'drilled' && normal.kind === 'drilled') {
      expect(close.diameter).toBeLessThan(normal.diameter);
    }
  });

  it('counterbore: head dia/depth come from the catalog row', () => {
    const spec = resolveHoleSpec('counterbore', { series: 'ISO', designation: 'M6', fitClass: 'normal' }, M6_ROW);
    expect(spec.kind).toBe('counterbore');
    if (spec.kind === 'counterbore') {
      expect(spec.headDiameter).toBe(11);
      expect(spec.headDepth).toBe(6.5);
      expect(spec.diameter).toBe(6.6);
    }
  });

  it('countersink: ISO defaults to 90° cone angle', () => {
    const spec = resolveHoleSpec('countersink', { series: 'ISO', designation: 'M6', fitClass: 'normal' }, M6_ROW);
    expect(spec.kind).toBe('countersink');
    if (spec.kind === 'countersink') {
      expect(spec.coneAngle).toBe(90);
      expect(spec.coneDiameter).toBe(13.44);
    }
  });

  it('countersink: ANSI defaults to 82° cone angle', () => {
    const spec = resolveHoleSpec('countersink', { series: 'ANSI', designation: '1/4-20', fitClass: 'normal' }, ANSI_QUARTER20_ROW);
    expect(spec.kind).toBe('countersink');
    if (spec.kind === 'countersink') {
      expect(spec.coneAngle).toBe(82);
    }
  });

  it('defaultCountersinkAngle: ISO=90, ANSI=82', () => {
    expect(defaultCountersinkAngle('ISO')).toBe(90);
    expect(defaultCountersinkAngle('ANSI')).toBe(82);
    expect(defaultCountersinkAngle('KSB0201')).toBe(90);
  });

  it('counterdrill: head > middle > drill diameter ordering enforced', () => {
    const spec = resolveHoleSpec('counterdrill', { series: 'ISO', designation: 'M6', fitClass: 'normal' }, M6_ROW);
    expect(spec.kind).toBe('counterdrill');
    if (spec.kind === 'counterdrill') {
      expect(spec.headDiameter).toBeGreaterThan(spec.middleDiameter);
      expect(spec.middleDiameter).toBeGreaterThan(spec.diameter);
    }
  });

  it('tap: pitch from catalog row, diameter from tapDrill', () => {
    const spec = resolveHoleSpec('tap', { series: 'ISO', designation: 'M6', fitClass: 'normal' }, M6_ROW);
    expect(spec.kind).toBe('tap');
    if (spec.kind === 'tap') {
      expect(spec.pitch).toBe(1.0);
      expect(spec.diameter).toBe(5.0); // tap-drill, not clearance
      expect(spec.tapClass).toBe('6H');
    }
  });

  it('tap: ANSI uses tpi → pitch conversion and 2B tap class', () => {
    const spec = resolveHoleSpec('tap', { series: 'ANSI', designation: '1/4-20', fitClass: 'normal' }, ANSI_QUARTER20_ROW);
    expect(spec.kind).toBe('tap');
    if (spec.kind === 'tap') {
      expect(spec.pitch).toBeCloseTo(25.4 / 20, 2); // 1.27 mm
      expect(spec.tapClass).toBe('2B');
    }
  });

  it('pipe_tap: pipeSizeKey from ref.designation, NPT default', () => {
    const spec = resolveHoleSpec(
      'pipe_tap',
      { series: 'NPT', designation: '1/4-18' },
      { ...M6_ROW, tapDrill: 11.40 },
    );
    expect(spec.kind).toBe('pipe_tap');
    if (spec.kind === 'pipe_tap') {
      expect(spec.pipeStandard).toBe('NPT');
      expect(spec.pipeSizeKey).toBe('1/4-18');
    }
  });

  it('falls back to sensible defaults when row is undefined', () => {
    const spec = resolveHoleSpec('drilled', { series: 'ISO', designation: 'M6' }, undefined);
    expect(spec.kind).toBe('drilled');
    if (spec.kind === 'drilled') {
      expect(spec.diameter).toBe(5); // fallback default
    }
  });
});

describe('validateHoleArray — HoleSpec sub-type validation', () => {
  it('accepts a default drilled HoleSpec when attached to def', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'drilled',
        diameter: 5,
        drillTipAngle: 118,
      },
    };
    expect(validateHoleArray(def).ok).toBe(true);
  });

  it('flags INVALID_DIAMETER on zero drill diameter', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: { kind: 'drilled', diameter: 0, drillTipAngle: 118 },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'INVALID_DIAMETER')).toBe(true);
    }
  });

  it('flags INVALID_CONE_ANGLE on out-of-range drill tip angle (40°)', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: { kind: 'drilled', diameter: 5, drillTipAngle: 40 },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'INVALID_CONE_ANGLE')).toBe(true);
    }
  });

  it('flags CBORE_SMALLER_THAN_BORE when headDiameter ≤ diameter', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'counterbore',
        diameter: 6,
        headDiameter: 5, // smaller than bore → invalid
        headDepth: 3,
        drillTipAngle: 118,
      },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'CBORE_SMALLER_THAN_BORE')).toBe(true);
    }
  });

  it('flags CSK_SMALLER_THAN_BORE when coneDiameter ≤ diameter', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'countersink',
        diameter: 6,
        coneDiameter: 5,
        coneAngle: 90,
        drillTipAngle: 118,
      },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'CSK_SMALLER_THAN_BORE')).toBe(true);
    }
  });

  it('flags INVALID_CONE_ANGLE on countersink with 200° cone angle', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'countersink',
        diameter: 5,
        coneDiameter: 10,
        coneAngle: 200,
        drillTipAngle: 118,
      },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'INVALID_CONE_ANGLE')).toBe(true);
    }
  });

  it('flags CDRILL_STEP_ORDER when middle is wider than head', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'counterdrill',
        diameter: 5,
        middleDiameter: 12,
        headDiameter: 10, // wrong order: head < middle
        middleDepth: 5,
        headDepth: 3,
        drillTipAngle: 118,
      },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'CDRILL_STEP_ORDER')).toBe(true);
    }
  });

  it('flags TAP_PITCH_INVALID when tap pitch is zero', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'tap',
        diameter: 5,
        pitch: 0,
        tapClass: '6H',
        tapDepth: 10,
        drillTipAngle: 118,
      },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'TAP_PITCH_INVALID')).toBe(true);
    }
  });

  it('flags PIPE_KEY_MISSING when pipe_tap has empty pipeSizeKey', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'pipe_tap',
        diameter: 11.4,
        pipeStandard: 'NPT',
        pipeSizeKey: '',
        engagementDepth: 9.7,
      },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'PIPE_KEY_MISSING')).toBe(true);
    }
  });

  it('accepts a fully populated counterbore HoleSpec', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'counterbore',
        diameter: 6.6,
        headDiameter: 11,
        headDepth: 6.5,
        drillTipAngle: 118,
      },
    };
    expect(validateHoleArray(def).ok).toBe(true);
  });

  it('accepts a fully populated countersink HoleSpec', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      holeSpecDetail: {
        kind: 'countersink',
        diameter: 6.6,
        coneDiameter: 13.44,
        coneAngle: 90,
        drillTipAngle: 118,
      },
    };
    expect(validateHoleArray(def).ok).toBe(true);
  });
});

describe('validateHoleArray — termination W3 extensions', () => {
  it('accepts blind with bottomShape=flat (no apex required)', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'blind',
      terminationParams: { kind: 'blind', depth: 8, bottomShape: 'flat' },
    };
    expect(validateHoleArray(def).ok).toBe(true);
  });

  it('accepts blind with bottomShape=conical + apex=118°', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'blind',
      terminationParams: { kind: 'blind', depth: 8, bottomShape: 'conical', drillTipAngle: 118 },
    };
    expect(validateHoleArray(def).ok).toBe(true);
  });

  it('flags INVALID_CONE_ANGLE on blind conical with 40° apex', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'blind',
      terminationParams: { kind: 'blind', depth: 8, bottomShape: 'conical', drillTipAngle: 40 },
    };
    const res = validateHoleArray(def);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === 'INVALID_CONE_ANGLE')).toBe(true);
    }
  });

  it('accepts upToNext without faceId (worker resolves later)', () => {
    const def: HoleArrayDefinition = {
      ...createLinearArrayDefaults('arr-1', SPEC),
      terminationKind: 'upToNext',
      terminationParams: { kind: 'upToNext' },
    };
    expect(validateHoleArray(def).ok).toBe(true);
  });
});
