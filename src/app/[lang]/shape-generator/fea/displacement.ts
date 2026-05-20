/**
 * displacement.ts — Visualise FEA displacement by deforming the mesh.
 *
 * Real FEA displacements are typically tiny — a 100mm part might only
 * move 0.05mm under load. Rendering them at true scale shows no
 * visible deformation. Engineers exaggerate by 100× / 1000× so the
 * bending mode is obvious in the viewport.
 *
 * This module owns:
 *   - `deformPositions` — bake `position + scale × displacement` into
 *     a new Float32Array, ready to push back into a BufferGeometry.
 *   - `pickDefaultScale` — heuristic that suggests a "1% of bbox"
 *     scale so the user sees motion without configuring anything.
 *   - `animationFrames` — produce N positions arrays interpolating
 *     between 0× and target scale. The renderer ticks through them
 *     for the "press play, watch it flex" animation.
 */

import type { StressField } from './stressField';

export interface DeformOptions {
  /** Multiplier applied to the displacement vectors. */
  scale: number;
}

/** Apply `scale × displacement` to a position array. Inputs are not
 *  mutated. */
export function deformPositions(
  positions: Float32Array,
  field: StressField,
  scale: number,
): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < field.vertexCount; i++) {
    out[i * 3]     = positions[i * 3]     + field.displacement[i * 3]     * scale;
    out[i * 3 + 1] = positions[i * 3 + 1] + field.displacement[i * 3 + 1] * scale;
    out[i * 3 + 2] = positions[i * 3 + 2] + field.displacement[i * 3 + 2] * scale;
  }
  return out;
}

/** Heuristic auto-scale: pick a multiplier such that the largest
 *  displacement equals `targetFraction` of the bounding-box diagonal.
 *  Default 1% gives a visible but unmistakeable deformation. */
export function pickDefaultScale(
  positions: Float32Array,
  field: StressField,
  targetFraction = 0.01,
): number {
  // Compute bbox diagonal.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (diag === 0) return 1;
  // Max displacement magnitude.
  let maxDispSq = 0;
  for (let i = 0; i < field.vertexCount; i++) {
    const dxv = field.displacement[i * 3];
    const dyv = field.displacement[i * 3 + 1];
    const dzv = field.displacement[i * 3 + 2];
    const m2 = dxv * dxv + dyv * dyv + dzv * dzv;
    if (Number.isFinite(m2) && m2 > maxDispSq) maxDispSq = m2;
  }
  const maxDisp = Math.sqrt(maxDispSq);
  if (maxDisp === 0) return 1;
  return (diag * targetFraction) / maxDisp;
}

/** Generate `count` interpolated frames for animation. Frame 0 is
 *  the rest pose; frame N-1 is the fully-deformed pose. */
export function animationFrames(
  positions: Float32Array,
  field: StressField,
  scale: number,
  count: number,
): Float32Array[] {
  const c = Math.max(2, Math.floor(count));
  const frames: Float32Array[] = [];
  for (let i = 0; i < c; i++) {
    const t = i / (c - 1);
    frames.push(deformPositions(positions, field, scale * t));
  }
  return frames;
}

/** Compute per-vertex displacement magnitude (mm) — used for the
 *  optional "displacement" colormap mode. */
export function displacementMagnitudes(field: StressField): Float32Array {
  const out = new Float32Array(field.vertexCount);
  for (let i = 0; i < field.vertexCount; i++) {
    const dx = field.displacement[i * 3];
    const dy = field.displacement[i * 3 + 1];
    const dz = field.displacement[i * 3 + 2];
    out[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return out;
}
