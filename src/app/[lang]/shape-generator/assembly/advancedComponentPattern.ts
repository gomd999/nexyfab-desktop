/**
 * advancedComponentPattern.ts — Recursive + variable patterns.
 *
 * Stage-1 component pattern: fixed-spacing linear or circular grid.
 * SolidWorks adds:
 *
 *   - **Pattern-of-pattern**: a circular array of linear arrays
 *     (think gear teeth spread around a hub).
 *   - **Variable spacing** per instance — easier to model bolt
 *     holes with non-uniform spacing.
 *   - **Sketch-driven pattern** — instances follow a 2D sketch
 *     curve at given parameter values.
 *
 * This module emits the *positions* (4×4 transforms) for each
 * instance. The caller materialises the instances via the
 * existing component instancing path. Pure compute — no scene
 * graph access here.
 */

import type { Matrix4 } from './subAssemblyMotion';
import { multiplyMat4, identityMatrix } from './subAssemblyMotion';

export interface PatternInstance {
  /** Index within this pattern. Useful for component naming. */
  index: number;
  transform: Matrix4;
  /** When nested patterns are used, this holds the chain of indices
   *  from outer to inner (e.g. [outer3, inner5]). */
  indexChain: number[];
}

// ── Basic constructors ──────────────────────────────────────────────

export function linearPattern(opts: {
  count: number;
  spacingMm: number;
  /** Direction vector (will be normalized). Default: +X. */
  axis?: [number, number, number];
  /** Variable per-instance offset multipliers — overrides uniform spacing. */
  customOffsets?: number[];
}): PatternInstance[] {
  const axis = opts.axis ?? [1, 0, 0];
  const ln = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const ux = axis[0] / ln;
  const uy = axis[1] / ln;
  const uz = axis[2] / ln;

  const result: PatternInstance[] = [];
  for (let i = 0; i < opts.count; i++) {
    const dist = opts.customOffsets?.[i] ?? (i * opts.spacingMm);
    const t = translation(ux * dist, uy * dist, uz * dist);
    result.push({ index: i, transform: t, indexChain: [i] });
  }
  return result;
}

export function circularPattern(opts: {
  count: number;
  fullCircle?: boolean;
  totalAngleDeg?: number;
  /** Rotation axis (default Z). */
  axis?: 'x' | 'y' | 'z';
}): PatternInstance[] {
  const axis = opts.axis ?? 'z';
  const fullCircle = opts.fullCircle ?? true;
  const totalAngle = fullCircle ? 360 : (opts.totalAngleDeg ?? 360);
  const step = opts.count > 1 ? (totalAngle / (fullCircle ? opts.count : opts.count - 1)) : 0;

  const out: PatternInstance[] = [];
  for (let i = 0; i < opts.count; i++) {
    const ang = (i * step) * Math.PI / 180;
    out.push({ index: i, transform: rotation(axis, ang), indexChain: [i] });
  }
  return out;
}

// ── Composition (pattern of pattern) ────────────────────────────────

export interface PatternComposition {
  /** Outer pattern — most coarse. */
  outer: PatternInstance[];
  /** Inner pattern applied at each outer slot. */
  inner: PatternInstance[];
}

export function composePatterns(comp: PatternComposition): PatternInstance[] {
  const out: PatternInstance[] = [];
  for (const o of comp.outer) {
    for (const i of comp.inner) {
      const t = multiplyMat4(o.transform, i.transform);
      out.push({
        index: out.length,
        transform: t,
        indexChain: [...o.indexChain, ...i.indexChain],
      });
    }
  }
  return out;
}

// ── Sketch-driven pattern ───────────────────────────────────────────

export interface SketchDrivenPatternOpts {
  /** 2D points on the sketch curve (mm). */
  points: Array<[number, number]>;
  /** Plane the sketch lives on. */
  plane?: 'xy' | 'xz' | 'yz';
  /** Optional sample-count override (defaults to points.length). */
  sampleCount?: number;
}

export function sketchDrivenPattern(opts: SketchDrivenPatternOpts): PatternInstance[] {
  const plane = opts.plane ?? 'xy';
  const samples = opts.sampleCount && opts.sampleCount < opts.points.length
    ? subsamplePoints(opts.points, opts.sampleCount)
    : opts.points;

  return samples.map((pt, i) => {
    const [u, v] = pt;
    let tx = 0, ty = 0, tz = 0;
    switch (plane) {
      case 'xy': tx = u; ty = v; break;
      case 'xz': tx = u; tz = v; break;
      case 'yz': ty = u; tz = v; break;
    }
    return { index: i, transform: translation(tx, ty, tz), indexChain: [i] };
  });
}

function subsamplePoints(pts: Array<[number, number]>, n: number): Array<[number, number]> {
  if (n <= 0 || pts.length === 0) return [];
  if (n >= pts.length) return pts.slice();
  const step = (pts.length - 1) / (n - 1);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * step);
    out.push(pts[idx]!);
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────

function translation(x: number, y: number, z: number): Matrix4 {
  return [
    1, 0, 0, x,
    0, 1, 0, y,
    0, 0, 1, z,
    0, 0, 0, 1,
  ];
}

function rotation(axis: 'x' | 'y' | 'z', angleRad: number): Matrix4 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  switch (axis) {
    case 'x': return [
      1, 0,  0, 0,
      0, c, -s, 0,
      0, s,  c, 0,
      0, 0,  0, 1,
    ];
    case 'y': return [
       c, 0, s, 0,
       0, 1, 0, 0,
      -s, 0, c, 0,
       0, 0, 0, 1,
    ];
    case 'z': return [
      c, -s, 0, 0,
      s,  c, 0, 0,
      0,  0, 1, 0,
      0,  0, 0, 1,
    ];
  }
}

export { identityMatrix };
