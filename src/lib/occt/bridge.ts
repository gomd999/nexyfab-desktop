/**
 * occt/bridge — OCCT (Open CASCADE Technology) bridge interface + stub.
 *
 * Phase 4 of NexyFab Pro own-CAD (ADR-013). This module defines the
 * `OcctBridge` interface every kernel binding must satisfy, plus a
 * `createStubBridge()` implementation usable today for UI plumbing and
 * tests. `createWasmBridge()` is the Phase 4 hand-off point for the real
 * OCCT-via-Emscripten binding and currently throws `Not implemented`.
 *
 * INTENT
 * ------
 * The stub bridge lets every downstream consumer (feature tree → solid
 * preview, boolean panel, fillet UI, STEP export button) wire against the
 * SAME interface that the real bridge will satisfy. When the WASM binding
 * arrives, every call site swaps `createStubBridge` → `createWasmBridge`
 * with zero refactor.
 *
 * STUB SEMANTICS (load-bearing — keep predictable for tests/UI)
 * --------------------------------------------------------------
 *  - `buildFromExtrude` / `buildFromRevolve`
 *      Return a fake `OcctShape` whose `bbox` is derived from the feature
 *      loop (extrude: 2D bbox extruded by `depth`; revolve: full-rotation
 *      torus envelope around the canonical Y axis). `kind='solid'`,
 *      `id='stub_<n>'`. No real BREP exists.
 *  - `boolean.union`     → bbox = element-wise min/max of inputs.
 *  - `boolean.subtract`  → bbox = A (stub cannot subtract geometry).
 *                          Warning emitted.
 *  - `boolean.intersect` → bbox = element-wise intersection. Returns
 *                          `ok=false` with empty bbox if no overlap.
 *  - `fillet` / `chamfer` → return the input shape under a fresh id with
 *                           a warning. No edge mutation.
 *  - `exportSTEP`        → ONLY supported when called via the convenience
 *                          method on a shape we constructed from a feature
 *                          (we stash the originating feature in a WeakMap).
 *                          Delegates to `stepWrite.writeExtrudeAsStep` /
 *                          assembly export.
 *  - `importSTEP`        → delegates to `stepImport.importStep`, returns
 *                          the first imported feature wrapped in a stub
 *                          shape. Warnings/unsupported items propagate.
 *  - `release`           → no-op (stub has no native memory).
 *
 * WASM BRIDGE WISHLIST (NOT implemented — Phase 4)
 * ------------------------------------------------
 *  - Worker URL: hosted at `/occt-worker/occt-worker.js` (built from
 *    `occt-worker/` next to this repo). Module init: postMessage('init').
 *  - OCCT.js module: `occt-import-js` + `occt-export-js` upstream, or a
 *    direct Emscripten build of OCCT 7.8 + custom bindings.
 *  - Shape mapping: kernel returns an integer handle; we map `occt_<n>` →
 *    `TopoDS_Shape*` via a Map kept inside the worker. Release sends a
 *    `release` message that the worker uses to call `Shape.delete()`.
 *  - Async over MessageChannel; every bridge method becomes
 *    `postMessage({ op, args })` + `Promise<result>` keyed by request id.
 *  - Memory budget: limit live shapes per session (e.g. 256) and emit a
 *    `release-suggested` event when above 75% — UI can prompt to flush.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import { writeExtrudeAsStep } from '@/lib/brep-bridge/stepWrite';
import { importStep } from '@/lib/brep-bridge/stepImport';
import type { OcctOperationResult, OcctShape, OcctTessellationResult, Vec3 } from './types';
import { featureToPolyhedron } from '@/lib/cad/featureMesh';
import { polyhedronToMesh, polyhedronFeatureEdges, meshBounds } from './occtViewerMesh';

/** Emitted only when a sampled circular loop was built as an exact OCCT cylinder. */
export const ANALYTIC_CIRCULAR_PRISM_WARNING = 'analytic circular prism promoted to OCCT cylinder';
/** Emitted only by the native arbitrary-axis OCCT cylinder primitive. */
export const ANALYTIC_CYLINDER_WARNING = 'analytic OCCT cylinder built along supplied axis';

// ─── public bridge interface ──────────────────────────────────────────────

/**
 * Stable identities for a boolean op (W1-B/W3-A of ADR-017). When provided,
 * a naming-capable bridge (nodeOcctBridge) prefixes inherited edge names with
 * the operand's FEATURE id instead of its positional slot, and scopes the
 * kernel-history seam names it mints under `opId`. Bridges without stable
 * naming (stub, mesh) may ignore this argument entirely.
 */
export interface BooleanOperandIds {
  /** Stable feature/node id of the left operand (base / accumulator). */
  baseId?: string;
  /** Stable feature/node id of the right operand (tool). */
  toolId?: string;
  /** Stable id of this boolean op itself — scopes the seam names it mints. */
  opId?: string;
}

export interface OcctBooleanOps {
  union(a: OcctShape, b: OcctShape, ids?: BooleanOperandIds): Promise<OcctOperationResult>;
  subtract(a: OcctShape, b: OcctShape, ids?: BooleanOperandIds): Promise<OcctOperationResult>;
  intersect(a: OcctShape, b: OcctShape, ids?: BooleanOperandIds): Promise<OcctOperationResult>;
}

export interface OcctLoftSection {
  z: number;
  loop: ReadonlyArray<{ x: number; y: number }>;
}

export interface OcctOrthogonalPolylineSweep {
  path: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  widthMm: number;
  heightMm: number;
}

/** One idealized constant-thickness rectangular sheet with one circular bend. */
export interface OcctSingleRectangularSheetBend {
  fixedLengthMm: number;
  straightLengthMm: number;
  widthMm: number;
  thicknessMm: number;
  innerRadiusMm: number;
  angleDeg: number;
}

/**
 * Narrow delete-face repair contract for one strict-interior blind cylindrical
 * hole in an axis-aligned rectangular prism. The implementation must remove
 * the hole wall, hole floor, and perforated top face from the supplied B-rep,
 * then assemble a new full top cap with the retained original faces.
 */
export interface OcctBlindHoleDeleteFaceRepair {
  hostLoop: ReadonlyArray<{ x: number; y: number }>;
  hostDepthMm: number;
  holeCenter: readonly [number, number];
  holeRadiusMm: number;
  holeDepthMm: number;
}

export type OcctTypeHistogram = Readonly<{
  status: 'available'; counts: Readonly<Record<string, number>>;
}> | Readonly<{ status: 'not_run'; reason: string }>;

export type OcctFaceAdjacencySummary = Readonly<{
  status: 'available';
  faceCount: number;
  uniqueEdgeCount: number;
  /** Zero-length/pole edges explicitly marked by OCCT. They are not free boundaries. */
  degeneratedEdgeCount: number;
  boundaryEdgeCount: number;
  manifoldEdgeCount: number;
  nonManifoldEdgeCount: number;
  /** Number of faces having each distinct-neighbour degree; keys are sorted integer strings. */
  faceDegreeHistogram: Readonly<Record<string, number>>;
}> | Readonly<{ status: 'not_run'; reason: string }>;

export type OcctDetailedShapeInspection = Readonly<{
  valid: boolean; solidCount: number; faceCount: number; edgeCount: number;
  /** Kernel topology only. These are not Product, Part, or occurrence counts. */
  shapeTypeCounts?: Readonly<{ compound: number; compsolid: number; solid: number; shell: number }>;
  /** XCAF product occurrence evidence is independent of topology counts. */
  productOccurrences?: Readonly<{ status: 'available'; count: number }> | Readonly<{ status: 'not_run'; reason: string }>;
  bbox: Readonly<{ min: Vec3; max: Vec3 }>;
  absoluteVolume: number; surfaceArea: number; centroid: Vec3;
  inertia: Readonly<{
    status: 'available'; units: 'mm^5'; about: 'centroid';
    matrix: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
  }> | Readonly<{ status: 'not_run'; reason: string }>;
  surfaceTypes: OcctTypeHistogram;
  curveTypes: OcctTypeHistogram;
  /** Radii of unique analytic cylindrical faces, measured by BRepAdaptor. */
  cylindricalRadii?: readonly number[];
  faceAdjacency: OcctFaceAdjacencySummary;
  /** Exact kernel tolerance/edge measurements used by bounded healing policy. */
  maxTolerance?: number;
  minEdgeLength?: number;
}>;

export interface OcctBridge {
  buildFromExtrude(feature: ExtrudeFeature): Promise<OcctOperationResult>;
  buildFromRevolve(feature: RevolveFeature): Promise<OcctOperationResult>;
  readonly boolean: OcctBooleanOps;
  fillet(shape: OcctShape, edgeIds: string[], radius: number): Promise<OcctOperationResult>;
  chamfer(shape: OcctShape, edgeIds: string[], distance: number): Promise<OcctOperationResult>;
  /**
   * Variable-radius fillet — each named edge gets its own radius. Real-kernel
   * only (the stub/approx bridges have no exact equivalent), so OPTIONAL: a
   * bridge that can't do it omits the method and callers feature-detect.
   */
  variableFillet?(
    shape: OcctShape,
    edges: ReadonlyArray<{ edgeId: string; radius: number }>,
  ): Promise<OcctOperationResult>;
  /** Linear radius law along each edge, from its kernel start to end vertex. */
  lawFillet?(
    shape: OcctShape,
    edges: ReadonlyArray<{ edgeId: string; startRadius: number; endRadius: number }>,
    options?: { continuity?: 'G1' | 'G2'; angularTolerance?: number },
  ): Promise<OcctOperationResult>;
  /**
   * Draft (taper) the side walls of a solid for moulding/casting: planar faces
   * perpendicular-ish to `pullDir` (default +Z) tilt by `angleDeg`, pivoting
   * about the neutral plane at `neutralZ`. Real-kernel only → OPTIONAL.
   */
  draft?(
    shape: OcctShape,
    opts: { angleDeg: number; pullDir?: [number, number, number]; neutralZ?: number },
  ): Promise<OcctOperationResult>;
  /** Uniform positive scale about the global origin, using native B-Rep only. */
  uniformScale?(shape: OcctShape, factor: number): Promise<OcctOperationResult>;
  /** Translate one solid by a finite vector, using native B-Rep only. */
  translate?(shape: OcctShape, offset: readonly [number, number, number]): Promise<OcctOperationResult>;
  /** Rotate one solid around a bounded native axis, using native B-Rep only. */
  rotate?(shape: OcctShape, axisPoint: readonly [number, number, number], axisDirection: readonly [number, number, number], angleDeg: number): Promise<OcctOperationResult>;
  /** Build an exact solid through two or three bounded convex polygon sections. */
  buildLoftSections?(sections: ReadonlyArray<OcctLoftSection>): Promise<OcctOperationResult>;
  /**
   * Build a constant rectangular-section native pipe along two orthogonal,
   * non-collinear path segments. Straight-path extrusion aliases are excluded.
   */
  buildOrthogonalPolylineSweep?(input: OcctOrthogonalPolylineSweep): Promise<OcctOperationResult>;
  /** Build one analytic annular-sector bend extruded across a constant width. */
  buildSingleRectangularSheetBend?(input: OcctSingleRectangularSheetBend): Promise<OcctOperationResult>;
  /** Assemble two or more live native shapes without fusing their solids. */
  makeCompound?(shapes: ReadonlyArray<OcctShape>): Promise<OcctOperationResult>;
  /**
   * Delete and heal the three-face set of one bounded blind cylindrical hole.
   * This is deliberately not a general face-delete or feature-suppression API.
   */
  deleteBlindHoleFacesAndCap?(
    shape: OcctShape,
    input: OcctBlindHoleDeleteFaceRepair,
  ): Promise<OcctOperationResult>;
  /** Mirror one solid through an explicit point/normal plane, using native B-Rep only. */
  mirror?(shape: OcctShape, planeOrigin: readonly [number, number, number], planeNormal: readonly [number, number, number]): Promise<OcctOperationResult>;
  /**
   * Build a closed PRISM solid from a 2D loop placed at an ARBITRARY `z0`,
   * extruded `heightMm` along +Z. `buildFromExtrude` can only place a prism at
   * the three `ExtrudeDirection` positions (0..d, ±d, ±d/2), so a tool that must
   * start part-way up a solid — a BLIND hole cut down from the top face — has no
   * way to be positioned through that API. The kernel path already builds prisms
   * at an explicit z0 internally; this exposes it. Real-kernel only → OPTIONAL,
   * callers feature-detect and refuse honestly when it is absent.
   */
  buildPrismAt?(loop: ReadonlyArray<{ x: number; y: number }>, z0: number, heightMm: number): Promise<OcctOperationResult>;
  /** Build an analytic OCCT cylinder from a finite origin and unit direction. */
  buildCylinderAt?(center: readonly [number, number, number], axis: readonly [number, number, number], radiusMm: number, depthMm: number): Promise<OcctOperationResult>;
  /** Build a conical frustum along +Z for countersink and tapered-tool cuts. */
  buildConeAt?(center: { x: number; y: number }, z0: number, heightMm: number, radius0: number, radius1: number): Promise<OcctOperationResult>;
  /** Build an exact BREP triangular thread cutter swept along a cylindrical
   * helix. The returned solid is intended for a subsequent Boolean cut. */
  buildThreadHelixCutter?(opts: {
    center: { x: number; y: number };
    z0: number;
    innerRadius: number;
    outerRadius: number;
    pitch: number;
    lengthMm: number;
    direction?: 'right_hand' | 'left_hand';
    threadKind?: 'external' | 'internal';
  }): Promise<OcctOperationResult>;
  /**
   * Build a planar FACE (open surface / sheet body) from a 2D loop at height
   * `z` (default 0). The input to {@link thicken} / {@link surfaceTrim}. The
   * mesh/stub bridges have no surface-body concept → OPTIONAL, real-kernel only.
   */
  buildPlanarFace?(loop: ReadonlyArray<{ x: number; y: number }>, z?: number): Promise<OcctOperationResult>;
  /**
   * Build a planar FACE from a 2D loop placed in an arbitrary plane (`origin` +
   * `normal`), so callers can construct NON-parallel/CROSSING faces — required
   * for {@link surfaceTrim}, since {@link buildPlanarFace} is XY-only and two
   * XY faces are always parallel (no section). Real-kernel only → OPTIONAL.
   */
  buildPlanarFaceOriented?(
    loop: ReadonlyArray<{ x: number; y: number }>,
    origin: [number, number, number],
    normal: [number, number, number],
  ): Promise<OcctOperationResult>;
  /**
   * THICKEN an open surface/shell into a SOLID of wall thickness `thickness`
   * (`BRepOffsetAPI_MakeThickSolid`). replicad's high-level API cannot express
   * this (confirmed 2026-06-07; the ceiling spike validated the K-series can —
   * see `ceilingSpike.thicken.test.ts`). Real-kernel only → OPTIONAL.
   */
  thicken?(shape: OcctShape, thickness: number): Promise<OcctOperationResult>;
  /**
   * Hollow a closed solid and remove the named faces. Face ids are stable
   * topology names (for an extrude: `f.cap.top` / `f.cap.bottom`). The method
   * is deliberately separate from `thicken`: this is
   * BRepOffsetAPI_MakeThickSolidByJoin over a SOLID, not a sheet-body offset.
   */
  solidShell?(
    shape: OcctShape,
    closingFaceIds: ReadonlyArray<string>,
    thickness: number,
  ): Promise<OcctOperationResult>;
  /** Exact kernel topology/validity inspection; omitted by approximate bridges. */
  inspectShape?(shape: OcctShape): Promise<{
    valid: boolean;
    solidCount: number;
    faceCount: number;
    edgeCount: number;
  }>;
  /** Exact, measurement-rich inspection; optional to preserve older bridges. */
  inspectShapeDetailed?(shape: OcctShape): Promise<OcctDetailedShapeInspection>;
  /** Execute bounded OCCT ShapeFix/Sewing. Callers must compare and approve the returned shape before replacing the original. */
  healShape?(shape: OcctShape, options: { workingTolerance: number; sewingTolerance: number; maxTolerance: number }): Promise<OcctOperationResult>;
  /** Deterministic face references currently available on a kernel shape. */
  listFaceRefs?(shape: OcctShape): Promise<string[]>;
  /** Push/pull one named planar face on a history-free imported B-rep. */
  pushPullFace?(shape: OcctShape, faceId: string, distance: number): Promise<OcctOperationResult>;
  /**
   * Surface–surface TRIM: the section (intersection curve) of two shapes
   * (`BRepAlgoAPI_Section`), returned as a compound of the intersection edges.
   * The mesh path only does UV-space trim → OPTIONAL, real-kernel only.
   */
  surfaceTrim?(a: OcctShape, b: OcctShape): Promise<OcctOperationResult>;
  exportSTEP(shape: OcctShape): Promise<string>;
  importSTEP(source: string): Promise<OcctOperationResult>;
  /**
   * Tessellate `shape` into renderable buffers (triangles + feature edges +
   * camera bounds) for the 3D viewer and for drawing projection. `deflection`
   * is the chord tolerance in mm (smaller = finer).
   */
  tessellate(shape: OcctShape, deflection?: number): Promise<OcctTessellationResult>;
  /** Release any native handle backing `shape`. After release the handle MUST NOT be re-used. No-op for the stub. */
  release(shape: OcctShape): void;
}

export interface CreateWasmBridgeOptions {
  /** Worker bundle URL — typically `/occt-worker/occt-worker.js`. */
  workerUrl?: string;
}

// ─── stub implementation ──────────────────────────────────────────────────

interface StubInternals {
  /**
   * Tracks shapes we manufactured ourselves so `exportSTEP` can recover the
   * originating feature. WeakMap keyed by the shape object reference.
   */
  featureOf: WeakMap<OcctShape, ExtrudeFeature | RevolveFeature>;
  /** Released shape ids — used to throw on use-after-release. */
  released: Set<string>;
  /** Monotonic id counter, scoped per-bridge instance. */
  nextId: number;
}

function makeStubBridge(): OcctBridge {
  const internals: StubInternals = {
    featureOf: new WeakMap(),
    released: new Set(),
    nextId: 1,
  };

  const allocId = (): string => `stub_${internals.nextId++}`;

  const assertLive = (shape: OcctShape, where: string): void => {
    if (internals.released.has(shape.id)) {
      throw new Error(`occt-stub: ${where}: shape ${shape.id} was released`);
    }
  };

  const buildFromExtrude = async (feature: ExtrudeFeature): Promise<OcctOperationResult> => {
    if (feature.kind !== 'extrude') {
      return { ok: false, error: `expected kind='extrude', got '${(feature as { kind: string }).kind}'`, warnings: [] };
    }
    if (feature.loop.length < 3) {
      return { ok: false, error: `extrude loop must have ≥3 points, got ${feature.loop.length}`, warnings: [] };
    }
    if (!(feature.depth > 0) || !Number.isFinite(feature.depth)) {
      return { ok: false, error: `extrude depth must be positive finite, got ${feature.depth}`, warnings: [] };
    }
    const bbox2 = bboxOf2D(feature.loop);
    // Direction maps to z extent: one_sided 0→depth, midplane -d/2→+d/2,
    // two_sided -depth→+depth (matches extrudeToScad).
    let z0 = 0;
    let z1 = feature.depth;
    if (feature.direction === 'midplane') {
      z0 = -feature.depth / 2;
      z1 = feature.depth / 2;
    } else if (feature.direction === 'two_sided') {
      z0 = -feature.depth;
      z1 = feature.depth;
    }
    const shape: OcctShape = {
      id: allocId(),
      kind: 'solid',
      bbox: { min: { x: bbox2.minX, y: bbox2.minY, z: z0 }, max: { x: bbox2.maxX, y: bbox2.maxY, z: z1 } },
    };
    internals.featureOf.set(shape, feature);
    return { ok: true, shape, warnings: ['stub: synthetic bbox; no real BREP'] };
  };

  const buildFromRevolve = async (feature: RevolveFeature): Promise<OcctOperationResult> => {
    if (feature.kind !== 'revolve') {
      return { ok: false, error: `expected kind='revolve', got '${(feature as { kind: string }).kind}'`, warnings: [] };
    }
    if (feature.loop.length < 3) {
      return { ok: false, error: `revolve loop must have ≥3 points, got ${feature.loop.length}`, warnings: [] };
    }
    // Canonical revolve: profile lives in X≥0, axis is +Y. Full revolve
    // sweeps the profile around Y, so the bbox in world space is
    // {-rmax..+rmax, ymin..ymax, -rmax..+rmax}.
    let rMax = 0;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of feature.loop) {
      if (p.x > rMax) rMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    // Partial sweep (< 360°) shrinks the XZ envelope but the stub keeps the
    // conservative full envelope — true sweep math will land with the WASM
    // bridge.
    const shape: OcctShape = {
      id: allocId(),
      kind: 'solid',
      bbox: { min: { x: -rMax, y: yMin, z: -rMax }, max: { x: rMax, y: yMax, z: rMax } },
    };
    internals.featureOf.set(shape, feature);
    const warnings = ['stub: synthetic bbox; no real BREP'];
    if (feature.angleDegrees < 360) {
      warnings.push(`stub: partial sweep ${feature.angleDegrees}° uses full-revolve envelope`);
    }
    return { ok: true, shape, warnings };
  };

  const boolean: OcctBooleanOps = {
    async union(a, b) {
      assertLive(a, 'union'); assertLive(b, 'union');
      const bbox = bboxUnion(a.bbox, b.bbox);
      const shape: OcctShape = { id: allocId(), kind: 'solid', bbox };
      return { ok: true, shape, warnings: ['stub: bbox-only union'] };
    },
    async subtract(a, b) {
      assertLive(a, 'subtract'); assertLive(b, 'subtract');
      // Cannot cut geometry from a bbox — return A's envelope unchanged.
      const shape: OcctShape = { id: allocId(), kind: 'solid', bbox: cloneBBox(a.bbox) };
      return { ok: true, shape, warnings: ['stub: no real cut; A bbox preserved'] };
    },
    async intersect(a, b) {
      assertLive(a, 'intersect'); assertLive(b, 'intersect');
      const bbox = bboxIntersection(a.bbox, b.bbox);
      if (!bbox) {
        return { ok: false, error: 'intersect: bbox disjoint (stub: no overlap)', warnings: ['stub: bbox-only intersect'] };
      }
      const shape: OcctShape = { id: allocId(), kind: 'solid', bbox };
      return { ok: true, shape, warnings: ['stub: bbox-only intersect'] };
    },
  };

  const fillet = async (shape: OcctShape, edgeIds: string[], radius: number): Promise<OcctOperationResult> => {
    assertLive(shape, 'fillet');
    if (!(radius > 0) || !Number.isFinite(radius)) {
      return { ok: false, error: `fillet radius must be positive finite, got ${radius}`, warnings: [] };
    }
    const passthrough: OcctShape = { id: allocId(), kind: shape.kind, bbox: cloneBBox(shape.bbox) };
    // Preserve the originating feature so exportSTEP still works post-fillet.
    const orig = internals.featureOf.get(shape);
    if (orig) internals.featureOf.set(passthrough, orig);
    return {
      ok: true,
      shape: passthrough,
      warnings: [`stub: no actual fillet (radius=${radius}, edges=${edgeIds.length})`],
    };
  };

  const chamfer = async (shape: OcctShape, edgeIds: string[], distance: number): Promise<OcctOperationResult> => {
    assertLive(shape, 'chamfer');
    if (!(distance > 0) || !Number.isFinite(distance)) {
      return { ok: false, error: `chamfer distance must be positive finite, got ${distance}`, warnings: [] };
    }
    const passthrough: OcctShape = { id: allocId(), kind: shape.kind, bbox: cloneBBox(shape.bbox) };
    const orig = internals.featureOf.get(shape);
    if (orig) internals.featureOf.set(passthrough, orig);
    return {
      ok: true,
      shape: passthrough,
      warnings: [`stub: no actual chamfer (distance=${distance}, edges=${edgeIds.length})`],
    };
  };

  const variableFillet = async (
    shape: OcctShape,
    edges: ReadonlyArray<{ edgeId: string; radius: number }>,
  ): Promise<OcctOperationResult> => {
    assertLive(shape, 'variableFillet');
    if (edges.length === 0 || edges.some((edge) => !(edge.radius > 0) || !Number.isFinite(edge.radius))) {
      return { ok: false, error: 'variableFillet requires positive finite radii', warnings: [] };
    }
    const next: OcctShape = { id: allocId(), kind: shape.kind, bbox: cloneBBox(shape.bbox) };
    const orig = internals.featureOf.get(shape);
    if (orig) internals.featureOf.set(next, orig);
    return {
      ok: true,
      shape: next,
      warnings: [`stub: no actual variable fillet (edges=${edges.length})`],
    };
  };

  const lawFillet = async (
    shape: OcctShape,
    edges: ReadonlyArray<{ edgeId: string; startRadius: number; endRadius: number }>,
    options?: { continuity?: 'G1' | 'G2'; angularTolerance?: number },
  ): Promise<OcctOperationResult> => {
    assertLive(shape, 'lawFillet');
    if (edges.length === 0 || edges.some((edge) =>
      !(edge.startRadius > 0) || !Number.isFinite(edge.startRadius) ||
      !(edge.endRadius > 0) || !Number.isFinite(edge.endRadius))) {
      return { ok: false, error: 'lawFillet requires positive finite start/end radii', warnings: [] };
    }
    if (options?.angularTolerance !== undefined && (!(options.angularTolerance > 0) || !Number.isFinite(options.angularTolerance))) {
      return { ok: false, error: 'lawFillet angularTolerance must be positive finite', warnings: [] };
    }
    const next: OcctShape = { id: allocId(), kind: shape.kind, bbox: cloneBBox(shape.bbox) };
    const orig = internals.featureOf.get(shape);
    if (orig) internals.featureOf.set(next, orig);
    return { ok: true, shape: next, warnings: [`stub: no actual law fillet (edges=${edges.length})`] };
  };

  const buildPrismAt = async (
    loop: ReadonlyArray<{ x: number; y: number }>, z0: number, heightMm: number,
  ): Promise<OcctOperationResult> => {
    if (loop.length < 3 || !Number.isFinite(z0) || !(heightMm > 0) || !Number.isFinite(heightMm)) {
      return { ok: false, error: 'buildPrismAt requires loop, finite z0, and positive height', warnings: [] };
    }
    const b = bboxOf2D(loop);
    const shape: OcctShape = {
      id: allocId(), kind: 'solid',
      bbox: { min: { x: b.minX, y: b.minY, z: z0 }, max: { x: b.maxX, y: b.maxY, z: z0 + heightMm } },
    };
    return { ok: true, shape, warnings: ['stub: bbox-only positioned prism'] };
  };

  const buildConeAt = async (
    center: { x: number; y: number }, z0: number, heightMm: number, radius0: number, radius1: number,
  ): Promise<OcctOperationResult> => {
    const radius = Math.max(radius0, radius1);
    if (![center?.x, center?.y, z0, heightMm, radius0, radius1].every(Number.isFinite) ||
        !(heightMm > 0) || radius0 < 0 || radius1 < 0 || !(radius > 0)) {
      return { ok: false, error: 'buildConeAt requires finite dimensions and positive height/radius', warnings: [] };
    }
    const shape: OcctShape = {
      id: allocId(), kind: 'solid',
      bbox: {
        min: { x: center.x - radius, y: center.y - radius, z: z0 },
        max: { x: center.x + radius, y: center.y + radius, z: z0 + heightMm },
      },
    };
    return { ok: true, shape, warnings: ['stub: bbox-only conical frustum'] };
  };

  const buildPlanarFace = async (loop: ReadonlyArray<{ x: number; y: number }>, z = 0): Promise<OcctOperationResult> => {
    if (!Array.isArray(loop) || loop.length < 3) {
      return { ok: false, error: `buildPlanarFace: loop must have ≥3 points, got ${loop?.length ?? 0}`, warnings: [] };
    }
    const b2 = bboxOf2D(loop);
    const shape: OcctShape = {
      id: allocId(), kind: 'face',
      bbox: { min: { x: b2.minX, y: b2.minY, z }, max: { x: b2.maxX, y: b2.maxY, z } },
    };
    return { ok: true, shape, warnings: ['stub: synthetic planar face; no real BREP'] };
  };

  const thicken = async (shape: OcctShape, thickness: number): Promise<OcctOperationResult> => {
    assertLive(shape, 'thicken');
    if (!(thickness > 0) || !Number.isFinite(thickness)) {
      return { ok: false, error: `thicken: thickness must be positive finite, got ${thickness}`, warnings: [] };
    }
    // Synthetic: extrude the face's bbox by `thickness` along +Z → a solid envelope.
    const bb = cloneBBox(shape.bbox);
    const bbox = bb ? { min: { ...bb.min }, max: { x: bb.max.x, y: bb.max.y, z: bb.min.z + thickness } } : undefined;
    const out: OcctShape = { id: allocId(), kind: 'solid', bbox };
    return { ok: true, shape: out, warnings: ['stub: synthetic thicken (no real BREP)'] };
  };

  const surfaceTrim = async (a: OcctShape, b: OcctShape): Promise<OcctOperationResult> => {
    assertLive(a, 'surfaceTrim'); assertLive(b, 'surfaceTrim');
    const bbox = bboxIntersection(a.bbox, b.bbox);
    if (!bbox) {
      return { ok: false, error: 'surfaceTrim: shapes do not intersect (stub: bbox disjoint)', warnings: [] };
    }
    const shape: OcctShape = { id: allocId(), kind: 'compound', bbox };
    return { ok: true, shape, warnings: ['stub: synthetic surface trim (bbox section)'] };
  };

  const exportSTEP = async (shape: OcctShape): Promise<string> => {
    assertLive(shape, 'exportSTEP');
    const feature = internals.featureOf.get(shape);
    if (!feature) {
      throw new Error(
        `occt-stub: exportSTEP: shape ${shape.id} has no originating feature ` +
          `(stub can only export shapes built via buildFromExtrude/buildFromRevolve/fillet/chamfer)`,
      );
    }
    if (feature.kind === 'extrude') {
      return writeExtrudeAsStep(feature);
    }
    // RevolveFeature → stepWrite has no public revolve writer yet. Approximate
    // by treating the revolve as a bbox-extrude in the canonical frame so the
    // emitted STEP is at least valid AP214 (matches BOX-ONLY phase 1 contract
    // of stepWrite). The real revolve emitter lands with the WASM bridge.
    let rMax = 0;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of feature.loop) {
      if (p.x > rMax) rMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    const surrogate: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: -rMax, y: yMin },
        { x: rMax, y: yMin },
        { x: rMax, y: yMax },
        { x: -rMax, y: yMax },
      ],
      depth: Math.max(rMax * 2, 1e-3),
      direction: 'one_sided',
      mode: 'add',
    };
    return writeExtrudeAsStep(surrogate, { productName: 'revolve_envelope' });
  };

  const importSTEP = async (source: string): Promise<OcctOperationResult> => {
    let result;
    try {
      result = importStep(source);
    } catch (err) {
      return { ok: false, error: (err as Error).message, warnings: [] };
    }
    if (result.tree.nodes.length === 0) {
      return {
        ok: false,
        error: 'importSTEP: no solids recognised',
        warnings: [...result.warnings, ...result.unsupported.map((u) => `unsupported:${u}`)],
      };
    }
    const first = result.tree.nodes[0]!;
    const payload = first.payload;
    // Stub only knows how to envelope extrude/revolve payloads; anything else
    // (sweep/loft/hole/fillet/chamfer/pattern) is reported as unsupported.
    if (payload.kind !== 'extrude' && payload.kind !== 'revolve') {
      return {
        ok: false,
        error: `importSTEP: stub does not handle feature kind '${payload.kind}'`,
        warnings: [...result.warnings.map((w) => `import:${w}`), ...result.unsupported.map((u) => `unsupported:${u}`)],
      };
    }
    const feature = payload;
    let shape: OcctShape;
    if (feature.kind === 'extrude') {
      const bbox2 = bboxOf2D(feature.loop);
      shape = {
        id: allocId(),
        kind: 'solid',
        bbox: { min: { x: bbox2.minX, y: bbox2.minY, z: 0 }, max: { x: bbox2.maxX, y: bbox2.maxY, z: feature.depth } },
      };
      internals.featureOf.set(shape, feature);
    } else {
      // revolve — reuse the buildFromRevolve envelope math.
      let rMax = 0;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const p of feature.loop) {
        if (p.x > rMax) rMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
      shape = {
        id: allocId(),
        kind: 'solid',
        bbox: { min: { x: -rMax, y: yMin, z: -rMax }, max: { x: rMax, y: yMax, z: rMax } },
      };
      internals.featureOf.set(shape, feature);
    }
    const warnings = [
      'stub: imported feature wrapped in synthetic shape',
      ...result.warnings.map((w) => `import:${w}`),
      ...result.unsupported.map((u) => `unsupported:${u}`),
    ];
    if (result.tree.nodes.length > 1) {
      warnings.push(`stub: ${result.tree.nodes.length - 1} additional solid(s) dropped (stub returns first only)`);
    }
    return { ok: true, shape, warnings };
  };

  const tessellate = async (shape: OcctShape, _deflection?: number): Promise<OcctTessellationResult> => {
    assertLive(shape, 'tessellate');
    // The stub has no kernel, but it CAN mesh shapes built from a tracked
    // primitive feature via featureMesh — same buffer shape as the real bridge.
    const feature = internals.featureOf.get(shape);
    if (!feature) {
      return {
        ok: false,
        error: `tessellate: stub can only mesh shapes built via buildFromExtrude/buildFromRevolve (got ${shape.id})`,
        warnings: [],
      };
    }
    const poly = featureToPolyhedron(feature);
    if (!poly) {
      return { ok: false, error: `tessellate: stub cannot mesh feature kind '${feature.kind}'`, warnings: [] };
    }
    const mesh = polyhedronToMesh(poly);
    const edges = polyhedronFeatureEdges(poly);
    return {
      ok: true,
      mesh: { ...mesh, edges, edgeCount: edges.length / 6, bounds: meshBounds(poly) },
      warnings: ['stub: featureMesh tessellation (no kernel deflection control)'],
    };
  };

  const release = (shape: OcctShape): void => {
    // No native memory to free; mark id as released so use-after-release
    // throws (matches the real bridge contract).
    internals.released.add(shape.id);
  };

  return {
    buildFromExtrude,
    buildFromRevolve,
    boolean,
    fillet,
    variableFillet,
    lawFillet,
    buildPrismAt,
    buildConeAt,
    chamfer,
    buildPlanarFace,
    thicken,
    surfaceTrim,
    exportSTEP,
    importSTEP,
    tessellate,
    release,
  };
}

/**
 * Build a stub `OcctBridge` suitable for UI plumbing and tests. The stub
 * never reaches a real kernel; all shapes are synthetic envelopes derived
 * from the input feature. See module JSDoc for the per-method contract.
 */
export function createStubBridge(): OcctBridge {
  return makeStubBridge();
}

/**
 * Build an OCCT WASM-backed `OcctBridge`.
 *
 * **Not implemented (Phase 4).** Wires the bridge interface to an OCCT
 * Emscripten worker. Until that ships, this throws so call sites that
 * silently fall through to WASM fail loudly in dev.
 *
 * Planned arguments:
 *   - `workerUrl` — URL of the worker bundle (default
 *     `/occt-worker/occt-worker.js`). Pass `undefined` to use the default
 *     served by Next from `public/occt-worker/`.
 *
 * @throws Always.
 */
export function createWasmBridge(_opts?: CreateWasmBridgeOptions): OcctBridge {
  throw new Error('createWasmBridge: Not implemented (Phase 4). Use createStubBridge() for now.');
}

// ─── bbox helpers ─────────────────────────────────────────────────────────

interface BBox2D { minX: number; maxX: number; minY: number; maxY: number }

function bboxOf2D(loop: ReadonlyArray<{ x: number; y: number }>): BBox2D {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function cloneBBox(b: OcctShape['bbox']): OcctShape['bbox'] {
  if (!b) return undefined;
  return { min: { ...b.min }, max: { ...b.max } };
}

function bboxUnion(a: OcctShape['bbox'], b: OcctShape['bbox']): OcctShape['bbox'] {
  if (!a) return cloneBBox(b);
  if (!b) return cloneBBox(a);
  const min: Vec3 = {
    x: Math.min(a.min.x, b.min.x),
    y: Math.min(a.min.y, b.min.y),
    z: Math.min(a.min.z, b.min.z),
  };
  const max: Vec3 = {
    x: Math.max(a.max.x, b.max.x),
    y: Math.max(a.max.y, b.max.y),
    z: Math.max(a.max.z, b.max.z),
  };
  return { min, max };
}

function bboxIntersection(a: OcctShape['bbox'], b: OcctShape['bbox']): OcctShape['bbox'] | undefined {
  if (!a || !b) return undefined;
  const min: Vec3 = {
    x: Math.max(a.min.x, b.min.x),
    y: Math.max(a.min.y, b.min.y),
    z: Math.max(a.min.z, b.min.z),
  };
  const max: Vec3 = {
    x: Math.min(a.max.x, b.max.x),
    y: Math.min(a.max.y, b.max.y),
    z: Math.min(a.max.z, b.max.z),
  };
  if (min.x > max.x || min.y > max.y || min.z > max.z) return undefined;
  return { min, max };
}
