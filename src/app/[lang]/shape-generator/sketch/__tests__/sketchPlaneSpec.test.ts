/**
 * sketchPlaneSpec.test.ts — Wave 2 Phase 2 Track D3.
 *
 * Pure unit tests for the new `SketchPlaneSpec` discriminated union +
 * `toLegacyPlane` / `toSketchPlaneSpec` adapters (spec §6.3, §10.1).
 */

import { describe, it, expect } from 'vitest';
import {
  isRefGeomPlaneSpec,
  isStandardPlaneSpec,
  toLegacyPlane,
  toSketchPlaneSpec,
  type SketchPlaneSpec,
} from '../types';

describe('SketchPlaneSpec adapters (W3, spec §6.3 / §10.1)', () => {
  it('toLegacyPlane passes through the legacy literal', () => {
    expect(toLegacyPlane('xy')).toBe('xy');
    expect(toLegacyPlane('xz')).toBe('xz');
    expect(toLegacyPlane('yz')).toBe('yz');
  });

  it('toLegacyPlane returns the .plane field for a standard spec', () => {
    expect(toLegacyPlane({ kind: 'standard', plane: 'xz' })).toBe('xz');
    expect(toLegacyPlane({ kind: 'standard', plane: 'yz', offset: 12 })).toBe('yz');
  });

  it('toLegacyPlane falls back to "xy" for a refGeom spec', () => {
    expect(
      toLegacyPlane({ kind: 'refGeom', planeId: 'some-uuid' }),
    ).toBe('xy');
  });

  it('toSketchPlaneSpec lifts the literal with no offset', () => {
    const spec = toSketchPlaneSpec('xy');
    expect(spec).toEqual({ kind: 'standard', plane: 'xy' });
  });

  it('toSketchPlaneSpec includes the offset only when non-zero', () => {
    expect(toSketchPlaneSpec('xy', 5)).toEqual({
      kind: 'standard',
      plane: 'xy',
      offset: 5,
    });
    expect(toSketchPlaneSpec('xy', 0)).toEqual({
      kind: 'standard',
      plane: 'xy',
    });
  });

  it('type guards narrow correctly', () => {
    const standard: SketchPlaneSpec = { kind: 'standard', plane: 'xy' };
    const refGeom: SketchPlaneSpec = { kind: 'refGeom', planeId: 'p1' };
    expect(isStandardPlaneSpec(standard)).toBe(true);
    expect(isStandardPlaneSpec(refGeom)).toBe(false);
    expect(isRefGeomPlaneSpec(standard)).toBe(false);
    expect(isRefGeomPlaneSpec(refGeom)).toBe(true);
  });
});
