/**
 * Shape → STL + STEP + meta. Shared across boolean / fillet / chamfer
 * / shell handlers so the output surface stays identical and meta
 * extraction is consistent.
 *
 * Defensive reads on volume/surface/bbox — replicad's kernel version
 * may or may not expose them as getters; we degrade to zero/empty
 * rather than throw so the route still returns useful R2 keys.
 */

import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export function serializeShape(replicad: ReplicadLike, shape: OcctShape): SerializedResult {
  const stepText = replicad.exportSTEP?.(shape) ?? '';
  if (!stepText) {
    throw new Error('replicad.exportSTEP returned empty — kernel state lost');
  }
  const stlRaw = replicad.exportSTL?.(shape);
  if (!stlRaw) {
    throw new Error('replicad.exportSTL returned empty');
  }
  const stl = Buffer.isBuffer(stlRaw)
    ? stlRaw
    : typeof stlRaw === 'string'
      ? Buffer.from(stlRaw, 'utf8')
      : Buffer.from(stlRaw);

  const volume = typeof shape.volume === 'number' ? shape.volume : 0;
  const surface = typeof shape.surface === 'number' ? shape.surface : 0;
  const bbox = shape.boundingBox ?? {
    min: [0, 0, 0] as [number, number, number],
    max: [0, 0, 0] as [number, number, number],
  };
  // Binary STL = 80-byte header + u32 LE triangle count.
  const triangles = stl.length >= 84 ? stl.readUInt32LE(80) : 0;
  const manifold = typeof shape.isClosed === 'function' ? shape.isClosed() : false;

  return {
    stl,
    step: stepText,
    meta: { volume, surface, bbox, triangles, manifold },
  };
}
