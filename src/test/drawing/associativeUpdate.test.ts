/**
 * associativeUpdate.test.ts — W4-B associative drawing pipe (pure layer).
 *
 * Covers:
 *   - reanchorCuttingPlane: relative-station preservation, honest defaults
 *     (no old model → centre), clamping, degenerate refusals;
 *   - measureSheetDimension / auditSheetDimensions: model edit → dimension
 *     value follows automatically; a ref that no longer exists comes back
 *     as an EXPLICIT unresolved-ref failure, never a stale number;
 *   - formatMeasuredValue display rounding.
 */
import { describe, it, expect } from 'vitest';
import type { Polyhedron } from '@/lib/cad/featureMesh';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildExtrudeTopo } from '@/lib/cad/topoNaming';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import type { Dimension } from '@/lib/drawing/dimension';
import {
  reanchorCuttingPlane,
  measureSheetDimension,
  auditSheetDimensions,
  formatMeasuredValue,
  type SectionPlane,
} from '@/lib/drawing/associativeUpdate';

// ─── fixtures ────────────────────────────────────────────────────────────

/** bbox-only stand-in polyhedron (re-anchoring reads vertices only). */
function boxPoly(min: number, max: number): Polyhedron {
  return {
    vertices: [
      { x: min, y: min, z: min },
      { x: max, y: max, z: max },
    ],
    faces: [],
  };
}

function cubeFeature(depth = 50): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function frontVp(sourceId = 'p1'): Viewport {
  return {
    id: 'front',
    sourceId,
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: 150, y: 150 },
    widthOnSheet: 100,
    scale: 1,
    label: 'FRONT',
  };
}

// ─── reanchorCuttingPlane ────────────────────────────────────────────────

describe('reanchorCuttingPlane', () => {
  const xPlane = (x: number): SectionPlane => ({ origin: [x, 10, 10], normal: [1, 0, 0] });

  it('centre cut stays a centre cut when the model grows', () => {
    const out = reanchorCuttingPlane(xPlane(25), boxPoly(0, 50), boxPoly(0, 80));
    expect(out.origin).toEqual([40, 40, 40]);
    expect(out.normal).toEqual([1, 0, 0]);
  });

  it('preserves the relative station (20% from the low side)', () => {
    const out = reanchorCuttingPlane(xPlane(10), boxPoly(0, 50), boxPoly(0, 100));
    expect(out.origin[0]).toBeCloseTo(20, 9);
    // In-plane components sit at the new bbox centre.
    expect(out.origin[1]).toBeCloseTo(50, 9);
    expect(out.origin[2]).toBeCloseTo(50, 9);
  });

  it('no old model → centre of the new body (honest default)', () => {
    const out = reanchorCuttingPlane(xPlane(10), null, boxPoly(0, 60));
    expect(out.origin).toEqual([30, 30, 30]);
  });

  it('plane outside the old body clamps into the new body', () => {
    const out = reanchorCuttingPlane(xPlane(-10), boxPoly(0, 50), boxPoly(0, 100));
    expect(out.origin[0]).toBeCloseTo(0, 9);
  });

  it('degenerate old span (flat body) falls back to the centre station', () => {
    // Old body flat along X → span 0 along the plane normal.
    const flat: Polyhedron = {
      vertices: [
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 50, z: 50 },
      ],
      faces: [],
    };
    const out = reanchorCuttingPlane(xPlane(5), flat, boxPoly(0, 40));
    expect(out.origin).toEqual([20, 20, 20]);
  });

  it('refuses an empty new model and a degenerate normal', () => {
    expect(() =>
      reanchorCuttingPlane(xPlane(25), boxPoly(0, 50), { vertices: [], faces: [] }),
    ).toThrow(/no vertices/);
    expect(() =>
      reanchorCuttingPlane({ origin: [0, 0, 0], normal: [0, 0, 0] }, null, boxPoly(0, 50)),
    ).toThrow(/normal/);
  });
});

// ─── measureSheetDimension / auditSheetDimensions ────────────────────────

describe('sheet dimension audit (associative re-measurement)', () => {
  const capDim: Dimension = {
    id: 'd-depth',
    viewportId: 'front',
    kind: 'linear',
    refs: ['f.cap.bottom', 'f.cap.top'],
  };

  it('a model edit re-measures the same refs to the new value (50 → 80)', () => {
    const vps = [frontVp()];
    const before = measureSheetDimension(
      capDim, vps, new Map([['p1', buildExtrudeTopo(cubeFeature(50))]]),
    );
    const after = measureSheetDimension(
      capDim, vps, new Map([['p1', buildExtrudeTopo(cubeFeature(80))]]),
    );
    expect(before && before.ok && before.value).toBe(50);
    expect(after && after.ok && after.value).toBe(80);
  });

  it('a ref missing from the edited model is an EXPLICIT unresolved-ref, not a stale number', () => {
    const ghost: Dimension = { ...capDim, id: 'd-ghost', refs: ['f.side.7', 'f.side.1'] };
    const res = measureSheetDimension(
      ghost, [frontVp()], new Map([['p1', buildExtrudeTopo(cubeFeature())]]),
    );
    expect(res && !res.ok && res.reason).toBe('unresolved-ref');
  });

  it('no topology / non-standard viewport → null (no measurement context)', () => {
    expect(measureSheetDimension(capDim, [frontVp()], undefined)).toBeNull();
    const sectionVp: Viewport = {
      ...frontVp(),
      id: 'front',
      projection: { kind: 'section', cuttingPlaneId: 'cp1' },
    };
    expect(
      measureSheetDimension(
        capDim, [sectionVp], new Map([['p1', buildExtrudeTopo(cubeFeature())]]),
      ),
    ).toBeNull();
  });

  it('auditSheetDimensions keys every sheet dimension by id', () => {
    const sheet: Sheet = {
      id: 's1', name: 'audit', paperSize: 'A3',
      viewports: [frontVp()],
      dimensions: [capDim, { ...capDim, id: 'd2', refs: ['ghost.x', 'ghost.y'] }],
    };
    const audit = auditSheetDimensions(sheet, new Map([['p1', buildExtrudeTopo(cubeFeature())]]));
    expect(audit.size).toBe(2);
    const ok = audit.get('d-depth');
    expect(ok && ok.ok && ok.value).toBe(50);
    const lost = audit.get('d2');
    expect(lost && !lost.ok && lost.reason).toBe('unresolved-ref');
  });
});

// ─── formatMeasuredValue ─────────────────────────────────────────────────

describe('formatMeasuredValue', () => {
  it('strips trailing zeros and rounds to 0.01', () => {
    expect(formatMeasuredValue(50)).toBe('50');
    expect(formatMeasuredValue(Math.PI)).toBe('3.14');
    expect(formatMeasuredValue(12.5)).toBe('12.5');
  });
  it('appends the degree sign for angular units', () => {
    expect(formatMeasuredValue(90, 'deg')).toBe('90°');
  });
});
