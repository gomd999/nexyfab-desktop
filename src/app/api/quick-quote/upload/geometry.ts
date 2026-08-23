export type Geometry = {
  volume_cm3: number;
  surface_area_cm2: number;
  bbox: { w: number; h: number; d: number };
};

// Browser measurements are client input. Keep them finite and within a
// manufacturing-part envelope before they are used for pricing or persisted.
export const MAX_CLIENT_GEOMETRY_VOLUME_CM3 = 1_000_000_000;
export const MAX_CLIENT_GEOMETRY_SURFACE_AREA_CM2 = 100_000_000;
export const MAX_CLIENT_GEOMETRY_DIMENSION_MM = 10_000;

export function isValidGeometry(value: unknown): value is Geometry {
  if (!value || typeof value !== 'object') return false;
  const geometry = value as Partial<Geometry>;
  const finitePositiveWithin = (number: unknown, maximum: number) =>
    typeof number === 'number'
    && Number.isFinite(number)
    && number > 0
    && number <= maximum;

  return finitePositiveWithin(geometry.volume_cm3, MAX_CLIENT_GEOMETRY_VOLUME_CM3)
    && finitePositiveWithin(geometry.surface_area_cm2, MAX_CLIENT_GEOMETRY_SURFACE_AREA_CM2)
    && !!geometry.bbox
    && finitePositiveWithin(geometry.bbox.w, MAX_CLIENT_GEOMETRY_DIMENSION_MM)
    && finitePositiveWithin(geometry.bbox.h, MAX_CLIENT_GEOMETRY_DIMENSION_MM)
    && finitePositiveWithin(geometry.bbox.d, MAX_CLIENT_GEOMETRY_DIMENSION_MM);
}

export function approximateGeometryFromDimensions(w: number, h: number, d: number): Geometry {
  return {
    volume_cm3: (w * h * d) / 1000,
    surface_area_cm2: (2 * (w * h + w * d + h * d)) / 100,
    bbox: { w, h, d },
  };
}
