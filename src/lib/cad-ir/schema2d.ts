/**
 * schema2d.ts — 2D drawing IR (DWG-2D initiative).
 *
 * The 3D IR (schema.ts) describes a solid: bbox / genus / watertight / volume. A 2D drawing has
 * none of that — it has dimension VALUES, circle radii, entity counts by type, drawing extents and
 * layers. `Ir2d` is the flat, measurable evidence extracted from a DXF/DWG so a 2D gate can compare
 * an interpretation against the drawing's OWN evidence, not against a 3D reconstruction.
 *
 * Honesty invariants (enforced at construction in ingestDxf2d.ts):
 *   1. `units:null` when the DXF/DWG does not DECLARE units ($INSUNITS absent / unitless). We never
 *      guess mm — a null unit means "compare ratios/counts, not absolute-unit claims".
 *   2. Every approximation or skip the upstream converter reports (spline->polyline, arc tessellation,
 *      block expansion, skipped 3DSOLID/HATCH, truncation) is copied verbatim into `approximations`.
 *      Nothing is silently dropped.
 *   3. Absence is not zero. No dimensions/circles/extents -> the gate returns `unavailable`, never a
 *      fabricated pass. `Ir2d` carries the raw evidence so the gate can make that call.
 */

/** DXF entity type name -> count (e.g. { LINE: 4, CIRCLE: 2, DIMENSION: 2 }). */
export type EntityCounts = Record<string, number>;

/** A dimension entity's measured value (DXF group code 42) and its display text (code 1). */
export interface Ir2dDimension {
  /** Measured value — code 42. The trustworthy number (text can be overridden by the author). */
  value: number;
  /** Display text — code 1. May differ from `value` (author override); kept for auditing. */
  text: string;
}

/** A circle: radius (code 40) and optional center (codes 10/20). Only radius is gate-compared. */
export interface Ir2dCircle {
  r: number;
  cx?: number;
  cy?: number;
}

/** Drawing extents = bounding box width/height of all measurable geometry. Position is not retained. */
export interface Ir2dExtents {
  w: number;
  h: number;
}

/** Flat 2D measurable evidence extracted from a DXF/DWG. */
export interface Ir2d {
  /** Declared drawing units, or null when the source declares none (honesty invariant #1). */
  units: 'mm' | 'in' | null;
  /** Count of each DXF entity type present in the ENTITIES section. */
  entityCounts: EntityCounts;
  /** Dimension entities with measured value + display text. */
  dimensions: Ir2dDimension[];
  /** Circle entities (radius, optional center). */
  circles: Ir2dCircle[];
  /** Drawing extents (w/h), or null when no bounded geometry was found. */
  extents: Ir2dExtents | null;
  /** Layer names declared in the LAYER table. */
  layers: string[];
  /** Every approximation/skip reported by the converter — surfaced, never hidden (invariant #2). */
  approximations: string[];
}

/** True when the IR has at least one piece of measurable evidence a gate can compare against. */
export function ir2dHasEvidence(ir: Ir2d): boolean {
  return ir.dimensions.length > 0 || ir.circles.length > 0 || ir.extents !== null;
}

/** Normalize an arbitrary object into an Ir2d with the honesty invariants applied (defensive). */
export function normalizeIr2d(raw: Partial<Ir2d> | null | undefined): Ir2d {
  const r = raw ?? {};
  const units = r.units === 'mm' || r.units === 'in' ? r.units : null;
  const entityCounts: EntityCounts = {};
  for (const [k, v] of Object.entries(r.entityCounts ?? {})) {
    const n = Math.trunc(Number(v));
    if (typeof k === 'string' && k && Number.isFinite(n) && n > 0) entityCounts[k] = n;
  }
  const dimensions: Ir2dDimension[] = (r.dimensions ?? [])
    .filter((d): d is Ir2dDimension => !!d && Number.isFinite(Number(d.value)))
    .map((d) => ({ value: +Number(d.value).toFixed(4), text: String(d.text ?? '') }));
  const circles: Ir2dCircle[] = (r.circles ?? [])
    .filter((c): c is Ir2dCircle => !!c && Number.isFinite(Number(c.r)) && Number(c.r) > 0)
    .map((c) => ({
      r: +Number(c.r).toFixed(4),
      ...(Number.isFinite(Number(c.cx)) ? { cx: +Number(c.cx).toFixed(4) } : {}),
      ...(Number.isFinite(Number(c.cy)) ? { cy: +Number(c.cy).toFixed(4) } : {}),
    }));
  const extents: Ir2dExtents | null =
    r.extents && Number.isFinite(Number(r.extents.w)) && Number.isFinite(Number(r.extents.h)) && Number(r.extents.w) > 0 && Number(r.extents.h) > 0
      ? { w: +Number(r.extents.w).toFixed(4), h: +Number(r.extents.h).toFixed(4) }
      : null;
  const layers = [...new Set((r.layers ?? []).filter((l): l is string => typeof l === 'string' && !!l))];
  const approximations = [...new Set((r.approximations ?? []).filter((a): a is string => typeof a === 'string' && !!a))];
  return { units, entityCounts, dimensions, circles, extents, layers, approximations };
}
