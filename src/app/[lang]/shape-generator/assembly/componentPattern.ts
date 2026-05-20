/**
 * componentPattern.ts — Linear / circular component patterns for
 * assemblies. Generates a series of transformed instances of a source
 * part so the user doesn't have to place each fastener / bracket / clip
 * manually (think bolt hole patterns, fan blades, terminal strips).
 *
 * Output is a list of `AssemblyBody` instances ready to splice into an
 * AssemblyState. Each generated body shares the source body's geometry
 * by reference — patterns are presentation only, not mesh duplication.
 *
 * Scope:
 *  - Linear: count + unit direction + spacing along that direction.
 *  - Circular: count + axis + centre + total angle swept by the array
 *    (inclusive of source if `includeSource`, else exclusive).
 *
 * Out of scope (follow-up):
 *  - Curve / sketch-driven patterns (along an arbitrary path).
 *  - Mirror patterns (`mirror` already exists at the feature level for
 *    geometry; component-level mirror lands when assembly hierarchy
 *    refactor finishes).
 *  - Skip-instance toggles (suppress specific indices).
 */

import * as THREE from 'three';
import type { AssemblyBody } from './matesSolver';

export interface LinearComponentPattern {
  kind: 'linear';
  /** Index of the source body in the AssemblyState.bodies array. */
  sourceBodyIndex: number;
  /** Number of copies. Includes the source position when `includeSource`
   *  is true, so a count of 4 with includeSource = true produces 4 total
   *  bodies (source + 3 clones). */
  count: number;
  /** Direction vector (world-space) — automatically normalised. */
  direction: THREE.Vector3;
  /** Centre-to-centre spacing along the direction (mm). */
  spacing: number;
  /** When true (default), the source body is part of the pattern at
   *  index 0; when false, all generated bodies are clones placed
   *  starting one `spacing` step away from the source. */
  includeSource?: boolean;
}

export interface CircularComponentPattern {
  kind: 'circular';
  sourceBodyIndex: number;
  /** Number of equally-spaced instances around the axis. */
  count: number;
  /** Rotation axis direction — auto-normalised. */
  axis: THREE.Vector3;
  /** Centre point of the circular pattern. */
  center: THREE.Vector3;
  /** Total angle swept by the pattern in degrees. 360 = full circle
   *  (equal spacing). For partial arrays, the angle is divided into
   *  `count - 1` steps when `includeSource = true`, else `count` steps. */
  totalAngleDeg: number;
  includeSource?: boolean;
}

export type ComponentPattern = LinearComponentPattern | CircularComponentPattern;

/** Re-pose a body using a translation. Geometry is shared by reference. */
function translatedBody(
  source: AssemblyBody,
  index: number,
  offset: THREE.Vector3,
): AssemblyBody {
  return {
    name: `${source.name}.${index + 1}`,
    position: source.position.clone().add(offset),
    rotation: source.rotation.clone(),
    fixed: false,
    geometry: source.geometry,
  };
}

/** Re-pose a body by rotating it around an axis through a centre. */
function rotatedBody(
  source: AssemblyBody,
  index: number,
  axis: THREE.Vector3,
  center: THREE.Vector3,
  angleRad: number,
): AssemblyBody {
  // Rotate the source's offset-from-centre vector, then translate back.
  const relPos = source.position.clone().sub(center);
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angleRad);
  const newPos = relPos.clone().applyQuaternion(q).add(center);

  // Rotate the source's orientation too — quaternion composition.
  const sourceQ = new THREE.Quaternion().setFromEuler(source.rotation);
  const newQ = q.clone().multiply(sourceQ);
  const newRot = new THREE.Euler().setFromQuaternion(newQ);

  return {
    name: `${source.name}.${index + 1}`,
    position: newPos,
    rotation: newRot,
    fixed: false,
    geometry: source.geometry,
  };
}

/**
 * Expand a component pattern into the list of bodies it represents.
 * Caller appends the result to AssemblyState.bodies. The source body
 * itself is included when `includeSource` is true (default).
 */
export function expandPattern(
  bodies: AssemblyBody[],
  pattern: ComponentPattern,
): AssemblyBody[] {
  const source = bodies[pattern.sourceBodyIndex];
  if (!source) return [];
  const count = Math.max(0, Math.floor(pattern.count));
  if (count <= 0) return [];

  const include = pattern.includeSource ?? true;
  const out: AssemblyBody[] = [];

  if (pattern.kind === 'linear') {
    if (pattern.direction.lengthSq() < 1e-12) return [];
    const dir = pattern.direction.clone().normalize();
    for (let i = 0; i < count; i++) {
      const step = include ? i : (i + 1);
      if (include && i === 0) {
        // Pattern's first slot is the source itself; we don't re-emit
        // the source so the caller can keep its original identity.
        continue;
      }
      out.push(translatedBody(source, step, dir.clone().multiplyScalar(step * pattern.spacing)));
    }
    return out;
  }

  // circular
  if (pattern.axis.lengthSq() < 1e-12) return [];
  const axis = pattern.axis.clone().normalize();
  const totalRad = (pattern.totalAngleDeg * Math.PI) / 180;
  // Equal spacing across the swept angle. For includeSource (default),
  // step = total / (count - 1) so source is index 0 and the final
  // instance lands at totalAngleDeg. For !includeSource, step = total
  // / count and instances start one step past the source.
  const steps = include ? Math.max(1, count - 1) : count;
  const stepRad = totalRad / steps;

  for (let i = 0; i < count; i++) {
    if (include && i === 0) continue; // skip source
    const angle = include ? i * stepRad : (i + 1) * stepRad;
    out.push(rotatedBody(source, i, axis, pattern.center, angle));
  }
  return out;
}
