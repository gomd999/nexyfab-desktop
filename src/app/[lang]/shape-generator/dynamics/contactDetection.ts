/**
 * contactDetection.ts — AABB sweep + SAT narrow phase.
 *
 * Real physics needs collision detection. The cheapest version
 * that's still useful for mechanical assemblies:
 *
 *   1. **Broad phase**: O(n²) AABB overlap test (or sweep-and-
 *      prune for moderate body counts).
 *   2. **Narrow phase**: SAT (Separating Axis Theorem) over the
 *      body's oriented bounding box (OBB) — works for any convex
 *      hull but we ship OBB for now.
 *
 * Output: a list of `ContactPair` entries with contact normal +
 * penetration depth. Caller (impulse solver) uses these to
 * generate collision impulses.
 *
 * Performance note: real physics engines (Bullet, Havok) use
 * BVH + GJK + EPA. This module is preview-grade — fine for
 * 10-50 bodies. Beyond that, BVH is the obvious next step.
 */

import type { Vec3 } from './rigidBody';
import { v3 } from './rigidBody';

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface OrientedBody {
  /** Body id. */
  id: string;
  /** Center of mass in world frame. */
  center: Vec3;
  /** Half-extents along local axes. */
  halfExtents: Vec3;
  /** Three orthonormal axes (rotated body frame, in world coords). */
  axes: [Vec3, Vec3, Vec3];
}

export interface ContactPair {
  bodyA: string;
  bodyB: string;
  /** World-frame contact normal pointing from A → B. */
  normal: Vec3;
  /** Penetration depth (m). */
  depth: number;
  /** Approximate contact point. */
  point: Vec3;
}

// ── AABB helpers ────────────────────────────────────────────────────

export function aabbFromOrientedBody(b: OrientedBody): Aabb {
  // Compute the AABB enclosing the OBB.
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corners.push(v3.add(
      v3.add(v3.add(b.center, v3.scale(b.axes[0], sx * b.halfExtents.x)),
                            v3.scale(b.axes[1], sy * b.halfExtents.y)),
                            v3.scale(b.axes[2], sz * b.halfExtents.z),
    ));
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of corners) {
    if (c.x < min.x) min.x = c.x;
    if (c.y < min.y) min.y = c.y;
    if (c.z < min.z) min.z = c.z;
    if (c.x > max.x) max.x = c.x;
    if (c.y > max.y) max.y = c.y;
    if (c.z > max.z) max.z = c.z;
  }
  return { min, max };
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return !(a.max.x < b.min.x || b.max.x < a.min.x
        || a.max.y < b.min.y || b.max.y < a.min.y
        || a.max.z < b.min.z || b.max.z < a.min.z);
}

// ── Broad phase ─────────────────────────────────────────────────────

export function broadPhase(bodies: OrientedBody[]): Array<[OrientedBody, OrientedBody]> {
  const out: Array<[OrientedBody, OrientedBody]> = [];
  const aabbs = bodies.map(aabbFromOrientedBody);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (aabbOverlap(aabbs[i]!, aabbs[j]!)) {
        out.push([bodies[i]!, bodies[j]!]);
      }
    }
  }
  return out;
}

// ── Narrow phase: SAT for OBB ───────────────────────────────────────

function projectOntoAxis(b: OrientedBody, axis: Vec3): { min: number; max: number } {
  const c = v3.dot(b.center, axis);
  const r = Math.abs(v3.dot(b.axes[0], axis)) * b.halfExtents.x
          + Math.abs(v3.dot(b.axes[1], axis)) * b.halfExtents.y
          + Math.abs(v3.dot(b.axes[2], axis)) * b.halfExtents.z;
  return { min: c - r, max: c + r };
}

export function satOverlap(a: OrientedBody, b: OrientedBody): ContactPair | null {
  // 15 candidate separating axes: 3 a-faces, 3 b-faces, 9 edge-edge crosses.
  const axes: Vec3[] = [];
  axes.push(a.axes[0], a.axes[1], a.axes[2]);
  axes.push(b.axes[0], b.axes[1], b.axes[2]);
  for (const ax of a.axes) for (const bx of b.axes) {
    const cross = v3.cross(ax, bx);
    const len = v3.length(cross);
    if (len > 1e-6) axes.push(v3.scale(cross, 1 / len));
  }

  let minOverlap = Infinity;
  let bestAxis: Vec3 = { x: 0, y: 0, z: 0 };
  for (const axis of axes) {
    const lenA = Math.hypot(axis.x, axis.y, axis.z);
    if (lenA < 1e-9) continue;
    const unitAxis = v3.scale(axis, 1 / lenA);
    const projA = projectOntoAxis(a, unitAxis);
    const projB = projectOntoAxis(b, unitAxis);
    const overlap = Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min);
    if (overlap < 0) return null; // separating axis found
    if (overlap < minOverlap) {
      minOverlap = overlap;
      bestAxis = unitAxis;
    }
  }
  // Ensure normal points A → B.
  const direction = v3.sub(b.center, a.center);
  if (v3.dot(direction, bestAxis) < 0) bestAxis = v3.scale(bestAxis, -1);

  const point = v3.scale(v3.add(a.center, b.center), 0.5);
  return { bodyA: a.id, bodyB: b.id, normal: bestAxis, depth: minOverlap, point };
}

// ── Full pipeline ───────────────────────────────────────────────────

export function detectContacts(bodies: OrientedBody[]): ContactPair[] {
  const pairs = broadPhase(bodies);
  const contacts: ContactPair[] = [];
  for (const [a, b] of pairs) {
    const hit = satOverlap(a, b);
    if (hit) contacts.push(hit);
  }
  return contacts;
}
