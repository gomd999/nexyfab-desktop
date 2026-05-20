/**
 * gizmoHandle.ts — 3D transform gizmo math.
 *
 * The on-screen handles for translate / rotate / scale interactions
 * boil down to a few common calculations:
 *
 *   - **Hit testing** — does the cursor ray hit handle X?
 *   - **Drag mapping** — given screen-space delta and the active
 *     axis/plane, what's the world-space delta?
 *   - **Snap** — round the delta to a chosen grid / angle.
 *
 * This module supplies that math. The React/Three.js layer renders
 * arrows / rings / handles; this module decides what the user *did*.
 *
 * Axis convention: gizmo orientation is identity-aligned by default;
 * apply a rotation when the gizmo follows an object's local frame.
 */

export type Vec3 = [number, number, number];

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type GizmoAxis = 'x' | 'y' | 'z';
export type GizmoPlane = 'xy' | 'yz' | 'xz';
export type GizmoHandle =
  | { kind: 'axis'; axis: GizmoAxis }
  | { kind: 'plane'; plane: GizmoPlane }
  | { kind: 'uniform' };

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

// ── Axis directions ─────────────────────────────────────────────

const AXIS_DIR: Record<GizmoAxis, Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

const PLANE_NORMAL: Record<GizmoPlane, Vec3> = {
  xy: [0, 0, 1],
  yz: [1, 0, 0],
  xz: [0, 1, 0],
};

// ── Hit testing ─────────────────────────────────────────────────

export interface HandleHit {
  handle: GizmoHandle;
  /** Distance along the ray. */
  distance: number;
  /** Hit point in world. */
  hitPoint: Vec3;
}

/** Find the closest gizmo handle hit by `ray`. Returns null on miss. */
export function pickHandle(
  ray: Ray,
  origin: Vec3,
  size: number,
  mode: GizmoMode,
  pickToleranceMm: number = 1,
): HandleHit | null {
  const candidates: HandleHit[] = [];

  if (mode === 'translate' || mode === 'scale') {
    // Axis handles: cylinder from origin along axis with length `size`.
    for (const axisKey of ['x', 'y', 'z'] as GizmoAxis[]) {
      const axis = AXIS_DIR[axisKey];
      const hit = rayCylinderHit(ray, origin, axis, size, pickToleranceMm);
      if (hit) {
        candidates.push({ handle: { kind: 'axis', axis: axisKey }, distance: hit.t, hitPoint: hit.point });
      }
    }
    // Plane handles: small squares at the axis intersections.
    for (const planeKey of ['xy', 'yz', 'xz'] as GizmoPlane[]) {
      const normal = PLANE_NORMAL[planeKey];
      const hit = rayPlaneSquareHit(ray, origin, normal, size * 0.3, pickToleranceMm);
      if (hit) {
        candidates.push({ handle: { kind: 'plane', plane: planeKey }, distance: hit.t, hitPoint: hit.point });
      }
    }
  }
  if (mode === 'scale') {
    // Uniform-scale handle in the center.
    const hit = raySphereHit(ray, origin, pickToleranceMm * 2);
    if (hit) candidates.push({ handle: { kind: 'uniform' }, distance: hit.t, hitPoint: hit.point });
  }
  if (mode === 'rotate') {
    // Rotation rings: torus around each axis.
    for (const axisKey of ['x', 'y', 'z'] as GizmoAxis[]) {
      const axis = AXIS_DIR[axisKey];
      const hit = rayTorusHit(ray, origin, axis, size, pickToleranceMm);
      if (hit) {
        candidates.push({ handle: { kind: 'axis', axis: axisKey }, distance: hit.t, hitPoint: hit.point });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]!;
}

// ── Drag mapping ────────────────────────────────────────────────

export interface DragInput {
  handle: GizmoHandle;
  /** Ray cast from the screen at the current cursor. */
  currentRay: Ray;
  /** The hit point when the drag started (world). */
  startHitPoint: Vec3;
  /** Origin of the gizmo (world). */
  gizmoOrigin: Vec3;
}

export interface DragResult {
  /** Translation delta (world). */
  translation: Vec3;
  /** Rotation angle (rad) — for rotate mode. */
  rotationRad: number;
  /** Uniform scale factor — for scale mode. */
  scaleFactor: number;
}

/** Map a drag to translation/rotation/scale based on the active handle. */
export function mapDrag(input: DragInput): DragResult {
  switch (input.handle.kind) {
    case 'axis':
      return mapAxisDrag(input.handle.axis, input);
    case 'plane':
      return mapPlaneDrag(input.handle.plane, input);
    case 'uniform':
      return mapUniformScale(input);
  }
}

function mapAxisDrag(axisKey: GizmoAxis, input: DragInput): DragResult {
  const axis = AXIS_DIR[axisKey];
  // Project the ray-vs-axis closest point onto the axis line.
  const cur = closestPointOnLineToRay(input.gizmoOrigin, axis, input.currentRay);
  const start = projectOntoAxis(input.startHitPoint, input.gizmoOrigin, axis);
  const delta: Vec3 = [
    (cur[0] - input.gizmoOrigin[0]) - (start[0] - input.gizmoOrigin[0]),
    (cur[1] - input.gizmoOrigin[1]) - (start[1] - input.gizmoOrigin[1]),
    (cur[2] - input.gizmoOrigin[2]) - (start[2] - input.gizmoOrigin[2]),
  ];
  return { translation: delta, rotationRad: 0, scaleFactor: 1 };
}

function mapPlaneDrag(planeKey: GizmoPlane, input: DragInput): DragResult {
  const normal = PLANE_NORMAL[planeKey];
  const cur = rayPlaneIntersect(input.currentRay, input.gizmoOrigin, normal);
  if (!cur) return { translation: [0, 0, 0], rotationRad: 0, scaleFactor: 1 };
  return {
    translation: [
      cur[0] - input.startHitPoint[0],
      cur[1] - input.startHitPoint[1],
      cur[2] - input.startHitPoint[2],
    ],
    rotationRad: 0,
    scaleFactor: 1,
  };
}

function mapUniformScale(input: DragInput): DragResult {
  const startDist = distance(input.startHitPoint, input.gizmoOrigin);
  const curHit = rayPlaneIntersect(input.currentRay, input.gizmoOrigin, [0, 0, 1]);
  if (!curHit) return { translation: [0, 0, 0], rotationRad: 0, scaleFactor: 1 };
  const curDist = distance(curHit, input.gizmoOrigin);
  return {
    translation: [0, 0, 0],
    rotationRad: 0,
    scaleFactor: startDist > 0 ? curDist / startDist : 1,
  };
}

// ── Snap ────────────────────────────────────────────────────────

export function snapTranslation(v: Vec3, gridMm: number): Vec3 {
  if (gridMm <= 0) return v;
  return [
    Math.round(v[0] / gridMm) * gridMm,
    Math.round(v[1] / gridMm) * gridMm,
    Math.round(v[2] / gridMm) * gridMm,
  ];
}

export function snapAngle(angleRad: number, angleStepRad: number): number {
  if (angleStepRad <= 0) return angleRad;
  return Math.round(angleRad / angleStepRad) * angleStepRad;
}

// ── Ray-primitive intersection helpers ──────────────────────────

function rayCylinderHit(ray: Ray, origin: Vec3, axis: Vec3, length: number, radius: number): { t: number; point: Vec3 } | null {
  // Closest point on the ray to the axis line; if within `radius` and
  // within [0, length] along the axis, count as a hit.
  const closestPoint = closestPointOnLineToRay(origin, axis, ray);
  const t = (closestPoint[0] - origin[0]) * axis[0] + (closestPoint[1] - origin[1]) * axis[1] + (closestPoint[2] - origin[2]) * axis[2];
  if (t < 0 || t > length) return null;
  // Distance from ray to that point.
  const rayClosest = closestPointOnRayToPoint(ray, closestPoint);
  const d = distance(closestPoint, rayClosest);
  if (d > radius) return null;
  // Approximate hit distance along ray.
  const tRay = (rayClosest[0] - ray.origin[0]) * ray.direction[0] +
               (rayClosest[1] - ray.origin[1]) * ray.direction[1] +
               (rayClosest[2] - ray.origin[2]) * ray.direction[2];
  if (tRay < 0) return null;
  return { t: tRay, point: rayClosest };
}

function rayPlaneSquareHit(ray: Ray, origin: Vec3, normal: Vec3, halfSize: number, _tol: number): { t: number; point: Vec3 } | null {
  void _tol;
  const hit = rayPlaneIntersect(ray, origin, normal);
  if (!hit) return null;
  // Check within square bounds projected to the plane.
  const local: Vec3 = [hit[0] - origin[0], hit[1] - origin[1], hit[2] - origin[2]];
  // Subtract axial component.
  const axial = local[0] * normal[0] + local[1] * normal[1] + local[2] * normal[2];
  const inPlane: Vec3 = [local[0] - axial * normal[0], local[1] - axial * normal[1], local[2] - axial * normal[2]];
  const maxComp = Math.max(Math.abs(inPlane[0]), Math.abs(inPlane[1]), Math.abs(inPlane[2]));
  if (maxComp > halfSize) return null;
  const tRay = (hit[0] - ray.origin[0]) * ray.direction[0] +
               (hit[1] - ray.origin[1]) * ray.direction[1] +
               (hit[2] - ray.origin[2]) * ray.direction[2];
  if (tRay < 0) return null;
  return { t: tRay, point: hit };
}

function raySphereHit(ray: Ray, center: Vec3, radius: number): { t: number; point: Vec3 } | null {
  const oc: Vec3 = [ray.origin[0] - center[0], ray.origin[1] - center[1], ray.origin[2] - center[2]];
  const a = ray.direction[0] ** 2 + ray.direction[1] ** 2 + ray.direction[2] ** 2;
  const b = 2 * (oc[0] * ray.direction[0] + oc[1] * ray.direction[1] + oc[2] * ray.direction[2]);
  const c = (oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2]) - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t = (-b - sq) / (2 * a);
  if (t < 0) return null;
  return { t, point: [ray.origin[0] + ray.direction[0] * t, ray.origin[1] + ray.direction[1] * t, ray.origin[2] + ray.direction[2] * t] };
}

function rayTorusHit(ray: Ray, center: Vec3, axis: Vec3, majorRadius: number, _tubeRadius: number): { t: number; point: Vec3 } | null {
  void _tubeRadius;
  // Approximate torus pick as ray-plane-intersect filtered by distance ≈ majorRadius.
  const hit = rayPlaneIntersect(ray, center, axis);
  if (!hit) return null;
  const r = distance(hit, center);
  if (Math.abs(r - majorRadius) > 1) return null;
  const tRay = (hit[0] - ray.origin[0]) * ray.direction[0] +
               (hit[1] - ray.origin[1]) * ray.direction[1] +
               (hit[2] - ray.origin[2]) * ray.direction[2];
  if (tRay < 0) return null;
  return { t: tRay, point: hit };
}

export function rayPlaneIntersect(ray: Ray, planePoint: Vec3, planeNormal: Vec3): Vec3 | null {
  const denom = ray.direction[0] * planeNormal[0] + ray.direction[1] * planeNormal[1] + ray.direction[2] * planeNormal[2];
  if (Math.abs(denom) < 1e-9) return null;
  const num = (planePoint[0] - ray.origin[0]) * planeNormal[0] +
              (planePoint[1] - ray.origin[1]) * planeNormal[1] +
              (planePoint[2] - ray.origin[2]) * planeNormal[2];
  const t = num / denom;
  if (t < 0) return null;
  return [ray.origin[0] + ray.direction[0] * t, ray.origin[1] + ray.direction[1] * t, ray.origin[2] + ray.direction[2] * t];
}

// ── Geometry helpers ────────────────────────────────────────────

function closestPointOnLineToRay(lineOrigin: Vec3, lineDir: Vec3, ray: Ray): Vec3 {
  // Skew-line closest point: minimize |P - Q| where P on line, Q on ray.
  const d1 = lineDir;
  const d2 = ray.direction;
  const r: Vec3 = [lineOrigin[0] - ray.origin[0], lineOrigin[1] - ray.origin[1], lineOrigin[2] - ray.origin[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
  const denom = a * e - b * b;
  if (Math.abs(denom) < 1e-9) return lineOrigin;
  const s = (b * f - c * e) / denom;
  return [lineOrigin[0] + d1[0] * s, lineOrigin[1] + d1[1] * s, lineOrigin[2] + d1[2] * s];
}

function closestPointOnRayToPoint(ray: Ray, point: Vec3): Vec3 {
  const r: Vec3 = [point[0] - ray.origin[0], point[1] - ray.origin[1], point[2] - ray.origin[2]];
  const t = r[0] * ray.direction[0] + r[1] * ray.direction[1] + r[2] * ray.direction[2];
  const clampedT = Math.max(0, t);
  return [
    ray.origin[0] + ray.direction[0] * clampedT,
    ray.origin[1] + ray.direction[1] * clampedT,
    ray.origin[2] + ray.direction[2] * clampedT,
  ];
}

function projectOntoAxis(point: Vec3, origin: Vec3, axis: Vec3): Vec3 {
  const r: Vec3 = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  const t = r[0] * axis[0] + r[1] * axis[1] + r[2] * axis[2];
  return [origin[0] + axis[0] * t, origin[1] + axis[1] * t, origin[2] + axis[2] * t];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
