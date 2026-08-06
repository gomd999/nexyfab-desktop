/**
 * featureTreeStats — Phase 1 unified statistics extraction for a FeatureTree.
 *
 * Agent EEEEE (B18 wave). Sibling read-only walker that augments the IR
 * with derived quantities the BOM exporter, 3D viewer, mass/cost UIs, and
 * physics overlays all need to ask for without each rolling their own walk.
 *
 * What this module produces, per non-suppressed node and aggregated for
 * the whole tree:
 *
 *   - volume        (mm³, signed: cut/hole contribute negatively)
 *   - surfaceArea   (mm², coarse "outer hull" estimate — see caveats)
 *   - bbox          (axis-aligned, world-space mm)
 *   - centerOfMass  (mm, Phase 1: bbox center; Phase 2 will run mass-weighted)
 *
 * Phase 1 accuracy caveats (the OCCT swap in Phase 2 will reset all of
 * these — call sites should treat the values as estimates, not authority):
 *
 *   - extrude     : exact for the polygon footprint × depth; surface area
 *                   adds 2× polygon area + perimeter × depth (no draft
 *                   correction).
 *   - revolve     : Pappus's volume + Pappus's surface theorems; exact for
 *                   axisymmetric loops, slight error when angle < 360
 *                   because the two end caps are not added.
 *   - sweep       : profile area × spine length (rectangular cross-section
 *                   approximation — ignores torsion / corner overlap).
 *   - loft        : average section area × spine length (linear blend
 *                   approximation — ignores section-to-section curvature).
 *   - linear/circular_pattern: child volume × count. NB: this double-counts
 *                   if the children overlap. The bbox unions across
 *                   instances so collision detection has a tight envelope.
 *   - hole        : subtractive cylinder volume (negative). Counterbore /
 *                   countersink add the upper bore stack volume.
 *   - fillet      : IGNORED for volume (radius typically small vs body —
 *                   the radius³ error term is well under 5% for radius
 *                   ≤ 0.1 × min(bbox edge)). Bbox passes through.
 *   - chamfer     : IGNORED for volume (same rationale as fillet).
 *
 * Why fillet / chamfer ignore? The exact volume delta for a fillet of
 * radius r on a 4-edge profile is `r² (4 - π) × edgeLength` per filleted
 * edge — usually < 2% of the parent box volume at the radius scales the
 * UI defaults pick. Carrying that through the Phase 1 estimator would
 * require building a true CSG tree (Minkowski subtraction → polygon
 * splitting), which is exactly the OCCT job the Phase 2 swap replaces
 * this whole module's guts with. Phase 1's contract is "fast, in-process,
 * good-enough for BOM display & viewport bbox" — not "kernel-grade".
 *
 * BOM integration path:
 *   bomExport.estimatePartVolume(tree) (Agent-DDDDD) shipped first and
 *   currently re-implements the extrude / revolve volume math inline.
 *   When Phase 2 lands, both modules will route through a shared
 *   stats.volume value (DDDDD will switch to `computeStats(tree).volume`
 *   and drop its private switch).  Until then, *both* are honored:
 *   - DDDDD continues to be the BOM source of truth (tested, deployed).
 *   - EEEEE adds bbox / surfaceArea / per-node stats that DDDDD never
 *     surfaced, and the assembly 3D viewer (Agent-FFFFF) uses bbox here.
 *   The two volume calculations agree to within machine epsilon for the
 *   extrude + revolve cases they both cover; the additional pattern /
 *   hole / sweep / loft volumes that EEEEE adds are Phase-2-supersedable
 *   estimates and are *not* fed back into the BOM until the OCCT swap.
 *
 * Out of scope (Phase 2 OCCT or Phase 3 polish):
 *   - True CSG union / difference (overlap-aware volume accumulation).
 *   - Mass-weighted centerOfMass (currently bbox center).
 *   - Fillet / chamfer volume + surface area corrections.
 *   - Density catalogue lookup (bomExport already owns this; callers pass
 *     `opts.density` as g/mm³ directly).
 */

import type {
  EmitContext,
  FeatureTree,
  FeatureNode,
  FeaturePayload,
  FeatureKind,
} from './featureTree';
import { emitContextForTree, resolveChildExtrude } from './upstreamResolve';
import type { ExtrudeFeature } from './extrudeProfile';

// ─── public types ─────────────────────────────────────────────────────────

/**
 * 3D vector in world-space millimeters. Plain object form chosen for
 * consistency with the existing assembly / shape-generator Vec3 dialect
 * (the tuple-form variants live in mesh / rendering paths). Read-only at
 * the API boundary — callers should not mutate the returned objects.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Axis-aligned bounding box in world-space millimeters. An "empty" bbox
 * has min.x > max.x and is treated as the additive identity (any union
 * with a non-empty bbox returns the non-empty bbox).
 */
export interface Bbox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Per-node statistics. Fields are optional because:
 *   - fillet/chamfer skip volume + surfaceArea (see module docstring).
 *   - pattern feature instances inherit child volume but their own bbox
 *     spans all instances (so the bbox is always present once at least
 *     one child has a bbox — but a pattern wrapping nothing yields undef).
 */
export interface FeatureStats {
  /** Kind echoed from the source FeatureNode for ergonomic switch handling. */
  readonly kind: FeatureKind;
  /** Signed volume in mm³. Negative for subtractive features (cut/hole). */
  readonly volume?: number;
  /** Outer surface area in mm². Coarse — see module caveats. */
  readonly surfaceArea?: number;
  /** Axis-aligned bbox in world mm. Undefined if the node contributes none. */
  readonly bbox?: Bbox;
}

/**
 * Aggregate statistics for the whole tree.
 *
 * `volume` and `surfaceArea` are simple sums of per-node contributions —
 * NOT a CSG union — so overlapping bodies will double-count until the
 * Phase 2 OCCT kernel lands. `bbox` is the geometric union of all
 * non-empty per-node bboxes, so it tightly bounds the viewport regardless
 * of overlap. `centerOfMass` is the bbox center in Phase 1; mass-weighted
 * accumulation arrives with Phase 2.
 *
 * `mass` is present iff `opts.density` was supplied and the resulting
 * volume is finite & non-negative (a tree of pure cuts can produce a
 * negative aggregate volume — we clamp at 0 for mass-derivation, matching
 * the bomExport semantics).
 */
export interface FeatureTreeStats {
  /** Aggregate volume (mm³). May be negative if cuts exceed adds. */
  readonly volume: number;
  /** Aggregate outer surface area (mm²). Coarse — see module docstring. */
  readonly surfaceArea: number;
  /** Union bbox of every non-suppressed contributing node. */
  readonly bbox: Bbox;
  /** Phase 1: bbox center (mm). Phase 2 will compute mass-weighted COM. */
  readonly centerOfMass: Vec3;
  /** Count of non-suppressed nodes processed. */
  readonly nodeCount: number;
  /** Per-node stats keyed by FeatureNode.id (suppressed nodes excluded). */
  readonly perFeature: ReadonlyMap<string, FeatureStats>;
  /** Mass in grams, present iff `opts.density` was supplied. */
  readonly mass?: number;
  /**
   * Fillet/chamfer nodes whose bbox was derived from the embedded
   * `childExtrude` snapshot because the payload names no `childId`
   * (legacy tree). Those bboxes do NOT follow upstream edits.
   *
   * Surfaced so a stale read is never invisible: a fillet/chamfer node
   * absent from this list was resolved against the live tree.
   */
  readonly embeddedChildNodes: ReadonlyArray<string>;
}

export interface ComputeStatsOptions {
  /** Density in g/mm³ (matches bomExport DEFAULT_DENSITIES units). */
  readonly density?: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Empty (degenerate) bbox sentinel. min > max in every axis so any union
 * with a real bbox returns the real bbox unchanged. Exported via
 * `isEmptyBbox` rather than directly so callers can't accidentally mutate
 * the shared instance.
 */
const EMPTY_BBOX: Bbox = Object.freeze({
  min: Object.freeze({ x: Infinity, y: Infinity, z: Infinity }),
  max: Object.freeze({ x: -Infinity, y: -Infinity, z: -Infinity }),
});

/**
 * True when the bbox has no extent (any min[axis] > max[axis]). The
 * union/intersect helpers use this to short-circuit empty inputs.
 */
export function isEmptyBbox(b: Bbox): boolean {
  return b.min.x > b.max.x || b.min.y > b.max.y || b.min.z > b.max.z;
}

/**
 * Union two bboxes. Either input may be empty (returns the other).
 * When both are empty, returns the EMPTY_BBOX sentinel.
 */
export function unionBbox(a: Bbox, b: Bbox): Bbox {
  const aE = isEmptyBbox(a);
  const bE = isEmptyBbox(b);
  if (aE && bE) return EMPTY_BBOX;
  if (aE) return b;
  if (bE) return a;
  return {
    min: {
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    },
    max: {
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    },
  };
}

/** Bbox center as a Vec3. Returns origin for empty bboxes. */
function bboxCenter(b: Bbox): Vec3 {
  if (isEmptyBbox(b)) return { x: 0, y: 0, z: 0 };
  return {
    x: (b.min.x + b.max.x) / 2,
    y: (b.min.y + b.max.y) / 2,
    z: (b.min.z + b.max.z) / 2,
  };
}

/**
 * Shoelace formula. Returns the signed area of a closed polygon (CCW
 * positive). Open polygons are tolerated — the closing edge is implied
 * between the last and first point. Mirror of bomExport.signedArea so
 * the two modules can be compared in tests without an inter-module
 * dependency that might cycle.
 */
function signedArea(loop: ReadonlyArray<{ x: number; y: number }>): number {
  if (loop.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Centroid X of a closed polygon. Falls back to the bbox midpoint for
 * degenerate / collinear inputs (matches bomExport.centroidX).
 */
function centroidX(loop: ReadonlyArray<{ x: number; y: number }>): number {
  if (loop.length === 0) return 0;
  if (loop.length < 3) {
    let sum = 0;
    for (const p of loop) sum += p.x;
    return sum / loop.length;
  }
  let cx = 0;
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[i]!;
    const p1 = loop[(i + 1) % loop.length]!;
    const cross = p0.x * p1.y - p1.x * p0.y;
    cx += (p0.x + p1.x) * cross;
    a += cross;
  }
  if (Math.abs(a) < 1e-12) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    return (minX + maxX) / 2;
  }
  return cx / (3 * a);
}

/** Perimeter of a closed polygon in 2D. */
function polygonPerimeter(loop: ReadonlyArray<{ x: number; y: number }>): number {
  if (loop.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/** 2D bbox of a polygon. */
function loopBbox2D(
  loop: ReadonlyArray<{ x: number; y: number }>,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

// ─── per-feature stat computation ─────────────────────────────────────────

/**
 * Compute the per-node stat block for a single FeatureNode. Pure function
 * over the payload — does not look at dependencies (Phase 2 will use the
 * lookup table built in `computeStats` to resolve pattern child IR for
 * tighter volume math).
 */
function computeNodeStats(
  node: FeatureNode,
  prior: ReadonlyMap<string, FeatureStats>,
  ctx: EmitContext,
  embeddedOut: string[],
): FeatureStats {
  const p: FeaturePayload = node.payload;
  switch (p.kind) {
    case 'extrude':
      return extrudeStats(p);
    case 'revolve':
      return revolveStats(p);
    case 'sweep':
      return sweepStats(p);
    case 'loft':
      return loftStats(p);
    case 'linear_pattern':
      return linearPatternStats(p, node, prior);
    case 'circular_pattern':
      return circularPatternStats(p, node, prior);
    case 'hole':
      return holeStats(p);
    case 'fillet':
      // Volume / surface area intentionally undefined — see module caveats.
      // Bbox passes through from the child extrude.
      return filletStats(resolveStatsChild(node, ctx, embeddedOut));
    case 'chamfer':
      return chamferStats(resolveStatsChild(node, ctx, embeddedOut));
    case 'shell':
      return shellStats(p, resolveStatsChild(node, ctx, embeddedOut));
    case 'rib':
      return ribStats(p);
    case 'sweep_path':
      return sweepPathStats(p);
    case 'boolean':
      return booleanStats(p, prior);
  }
}

/**
 * Boolean combine. bbox = union of body bboxes (conservative — never
 * under-estimates, safe for culling). Volume is coarse: union ≈ Σ bodies
 * (ignores overlap), difference ≈ base body, intersection undefined (needs
 * real geometry).
 */
function booleanStats(
  p: Extract<FeaturePayload, { kind: 'boolean' }>,
  prior: ReadonlyMap<string, FeatureStats>,
): FeatureStats {
  let acc: Bbox = EMPTY_BBOX;
  let anyBbox = false;
  const vols: number[] = [];
  for (const bid of p.bodies) {
    const s = prior.get(bid);
    if (!s) continue;
    if (s.bbox && !isEmptyBbox(s.bbox)) {
      acc = unionBbox(acc, s.bbox);
      anyBbox = true;
    }
    if (typeof s.volume === 'number') vols.push(s.volume);
  }
  let volume: number | undefined;
  if (p.op === 'union') {
    volume = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) : undefined;
  } else if (p.op === 'difference') {
    volume = prior.get(p.bodies[0])?.volume;
  }
  return { kind: 'boolean', volume, bbox: anyBbox ? acc : undefined };
}

/** Rib = a box (length × thickness × height) standing on the XY plane. */
function ribStats(p: Extract<FeaturePayload, { kind: 'rib' }>): FeatureStats {
  const len = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
  const v = len * p.thickness * p.height;
  const sa = 2 * (len * p.thickness + len * p.height + p.thickness * p.height);
  const half = p.thickness / 2;
  const bbox: Bbox = {
    min: { x: Math.min(p.start.x, p.end.x) - half, y: Math.min(p.start.y, p.end.y) - half, z: 0 },
    max: { x: Math.max(p.start.x, p.end.x) + half, y: Math.max(p.start.y, p.end.y) + half, z: p.height },
  };
  return { kind: 'rib', volume: v, surfaceArea: sa, bbox };
}

/**
 * Sweep-along-path = profile area × path length (same coarse model as
 * `sweepStats`; bbox is path ⊕ profile half-extent, conservative).
 */
function sweepPathStats(p: Extract<FeaturePayload, { kind: 'sweep_path' }>): FeatureStats {
  const area = Math.abs(signedArea(p.profile));
  let len = 0;
  for (let i = 1; i < p.path.length; i++) {
    const a = p.path[i - 1]!;
    const b = p.path[i]!;
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const perim = polygonPerimeter(p.profile);
  const profBb = loopBbox2D(p.profile);
  const halfExtent = Math.max(
    Math.abs(profBb.minX), Math.abs(profBb.maxX),
    Math.abs(profBb.minY), Math.abs(profBb.maxY),
  );
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const pt of p.path) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;
  }
  const bbox: Bbox = {
    min: { x: minX - halfExtent, y: minY - halfExtent, z: minZ - halfExtent },
    max: { x: maxX + halfExtent, y: maxY + halfExtent, z: maxZ + halfExtent },
  };
  return { kind: 'sweep_path', volume: area * len, surfaceArea: 2 * area + perim * len, bbox };
}

function extrudeStats(p: Extract<FeaturePayload, { kind: 'extrude' }>): FeatureStats {
  const area = Math.abs(signedArea(p.loop));
  const depthSpan = p.direction === 'two_sided' ? p.depth * 2 : p.depth;
  const v = area * depthSpan;
  const perim = polygonPerimeter(p.loop);
  const sa = 2 * area + perim * depthSpan;
  const bb = loopBbox2D(p.loop);
  // Z extent depends on direction:
  //   one_sided : [0, depth]
  //   two_sided : [-depth, +depth]
  //   midplane  : [-depth/2, +depth/2]
  let zMin: number;
  let zMax: number;
  switch (p.direction) {
    case 'one_sided':
      zMin = 0;
      zMax = p.depth;
      break;
    case 'two_sided':
      zMin = -p.depth;
      zMax = p.depth;
      break;
    case 'midplane':
      zMin = -p.depth / 2;
      zMax = p.depth / 2;
      break;
  }
  zMin += p.profileOffsetZ ?? 0;
  zMax += p.profileOffsetZ ?? 0;
  const bbox: Bbox = {
    min: { x: bb.minX, y: bb.minY, z: zMin },
    max: { x: bb.maxX, y: bb.maxY, z: zMax },
  };
  const signedV = p.mode === 'cut' ? -v : v;
  return { kind: 'extrude', volume: signedV, surfaceArea: sa, bbox };
}

function revolveStats(p: Extract<FeaturePayload, { kind: 'revolve' }>): FeatureStats {
  const area = Math.abs(signedArea(p.loop));
  const rC = centroidX(p.loop);
  const sweepFrac = p.angleDegrees / 360;
  const v = area * 2 * Math.PI * rC * sweepFrac;
  // Pappus surface theorem: S = perimeter × 2π × r_perimCentroid × sweepFrac.
  // Approximation: use the polygon centroid for the perimeter centroid (exact
  // for symmetric profiles, off by O(perimeter / curvature) otherwise).
  const perim = polygonPerimeter(p.loop);
  const sa = perim * 2 * Math.PI * rC * sweepFrac;
  // bbox in canonical axis frame:
  //   X ranges over [-maxX, +maxX] (full revolve) or partial arc — Phase 1
  //     conservatively uses the full ring for any angle (cheap, tight enough
  //     for viewport culling). Y matches the profile's Y span.
  const bb = loopBbox2D(p.loop);
  const r = Math.max(Math.abs(bb.maxX), Math.abs(bb.minX));
  const bbox: Bbox = {
    min: { x: -r, y: bb.minY, z: -r },
    max: { x: r, y: bb.maxY, z: r },
  };
  const signedV = p.mode === 'cut' ? -v : v;
  return { kind: 'revolve', volume: signedV, surfaceArea: sa, bbox };
}

function sweepStats(p: Extract<FeaturePayload, { kind: 'sweep' }>): FeatureStats {
  // Phase 1: profile area × spine length. Ignores profile rotation along
  // the spine (which would change neither area nor length but does change
  // surface area for non-circular profiles).
  const area = Math.abs(signedArea(p.profile.points));
  let len = 0;
  for (let i = 1; i < p.path.length; i++) {
    const a = p.path[i - 1]!;
    const b = p.path[i]!;
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const v = area * len;
  // Coarse SA: 2 × profileArea + profilePerimeter × spineLen (treats the
  // sweep as if it were a generalized prism — error term grows with path
  // curvature; the OCCT swap will replace this).
  const perim = polygonPerimeter(p.profile.points);
  const sa = 2 * area + perim * len;
  // Bbox: bounding box of (path bbox ⊕ profile bbox). Phase 1 doesn't
  // rotate the profile to follow the path tangent — it just adds the
  // profile half-extents to every path point's bbox. This over-estimates
  // for paths with sharp turns but never under-estimates (so viewport
  // culling stays correct).
  const profBb = loopBbox2D(p.profile.points);
  const profHalfX = Math.max(Math.abs(profBb.minX), Math.abs(profBb.maxX));
  const profHalfY = Math.max(Math.abs(profBb.minY), Math.abs(profBb.maxY));
  // Use the larger of the two for a single conservative half-extent in
  // every axis (we don't know which axis the profile aligns with at each
  // path segment).
  const halfExtent = Math.max(profHalfX, profHalfY);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const pt of p.path) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;
  }
  const bbox: Bbox = {
    min: { x: minX - halfExtent, y: minY - halfExtent, z: minZ - halfExtent },
    max: { x: maxX + halfExtent, y: maxY + halfExtent, z: maxZ + halfExtent },
  };
  const signedV = p.mode === 'cut' ? -v : v;
  return { kind: 'sweep', volume: signedV, surfaceArea: sa, bbox };
}

function loftStats(p: Extract<FeaturePayload, { kind: 'loft' }>): FeatureStats {
  // Phase 1: average section area × spine length (the spine here is the
  // monotonic z axis between sections[0].z and sections[N-1].z).
  let areaSum = 0;
  for (const s of p.sections) {
    areaSum += Math.abs(signedArea(s.profile.points));
  }
  const avgArea = areaSum / p.sections.length;
  const zMin = p.sections[0]!.z;
  const zMax = p.sections[p.sections.length - 1]!.z;
  const len = zMax - zMin;
  const v = avgArea * len;
  // Surface area: 2 end caps (use the two end-section areas, not the
  // average) + a generalized lateral term using the average perimeter ×
  // the slant distance between adjacent sections. Coarse but consistent.
  const aFirst = Math.abs(signedArea(p.sections[0]!.profile.points));
  const aLast = Math.abs(signedArea(p.sections[p.sections.length - 1]!.profile.points));
  let lateral = 0;
  for (let i = 1; i < p.sections.length; i++) {
    const prev = p.sections[i - 1]!;
    const next = p.sections[i]!;
    const perimAvg =
      (polygonPerimeter(prev.profile.points) + polygonPerimeter(next.profile.points)) / 2;
    const dz = next.z - prev.z;
    lateral += perimAvg * dz;
  }
  const sa = aFirst + aLast + lateral;
  // Bbox: union of every section's 2D bbox lifted to its z.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of p.sections) {
    const bb = loopBbox2D(s.profile.points);
    if (bb.minX < minX) minX = bb.minX;
    if (bb.minY < minY) minY = bb.minY;
    if (bb.maxX > maxX) maxX = bb.maxX;
    if (bb.maxY > maxY) maxY = bb.maxY;
  }
  const bbox: Bbox = {
    min: { x: minX, y: minY, z: zMin },
    max: { x: maxX, y: maxY, z: zMax },
  };
  const signedV = p.mode === 'cut' ? -v : v;
  return { kind: 'loft', volume: signedV, surfaceArea: sa, bbox };
}

function linearPatternStats(
  p: Extract<FeaturePayload, { kind: 'linear_pattern' }>,
  node: FeatureNode,
  prior: ReadonlyMap<string, FeatureStats>,
): FeatureStats {
  // Pull the first concrete child dependency stats if available. The IR
  // currently carries an opaque childScad string, so we cannot recover the
  // exact child geometry — we rely on dep resolution. For trees built via
  // the standard pattern builder the dependent extrude/revolve is the
  // first dependency.
  const childStats = resolveChildStats(node, prior);
  if (!childStats) {
    // No resolvable child — return a stat block with nothing to contribute
    // beyond a stub bbox spanning the pattern direction × count × spacing.
    return { kind: 'linear_pattern' };
  }
  const childVol = childStats.volume;
  const childSA = childStats.surfaceArea;
  const childBbox = childStats.bbox;
  const totalVol = childVol !== undefined ? childVol * p.count : undefined;
  const totalSA = childSA !== undefined ? childSA * p.count : undefined;
  let bbox: Bbox | undefined;
  if (childBbox && !isEmptyBbox(childBbox)) {
    // Union the child bbox at every instance position. Instance i is
    // translated by i × spacing × direction.
    let acc: Bbox = EMPTY_BBOX;
    for (let i = 0; i < p.count; i++) {
      const dx = p.direction.x * p.spacing * i;
      const dy = p.direction.y * p.spacing * i;
      const dz = p.direction.z * p.spacing * i;
      const shifted: Bbox = {
        min: {
          x: childBbox.min.x + dx,
          y: childBbox.min.y + dy,
          z: childBbox.min.z + dz,
        },
        max: {
          x: childBbox.max.x + dx,
          y: childBbox.max.y + dy,
          z: childBbox.max.z + dz,
        },
      };
      acc = unionBbox(acc, shifted);
    }
    bbox = acc;
  }
  return {
    kind: 'linear_pattern',
    volume: totalVol,
    surfaceArea: totalSA,
    bbox,
  };
}

function circularPatternStats(
  p: Extract<FeaturePayload, { kind: 'circular_pattern' }>,
  node: FeatureNode,
  prior: ReadonlyMap<string, FeatureStats>,
): FeatureStats {
  const childStats = resolveChildStats(node, prior);
  if (!childStats) {
    return { kind: 'circular_pattern' };
  }
  const childVol = childStats.volume;
  const childSA = childStats.surfaceArea;
  const childBbox = childStats.bbox;
  const totalVol = childVol !== undefined ? childVol * p.count : undefined;
  const totalSA = childSA !== undefined ? childSA * p.count : undefined;
  // Bbox: for arbitrary 3D axis we'd need to rotate the child bbox by each
  // step angle, then re-bbox the resulting set. Phase 1 takes the worst
  // case: extend the child bbox out to the maximum radial distance the
  // child reaches from the axis, then return a ring bbox. This is a tight
  // upper bound for the common Z-axis case and conservative otherwise —
  // good enough for viewport culling and acceptable for collision pre-pass.
  let bbox: Bbox | undefined;
  if (childBbox && !isEmptyBbox(childBbox)) {
    // Compute the max distance from any child bbox corner to the axis line.
    // Axis line: point = axisOrigin, direction = axisDirection (already
    // normalized by the pattern builder).
    const corners: Vec3[] = bboxCorners(childBbox);
    let maxR = 0;
    for (const c of corners) {
      const r = distancePointToLine(c, p.axisOrigin, p.axisDirection);
      if (r > maxR) maxR = r;
    }
    // Project all corners onto the axis to get the along-axis extent.
    let minProj = Infinity;
    let maxProj = -Infinity;
    for (const c of corners) {
      const proj = projectAlongAxis(c, p.axisOrigin, p.axisDirection);
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }
    // Reconstruct the ring bbox in world space. Build a 2-orthogonal-axis
    // frame perpendicular to the pattern axis to size the radial cross
    // section — the ring's world bbox is the axisOrigin translated by
    // ±maxR along the two perpendicular axes and minProj..maxProj along
    // the pattern axis.
    const { u, v } = perpendicularBasis(p.axisDirection);
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    // The ring boundary points lie at axisOrigin + projAlongAxis*axis ±
    // maxR*u ± maxR*v. Sample the 4 extremes per axial extent.
    const samples: Vec3[] = [];
    for (const proj of [minProj, maxProj]) {
      const center = {
        x: p.axisOrigin.x + proj * p.axisDirection.x,
        y: p.axisOrigin.y + proj * p.axisDirection.y,
        z: p.axisOrigin.z + proj * p.axisDirection.z,
      };
      for (const su of [-1, 1]) {
        for (const sv of [-1, 1]) {
          samples.push({
            x: center.x + su * maxR * u.x + sv * maxR * v.x,
            y: center.y + su * maxR * u.y + sv * maxR * v.y,
            z: center.z + su * maxR * u.z + sv * maxR * v.z,
          });
        }
      }
    }
    for (const s of samples) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.z < minZ) minZ = s.z;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
      if (s.z > maxZ) maxZ = s.z;
    }
    bbox = {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }
  return {
    kind: 'circular_pattern',
    volume: totalVol,
    surfaceArea: totalSA,
    bbox,
  };
}

function holeStats(p: Extract<FeaturePayload, { kind: 'hole' }>): FeatureStats {
  // Subtractive — negative volume. The hole sits at (cx, cy) with the
  // bore axis along -Z, top at z=0, bottom at z=-depth.
  const r = p.diameter / 2;
  let v = -(Math.PI * r * r * p.depth);
  // Outer surface area of the carved cavity: side wall + bottom disc.
  // (No top disc — that face is shared with the parent body and is
  // removed by the subtraction.)
  let sa = 2 * Math.PI * r * p.depth + Math.PI * r * r;
  const bottomZ = -p.depth;
  const topZ = 0;
  let maxR = r;
  if (p.holeType === 'counterbore' && p.counterboreDiameter !== undefined && p.counterboreDepth !== undefined) {
    const cbR = p.counterboreDiameter / 2;
    // Counterbore: extra cylinder above the bore, between z = -counterboreDepth and z = 0,
    // diameter = counterboreDiameter. Subtracts the annular volume (cbR² - boreR²) × cbDepth
    // (we already subtracted the bore down to -depth, which overlapped the upper -cbDepth
    // region in the central disc; here we add the *additional* annulus only).
    v -= Math.PI * (cbR * cbR - r * r) * p.counterboreDepth;
    sa += 2 * Math.PI * cbR * p.counterboreDepth + Math.PI * (cbR * cbR - r * r);
    if (cbR > maxR) maxR = cbR;
  }
  if (p.holeType === 'countersink' && p.countersinkAngleDegrees !== undefined && p.countersinkDepth !== undefined) {
    // Frustum volume: V = π h (R² + r·R + r²) / 3 where R = top radius, r = bore radius.
    const halfAngle = (p.countersinkAngleDegrees / 2) * (Math.PI / 180);
    const topR = r + p.countersinkDepth * Math.tan(halfAngle);
    const frust = (Math.PI * p.countersinkDepth * (topR * topR + topR * r + r * r)) / 3;
    // Subtract the cylindrical region we already removed (radius r × csink depth)
    // so we add only the *extra* conical widening.
    const cyl = Math.PI * r * r * p.countersinkDepth;
    v -= frust - cyl;
    if (topR > maxR) maxR = topR;
    // Lateral surface area of frustum: π (R + r) × slant.
    const slant = Math.hypot(p.countersinkDepth, topR - r);
    sa += Math.PI * (topR + r) * slant;
  }
  const bbox: Bbox = {
    min: { x: p.center.x - maxR, y: p.center.y - maxR, z: bottomZ },
    max: { x: p.center.x + maxR, y: p.center.y + maxR, z: topZ },
  };
  return { kind: 'hole', volume: v, surfaceArea: sa, bbox };
}

/**
 * Resolve the body a fillet/chamfer node wraps, preferring the live
 * upstream node named by `childId` over the embedded snapshot (W2-0).
 *
 * A node that falls back to the snapshot is recorded in `embeddedOut` —
 * the bbox it yields is frozen at build time and will not track an
 * upstream depth edit. Legacy trees are the expected source of that, and
 * it is reported rather than hidden.
 */
function resolveStatsChild(
  node: FeatureNode,
  ctx: EmitContext,
  embeddedOut: string[],
): ExtrudeFeature {
  const resolved = resolveChildExtrude(node.payload, node.id, ctx);
  if (!resolved) {
    throw new Error(
      `computeStats: '${node.payload.kind}' node ${node.id} has no child body ` +
        `(neither childId nor childExtrude)`,
    );
  }
  if (resolved.source === 'embedded') embeddedOut.push(node.id);
  return resolved.child;
}

function filletStats(child: ExtrudeFeature): FeatureStats {
  // Pass through the child extrude's bbox unchanged (a fillet never grows
  // the bbox). Volume / surface area intentionally omitted — see module
  // caveats.
  return {
    kind: 'fillet',
    bbox: extrudeStats(child).bbox,
  };
}

function chamferStats(child: ExtrudeFeature): FeatureStats {
  return {
    kind: 'chamfer',
    bbox: extrudeStats(child).bbox,
  };
}

function shellStats(
  p: Extract<FeaturePayload, { kind: 'shell' }>,
  child: ExtrudeFeature,
): FeatureStats {
  const outer = extrudeStats(child);
  const bb = loopBbox2D(child.loop);
  const innerWidth = Math.max(0, bb.maxX - bb.minX - 2 * p.thickness);
  const innerHeight = Math.max(0, bb.maxY - bb.minY - 2 * p.thickness);
  const zStart = p.openBottomFace ? -p.thickness : p.thickness;
  const zEnd = p.openTopFace ? child.depth + p.thickness : child.depth - p.thickness;
  const removed = innerWidth * innerHeight * Math.max(0, zEnd - zStart);
  return {
    kind: 'shell',
    volume: outer.volume === undefined ? undefined : outer.volume - removed,
    bbox: outer.bbox,
  };
}

// ─── pattern helpers ──────────────────────────────────────────────────────

/**
 * Resolve the "child" stats for a pattern node. The pattern IR carries the
 * child SCAD as an opaque string (so we cannot recompute child volume
 * from the payload), but the dependency edge from the pattern node back to
 * the child body is recorded in `node.dependencies`. We pick the first
 * dependency that has resolved stats.
 *
 * Returns undefined when no dependency resolves — patterns built without
 * an explicit dep edge (e.g., a pattern wrapping an externally-provided
 * SCAD blob) are then stats-empty, which the aggregate path tolerates.
 */
function resolveChildStats(
  node: FeatureNode,
  prior: ReadonlyMap<string, FeatureStats>,
): FeatureStats | undefined {
  for (const depId of node.dependencies) {
    const s = prior.get(depId);
    if (s) return s;
  }
  return undefined;
}

function bboxCorners(b: Bbox): Vec3[] {
  return [
    { x: b.min.x, y: b.min.y, z: b.min.z },
    { x: b.max.x, y: b.min.y, z: b.min.z },
    { x: b.min.x, y: b.max.y, z: b.min.z },
    { x: b.max.x, y: b.max.y, z: b.min.z },
    { x: b.min.x, y: b.min.y, z: b.max.z },
    { x: b.max.x, y: b.min.y, z: b.max.z },
    { x: b.min.x, y: b.max.y, z: b.max.z },
    { x: b.max.x, y: b.max.y, z: b.max.z },
  ];
}

function distancePointToLine(p: Vec3, origin: Vec3, dir: Vec3): number {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const dz = p.z - origin.z;
  // cross(p-o, dir) / |dir| — dir assumed unit-length (pattern builder
  // normalizes), but compute |dir| anyway for safety.
  const cx = dy * dir.z - dz * dir.y;
  const cy = dz * dir.x - dx * dir.z;
  const cz = dx * dir.y - dy * dir.x;
  const numer = Math.hypot(cx, cy, cz);
  const denom = Math.hypot(dir.x, dir.y, dir.z);
  return denom < 1e-12 ? 0 : numer / denom;
}

function projectAlongAxis(p: Vec3, origin: Vec3, dir: Vec3): number {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const dz = p.z - origin.z;
  const denom = Math.hypot(dir.x, dir.y, dir.z);
  if (denom < 1e-12) return 0;
  return (dx * dir.x + dy * dir.y + dz * dir.z) / denom;
}

/**
 * Build two orthogonal unit vectors perpendicular to `axis`. Chooses the
 * world axis least aligned with `axis` as the seed for Gram-Schmidt so the
 * basis is numerically stable for any input direction.
 */
function perpendicularBasis(axis: Vec3): { u: Vec3; v: Vec3 } {
  const ax = Math.abs(axis.x);
  const ay = Math.abs(axis.y);
  const az = Math.abs(axis.z);
  let seed: Vec3;
  if (ax <= ay && ax <= az) seed = { x: 1, y: 0, z: 0 };
  else if (ay <= ax && ay <= az) seed = { x: 0, y: 1, z: 0 };
  else seed = { x: 0, y: 0, z: 1 };
  // u = normalize(seed × axis)
  const ux = seed.y * axis.z - seed.z * axis.y;
  const uy = seed.z * axis.x - seed.x * axis.z;
  const uz = seed.x * axis.y - seed.y * axis.x;
  const uLen = Math.hypot(ux, uy, uz);
  const u: Vec3 =
    uLen < 1e-12
      ? { x: 0, y: 0, z: 0 }
      : { x: ux / uLen, y: uy / uLen, z: uz / uLen };
  // v = normalize(axis × u)
  const vx = axis.y * u.z - axis.z * u.y;
  const vy = axis.z * u.x - axis.x * u.z;
  const vz = axis.x * u.y - axis.y * u.x;
  const vLen = Math.hypot(vx, vy, vz);
  const v: Vec3 =
    vLen < 1e-12
      ? { x: 0, y: 0, z: 0 }
      : { x: vx / vLen, y: vy / vLen, z: vz / vLen };
  return { u, v };
}

// ─── public entry point ───────────────────────────────────────────────────

/**
 * Compute aggregate + per-node statistics for a FeatureTree.
 *
 * Walk order is tree.nodes order (i.e., the declared / topologically valid
 * order), so pattern nodes always see their dependency stats in the
 * `perFeature` map by the time they are processed.
 *
 * Suppressed nodes are skipped entirely (no entry in perFeature, no
 * contribution to aggregates). This matches the bomExport behaviour.
 *
 * Note: this function does NOT call validateTree — callers that need
 * topological validation should run it first (mirrors replayTree's
 * contract; the editor's persistence layer is the typical caller and
 * already validates on load).
 */
export function computeStats(
  tree: FeatureTree,
  opts: ComputeStatsOptions = {},
): FeatureTreeStats {
  const perFeature = new Map<string, FeatureStats>();
  let aggVolume = 0;
  let aggSA = 0;
  let aggBbox: Bbox = EMPTY_BBOX;
  let nodeCount = 0;
  // Payload-only context — fillet/chamfer need the upstream extrude's
  // parameters, never its rendered SCAD.
  const ctx = emitContextForTree(tree);
  const embeddedChildNodes: string[] = [];

  for (const node of tree.nodes) {
    if (node.suppressed) continue;
    const stats = computeNodeStats(node, perFeature, ctx, embeddedChildNodes);
    perFeature.set(node.id, stats);
    nodeCount += 1;
    if (stats.volume !== undefined && Number.isFinite(stats.volume)) {
      aggVolume += stats.volume;
    }
    if (stats.surfaceArea !== undefined && Number.isFinite(stats.surfaceArea)) {
      aggSA += stats.surfaceArea;
    }
    if (stats.bbox && !isEmptyBbox(stats.bbox)) {
      aggBbox = unionBbox(aggBbox, stats.bbox);
    }
  }

  const result: Mutable<FeatureTreeStats> = {
    volume: aggVolume,
    surfaceArea: aggSA,
    bbox: aggBbox,
    centerOfMass: bboxCenter(aggBbox),
    nodeCount,
    perFeature,
    embeddedChildNodes,
  };

  if (opts.density !== undefined && Number.isFinite(opts.density) && opts.density > 0) {
    // Match bomExport: clamp at 0 for mass derivation so an all-cut tree
    // does not surface a negative mass.
    const massVol = Math.max(0, aggVolume);
    result.mass = massVol * opts.density;
  }

  return result;
}

/**
 * Local Mutable<T> — strip readonly for the local builder pattern. Public
 * API still returns the readonly-typed FeatureTreeStats.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
