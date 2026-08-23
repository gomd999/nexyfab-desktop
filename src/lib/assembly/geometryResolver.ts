/**
 * geometryResolver — Phase 4 of NexyFab Pro own-CAD assembly track (ADR-013).
 *
 * Bridges the FeatureTree IR (per-part history) and the iterative assembly
 * solver. The iterativeSolver expects a `GeometryResolver` callback that,
 * given a MateRef + the PartInstance's current placement, returns the
 * world-frame primitive (point / axis / plane) the mate constrains.
 *
 * This module produces a "small named registry" of canonical refs per part
 * derived deterministically from its FeatureTree:
 *
 *   Always available (independent of features):
 *     - 'origin'                   → point at part local origin
 *     - 'x_axis' / 'y_axis' / 'z_axis'  → world axes anchored at the origin
 *     - 'xy_plane' / 'yz_plane' / 'xz_plane'  → the three standard planes
 *
 *   Derived from the FeatureTree:
 *     - 'sketch_plane'             → XY plane (Phase 1 simplification — every
 *                                     extrude is assumed to start on XY)
 *     - 'extrude_axis'             → Z axis at origin (the sketch plane's
 *                                     normal of the FIRST extrude node)
 *     - `hole_axis_${i}`           → Z-direction axis through the i-th hole's
 *                                     (cx, cy, 0) center (Phase 1: holes drill
 *                                     down from XY plane only)
 *     - `hole_top_${i}`            → the (cx, cy, 0) top-point of hole #i
 *     - `revolve_axis_${i}`        → Y axis (the canonical revolve axis after
 *                                     buildRevolveFromLoop transforms to the
 *                                     OpenSCAD rotate_extrude frame)
 *
 * All returned geometry is in WORLD frame — the resolver applies the
 * PartInstance's position + orientation before returning, using the same
 * `rotateVec` helper the analytical mate-solvers use.
 *
 * Phase 1 limitations (documented so callers don't expect more):
 *   - Sketch plane is hardcoded to XY for every extrude. Real sketches can
 *     live on any datum plane; Phase 2 will read the sketch_plane id off
 *     ExtrudeFeature (which doesn't carry one today).
 *   - Hole position is in the sketch's local (u, v) frame, which we treat
 *     as the part's local (x, y, 0). For sketches placed on non-XY planes
 *     this will be wrong — Phase 2 will compose with the sketch plane's
 *     localToWorld basis.
 *   - Hole DEPTH is ignored — only the top point + axis are exposed (the
 *     bottom point would be `(cx, cy, -depth)`; can be added when the
 *     first mate that needs it lands).
 *   - Only the FIRST extrude/revolve gets an indexed ref; subsequent
 *     extrudes contribute their indices via the same numbered scheme but
 *     the canonical 'sketch_plane' / 'extrude_axis' aliases point to the
 *     first one.
 *   - Sweep / loft / fillet / chamfer / pattern features expose no extra
 *     refs in Phase 1 (their natural mate-refs require curve & surface
 *     primitives the assembly solver doesn't consume yet).
 *
 * Phase 2 will replace this hand-curated registry with a feature-tree
 * REPLAY that walks each node's emitted geometry and registers refs by
 * topology id — matching how OCCT / Parasolid kernels surface mate refs.
 */

import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { HoleFeature } from '@/lib/cad/holeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type {
  GeometryResolver,
  ResolvedGeometry,
} from './iterativeSolver';
import type { MateRef } from './mate';
import type { PartInstance } from './assemblyState';
import type { PartRefSpec } from './api';
import { rotateVec } from './mateSolver';
import { vec3, add, type Vec3 } from '@/lib/sketch/sketchPlane';

// ─── named-ref factory (one per part) ────────────────────────────────────

/**
 * A primitive expressed in the part's LOCAL frame. The resolver applies
 * the part's placement (position + orientation) to convert it to world.
 */
type LocalGeometry =
  | { kind: 'point'; origin: Vec3 }
  | { kind: 'axis'; origin: Vec3; direction: Vec3 }
  | { kind: 'plane'; origin: Vec3; normal: Vec3 };

/**
 * Build the deterministic named-ref registry for one part from its
 * FeatureTree. Exposed for tests; production callers go through
 * `featureTreeGeometryResolver`.
 */
export function buildPartRefRegistry(
  tree: FeatureTree,
  explicitRefs?: Readonly<Record<string, PartRefSpec>>,
): ReadonlyMap<string, LocalGeometry> {
  const registry = new Map<string, LocalGeometry>();
  const ORIGIN = vec3(0, 0, 0);
  const X = vec3(1, 0, 0);
  const Y = vec3(0, 1, 0);
  const Z = vec3(0, 0, 1);

  // ── always-present refs ────────────────────────────────────────────────
  registry.set('origin', { kind: 'point', origin: ORIGIN });
  registry.set('x_axis', { kind: 'axis', origin: ORIGIN, direction: X });
  registry.set('y_axis', { kind: 'axis', origin: ORIGIN, direction: Y });
  registry.set('z_axis', { kind: 'axis', origin: ORIGIN, direction: Z });
  registry.set('xy_plane', { kind: 'plane', origin: ORIGIN, normal: Z });
  registry.set('yz_plane', { kind: 'plane', origin: ORIGIN, normal: X });
  registry.set('xz_plane', { kind: 'plane', origin: ORIGIN, normal: Y });

  // ── feature-derived refs ───────────────────────────────────────────────
  let extrudeIdx = 0;
  let holeIdx = 0;
  let revolveIdx = 0;
  for (const node of tree.nodes) {
    const p = node.payload;
    if (p.kind === 'extrude') {
      registerExtrude(registry, p as ExtrudeFeature, extrudeIdx);
      extrudeIdx += 1;
    } else if (p.kind === 'hole') {
      registerHole(registry, p as HoleFeature, holeIdx);
      holeIdx += 1;
    } else if (p.kind === 'revolve') {
      registerRevolve(registry, p as RevolveFeature, revolveIdx);
      revolveIdx += 1;
    }
    // sweep / loft / pattern / fillet / chamfer expose no extra refs in
    // Phase 1 — see header doc.
    void node;
  }

  // Stable viewport-pick references for the first axis-aligned base extrude.
  // These survive triangulation changes because their ids describe semantic
  // bounds, not renderer triangle indices.
  const base = tree.nodes.find(node => node.payload.kind === 'extrude')?.payload as ExtrudeFeature | undefined;
  if (base?.loop?.length) {
    const xs = base.loop.map(point => point.x);
    const ys = base.loop.map(point => point.y);
    const baseZ = base.profileOffsetZ ?? 0;
    const bounds = { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], z: [baseZ, baseZ + base.depth] } as const;
    const axes = ['x', 'y', 'z'] as const;
    for (const axis of axes) for (const side of ['min', 'max'] as const) {
      const coordinate = bounds[axis][side === 'min' ? 0 : 1];
      const origin = vec3(axis === 'x' ? coordinate : 0, axis === 'y' ? coordinate : 0, axis === 'z' ? coordinate : 0);
      const normal = vec3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
      registry.set(`bbox_plane_${axis}_${side}`, { kind: 'plane', origin, normal });
    }
    for (const x of ['min', 'max'] as const) for (const y of ['min', 'max'] as const) for (const z of ['min', 'max'] as const) {
      registry.set(`bbox_point_x${x}_y${y}_z${z}`, { kind: 'point', origin: vec3(bounds.x[x === 'min' ? 0 : 1], bounds.y[y === 'min' ? 0 : 1], bounds.z[z === 'min' ? 0 : 1]) });
    }
    const topZ=baseZ+base.depth;
    registry.set('f.cap.bottom', { kind:'plane', origin:vec3(0,0,baseZ), normal:vec3(0,0,-1) });
    registry.set('f.cap.top', { kind:'plane', origin:vec3(0,0,topZ), normal:vec3(0,0,1) });
    registry.set('bbox_axis_z_min', { kind:'axis', origin:vec3(0,0,baseZ), direction:vec3(0,0,1) });
    registry.set('bbox_axis_z_max', { kind:'axis', origin:vec3(0,0,topZ), direction:vec3(0,0,1) });
    const loop = base.loop.filter((point,index,all)=>index===0||Math.hypot(point.x-all[index-1]!.x,point.y-all[index-1]!.y)>1e-9);
    if(loop.length>1&&Math.hypot(loop[0]!.x-loop.at(-1)!.x,loop[0]!.y-loop.at(-1)!.y)<1e-9)loop.pop();
    loop.forEach((a,index)=>{const b=loop[(index+1)%loop.length]!,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;registry.set(`f.side.${index}`,{kind:'plane',origin:vec3(a.x,a.y,baseZ),normal:vec3(dy/len,-dx/len,0)});registry.set(`v.bottom.${index}`,{kind:'point',origin:vec3(a.x,a.y,baseZ)});registry.set(`v.top.${index}`,{kind:'point',origin:vec3(a.x,a.y,topZ)});});
  }

  // Explicit semantic refs intentionally win over generated aliases. This
  // preserves imported/AI intent such as an offset boss axis.
  for (const [refId, ref] of Object.entries(explicitRefs ?? {})) {
    if (ref.kind === 'point') {
      registry.set(refId, { kind: 'point', origin: vec3(ref.origin.x, ref.origin.y, ref.origin.z) });
    } else if (ref.kind === 'axis') {
      registry.set(refId, {
        kind: 'axis',
        origin: vec3(ref.origin.x, ref.origin.y, ref.origin.z),
        direction: vec3(ref.direction.x, ref.direction.y, ref.direction.z),
      });
    } else {
      registry.set(refId, {
        kind: 'plane',
        origin: vec3(ref.origin.x, ref.origin.y, ref.origin.z),
        normal: vec3(ref.normal.x, ref.normal.y, ref.normal.z),
      });
    }
  }

  return registry;
}

function registerExtrude(
  registry: Map<string, LocalGeometry>,
  feature: ExtrudeFeature,
  idx: number,
): void {
  // Phase 1: every extrude is assumed to start on the XY plane. The
  // sketch_plane ref is the XY plane's normal+origin; extrude_axis is the
  // Z axis (the extrusion direction) at the part origin.
  const xyOrigin = vec3(0, 0, 0);
  const zDir = vec3(0, 0, 1);
  if (idx === 0) {
    registry.set('sketch_plane', { kind: 'plane', origin: xyOrigin, normal: zDir });
    registry.set('extrude_axis', { kind: 'axis', origin: xyOrigin, direction: zDir });
  }
  // Numbered alias so callers can target a specific extrude in a
  // multi-extrude part (Phase 2 + multi-body).
  registry.set(`sketch_plane_${idx}`, {
    kind: 'plane',
    origin: xyOrigin,
    normal: zDir,
  });
  registry.set(`extrude_axis_${idx}`, {
    kind: 'axis',
    origin: xyOrigin,
    direction: zDir,
  });
  void feature; // depth/draft/mode not consumed in Phase 1
}

function registerHole(
  registry: Map<string, LocalGeometry>,
  feature: HoleFeature,
  idx: number,
): void {
  // Phase 1: hole drills DOWN from the XY plane (z=0) in -Z direction.
  // The top-point sits at (cx, cy, 0) in the part's local frame and the
  // axis points along +Z (so two holes whose axes are concentric line up
  // as expected by the concentric mate solver).
  const top = vec3(feature.center.x, feature.center.y, 0);
  const axisDir = vec3(0, 0, 1);
  registry.set(`hole_axis_${idx}`, { kind: 'axis', origin: top, direction: axisDir });
  registry.set(`hole_top_${idx}`, { kind: 'point', origin: top });
}

function registerRevolve(
  registry: Map<string, LocalGeometry>,
  feature: RevolveFeature,
  idx: number,
): void {
  // buildRevolveFromLoop transforms the profile into the canonical
  // rotate_extrude frame where the axis = Y. We expose that canonical
  // axis (origin at part origin, direction = +Y) as the revolve axis.
  // Phase 2 will compose the original 2D axis line with the sketch
  // plane's basis to recover the world-space axis.
  registry.set(`revolve_axis_${idx}`, {
    kind: 'axis',
    origin: vec3(0, 0, 0),
    direction: vec3(0, 1, 0),
  });
  void feature;
}

// ─── world-frame transform ───────────────────────────────────────────────

function toWorld(local: LocalGeometry, part: PartInstance): ResolvedGeometry {
  if (local.kind === 'point') {
    const rotated = rotateVec(local.origin, part.orientation);
    return { kind: 'point', world: add(part.position, rotated) };
  }
  if (local.kind === 'axis') {
    const rotatedOrigin = rotateVec(local.origin, part.orientation);
    const rotatedDir = rotateVec(local.direction, part.orientation);
    return {
      kind: 'axis',
      world: {
        origin: add(part.position, rotatedOrigin),
        direction: rotatedDir,
      },
    };
  }
  // plane
  const rotatedOrigin = rotateVec(local.origin, part.orientation);
  const rotatedNormal = rotateVec(local.normal, part.orientation);
  return {
    kind: 'plane',
    world: {
      origin: add(part.position, rotatedOrigin),
      normal: rotatedNormal,
    },
  };
}

// ─── public resolver factory ─────────────────────────────────────────────

/**
 * Build a `GeometryResolver` keyed by the per-part FeatureTree map. The
 * solver invokes this closure every iteration after moving parts; we look
 * up the part's tree, find the named ref, and return it transformed into
 * world space using the part's CURRENT placement.
 *
 * Returns `null` (per resolver contract) when:
 *   - the part has no FeatureTree in the map (no geometry available), or
 *   - the refId is not one of the canonical names listed in the header doc.
 *
 * @param parts map from PartInstance.id → FeatureTree
 */
export function featureTreeGeometryResolver(
  parts: ReadonlyMap<string, FeatureTree>,
): GeometryResolver {
  // Memoize the per-part registry — feature trees don't change mid-solve,
  // so this turns a per-call O(nodes) walk into O(1).
  const registries = new Map<string, ReadonlyMap<string, LocalGeometry>>();
  function registryFor(partId: string, part: PartInstance): ReadonlyMap<string, LocalGeometry> | null {
    const cached = registries.get(partId);
    if (cached) return cached;
    const tree = parts.get(partId);
    if (!tree) return null;
    const built = buildPartRefRegistry(tree, part.refs);
    registries.set(partId, built);
    return built;
  }

  return (ref: MateRef, part: PartInstance): ResolvedGeometry | null => {
    const registry = registryFor(ref.partId, part);
    if (!registry) return null;
    const local = registry.get(ref.refId);
    if (!local) return null;
    return toWorld(local, part);
  };
}

// ─── small helper for tests ──────────────────────────────────────────────

/** Iterate the registered ref names for a part. Useful for UI / debug. */
export function listPartRefs(
  tree: FeatureTree,
  explicitRefs?: Readonly<Record<string, PartRefSpec>>,
): ReadonlyArray<string> {
  return Array.from(buildPartRefRegistry(tree, explicitRefs).keys());
}

// ─── FeatureNode is re-exported for tests that build trees inline. ───────
export type { FeatureNode };
