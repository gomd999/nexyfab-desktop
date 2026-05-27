import type * as THREE from 'three';

/**
 * roundingGuard.ts — Detect when a mesh-CSG fillet/chamfer approximation was a
 * NO-OP so a silent OCCT→mesh downgrade can fail loudly instead of shipping an
 * unrounded part.
 *
 * The mesh approximator inflates the solid along vertex normals then INTERSECTs
 * with the original. On a convex solid that is the identity ("bigger box ∩ box
 * = box"), so the fallback returns the input untouched. When OCCT was *wanted*
 * but unavailable, that silent placeholder is wrong geometry; we'd rather throw
 * a typed error pointing the user at the B-rep engine. (When the user
 * *explicitly* picks the mesh engine, we leave the placeholder behavior alone.)
 */

/** Divergence-theorem volume (mm³, absolute) of a triangle mesh. */
export function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  if (!pos) return 0;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    vol += ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by);
  }
  return Math.abs(vol / 6);
}

/** True if the rounding op left the solid's volume essentially unchanged. */
export function isRoundingNoOp(
  input: THREE.BufferGeometry,
  output: THREE.BufferGeometry,
  relTolerance = 1e-4,
): boolean {
  const vin = meshVolume(input);
  if (vin <= 0) return false; // can't judge; don't block
  const vout = meshVolume(output);
  return Math.abs(vin - vout) / vin < relTolerance;
}

/**
 * Throw a typed, user-facing error if a fillet/chamfer fallback produced no
 * change. Only call this on the silent-downgrade path (OCCT requested but
 * unavailable) — never when the user explicitly selected the mesh engine.
 */
export function assertRoundingApplied(
  input: THREE.BufferGeometry,
  output: THREE.BufferGeometry,
  op: 'Fillet' | 'Chamfer',
): void {
  if (isRoundingNoOp(input, output)) {
    throw new Error(
      `${op} failed: the B-rep (OCCT) engine is unavailable and the mesh ` +
      `approximation cannot round this solid (all-convex edges). ` +
      `Enable the OCCT engine and retry — a silent unrounded result was blocked.`,
    );
  }
}
