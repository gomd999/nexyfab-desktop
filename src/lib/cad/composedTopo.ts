/**
 * composedTopo — stable edge names across a boolean (K2.2 of ADR-014).
 *
 * A primitive's edges get provenance names from topoNaming (`e.vert.0`, …). A
 * boolean (Fuse/Cut/Common) keeps SOME of those edges verbatim, drops others,
 * and introduces new seam edges along the intersection. K2.2 re-derives a stable
 * naming for the RESULT by geometric inheritance:
 *   - a result edge whose midpoint coincides with an input edge inherits that
 *     input's name, prefixed by the input's role (`a/e.vert.0`, `b/e.top.0-1`);
 *   - a result edge that matches no input is an intersection seam, named
 *     `seam.{i}` in a deterministic midpoint order.
 * The names resolve back to 3D anchors so the OCCT bridge can pick the kernel's
 * re-indexed `TopoDS_Edge` for a fillet — exactly as in K3, now on a composed
 * shape. This is the kernel-agnostic re-match; pure + testable.
 */

import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { sub, lengthOf } from '@/lib/sketch/sketchPlane';

/** A name→anchor source the fillet path resolves edges against. */
export interface EdgeAnchorSource {
  /** 3D anchor (midpoint) of the named edge, or null if unknown. */
  anchor(name: string): Vec3 | null;
  /** Every resolvable edge name (for error messages / UI pickers). */
  names(): string[];
}

/** Wrap a primitive's stable topology as an anchor source. */
export function fromAnchors(map: ReadonlyMap<string, Vec3>): EdgeAnchorSource {
  return {
    anchor: (name) => map.get(name) ?? null,
    names: () => [...map.keys()].sort(),
  };
}

export interface BooleanInput {
  /** Role prefix for inherited names, e.g. 'a' / 'b'. */
  role: string;
  /** Edge names of this input. */
  names: string[];
  /** 3D anchor of one of this input's edge names. */
  anchorOf(name: string): Vec3 | null;
}

function coincides(a: Vec3, b: Vec3, tol: number): boolean {
  return lengthOf(sub(a, b)) <= tol;
}

function sortKey(v: Vec3): string {
  const q = (n: number) => Math.round(n * 1000).toString().padStart(8, '0');
  return `${q(v.x)},${q(v.y)},${q(v.z)}`;
}

/**
 * Build the composed naming for a boolean result.
 *
 * @param inputs       the boolean's operands, each with named edges + anchors
 * @param resultMids   midpoints of the RESULT's unique edges (kernel order)
 * @param tol          coincidence tolerance (mm)
 */
export function composeBooleanTopo(
  inputs: ReadonlyArray<BooleanInput>,
  resultMids: ReadonlyArray<Vec3>,
  tol = 1e-3,
): EdgeAnchorSource {
  const named = new Map<string, Vec3>();
  const claimed = new Set<number>(); // result-edge indices an input has claimed

  // Inherit names for surviving edges.
  for (const input of inputs) {
    for (const name of input.names) {
      const a = input.anchorOf(name);
      if (!a) continue;
      const idx = resultMids.findIndex((m, i) => !claimed.has(i) && coincides(m, a, tol));
      if (idx >= 0) {
        claimed.add(idx);
        named.set(`${input.role}/${name}`, resultMids[idx]);
      }
    }
  }

  // Remaining result edges are intersection seams — deterministic by midpoint.
  const seams = resultMids
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => !claimed.has(i))
    .sort((p, q) => (sortKey(p.m) < sortKey(q.m) ? -1 : 1));
  seams.forEach(({ m }, k) => named.set(`seam.${k}`, m));

  return fromAnchors(named);
}
