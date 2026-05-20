/**
 * morphTarget.ts — Shape morphing between multiple targets.
 *
 * For interactive configurators and "show variant" buttons: blend a
 * base mesh toward one or more target shapes using per-target weights.
 * Used by:
 *
 *   - **Apparel sizing** — slider tween between size S/M/L body
 *     proxies on a virtual mannequin.
 *   - **Configurator preview** — fade between "narrow" and "wide"
 *     versions of a part.
 *   - **Facial expression rigs** (when our 3D avatars need lipsync).
 *
 * Algorithm: each target stores the *delta* from base (per-vertex).
 * To apply weights {w_i}, output = base + Σ w_i × delta_i. Linear,
 * cheap, exactly what GPU vertex-morph shaders compute.
 *
 * The module:
 *   - Builds delta arrays from a base + targets.
 *   - Evaluates the blend with an array of weights.
 *   - Supports easing per target weight (eased blend).
 *   - Reports stats: max deviation per target, mean deviation, etc.
 */

export interface MorphTarget {
  id: string;
  /** Per-vertex displacement (delta from base). */
  deltas: Float32Array;
  /** Optional per-vertex normal delta (for shading). */
  normalDeltas?: Float32Array;
  /** Display name. */
  name?: string;
}

export interface MorphRig {
  /** Base mesh positions. */
  basePositions: Float32Array;
  /** Per-vertex base normals (optional). */
  baseNormals?: Float32Array;
  /** Morph targets. */
  targets: MorphTarget[];
}

// ── Construction ───────────────────────────────────────────────

/** Build a morph target by computing the delta from base to target. */
export function buildTarget(id: string, basePositions: Float32Array, targetPositions: Float32Array, opts: Partial<{ name: string; targetNormals: Float32Array; baseNormals: Float32Array }> = {}): MorphTarget {
  if (basePositions.length !== targetPositions.length) {
    throw new Error('Base and target position arrays must match in length');
  }
  const deltas = new Float32Array(basePositions.length);
  for (let i = 0; i < basePositions.length; i++) {
    deltas[i] = targetPositions[i]! - basePositions[i]!;
  }
  const result: MorphTarget = { id, deltas };
  if (opts.name) result.name = opts.name;
  if (opts.targetNormals && opts.baseNormals && opts.targetNormals.length === opts.baseNormals.length) {
    const normalDeltas = new Float32Array(opts.targetNormals.length);
    for (let i = 0; i < normalDeltas.length; i++) {
      normalDeltas[i] = opts.targetNormals[i]! - opts.baseNormals[i]!;
    }
    result.normalDeltas = normalDeltas;
  }
  return result;
}

// ── Evaluation ────────────────────────────────────────────────

export interface EvaluatedMorph {
  positions: Float32Array;
  normals?: Float32Array;
}

/** Apply per-target weights to produce the morphed mesh. */
export function evaluateMorph(rig: MorphRig, weights: Record<string, number>): EvaluatedMorph {
  const out = new Float32Array(rig.basePositions);
  for (const target of rig.targets) {
    const w = weights[target.id] ?? 0;
    if (w === 0) continue;
    for (let i = 0; i < out.length; i++) out[i] += w * target.deltas[i]!;
  }
  let normals: Float32Array | undefined;
  if (rig.baseNormals) {
    normals = new Float32Array(rig.baseNormals);
    for (const target of rig.targets) {
      if (!target.normalDeltas) continue;
      const w = weights[target.id] ?? 0;
      if (w === 0) continue;
      for (let i = 0; i < normals.length; i++) normals[i] += w * target.normalDeltas[i]!;
    }
  }
  const result: EvaluatedMorph = { positions: out };
  if (normals) result.normals = normals;
  return result;
}

// ── Easing ────────────────────────────────────────────────────

export type EasingKind = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export function ease(weight: number, kind: EasingKind = 'linear'): number {
  const t = Math.max(0, Math.min(1, weight));
  switch (kind) {
    case 'linear': return t;
    case 'ease-in': return t * t;
    case 'ease-out': return 1 - (1 - t) * (1 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}

export interface EvaluateOptions {
  easing?: Record<string, EasingKind>;
}

export function evaluateMorphEased(rig: MorphRig, weights: Record<string, number>, options: EvaluateOptions = {}): EvaluatedMorph {
  const easedWeights: Record<string, number> = {};
  for (const [id, w] of Object.entries(weights)) {
    easedWeights[id] = ease(w, options.easing?.[id] ?? 'linear');
  }
  return evaluateMorph(rig, easedWeights);
}

// ── Weight normalization (constrained blends) ─────────────────

/** When weights sum > 1, blend would over-displace; normalize to sum
 *  to exactly `sumTo` (1 = single target dominates max). */
export function normalizeWeights(weights: Record<string, number>, sumTo: number = 1): Record<string, number> {
  let sum = 0;
  for (const w of Object.values(weights)) sum += Math.max(0, w);
  if (sum <= sumTo) return weights;
  const factor = sumTo / sum;
  const out: Record<string, number> = {};
  for (const [id, w] of Object.entries(weights)) out[id] = w * factor;
  return out;
}

// ── Stats ─────────────────────────────────────────────────────

export interface TargetStats {
  targetId: string;
  maxDeltaMm: number;
  meanDeltaMm: number;
  affectedVertexCount: number;
}

export function computeTargetStats(target: MorphTarget): TargetStats {
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < target.deltas.length; i += 3) {
    const d = Math.hypot(target.deltas[i]!, target.deltas[i + 1]!, target.deltas[i + 2]!);
    if (d > 1e-6) {
      if (d > max) max = d;
      sum += d;
      count++;
    }
  }
  return {
    targetId: target.id,
    maxDeltaMm: max,
    meanDeltaMm: count > 0 ? sum / count : 0,
    affectedVertexCount: count,
  };
}

export interface RigStats {
  vertexCount: number;
  targetCount: number;
  targetStats: TargetStats[];
}

export function computeRigStats(rig: MorphRig): RigStats {
  return {
    vertexCount: rig.basePositions.length / 3,
    targetCount: rig.targets.length,
    targetStats: rig.targets.map(computeTargetStats),
  };
}

// ── Serialization ─────────────────────────────────────────────

export interface SerializedRig {
  version: number;
  basePositions: number[];
  baseNormals?: number[];
  targets: Array<{
    id: string;
    name?: string;
    deltas: number[];
    normalDeltas?: number[];
  }>;
}

export function serializeRig(rig: MorphRig): SerializedRig {
  return {
    version: 1,
    basePositions: Array.from(rig.basePositions),
    ...(rig.baseNormals ? { baseNormals: Array.from(rig.baseNormals) } : {}),
    targets: rig.targets.map(t => ({
      id: t.id,
      ...(t.name ? { name: t.name } : {}),
      deltas: Array.from(t.deltas),
      ...(t.normalDeltas ? { normalDeltas: Array.from(t.normalDeltas) } : {}),
    })),
  };
}

export function deserializeRig(data: SerializedRig): MorphRig {
  if (data.version !== 1) throw new Error(`Unsupported rig version ${data.version}`);
  return {
    basePositions: new Float32Array(data.basePositions),
    ...(data.baseNormals ? { baseNormals: new Float32Array(data.baseNormals) } : {}),
    targets: data.targets.map(t => ({
      id: t.id,
      ...(t.name ? { name: t.name } : {}),
      deltas: new Float32Array(t.deltas),
      ...(t.normalDeltas ? { normalDeltas: new Float32Array(t.normalDeltas) } : {}),
    })),
  };
}
