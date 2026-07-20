/**
 * patternTopo — stable instance names for linear / circular patterns
 * (ADR-017 S5: pattern naming coverage was 0%).
 *
 * A pattern stamps `count` rigid copies of a child body. Every named entity of
 * the child therefore exists `count` times in the result, so the stable name of
 * an instance entity is the child's name plus the INSTANCE index — generative
 * provenance again, never geometry:
 *
 *      {childName}@{k}        k = 0 … count−1   (@0 = the untransformed seed)
 *
 * The bare child name stays resolvable as an alias of `@0`: a reference
 * authored BEFORE the pattern was inserted keeps pointing at the same physical
 * edge (instance 0 is the identity transform), which is the W1-B insertion
 * invariant — inserting a feature must never relocate an existing reference.
 * Composition nests naturally: patterning a pattern yields `name@j@k`.
 *
 * Anchors are the child's anchors pushed through the k-th instance transform:
 *   linear   — translate by k · spacing · direction (unit, per the builder)
 *   circular — rotate about the (axisOrigin, axisDirection) line by k · step,
 *              step = 360/count for a full circle, totalAngle/(count−1)
 *              otherwise — the EXACT rule circularPatternToScad emits, so the
 *              names describe the same geometry the SCAD backend builds.
 *
 * ── SCOPE: TS (polyhedron/anchor) LEVEL ONLY — NO KERNEL WIRING ─────────────
 * `featureTreeToOcctPlan` reports linear/circular patterns as UNSUPPORTED and
 * is deliberately not touched here (separate track). These names therefore
 * resolve against TS-level anchors (and the SCAD-built geometry they describe);
 * nothing routes them into the OCCT bridge yet. When the plan layer learns
 * patterns, the anchors are already in `EdgeAnchorSource` shape — the same
 * `nearestByMidpoint` bridge match extrudes use applies unchanged.
 */

import type { Vec3 } from '@/lib/sketch/sketchPlane';
import type { EdgeAnchorSource } from './composedTopo';
import type { LinearPatternFeature, CircularPatternFeature } from './pattern';

/** `{childName}@{k}` — the one place the format lives. */
export function patternInstanceName(childName: string, k: number): string {
  return `${childName}@${k}`;
}

/** Instance transforms of a linear pattern: p ↦ p + k·spacing·direction. */
export function linearInstanceTransforms(f: LinearPatternFeature): Array<(p: Vec3) => Vec3> {
  const out: Array<(p: Vec3) => Vec3> = [];
  for (let k = 0; k < f.count; k++) {
    const dx = f.direction.x * f.spacing * k;
    const dy = f.direction.y * f.spacing * k;
    const dz = f.direction.z * f.spacing * k;
    out.push((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz }));
  }
  return out;
}

/**
 * Instance transforms of a circular pattern: rotate about the axis line by
 * k·step (right-handed about `axisDirection`, matching SCAD `rotate(a, v)`).
 * Step rule replicates `circularPatternToScad` byte-for-byte in intent:
 * full 360° drops the closing duplicate (step = 360/count); a partial sweep is
 * endpoint-inclusive (step = totalAngle/(count−1)).
 */
export function circularInstanceTransforms(f: CircularPatternFeature): Array<(p: Vec3) => Vec3> {
  const step =
    f.totalAngleDegrees === 360 ? 360 / f.count : f.totalAngleDegrees / (f.count - 1);
  const o = f.axisOrigin;
  const d = f.axisDirection; // unit, per buildCircularPattern
  const out: Array<(p: Vec3) => Vec3> = [];
  for (let k = 0; k < f.count; k++) {
    const t = (k * step * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    out.push((p) => {
      // Rodrigues about unit axis d, pivoted at o.
      const vx = p.x - o.x;
      const vy = p.y - o.y;
      const vz = p.z - o.z;
      const dotdv = d.x * vx + d.y * vy + d.z * vz;
      const cx = d.y * vz - d.z * vy;
      const cy = d.z * vx - d.x * vz;
      const cz = d.x * vy - d.y * vx;
      return {
        x: o.x + vx * cos + cx * sin + d.x * dotdv * (1 - cos),
        y: o.y + vy * cos + cy * sin + d.y * dotdv * (1 - cos),
        z: o.z + vz * cos + cz * sin + d.z * dotdv * (1 - cos),
      };
    });
  }
  return out;
}

/**
 * Name the instances of a pattern given the child's named anchors and the
 * per-instance transforms. Shared engine for linear + circular.
 */
function buildPatternTopo(
  child: EdgeAnchorSource,
  transforms: Array<(p: Vec3) => Vec3>,
): EdgeAnchorSource {
  const childNames = child.names();

  const resolve = (name: string): Vec3 | null => {
    const at = name.lastIndexOf('@');
    if (at > 0) {
      const k = Number(name.slice(at + 1));
      if (Number.isInteger(k) && k >= 0 && k < transforms.length) {
        const base = child.anchor(name.slice(0, at));
        if (base) return transforms[k](base);
      }
      return null;
    }
    // Bare child name = alias of instance 0 (identity) — pre-pattern
    // references keep resolving to the same physical edge.
    const base = child.anchor(name);
    return base ? transforms[0](base) : null;
  };

  return {
    anchor: resolve,
    names: () => {
      const out: string[] = [];
      for (const n of childNames) {
        for (let k = 0; k < transforms.length; k++) out.push(patternInstanceName(n, k));
      }
      return out.sort();
    },
    lossReason: (name) => {
      if (resolve(name)) return null;
      return child.lossReason?.(name.includes('@') ? name.slice(0, name.lastIndexOf('@')) : name) ?? 'unknown';
    },
  };
}

/** Stable instance names + anchors for a linear pattern (TS level only). */
export function buildLinearPatternTopo(
  child: EdgeAnchorSource,
  feature: LinearPatternFeature,
): EdgeAnchorSource {
  return buildPatternTopo(child, linearInstanceTransforms(feature));
}

/** Stable instance names + anchors for a circular pattern (TS level only). */
export function buildCircularPatternTopo(
  child: EdgeAnchorSource,
  feature: CircularPatternFeature,
): EdgeAnchorSource {
  return buildPatternTopo(child, circularInstanceTransforms(feature));
}
