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
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export interface PatternLinearParams {
  kind: 'linear';
  host: { w: number; h: number; d: number };
  /** Number of copies including the original (≥ 2). */
  count: number;
  /** Step between adjacent copies, mm. */
  spacing: number;
  /** Direction axis. */
  axis: 'X' | 'Y' | 'Z';
}

export interface PatternCircularParams {
  kind: 'circular';
  host: { w: number; h: number; d: number };
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

function buildHost(replicad: ReplicadLike, host: PatternParams['host']): OcctShape {
  if (!replicad.makeBaseBox) {
    throw new Error('replicad.makeBaseBox unavailable — kernel build mismatch');
  }
  return replicad.makeBaseBox(host.w, host.h, host.d) as OcctShape;
}

function cloneOrRebuild(replicad: ReplicadLike, params: PatternParams): OcctShape {
  // Prefer clone() if the kernel exposes it; otherwise rebuild the
  // primitive (cheap for boxes — replicad reconstructs the topology
  // without re-running boolean ops).
  const fresh = buildHost(replicad, params.host);
  if (fresh.clone) return fresh.clone();
  return fresh;
}

function runLinear(replicad: ReplicadLike, params: PatternLinearParams): OcctShape {
  let result = buildHost(replicad, params.host);
  const dir = axisVector(params.axis);
  for (let i = 1; i < params.count; i++) {
    const copy = cloneOrRebuild(replicad, params);
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

function runCircular(replicad: ReplicadLike, params: PatternCircularParams): OcctShape {
  let result = buildHost(replicad, params.host);
  const dir = axisVector(params.axis);
  const step = params.totalAngleDeg / params.count;
  for (let i = 1; i < params.count; i++) {
    const copy = cloneOrRebuild(replicad, params);
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

export async function runPattern(params: PatternParams): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  const result = params.kind === 'linear'
    ? runLinear(replicad, params)
    : runCircular(replicad, params);

  return serializeShape(replicad, result);
}
