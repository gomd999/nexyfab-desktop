/**
 * patternVariants.ts — Curve / sketch / fill / variable / table-driven
 * patterns beyond the existing linear + circular variants.
 *
 * SolidWorks pattern types we haven't implemented:
 *
 *   - **Curve-driven** — instances placed along a path with uniform
 *     parametric spacing, optionally rotating to follow tangent.
 *   - **Sketch-driven** — instances at sketch points (the user marks
 *     N points on a sketch + pattern places N instances at them).
 *   - **Table-driven** — explicit (x, y, z) instance positions from a
 *     row table (CSV-style import).
 *   - **Fill pattern** — pack instances into a region with a tile
 *     pattern (square, hex, polar, perimeter).
 *   - **Variable pattern** — parameter override per instance (e.g.
 *     hole diameter varies along a wing's span).
 *
 * Output: an array of `InstanceTransform` objects (position +
 * optional rotation + optional parameter override) that the feature
 * pipeline applies to the seed body.
 */

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export interface InstanceTransform {
  /** Translation (mm). */
  position: Vec3;
  /** Rotation (radians) about X / Y / Z. Default 0. */
  rotation?: Vec3;
  /** Per-instance scalar parameter overrides (e.g. { radius: 5 }). */
  paramOverrides?: Record<string, number>;
}

// ── Curve-driven pattern ────────────────────────────────────────

export interface CurvePoint {
  /** Position on the curve (mm). */
  position: Vec3;
  /** Unit tangent at this point. */
  tangent: Vec3;
}

export interface CurveDrivenOptions {
  /** Number of instances along the curve. */
  count: number;
  /** Spacing along the curve (mm). If set, count overrides this implicitly via curve length. */
  spacingMm?: number;
  /** Whether to rotate each instance to align with the curve's tangent. */
  alignToTangent: boolean;
  /** Optional skip pattern — `[0, 2, 5]` skips instances at those indices. */
  skipIndices?: number[];
}

/** Generate instances along a sampled curve. Spacing falls back to
 *  count-based uniform if `spacingMm` not given. */
export function curveDrivenPattern(
  curve: CurvePoint[],
  options: CurveDrivenOptions,
): InstanceTransform[] {
  if (curve.length < 2 || options.count < 1) return [];
  const out: InstanceTransform[] = [];
  // Compute cumulative arc length.
  const arc: number[] = [0];
  for (let i = 1; i < curve.length; i++) {
    const dx = curve[i]!.position[0] - curve[i - 1]!.position[0];
    const dy = curve[i]!.position[1] - curve[i - 1]!.position[1];
    const dz = curve[i]!.position[2] - curve[i - 1]!.position[2];
    arc.push(arc[i - 1]! + Math.hypot(dx, dy, dz));
  }
  const totalLength = arc[arc.length - 1]!;
  const skipSet = new Set(options.skipIndices ?? []);

  for (let i = 0; i < options.count; i++) {
    if (skipSet.has(i)) continue;
    const targetArc = options.spacingMm != null
      ? i * options.spacingMm
      : (i / Math.max(1, options.count - 1)) * totalLength;
    if (targetArc > totalLength) break;
    // Find the curve segment containing this arc length.
    let segIdx = 0;
    while (segIdx < arc.length - 1 && arc[segIdx + 1]! < targetArc) segIdx++;
    const segStart = arc[segIdx]!;
    const segEnd = arc[Math.min(segIdx + 1, arc.length - 1)]!;
    const t = segEnd > segStart ? (targetArc - segStart) / (segEnd - segStart) : 0;
    const a = curve[segIdx]!;
    const b = curve[Math.min(segIdx + 1, curve.length - 1)]!;
    const position: Vec3 = [
      a.position[0] + (b.position[0] - a.position[0]) * t,
      a.position[1] + (b.position[1] - a.position[1]) * t,
      a.position[2] + (b.position[2] - a.position[2]) * t,
    ];
    let rotation: Vec3 | undefined;
    if (options.alignToTangent) {
      const tangent: Vec3 = [
        a.tangent[0] + (b.tangent[0] - a.tangent[0]) * t,
        a.tangent[1] + (b.tangent[1] - a.tangent[1]) * t,
        a.tangent[2] + (b.tangent[2] - a.tangent[2]) * t,
      ];
      rotation = [0, Math.atan2(tangent[1], tangent[0]), Math.atan2(tangent[2], Math.hypot(tangent[0], tangent[1]))];
    }
    out.push({ position, rotation });
  }
  return out;
}

// ── Sketch-driven pattern ───────────────────────────────────────

/** Generate instances at user-marked sketch points. The sketch plane
 *  is supplied so the 2D points are projected into 3D. */
export interface SketchPoint {
  x: number;
  y: number;
}

export interface SketchPlane {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
}

export function sketchDrivenPattern(
  points: SketchPoint[],
  plane: SketchPlane,
): InstanceTransform[] {
  return points.map(p => ({
    position: [
      plane.origin[0] + plane.xAxis[0] * p.x + plane.yAxis[0] * p.y,
      plane.origin[1] + plane.xAxis[1] * p.x + plane.yAxis[1] * p.y,
      plane.origin[2] + plane.xAxis[2] * p.x + plane.yAxis[2] * p.y,
    ],
  }));
}

// ── Table-driven pattern ────────────────────────────────────────

export interface PatternTableRow {
  x: number;
  y: number;
  z?: number;
  /** Rotation overrides (radians). */
  rx?: number;
  ry?: number;
  rz?: number;
  /** Per-instance parameter overrides. */
  params?: Record<string, number>;
}

export function tableDrivenPattern(rows: PatternTableRow[]): InstanceTransform[] {
  return rows.map(r => {
    const inst: InstanceTransform = {
      position: [r.x, r.y, r.z ?? 0],
    };
    if (r.rx != null || r.ry != null || r.rz != null) {
      inst.rotation = [r.rx ?? 0, r.ry ?? 0, r.rz ?? 0];
    }
    if (r.params) inst.paramOverrides = r.params;
    return inst;
  });
}

// ── Fill pattern ────────────────────────────────────────────────

export type FillTileShape = 'square' | 'hex' | 'polar' | 'perimeter';

export interface FillRegion {
  /** Region bounding box on the sketch plane (2D, mm). */
  boundary: SketchPoint[];
  plane: SketchPlane;
}

export interface FillPatternOptions {
  tile: FillTileShape;
  /** Spacing between instances (mm). */
  spacingMm: number;
  /** Optional margin from region boundary (mm). */
  marginMm?: number;
  /** Polar fill: center + radial steps. */
  polarCenter?: SketchPoint;
}

/** Generate instances tiled inside a 2D region. */
export function fillPattern(region: FillRegion, options: FillPatternOptions): InstanceTransform[] {
  if (region.boundary.length < 3) return [];
  // Compute bbox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of region.boundary) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const margin = options.marginMm ?? 0;
  minX += margin; minY += margin; maxX -= margin; maxY -= margin;
  const points: SketchPoint[] = [];

  switch (options.tile) {
    case 'square':
      for (let x = minX; x <= maxX; x += options.spacingMm) {
        for (let y = minY; y <= maxY; y += options.spacingMm) {
          if (pointInPolygon({ x, y }, region.boundary)) points.push({ x, y });
        }
      }
      break;
    case 'hex': {
      const rowH = options.spacingMm * Math.sqrt(3) / 2;
      let row = 0;
      for (let y = minY; y <= maxY; y += rowH) {
        const offsetX = (row % 2 === 0) ? 0 : options.spacingMm / 2;
        for (let x = minX + offsetX; x <= maxX; x += options.spacingMm) {
          if (pointInPolygon({ x, y }, region.boundary)) points.push({ x, y });
        }
        row++;
      }
      break;
    }
    case 'polar': {
      const c = options.polarCenter ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      const maxR = Math.max(Math.hypot(maxX - c.x, maxY - c.y), Math.hypot(c.x - minX, c.y - minY));
      const rings = Math.floor(maxR / options.spacingMm);
      for (let i = 1; i <= rings; i++) {
        const r = i * options.spacingMm;
        const perim = 2 * Math.PI * r;
        const count = Math.max(6, Math.round(perim / options.spacingMm));
        for (let k = 0; k < count; k++) {
          const a = (k / count) * Math.PI * 2;
          const p = { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
          if (pointInPolygon(p, region.boundary)) points.push(p);
        }
      }
      break;
    }
    case 'perimeter': {
      // Walk along the polygon perimeter, placing every spacingMm.
      for (let i = 0; i < region.boundary.length; i++) {
        const a = region.boundary[i]!;
        const b = region.boundary[(i + 1) % region.boundary.length]!;
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.floor(segLen / options.spacingMm);
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
      break;
    }
  }
  return sketchDrivenPattern(points, region.plane);
}

/** Ray-casting point-in-polygon. */
function pointInPolygon(p: SketchPoint, poly: SketchPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect = ((a.y > p.y) !== (b.y > p.y))
      && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Variable pattern (parameter override per instance) ──────────

export interface VariableSpec {
  /** Parameter name to vary. */
  paramName: string;
  /** Start value at instance 0. */
  startValue: number;
  /** End value at last instance. */
  endValue: number;
  /** Interpolation mode. */
  interpolation?: 'linear' | 'quadratic' | 'cubic';
}

/** Apply variable spec(s) on top of an existing instance list. */
export function variablePattern(
  baseInstances: InstanceTransform[],
  variables: VariableSpec[],
): InstanceTransform[] {
  const n = baseInstances.length;
  if (n === 0) return [];
  return baseInstances.map((inst, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const overrides: Record<string, number> = { ...(inst.paramOverrides ?? {}) };
    for (const v of variables) {
      const tApplied = v.interpolation === 'quadratic' ? t * t
        : v.interpolation === 'cubic' ? t * t * t
        : t;
      overrides[v.paramName] = v.startValue + (v.endValue - v.startValue) * tApplied;
    }
    return { ...inst, paramOverrides: overrides };
  });
}
