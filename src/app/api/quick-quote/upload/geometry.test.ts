import { describe, expect, it } from 'vitest';
import {
  MAX_CLIENT_GEOMETRY_DIMENSION_MM,
  MAX_CLIENT_GEOMETRY_SURFACE_AREA_CM2,
  MAX_CLIENT_GEOMETRY_VOLUME_CM3,
  approximateGeometryFromDimensions,
  isValidGeometry,
} from './geometry';

const valid = {
  volume_cm3: 10,
  surface_area_cm2: 20,
  bbox: { w: 30, h: 40, d: 50 },
};

describe('quick quote client geometry bounds', () => {
  it('accepts finite positive measurements within the envelope', () => {
    expect(isValidGeometry(valid)).toBe(true);
  });

  it.each([
    ['volume', { ...valid, volume_cm3: MAX_CLIENT_GEOMETRY_VOLUME_CM3 + 1 }],
    ['surface area', { ...valid, surface_area_cm2: MAX_CLIENT_GEOMETRY_SURFACE_AREA_CM2 + 1 }],
    ['width', { ...valid, bbox: { ...valid.bbox, w: MAX_CLIENT_GEOMETRY_DIMENSION_MM + 1 } }],
    ['non-finite', { ...valid, volume_cm3: Number.POSITIVE_INFINITY }],
  ])('rejects unsafe %s input', (_label, candidate) => {
    expect(isValidGeometry(candidate)).toBe(false);
  });

  it('produces a candidate that can be checked for overflow', () => {
    expect(isValidGeometry(approximateGeometryFromDimensions(100, 200, 300))).toBe(true);
    expect(isValidGeometry(approximateGeometryFromDimensions(Number.MAX_VALUE, 2, 2))).toBe(false);
  });
});
