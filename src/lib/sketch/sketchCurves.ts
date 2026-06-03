/**
 * sketchCurves — spline + ellipse sketch curve primitives.
 *
 * Phase 2.1.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Sketches in NexyFab are ultimately tessellated to polylines so they can
 * feed the existing loop/profile pipeline (see `sketchProfile.ts`) and the
 * OCCT extrude/revolve/sweep stages. Lines and arcs already have exact
 * representations; this module adds the two remaining "smooth" primitives —
 * Bézier splines and ellipses — and tessellates them to {x,y} polylines.
 *
 * Vector convention matches the rest of the sketch layer: plain 2D points
 * `{ x: number; y: number }` (the profile pipeline works in sketch-local
 * 2D coords; `SketchPlane` lifts them to 3D at the edge).
 *
 * Pure math, fully deterministic — no DOM / Three.js / network / clock /
 * randomness. Same input ⇒ identical output. Defensive validation throws
 * `Error` on malformed input (NaN, non-finite, wrong control-point count,
 * non-positive radii / segment counts).
 */

// ─── Vec2 ───────────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

function assertFinite(v: Vec2, label: string): void {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) {
    throw new Error(`${label}: point must have finite x,y (got x=${v.x}, y=${v.y})`);
  }
}

function assertFiniteNumber(n: number, label: string): void {
  if (!Number.isFinite(n)) {
    throw new Error(`${label}: expected a finite number (got ${n})`);
  }
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ─── Bézier evaluation (de Casteljau) ───────────────────────────────────────

/**
 * Quadratic Bézier point at parameter `t ∈ [0,1]` via de Casteljau.
 * `t=0 → p0`, `t=1 → p2`.
 */
export function quadraticBezier(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 {
  assertFinite(p0, 'quadraticBezier.p0');
  assertFinite(p1, 'quadraticBezier.p1');
  assertFinite(p2, 'quadraticBezier.p2');
  assertFiniteNumber(t, 'quadraticBezier.t');
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  return lerp(a, b, t);
}

/**
 * Cubic Bézier point at parameter `t ∈ [0,1]` via de Casteljau.
 * `t=0 → p0`, `t=1 → p3`.
 */
export function cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  assertFinite(p0, 'cubicBezier.p0');
  assertFinite(p1, 'cubicBezier.p1');
  assertFinite(p2, 'cubicBezier.p2');
  assertFinite(p3, 'cubicBezier.p3');
  assertFiniteNumber(t, 'cubicBezier.t');
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  return lerp(d, e, t);
}

/**
 * Tessellate a quadratic (3 control points) or cubic (4 control points)
 * Bézier into a polyline of `segments + 1` points, including both endpoints.
 *
 * @param controlPoints exactly 3 or 4 points; throws otherwise.
 * @param segments      number of straight chords; must be an integer >= 1.
 * @returns             `segments + 1` evenly-parameterised points.
 */
export function tessellateBezier(
  controlPoints: ReadonlyArray<Vec2>,
  segments: number,
): Vec2[] {
  if (controlPoints.length !== 3 && controlPoints.length !== 4) {
    throw new Error(
      `tessellateBezier: expected 3 (quadratic) or 4 (cubic) control points, got ${controlPoints.length}`,
    );
  }
  if (!Number.isInteger(segments) || segments < 1) {
    throw new Error(`tessellateBezier: segments must be an integer >= 1 (got ${segments})`);
  }
  for (let i = 0; i < controlPoints.length; i++) {
    assertFinite(controlPoints[i]!, `tessellateBezier.controlPoints[${i}]`);
  }

  const out: Vec2[] = [];
  const isCubic = controlPoints.length === 4;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    if (isCubic) {
      out.push(
        cubicBezier(controlPoints[0]!, controlPoints[1]!, controlPoints[2]!, controlPoints[3]!, t),
      );
    } else {
      out.push(quadraticBezier(controlPoints[0]!, controlPoints[1]!, controlPoints[2]!, t));
    }
  }
  return out;
}

// ─── Ellipse ────────────────────────────────────────────────────────────────

/**
 * A single point on an axis-aligned (then optionally rotated) ellipse.
 *
 * Local-frame parameterisation:
 *   x = cx + rx·cos(angle)
 *   y = cy + ry·sin(angle)
 * then the (x,y) offset from centre is rotated CCW by `rotationRad` about the
 * centre. `angle=0 → +rx along the (rotated) major axis`, `angle=π/2 → +ry`.
 */
export function ellipsePoint(
  center: Vec2,
  rx: number,
  ry: number,
  angleRad: number,
  rotationRad: number = 0,
): Vec2 {
  assertFinite(center, 'ellipsePoint.center');
  assertFiniteNumber(rx, 'ellipsePoint.rx');
  assertFiniteNumber(ry, 'ellipsePoint.ry');
  assertFiniteNumber(angleRad, 'ellipsePoint.angleRad');
  assertFiniteNumber(rotationRad, 'ellipsePoint.rotationRad');
  if (rx <= 0) throw new Error(`ellipsePoint: rx must be > 0 (got ${rx})`);
  if (ry <= 0) throw new Error(`ellipsePoint: ry must be > 0 (got ${ry})`);

  const lx = rx * Math.cos(angleRad);
  const ly = ry * Math.sin(angleRad);
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return {
    x: center.x + lx * cos - ly * sin,
    y: center.y + lx * sin + ly * cos,
  };
}

/**
 * Tessellate a full ellipse into a closed polyline of exactly `segments`
 * points (the closing point is implied — `pts[segments-1]` connects back to
 * `pts[0]`, matching the `ProfilePoint` loop convention which does not repeat
 * the start). Deterministic: samples angles at `2π·i/segments`.
 *
 * @param segments integer >= 3 (need at least a triangle to enclose area).
 */
export function tessellateEllipse(
  center: Vec2,
  rx: number,
  ry: number,
  segments: number,
  rotationRad: number = 0,
): Vec2[] {
  assertFinite(center, 'tessellateEllipse.center');
  assertFiniteNumber(rx, 'tessellateEllipse.rx');
  assertFiniteNumber(ry, 'tessellateEllipse.ry');
  assertFiniteNumber(rotationRad, 'tessellateEllipse.rotationRad');
  if (rx <= 0) throw new Error(`tessellateEllipse: rx must be > 0 (got ${rx})`);
  if (ry <= 0) throw new Error(`tessellateEllipse: ry must be > 0 (got ${ry})`);
  if (!Number.isInteger(segments) || segments < 3) {
    throw new Error(`tessellateEllipse: segments must be an integer >= 3 (got ${segments})`);
  }

  const out: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    out.push(ellipsePoint(center, rx, ry, angle, rotationRad));
  }
  return out;
}

// ─── Polyline measures ──────────────────────────────────────────────────────

/**
 * Total length of an open polyline (sum of chord lengths between consecutive
 * points). For a closed polyline, append a copy of the first point or add the
 * closing chord separately. Returns 0 for a 0/1-point input.
 */
export function polylineLength(pts: ReadonlyArray<Vec2>): number {
  for (let i = 0; i < pts.length; i++) assertFinite(pts[i]!, `polylineLength.pts[${i}]`);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Axis-aligned bounding box of a polyline. Throws on empty input (an empty
 * box is undefined — callers should special-case "no points" upstream).
 */
export function polylineBbox(pts: ReadonlyArray<Vec2>): Bbox {
  if (pts.length === 0) {
    throw new Error('polylineBbox: cannot compute bbox of an empty polyline');
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    assertFinite(p, `polylineBbox.pts[${i}]`);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
