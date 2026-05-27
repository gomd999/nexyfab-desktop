/**
 * Server-side pattern op — Wave 1 W15 (ADR-007).
 *
 * Replicates a primitive host shape in a linear or circular array,
 * then fuses the copies into a single solid. Linear uses translate +
 * fuse; circular uses rotate + fuse around an axis through origin.
 *
 * As with mirror, standalone use is mostly a smoke test — real CAD
 * use comes when chained ops feed cylinders / cuts / etc. into the
 * pattern. That chained surface lands when R2-imported shapes become
 * accepted as host inputs (W12+ follow-up).
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { resolveShape, type OpContext } from './_input.js';
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export interface PatternLinearParams {
  kind: 'linear';
  /** Primitive box. Exactly one of host or sourceR2Key required. */
  host?: { w: number; h: number; d: number };
  /** R2 key pointing to a STEP file (chained-op input, W16 D1-2). */
  sourceR2Key?: string;
  /** Number of copies including the original (≥ 2). */
  count: number;
  /** Step between adjacent copies, mm. */
  spacing: number;
  /** Direction axis. */
  axis: 'X' | 'Y' | 'Z';
}

export interface PatternCircularParams {
  kind: 'circular';
  /** Primitive box. Exactly one of host or sourceR2Key required. */
  host?: { w: number; h: number; d: number };
  /** R2 key pointing to a STEP file (chained-op input, W16 D1-2). */
  sourceR2Key?: string;
  /** Number of copies including the original (≥ 2). */
  count: number;
  /** Total sweep (degrees). Common values: 360 (full ring), 180 (half), 90 (quarter). */
  totalAngleDeg: number;
  /** Rotation axis through origin. */
  axis: 'X' | 'Y' | 'Z';
}

export type PatternParams = PatternLinearParams | PatternCircularParams;

function axisVector(a: 'X' | 'Y' | 'Z'): [number, number, number] {
  switch (a) {
    case 'X': return [1, 0, 0];
    case 'Y': return [0, 1, 0];
    case 'Z': return [0, 0, 1];
  }
}

async function buildHost(
  replicad: ReplicadLike,
  params: PatternParams,
  userId: string,
): Promise<OcctShape> {
  return resolveShape(replicad, params, userId);
}

async function cloneOrRebuild(
  replicad: ReplicadLike,
  params: PatternParams,
  userId: string,
): Promise<OcctShape> {
  // Prefer clone() if the kernel exposes it on a fresh build —
  // otherwise re-resolve (re-fetch R2 + re-import is the expensive
  // case, but it's safe for non-clonable kernels).
  const fresh = await buildHost(replicad, params, userId);
  if (fresh.clone) return fresh.clone();
  return fresh;
}

async function runLinear(
  replicad: ReplicadLike,
  params: PatternLinearParams,
  userId: string,
): Promise<OcctShape> {
  let result = await buildHost(replicad, params, userId);
  const dir = axisVector(params.axis);
  for (let i = 1; i < params.count; i++) {
    const copy = await cloneOrRebuild(replicad, params, userId);
    const offset: [number, number, number] = [
      dir[0] * params.spacing * i,
      dir[1] * params.spacing * i,
      dir[2] * params.spacing * i,
    ];
    if (!copy.translate) {
      throw new Error('replicad shape has no translate() — pattern op aborted');
    }
    const moved = copy.translate(offset);
    if (!result.fuse) {
      throw new Error('replicad shape has no fuse() — pattern op aborted');
    }
    result = result.fuse(moved);
  }
  return result;
}

async function runCircular(
  replicad: ReplicadLike,
  params: PatternCircularParams,
  userId: string,
): Promise<OcctShape> {
  let result = await buildHost(replicad, params, userId);
  const dir = axisVector(params.axis);
  const step = params.totalAngleDeg / params.count;
  for (let i = 1; i < params.count; i++) {
    const copy = await cloneOrRebuild(replicad, params, userId);
    if (!copy.rotate) {
      throw new Error('replicad shape has no rotate() — pattern op aborted');
    }
    const rotated = copy.rotate(step * i, [0, 0, 0], dir);
    if (!result.fuse) {
      throw new Error('replicad shape has no fuse() — pattern op aborted');
    }
    result = result.fuse(rotated);
  }
  return result;
}

export async function runPattern(params: PatternParams, ctx: OpContext): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  const result = params.kind === 'linear'
    ? await runLinear(replicad, params, ctx.userId)
    : await runCircular(replicad, params, ctx.userId);

  return serializeShape(replicad, result);
}
