/**
 * OCCT topology engine wrapper (#98 phase 2).
 *
 * Lazy, module-scoped singleton that loads the replicad WASM kernel on first
 * use and exposes the narrow surface the feature pipeline needs: create
 * primitives, run boolean ops, tessellate back to BufferGeometry.
 *
 * Design notes
 * ─────────────
 * - WASM init is async (emscripten factory). FeatureDefinition.apply is sync,
 *   so callers must `await ensureOcctReady()` before invoking any sync helper.
 *   If they don't, the helpers throw `OcctNotReadyError` and the pipeline
 *   executor is expected to fall back to the legacy three-bvh-csg path.
 * - We intentionally keep this file free of React/Next imports so it can run
 *   under vitest in node without a browser shim.
 * - Tessellation tolerance is exposed so callers can trade off mesh quality
 *   for speed. Defaults mirror what feasibility tests showed to be a good
 *   balance for a typical 60mm part.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint32BufferAttribute,
} from 'three';
import { publicWasmUrl } from '../lib/publicWasmUrl';
import { reportWarning } from '../lib/telemetry';
import type { EdgeSig, FaceSig } from './edgeCorrespondence';

let ocInstance: unknown = null;
let initPromise: Promise<void> | null = null;

export class OcctNotReadyError extends Error {
  constructor() {
    super('OCCT engine not initialized — call ensureOcctReady() before using OCCT features');
    this.name = 'OcctNotReadyError';
  }
}

export function isOcctReady(): boolean {
  return ocInstance !== null;
}

/**
 * Idempotent init. Safe to call from multiple callsites — the first one wins
 * and subsequent calls await the same promise. No-op if already ready.
 */
export async function ensureOcctReady(): Promise<void> {
  if (ocInstance) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Dynamic import so the 10 MB WASM is only pulled in when someone
    // actually enables OCCT — doesn't bloat the default page bundle.
    const ocModule = await import('replicad-opencascadejs/src/replicad_single.js');
    const factory = (ocModule as { default: (opts?: unknown) => Promise<unknown> }).default;
    // In the browser the .wasm is served from /public at root; supply a
    // locateFile hook so emscripten finds it. In node (tests) omit the
    // hook entirely — emscripten resolves relative to the .js file, which
    // is where the wasm lives in node_modules.
    const factoryOpts = typeof window !== 'undefined'
      ? {
          locateFile: (p: string) =>
            p.endsWith('.wasm') ? publicWasmUrl('replicad_single.wasm') : p,
        }
      : undefined;
    const oc = await factory(factoryOpts);
    const replicad = await import('replicad');
    replicad.setOC(oc as Parameters<typeof replicad.setOC>[0]);
    replicadMod = replicad;
    ocInstance = oc;
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

// ─── Boolean via OCCT ───────────────────────────────────────────────────────

export type OcctBooleanType = 'union' | 'subtract' | 'intersect';

export interface OcctBooleanResult {
  geometry: BufferGeometry;
  /** Registry handle for the replicad shape backing this result. Downstream
   *  features can chain by passing this as `hostHandle` to skip re-building
   *  the host from mesh bbox. Null if the shape could not be retained. */
  handle: string | null;
}

// ─── Shape registry (phase 2d-1) ────────────────────────────────────────────
//
// Replicad shapes are live C++/WASM objects; serializing to STEP on every
// feature is expensive and lossy. Instead we keep them in a module-scoped Map
// and pass lightweight string handles between features via
// BufferGeometry.userData.occtHandle. The registry is cleared at the start of
// each pipeline run to cap memory — handles never outlive a single pass.

const shapeRegistry = new Map<string, unknown>();
let nextHandleSeq = 0;

// ─── Global engine mode flag (phase 2d-3) ──────────────────────────────────
//
// When enabled, OCCT-capable features (boolean/fillet/chamfer) route through
// the replicad path regardless of their per-feature `engine` param. Set by
// the UI toggle in uiStore, read by features during .apply().

let occtGlobalMode = false;

export function setOcctGlobalMode(on: boolean): void {
  occtGlobalMode = on;
}

export function isOcctGlobalMode(): boolean {
  return occtGlobalMode;
}

export function registerShape(shape: unknown): string {
  const handle = `occt:${++nextHandleSeq}`;
  shapeRegistry.set(handle, shape);
  return handle;
}

export function getShape(handle: string | undefined | null): unknown | null {
  if (!handle) return null;
  return shapeRegistry.get(handle) ?? null;
}

export function resetShapeRegistry(): void {
  shapeRegistry.clear();
}

export async function exportOcctStep(handle: string | undefined | null): Promise<string | null> {
  const shape = getShape(handle);
  if (
    shape === null
    || typeof shape !== 'object'
    || !('blobSTEP' in shape)
    || typeof (shape as { blobSTEP?: unknown }).blobSTEP !== 'function'
  ) {
    return null;
  }
  const blob = (shape as { blobSTEP: () => Blob }).blobSTEP();
  return await blob.text();
}

/**
 * Route A bridge: convert an arbitrary THREE.BufferGeometry into an OCCT
 * shape via replicad's STL importer, register the shape, and return its
 * handle. The handle can be fed straight into `exportOcctStep()` to emit
 * STEP that round-trips through occt-import-js.
 *
 * Cost: an STL serialize + an OCCT BRep import per call. Acceptable for
 * "export" flows (user-initiated); cache the handle on `userData.occtHandle`
 * if the same geometry will be re-exported.
 *
 * Returns null when WASM init failed or the importer rejected the mesh
 * (non-manifold, degenerate, etc). Callers should fall back to the legacy
 * tessellated AP242 emitter only behind a feature flag — production should
 * grey out the STEP button instead, see canExportStepCleanly().
 */
export async function meshToOcctShapeHandle(
  geometry: import('three').BufferGeometry,
): Promise<string | null> {
  try {
    await ensureOcctReady();
    const replicad = replicadMod as unknown as {
      importSTL?: (blob: Blob) => Promise<unknown>;
    } | null;
    if (!replicad?.importSTL) return null;

    const { buildBinaryStl } = await import('../io/stlEncode');
    const stlBuf = buildBinaryStl(geometry);
    const blob = new Blob([stlBuf], { type: 'application/octet-stream' });
    const shape = await replicad.importSTL(blob);
    if (!shape) return null;
    return registerShape(shape);
  } catch (err) {
    console.warn('[occtEngine] meshToOcctShapeHandle failed:', err);
    return null;
  }
}

interface ReplicadLike {
  makeBaseBox: (x: number, y: number, z: number) => unknown;
  makeCylinder: (r: number, h: number, location?: [number, number, number], direction?: [number, number, number]) => unknown;
  makeSphere: (r: number) => unknown;
}

// Cached dynamic-import reference, populated by ensureOcctReady().
let replicadMod: unknown = null;

function requireReplicad(): ReplicadLike & Record<string, unknown> {
  if (!ocInstance || !replicadMod) throw new OcctNotReadyError();
  return replicadMod as ReplicadLike & Record<string, unknown>;
}

/**
 * Run a boolean between a host geometry (as OCCT solid built from primitive
 * params) and a tool solid. The caller owns the primitive shape selection —
 * this function just executes the op.
 *
 * Current scope: host must be expressible as a box primitive because we don't
 * have a mesh → B-rep importer yet. Phase 2c will lift that by accepting a
 * STEP byte buffer as the host. For the pipeline A/B flag to be useful now,
 * the fixture case (box − cylinder) is already covered.
 */
export function occtBoxBooleanWithPrimitive(
  type: OcctBooleanType,
  hostBox: { w: number; h: number; d: number; cx: number; cy: number; cz: number },
  tool: { shape: 'box' | 'cylinder' | 'sphere' | 'cone'; w: number; h: number; d: number; cx: number; cy: number; cz: number; rx: number; ry: number; rz: number },
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  hostHandle?: string | null,
): OcctBooleanResult {
  const rc = requireReplicad();

  // Prefer a registered upstream shape when chaining from a previous OCCT
  // feature. Otherwise build a box host from the caller-provided dimensions.
  let host: unknown;
  const chained = getShape(hostHandle);
  if (chained) {
    host = chained;
  } else {
    let boxHost = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w, hostBox.h, hostBox.d) as {
      translate: (v: [number, number, number]) => unknown;
    };
    boxHost = (boxHost.translate as (v: [number, number, number]) => typeof boxHost)([
      hostBox.cx,
      hostBox.cy,
      hostBox.cz - hostBox.d / 2,
    ]);
    host = boxHost;
  }

  // Build tool.
  let toolSolid: unknown;
  if (tool.shape === 'box') {
    const b = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(tool.w, tool.h, tool.d) as {
      translate: (v: [number, number, number]) => unknown;
    };
    toolSolid = (b.translate as (v: [number, number, number]) => unknown)([
      tool.cx,
      tool.cy,
      tool.cz - tool.d / 2,
    ]);
  } else if (tool.shape === 'cylinder') {
    // Cylinder: radius = w/2, height = h, axis defaults to +Z. Caller provides
    // rotation via (rx,ry,rz) — we convert to a direction vector for the
    // common axis-aligned cases the three-bvh-csg fixture uses.
    const r = tool.w / 2;
    // three.js CylinderGeometry is +Y by default; replicad makeCylinder is +Z.
    // Treat the feature-space cylinder as +Y (matching three.js) and feed
    // replicad the +Y direction, with location chosen so its centre of mass
    // lands at (cx,cy,cz).
    toolSolid = (rc.makeCylinder as ReplicadLike['makeCylinder'])(
      r,
      tool.h,
      [tool.cx, tool.cy - tool.h / 2, tool.cz],
      [0, 1, 0],
    );
  } else if (tool.shape === 'cone') {
    // Cone tool (countersink): apex DOWN, wide base UP, axis +Y, height h,
    // base radius w/2. Built by revolving a triangle about Y, then centred at
    // (cx,cy,cz) so its mid-height lands there (matches the mesh ConeGeometry).
    const r = tool.w / 2;
    const h = tool.h;
    const draw = rc.draw as ((p?: [number, number]) => RevolvePen) | undefined;
    if (typeof draw === 'function' && r > 0 && h > 0) {
      const cone = draw([0, -h / 2])
        .lineTo([r, h / 2])
        .lineTo([0, h / 2])
        .close()
        .sketchOnPlane('XY')
        .revolve([0, 1, 0]) as unknown as { translate: (v: [number, number, number]) => unknown };
      toolSolid = cone.translate([tool.cx, tool.cy, tool.cz]);
    } else {
      toolSolid = undefined;
    }
  } else {
    const r = tool.w / 2;
    const s = (rc.makeSphere as ReplicadLike['makeSphere'])(r) as {
      translate: (v: [number, number, number]) => unknown;
    };
    toolSolid = (s.translate as (v: [number, number, number]) => unknown)([tool.cx, tool.cy, tool.cz]);
  }

  // Apply rotation euler last (only matters for box/sphere with non-zero rot).
  // Replicad's rotate takes (deg, axisLocation, axisDirection).
  const rot = [tool.rx, tool.ry, tool.rz];
  if (rot.some(v => v !== 0)) {
    type Rotatable = { rotate: (deg: number, loc: [number, number, number], dir: [number, number, number]) => Rotatable };
    let rotated = toolSolid as Rotatable;
    if (tool.rx !== 0) rotated = rotated.rotate(tool.rx, [tool.cx, tool.cy, tool.cz], [1, 0, 0]);
    if (tool.ry !== 0) rotated = rotated.rotate(tool.ry, [tool.cx, tool.cy, tool.cz], [0, 1, 0]);
    if (tool.rz !== 0) rotated = rotated.rotate(tool.rz, [tool.cx, tool.cy, tool.cz], [0, 0, 1]);
    toolSolid = rotated;
  }

  // Run the op.
  type BoolOps = {
    cut: (other: unknown) => unknown;
    fuse: (other: unknown) => unknown;
    intersect: (other: unknown) => unknown;
    mesh: (opts?: { tolerance?: number; angularTolerance?: number }) => { vertices: number[]; triangles: number[]; normals: number[] };
  };
  const hostOps = host as unknown as BoolOps;
  let result: unknown;
  if (type === 'subtract') result = hostOps.cut(toolSolid);
  else if (type === 'union')    result = hostOps.fuse(toolSolid);
  else                          result = hostOps.intersect(toolSolid);

  const mesh = (result as BoolOps).mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });

  // Convert to BufferGeometry. mesh.vertices is flat [x,y,z,...],
  // mesh.triangles is flat index buffer, mesh.normals is vertex-parallel.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.vertices, 3));
  if (mesh.normals && mesh.normals.length === mesh.vertices.length) {
    geometry.setAttribute('normal', new Float32BufferAttribute(mesh.normals, 3));
  }
  geometry.setIndex(new Uint32BufferAttribute(mesh.triangles, 1));
  if (!geometry.attributes.normal) geometry.computeVertexNormals();

  return {
    geometry,
    handle: registerShape(result),
  };
}

/**
 * General solid-vs-solid boolean: combine TWO arbitrary registered OCCT solids
 * (by handle), not just a primitive tool. This lifts the box-host/primitive-tool
 * limitation of occtBoxBooleanWithPrimitive — either operand can be any
 * feature-built B-rep (extrude, revolve, sweep, loft, a prior boolean…), so
 * multi-body booleans compose precisely. Returns geometry + a fresh handle for
 * chaining, or { handle: null } when a handle is unknown / inputs don't intersect.
 */
export function occtBooleanSolids(
  type: OcctBooleanType,
  hostHandle: string | null | undefined,
  toolHandle: string | null | undefined,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctBooleanResult {
  const host = getShape(hostHandle);
  const tool = getShape(toolHandle);
  if (!host || !tool) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  type BoolOps = {
    cut: (other: unknown) => unknown;
    fuse: (other: unknown) => unknown;
    intersect: (other: unknown) => unknown;
    mesh: (opts?: { tolerance?: number; angularTolerance?: number }) => { vertices: number[]; triangles: number[]; normals: number[] };
  };
  const hostOps = host as BoolOps;
  let result: unknown;
  if (type === 'subtract') result = hostOps.cut(tool);
  else if (type === 'union') result = hostOps.fuse(tool);
  else result = hostOps.intersect(tool);

  const mesh = (result as BoolOps).mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.vertices, 3));
  if (mesh.normals && mesh.normals.length === mesh.vertices.length) {
    geometry.setAttribute('normal', new Float32BufferAttribute(mesh.normals, 3));
  }
  geometry.setIndex(new Uint32BufferAttribute(mesh.triangles, 1));
  if (!geometry.attributes.normal) geometry.computeVertexNormals();

  return { geometry, handle: registerShape(result) };
}

// ─── Fillet / Chamfer via OCCT ──────────────────────────────────────────────

interface MeshedShape {
  mesh: (opts?: { tolerance?: number; angularTolerance?: number }) => { vertices: number[]; triangles: number[]; normals: number[] };
}

/** Opaque branded type for replicad's EdgeFinder.
 *
 *  We deliberately don't import `replicad`'s real type — it would
 *  drag the WASM module into the type graph at compile time and
 *  inflate cold-start. The branding still prevents callers from
 *  passing arbitrary unknown values: only values produced by
 *  `topologyEdgeFinder.buildEdgeFinderFromSelection` (or its multi /
 *  loop / split variants) carry the brand.
 *
 *  Lifecycle:
 *    - constructed by the topology module (branded via cast there)
 *    - flows through pipeline params untouched
 *    - finally handed to replicad's `fillet(radius, predicate)` /
 *      `chamfer(distance, predicate)`, which only inspects the
 *      builder methods, not the brand.
 */
declare const ReplicadEdgeFinderBrand: unique symbol;
export type ReplicadEdgeFinder = { readonly [ReplicadEdgeFinderBrand]: 'ReplicadEdgeFinder' };

interface FilletChamferShape extends MeshedShape {
  /** replicad accepts `(radius, predicate?)`; predicate is an EdgeFinder
   *  or `(edge) => boolean`. NexyFab passes it through opaquely. */
  fillet: (radius: number | [number, number], predicate?: (f: ReplicadEdgeFinder) => ReplicadEdgeFinder) => FilletChamferShape;
  chamfer: (distance: number, predicate?: (f: ReplicadEdgeFinder) => ReplicadEdgeFinder) => FilletChamferShape;
  translate: (v: [number, number, number]) => FilletChamferShape;
}

/** B-rep shape supporting shell + boolean cut (open-face trimming). */
interface ShellableShape extends MeshedShape {
  shell: (thickness: number, finderFn?: (ff: unknown) => unknown) => ShellableShape;
  cut: (other: unknown) => ShellableShape;
  translate: (v: [number, number, number]) => ShellableShape;
  boundingBox?: { bounds: [number[], number[]] };
}

function meshToBufferGeometry(
  mesh: { vertices: number[]; triangles: number[]; normals: number[] },
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.vertices, 3));
  if (mesh.normals && mesh.normals.length === mesh.vertices.length) {
    geometry.setAttribute('normal', new Float32BufferAttribute(mesh.normals, 3));
  }
  geometry.setIndex(new Uint32BufferAttribute(mesh.triangles, 1));
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  return geometry;
}

// ─── B-rep extrude (Phase 1 — make sketchExtrude the start of the B-rep chain) ─

interface DrawPen {
  lineTo: (p: [number, number]) => DrawPen;
  close: () => { sketchOnPlane: (plane: string, origin?: number) => { extrude: (dist: number) => MeshedShape } };
}

export interface OcctExtrudeResult {
  /** Tessellated solid (for callers that want the B-rep mesh directly). */
  geometry: BufferGeometry;
  /** Registry handle for the replicad solid, or null if the build failed. */
  handle: string | null;
}

/**
 * Build a real replicad B-rep solid by extruding a closed 2D profile on the
 * XY plane, register it, and return its handle. This is what lets a sketch
 * extrude START the B-rep chain so downstream fillet/chamfer/hole/boolean
 * operate on the true solid instead of a bounding box.
 *
 * Phase 1 scope: XY plane (with optional Z offset), straight +Z extrude. Other
 * planes / tilted faces / revolve-sweep-loft come in later phases. Requires
 * `isOcctReady()`; throws OcctNotReadyError via requireReplicad otherwise, so
 * callers must guard + try/catch and fall back to the mesh path.
 */
export function occtExtrudeProfile(
  points: { x: number; y: number }[],
  depth: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  planeOffset = 0,
): OcctExtrudeResult {
  const rc = requireReplicad();
  const draw = rc.draw as ((p?: [number, number]) => DrawPen) | undefined;
  if (typeof draw !== 'function' || points.length < 3 || !(depth > 0)) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  let pen = draw([points[0].x, points[0].y]);
  const last = points.length - 1;
  for (let i = 1; i < points.length; i++) {
    // Drop a trailing point that duplicates the start — close() adds the
    // closing edge itself, and a zero-length segment makes an invalid wire.
    if (i === last
      && Math.abs(points[i].x - points[0].x) < 1e-6
      && Math.abs(points[i].y - points[0].y) < 1e-6) break;
    pen = pen.lineTo([points[i].x, points[i].y]);
  }
  const sketch = pen.close().sketchOnPlane('XY', planeOffset);
  const solid = sketch.extrude(depth);
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

interface DrawPenOnFrame {
  lineTo: (p: [number, number]) => DrawPenOnFrame;
  close: () => { sketchOnPlane: (plane: unknown) => { extrude: (dist: number) => MeshedShape } };
}
export interface SketchFaceFrame {
  origin: [number, number, number];
  normal: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
}

/**
 * Extrude a closed 2D profile that was sketched ON A SELECTED FACE — the (u,v)
 * profile coords live in the face's frame, and the extrude runs along the face
 * normal. This is the B-rep half of "sketch on face": a boss/pocket built on an
 * existing face instead of a global plane. The caller fuses/cuts the result
 * onto the host solid. Same handle/registry contract; null handle on bad input.
 */
export function occtExtrudeProfileOnFrame(
  points: { x: number; y: number }[],
  depth: number,
  frame: SketchFaceFrame,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const rc = requireReplicad();
  const draw = rc.draw as ((p?: [number, number]) => DrawPenOnFrame) | undefined;
  const PlaneCtor = rc.Plane as (new (origin: [number, number, number], xDir: [number, number, number], normal: [number, number, number]) => unknown) | undefined;
  if (typeof draw !== 'function' || typeof PlaneCtor !== 'function' || points.length < 3 || !(depth > 0)) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  let pen = draw([points[0].x, points[0].y]);
  const last = points.length - 1;
  for (let i = 1; i < points.length; i++) {
    if (i === last
      && Math.abs(points[i].x - points[0].x) < 1e-6
      && Math.abs(points[i].y - points[0].y) < 1e-6) break;
    pen = pen.lineTo([points[i].x, points[i].y]);
  }
  // Plane(origin, xDir=uAxis, normal) → 2D (u,v) maps to origin + u·uAxis +
  // v·(normal×uAxis) = vAxis for a right-handed frame; extrude along the normal.
  const plane = new PlaneCtor(frame.origin, frame.uAxis, frame.normal);
  const solid = pen.close().sketchOnPlane(plane).extrude(depth);
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

interface RevolvePenOnFrame {
  lineTo: (p: [number, number]) => RevolvePenOnFrame;
  close: () => { sketchOnPlane: (plane: unknown) => { revolve: (axis?: [number, number, number]) => MeshedShape } };
}

/**
 * Revolve variant of the on-frame builders: a profile sketched on a selected
 * face, revolved 360° about the face's v-axis (the sketch "vertical", matching
 * the global revolve's Y-axis convention). For an identity frame this is
 * identical to occtRevolveProfile. Profile must sit on the u≥0 side of the axis.
 */
export function occtRevolveProfileOnFrame(
  points: { x: number; y: number }[],
  frame: SketchFaceFrame,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const rc = requireReplicad();
  const draw = rc.draw as ((p?: [number, number]) => RevolvePenOnFrame) | undefined;
  const PlaneCtor = rc.Plane as (new (origin: [number, number, number], xDir: [number, number, number], normal: [number, number, number]) => unknown) | undefined;
  if (typeof draw !== 'function' || typeof PlaneCtor !== 'function' || points.length < 3) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  let pen = draw([points[0].x, points[0].y]);
  const last = points.length - 1;
  for (let i = 1; i < points.length; i++) {
    if (i === last
      && Math.abs(points[i].x - points[0].x) < 1e-6
      && Math.abs(points[i].y - points[0].y) < 1e-6) break;
    pen = pen.lineTo([points[i].x, points[i].y]);
  }
  const plane = new PlaneCtor(frame.origin, frame.uAxis, frame.normal);
  const solid = pen.close().sketchOnPlane(plane).revolve(frame.vAxis);
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

interface ExtrudedSolid extends MeshedShape {
  translate: (v: [number, number, number]) => ExtrudedSolid;
}
interface CircleDraw {
  sketchOnPlane: (plane: string, origin?: number) => { extrude: (dist: number) => ExtrudedSolid };
}
interface CircleDrawOnFrame {
  sketchOnPlane: (plane: unknown) => { extrude: (dist: number) => ExtrudedSolid };
}

/**
 * Circle variant of occtExtrudeProfileOnFrame: a circular boss/hole sketched on
 * a selected face. The circle (face-coords cx,cy radius r) is sketched on the
 * face plane and extruded along the normal into an EXACT cylinder (smooth side,
 * not a faceted polygon). The (cx,cy) offset is applied along the frame's u/v
 * axes. Same handle/registry contract.
 */
export function occtExtrudeCircleOnFrame(
  radius: number,
  cx: number,
  cy: number,
  depth: number,
  frame: SketchFaceFrame,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const rc = requireReplicad();
  const drawCircle = rc.drawCircle as ((r: number) => CircleDrawOnFrame) | undefined;
  const PlaneCtor = rc.Plane as (new (origin: [number, number, number], xDir: [number, number, number], normal: [number, number, number]) => unknown) | undefined;
  if (typeof drawCircle !== 'function' || typeof PlaneCtor !== 'function' || !(radius > 0) || !(depth > 0)) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const plane = new PlaneCtor(frame.origin, frame.uAxis, frame.normal);
  let solid = drawCircle(radius).sketchOnPlane(plane).extrude(depth);
  if (cx !== 0 || cy !== 0) {
    // Offset the centre along the face's in-plane axes (u·cx + v·cy).
    const wx = cx * frame.uAxis[0] + cy * frame.vAxis[0];
    const wy = cx * frame.uAxis[1] + cy * frame.vAxis[1];
    const wz = cx * frame.uAxis[2] + cy * frame.vAxis[2];
    solid = solid.translate([wx, wy, wz]);
  }
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

/**
 * Extrude a circle into an EXACT cylinder B-rep (not a faceted polygon, so
 * downstream fillet/chamfer round one smooth edge instead of N facet edges).
 * Used for single-`circle` sketch profiles. Same handle/registry contract as
 * occtExtrudeProfile.
 */
export function occtExtrudeCircle(
  radius: number,
  cx: number,
  cy: number,
  depth: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  planeOffset = 0,
): OcctExtrudeResult {
  const rc = requireReplicad();
  const drawCircle = rc.drawCircle as ((r: number) => CircleDraw) | undefined;
  if (typeof drawCircle !== 'function' || !(radius > 0) || !(depth > 0)) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  let solid = drawCircle(radius).sketchOnPlane('XY', planeOffset).extrude(depth);
  if (cx !== 0 || cy !== 0) solid = solid.translate([cx, cy, 0]);
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

interface CutShape extends MeshedShape {
  cut: (other: unknown) => CutShape;
}

interface RevolvePen {
  lineTo: (p: [number, number]) => RevolvePen;
  close: () => { sketchOnPlane: (plane: string, origin?: number) => { revolve: (axis?: [number, number, number]) => MeshedShape } };
}

/**
 * Revolve a closed profile 360° around the Y axis into a real B-rep solid of
 * revolution (shafts, bushings, turned parts). v1 scope: full 360° about Y; the
 * profile must lie on x ≥ 0 (one side of the axis). Same handle/registry
 * contract as occtExtrudeProfile; returns a null handle on failure so the
 * caller can fall back to the mesh (LatheGeometry) path.
 */
export function occtRevolveProfile(
  points: { x: number; y: number }[],
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  planeOffset = 0,
): OcctExtrudeResult {
  const rc = requireReplicad();
  const draw = rc.draw as ((p?: [number, number]) => RevolvePen) | undefined;
  if (typeof draw !== 'function' || points.length < 3) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  let pen = draw([points[0].x, points[0].y]);
  const last = points.length - 1;
  for (let i = 1; i < points.length; i++) {
    if (i === last
      && Math.abs(points[i].x - points[0].x) < 1e-6
      && Math.abs(points[i].y - points[0].y) < 1e-6) break;
    pen = pen.lineTo([points[i].x, points[i].y]);
  }
  const solid = pen.close().sketchOnPlane('XY', planeOffset).revolve([0, 1, 0]);
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

/**
 * Extrude a closed outer contour and subtract one or more inner hole contours
 * to make a real B-rep solid (e.g. a plate with bolt holes drawn in a single
 * sketch). Holes are extruded slightly proud of the body and cut through, so
 * the result is a clean through-hole. Same handle/registry contract as
 * occtExtrudeProfile. Returns a null handle if the outer build fails.
 */
export function occtExtrudeWithHoles(
  outer: { x: number; y: number }[],
  holes: { x: number; y: number }[][],
  depth: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  planeOffset = 0,
): OcctExtrudeResult {
  const base = occtExtrudeProfile(outer, depth, tessellation, planeOffset);
  if (!base.handle) return { geometry: new BufferGeometry(), handle: null };
  let solid = getShape(base.handle) as CutShape | null;
  if (!solid || typeof solid.cut !== 'function') return base;
  for (const hole of holes) {
    if (!hole || hole.length < 3) continue;
    // Extrude the hole a touch taller than the body and start it just below,
    // so the cut is a clean through-hole (no coplanar cap faces).
    const tool = occtExtrudeProfile(hole, depth + 0.2, tessellation, planeOffset - 0.1);
    const toolSolid = getShape(tool.handle);
    if (!toolSolid) continue;
    try {
      solid = solid.cut(toolSolid);
    } catch {
      /* skip a hole that fails to cut rather than abort the whole solid */
    }
  }
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

interface LoftSketch extends MeshedShape {
  loftWith: (others: LoftSketch[], config?: { ruled?: boolean }) => RotatableShape;
}
interface RotatableShape extends MeshedShape {
  rotate?: (deg: number, loc: [number, number, number], dir: [number, number, number]) => MeshedShape;
}
interface LoftPen {
  lineTo: (p: [number, number]) => LoftPen;
  close: () => { sketchOnPlane: (plane: string, origin?: number) => LoftSketch };
}

/**
 * Loft between two or more closed profiles into a real B-rep solid
 * (transitions, ducts, blended bosses). Each profile is a closed polygon
 * sketched on the XY plane at its own `z`; replicad blends a skin across them.
 * Profiles must be given bottom→top and share a winding. v1 scope: polygon
 * profiles, ruled = false (smooth).
 *
 * `stackAxis` controls the final orientation: 'Z' (default) keeps the loft
 * stacked along +Z; 'Y' rotates it −90° about X so the stack runs along +Y to
 * match THREE primitives / the mesh loftFeature (verified by bbox+centroid).
 *
 * Same handle/registry contract as the other B-rep builders; returns a null
 * handle on < 2 profiles or a build failure.
 */
export function occtLoftProfiles(
  profiles: { points: { x: number; y: number }[]; z: number }[],
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  stackAxis: 'Y' | 'Z' = 'Z',
): OcctExtrudeResult {
  const rc = requireReplicad();
  const draw = rc.draw as ((p?: [number, number]) => LoftPen) | undefined;
  if (typeof draw !== 'function' || profiles.length < 2) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const sketches: LoftSketch[] = [];
  for (const pf of profiles) {
    const pts = pf.points;
    if (pts.length < 3) return { geometry: new BufferGeometry(), handle: null };
    let pen = draw([pts[0].x, pts[0].y]);
    const last = pts.length - 1;
    for (let i = 1; i < pts.length; i++) {
      if (i === last
        && Math.abs(pts[i].x - pts[0].x) < 1e-6
        && Math.abs(pts[i].y - pts[0].y) < 1e-6) break;
      pen = pen.lineTo([pts[i].x, pts[i].y]);
    }
    sketches.push(pen.close().sketchOnPlane('XY', pf.z));
  }
  const [first, ...rest] = sketches;
  const lofted = first!.loftWith(rest, { ruled: false });
  const solid: MeshedShape = stackAxis === 'Y' && typeof lofted.rotate === 'function'
    ? lofted.rotate(-90, [0, 0, 0], [1, 0, 0])
    : lofted;
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

// ─── Kernel-backed filled surface (Track S — surfacing on the OCCT kernel) ──

export interface OcctSurfaceResult extends OcctExtrudeResult {
  /** The B-rep surface type OCCT assigned (e.g. BSPLINE_SURFACE) — proves the
   *  result is a real kernel surface, not a tessellated approximation. */
  surfaceType: string | null;
}

interface BSplineEdge { /* opaque replicad Edge */ _e?: never }
interface FilledFace {
  geomType: string;
  mesh: (cfg?: { tolerance?: number; angularTolerance?: number }) => { vertices: number[]; triangles: number[]; normals: number[] };
}

/**
 * Build a real B-rep surface FACE filling a 4-sided boundary of (possibly
 * curved) edges, on the OCCT kernel — `makeBSplineApproximation` fits each
 * boundary as a B-spline edge, `assembleWire` closes them, `makeNonPlanarFace`
 * fills the wire (BRepFill). The result is a genuine `Geom_BSplineSurface`-backed
 * face with exact UV/normals, not a tessellated patch — so trims/knits/offsets
 * downstream are kernel-exact (Track S goal). Returns the tessellation + a
 * registry handle + the OCCT surface type. Requires `isOcctReady()`.
 */
export function occtFilledSurface(
  boundary: Array<Array<{ x: number; y: number; z: number }>>,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctSurfaceResult {
  const rc = requireReplicad();
  const makeApprox = rc.makeBSplineApproximation as ((pts: Array<[number, number, number]>, cfg?: unknown) => BSplineEdge) | undefined;
  const assemble = rc.assembleWire as ((edges: BSplineEdge[]) => unknown) | undefined;
  const makeNonPlanar = rc.makeNonPlanarFace as ((wire: unknown) => FilledFace) | undefined;
  if (typeof makeApprox !== 'function' || typeof assemble !== 'function' || typeof makeNonPlanar !== 'function'
      || boundary.length !== 4) {
    return { geometry: new BufferGeometry(), handle: null, surfaceType: null };
  }
  try {
    const edges = boundary.map((curve) => {
      if (curve.length < 2) throw new Error('boundary curve needs ≥2 points');
      return makeApprox(curve.map((p) => [p.x, p.y, p.z] as [number, number, number]));
    });
    const wire = assemble(edges);
    const face = makeNonPlanar(wire);
    const mesh = face.mesh({
      tolerance: tessellation.tolerance ?? 0.1,
      angularTolerance: tessellation.angularTolerance ?? 0.2,
    });
    return { geometry: meshToBufferGeometry(mesh), handle: registerShape(face), surfaceType: face.geomType ?? null };
  } catch (err) {
    console.warn('[occtFilledSurface] kernel fill failed:', err);
    return { geometry: new BufferGeometry(), handle: null, surfaceType: null };
  }
}

export interface OcctKnitResult extends OcctExtrudeResult {
  /** Number of faces that were knit. */
  faceCount: number;
  /** Exact B-rep volume of the sewn solid (kernel measure), or null. */
  volume: number | null;
}

interface ShapeWithFaces { faces: unknown[] }
interface MeshableSolid { mesh: (cfg?: { tolerance?: number; angularTolerance?: number }) => { vertices: number[]; triangles: number[]; normals: number[] } }

/**
 * KNIT (sew) the faces of a registered B-rep shape into a watertight shell and
 * close it into a Solid on the OCCT kernel — `weldShellsAndFaces` stitches shared
 * edges within tolerance, `makeSolid` caps the shell (Track S surfacing op). The
 * round-trip (decompose a solid → re-sew) is the cleanest proof the knit is
 * kernel-exact: the sewn solid's `measureVolume` must match the original. Returns
 * the tessellation, a handle, the face count and the exact B-rep volume.
 */
export function occtKnitSolidFaces(
  handle: string | null | undefined,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctKnitResult {
  const rc = requireReplicad();
  const shape = getShape(handle) as ShapeWithFaces | null;
  const weld = rc.weldShellsAndFaces as ((fs: unknown[], ignore?: boolean) => unknown) | undefined;
  const makeSolid = rc.makeSolid as ((fs: unknown[]) => unknown) | undefined;
  const measureVolume = rc.measureVolume as ((s: unknown) => number) | undefined;
  if (!shape || typeof weld !== 'function' || typeof makeSolid !== 'function' || !Array.isArray(shape.faces)) {
    return { geometry: new BufferGeometry(), handle: null, faceCount: 0, volume: null };
  }
  try {
    const faces = shape.faces;
    const shell = weld(faces, true);
    const solid = makeSolid([shell]) as MeshableSolid;
    const volume = typeof measureVolume === 'function' ? measureVolume(solid) : null;
    const mesh = solid.mesh({
      tolerance: tessellation.tolerance ?? 0.1,
      angularTolerance: tessellation.angularTolerance ?? 0.2,
    });
    return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid), faceCount: faces.length, volume };
  } catch (err) {
    console.warn('[occtKnitSolidFaces] sew/knit failed:', err);
    return { geometry: new BufferGeometry(), handle: null, faceCount: 0, volume: null };
  }
}

interface SweepSketch {
  sweepSketch: (
    fn: (plane: unknown, origin: unknown) => unknown,
    config?: Record<string, unknown>,
  ) => MeshedShape;
}
interface SweepPen {
  lineTo: (p: [number, number]) => SweepPen;
  done: () => { sketchOnPlane: (plane: string, origin?: number) => SweepSketch };
}
interface PlaneProfileDraw {
  lineTo: (p: [number, number]) => PlaneProfileDraw;
  close: () => { sketchOnPlane: (plane: unknown) => unknown };
}

/**
 * Sweep a closed 2D profile along an open polyline path into a real B-rep solid
 * (pipes, handles, rails, gaskets). The path is drawn in `pathPlane` (default
 * XZ, so it rises and bends out of the ground plane); the profile is swept
 * perpendicular to the path tangent. v1 scope: polyline path, polygon profile,
 * profile-spine orthogonality forced for clean tube ends. Same handle/registry
 * contract; returns a null handle on a too-short path/profile or build failure.
 */
export function occtSweepProfile(
  profile: { x: number; y: number }[],
  path: { x: number; y: number }[],
  pathPlane = 'XZ',
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const rc = requireReplicad();
  const draw = rc.draw as ((p?: [number, number]) => SweepPen & PlaneProfileDraw) | undefined;
  if (typeof draw !== 'function' || profile.length < 3 || path.length < 2) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  let pathPen = draw([path[0].x, path[0].y]) as SweepPen;
  for (let i = 1; i < path.length; i++) pathPen = pathPen.lineTo([path[i].x, path[i].y]);
  const spine = pathPen.done().sketchOnPlane(pathPlane);
  const last = profile.length - 1;
  const solid = spine.sweepSketch((plane) => {
    let pp = (draw as (p?: [number, number]) => PlaneProfileDraw)([profile[0]!.x, profile[0]!.y]);
    for (let i = 1; i < profile.length; i++) {
      if (i === last
        && Math.abs(profile[i]!.x - profile[0]!.x) < 1e-6
        && Math.abs(profile[i]!.y - profile[0]!.y) < 1e-6) break;
      pp = pp.lineTo([profile[i]!.x, profile[i]!.y]);
    }
    return pp.close().sketchOnPlane(plane);
  }, { forceProfileSpineOthogonality: true });
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

/**
 * Sweep a closed 2D profile along a true 3D helix into a real B-rep solid
 * (springs, threads, augers) — the case occtSweepProfile can't reach with its
 * planar polyline path. The helix axis is +Y to match the THREE helix sweep
 * mesh; `height` is the total rise (turns × pitch). Same handle/registry
 * contract; returns a null handle on bad inputs or a build failure.
 */
export function occtSweepHelix(
  profile: { x: number; y: number }[],
  pitch: number,
  height: number,
  radius: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  /** Helix axis direction (default +Y, matching the legacy sweep wiring). */
  axisDir: [number, number, number] = [0, 1, 0],
  /** Left-handed helix (default right-handed). */
  lefthand = false,
): OcctExtrudeResult {
  const rc = requireReplicad();
  const sketchHelix = rc.sketchHelix as
    ((pitch: number, height: number, radius: number, center?: [number, number, number], dir?: [number, number, number], lefthand?: boolean) => SweepSketch) | undefined;
  const draw = rc.draw as ((p?: [number, number]) => PlaneProfileDraw) | undefined;
  if (typeof sketchHelix !== 'function' || typeof draw !== 'function'
    || profile.length < 3 || !(radius > 0) || !(height > 0) || !(pitch > 0)) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const spine = sketchHelix(pitch, height, radius, [0, 0, 0], axisDir, lefthand);
  const last = profile.length - 1;
  const solid = spine.sweepSketch((plane) => {
    let pp = draw([profile[0]!.x, profile[0]!.y]);
    for (let i = 1; i < profile.length; i++) {
      if (i === last
        && Math.abs(profile[i]!.x - profile[0]!.x) < 1e-6
        && Math.abs(profile[i]!.y - profile[0]!.y) < 1e-6) break;
      pp = pp.lineTo([profile[i]!.x, profile[i]!.y]);
    }
    return pp.close().sketchOnPlane(plane);
  }, { forceProfileSpineOthogonality: true });
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

interface OcctVertexPoint { x: number; y: number; z: number; delete?: () => void }
interface OcctTopoEdge { startPoint: OcctVertexPoint; endPoint: OcctVertexPoint; delete?: () => void }
interface EdgeEnumerableShape { edges: OcctTopoEdge[] }

/**
 * Enumerate a registered solid's edges into geometric signatures (chord
 * midpoint, sign-normalised direction, chord length). This is the OCCT half of
 * topology tracking: a stored fillet selection is re-anchored by matching its
 * signature against the CURRENT solid's edges (see edgeCorrespondence), which
 * survives topology changes the absolute click point can't. Returns [] when the
 * handle is unknown or the shape can't enumerate edges.
 */
export function occtEdgeSignatures(handle: string | null | undefined): EdgeSig[] {
  const shape = getShape(handle) as EdgeEnumerableShape | null;
  if (!shape) return [];
  let edges: OcctTopoEdge[];
  try {
    edges = shape.edges;
  } catch {
    return [];
  }
  if (!Array.isArray(edges)) return [];
  const sigs: EdgeSig[] = [];
  for (const e of edges) {
    try {
      const s = e.startPoint, t = e.endPoint;
      const sx = s.x, sy = s.y, sz = s.z, tx = t.x, ty = t.y, tz = t.z;
      s.delete?.(); t.delete?.();
      const dx = tx - sx, dy = ty - sy, dz = tz - sz;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      sigs.push({
        mid: [(sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2],
        dir: [dx / len, dy / len, dz / len],
        length: len,
      });
    } catch {
      /* skip an edge that fails to read rather than abort enumeration */
    } finally {
      e.delete?.();
    }
  }
  return sigs;
}

interface OcctTopoFace {
  center: OcctVertexPoint;
  normalAt: (loc?: unknown) => OcctVertexPoint;
  geomType?: string;
  delete?: () => void;
}
interface FaceEnumerableShape { faces: OcctTopoFace[] }

/**
 * Enumerate a registered solid's faces into geometric signatures (a surface
 * point, the signed outward normal, and the OCCT surface type). The face half
 * of topology tracking: a stored face selection (shell removal, sketch-on-face
 * plane) is re-anchored by matching its signature against the CURRENT solid's
 * faces (see matchFaceBySignature). Returns [] when the handle is unknown or
 * the shape can't enumerate faces.
 */
export function occtFaceSignatures(handle: string | null | undefined): FaceSig[] {
  const shape = getShape(handle) as FaceEnumerableShape | null;
  if (!shape) return [];
  let faces: OcctTopoFace[];
  try {
    faces = shape.faces;
  } catch {
    return [];
  }
  if (!Array.isArray(faces)) return [];
  const sigs: FaceSig[] = [];
  for (const f of faces) {
    try {
      const c = f.center;
      const cx = c.x, cy = c.y, cz = c.z;
      const n = f.normalAt(c);
      const nx = n.x, ny = n.y, nz = n.z;
      c.delete?.(); n.delete?.();
      let geomType: string | undefined;
      try { geomType = typeof f.geomType === 'string' ? f.geomType : undefined; } catch { geomType = undefined; }
      sigs.push({ center: [cx, cy, cz], normal: [nx, ny, nz], geomType });
    } catch {
      /* skip a face that fails to read rather than abort enumeration */
    } finally {
      f.delete?.();
    }
  }
  return sigs;
}

interface TransformableSolid extends MeshedShape {
  clone: () => TransformableSolid;
  translate: (v: [number, number, number]) => TransformableSolid;
  rotate: (deg: number, center: [number, number, number], dir: [number, number, number]) => TransformableSolid;
  mirror: (plane: string, origin?: [number, number, number]) => TransformableSolid;
  fuse: (other: unknown) => TransformableSolid;
}

function meshAndRegister(
  solid: MeshedShape,
  tessellation: { tolerance?: number; angularTolerance?: number },
): OcctExtrudeResult {
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

/**
 * Linear pattern as a real B-rep: fuse `count` translated copies of the host
 * solid (handle) along axis 0/1/2 by `spacing`. Unlike the mesh pattern (which
 * just merges disjoint geometries and loses the handle) this yields one solid
 * that chains into fillet/chamfer. Null handle if the host can't be cloned.
 */
export function occtLinearPattern(
  handle: string | null | undefined,
  axis: number,
  count: number,
  spacing: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const base = getShape(handle) as TransformableSolid | null;
  if (!base || typeof base.fuse !== 'function' || typeof base.clone !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  let acc: TransformableSolid | null = null;
  for (let i = 0; i < Math.max(1, count); i++) {
    const off: [number, number, number] = [0, 0, 0];
    off[axis] = i * spacing;
    const copy = base.clone().translate(off);
    acc = acc ? acc.fuse(copy) : copy;
  }
  if (!acc) return { geometry: new BufferGeometry(), handle: null };
  return meshAndRegister(acc, tessellation);
}

/**
 * Circular pattern as a real B-rep: fuse `count` copies rotated about the given
 * axis (0=X,1=Y,2=Z, through the origin) spread over `totalAngleDeg`. Same
 * handle-preserving contract as occtLinearPattern.
 */
export function occtCircularPattern(
  handle: string | null | undefined,
  axis: number,
  count: number,
  totalAngleDeg: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const base = getShape(handle) as TransformableSolid | null;
  if (!base || typeof base.fuse !== 'function' || typeof base.clone !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const n = Math.max(2, count);
  const stepDeg = totalAngleDeg / n;
  const dir: [number, number, number] = axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
  let acc: TransformableSolid | null = null;
  for (let i = 0; i < n; i++) {
    const copy = base.clone().rotate(i * stepDeg, [0, 0, 0], dir);
    acc = acc ? acc.fuse(copy) : copy;
  }
  if (!acc) return { geometry: new BufferGeometry(), handle: null };
  return meshAndRegister(acc, tessellation);
}

/**
 * Rib as a real B-rep: a thin box (length × height × thickness) posed along the
 * sketch line and fused onto the host solid, so the rib merges into the body
 * (chainable, clean STEP) instead of a mesh-CSG approximation. Mirrors the rib
 * mesh's pose: box centred, rotated −angleY about Y, translated to the line
 * mid-point at the right height. Null handle if the host can't be fused.
 */
export function occtRib(
  handle: string | null | undefined,
  p: { startX: number; startZ: number; endX: number; endZ: number; thickness: number; height: number; direction: number },
  bbMinY: number,
  bbMaxY: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const rc = requireReplicad();
  const host = getShape(handle) as TransformableSolid | null;
  if (!host || typeof host.fuse !== 'function') return { geometry: new BufferGeometry(), handle: null };
  const dx = p.endX - p.startX, dz = p.endZ - p.startZ;
  const len = Math.hypot(dx, dz);
  const thickness = Math.max(0.1, p.thickness), height = Math.max(0.5, p.height);
  if (len < 0.5) return { geometry: new BufferGeometry(), handle: null };
  const angleY = Math.atan2(dz, dx);
  const midX = (p.startX + p.endX) / 2, midZ = (p.startZ + p.endZ) / 2;
  const baseY = p.direction === 0 ? bbMinY : bbMaxY - height;
  const ribCenterY = baseY + height / 2;
  // makeBaseBox is centred in X/Y, z∈[0,thickness]; shift −thickness/2 to centre.
  let box = ((rc.makeBaseBox as ReplicadLike['makeBaseBox'])(len, height, thickness) as unknown as TransformableSolid)
    .translate([0, 0, -thickness / 2]);
  if (Math.abs(angleY) > 1e-9) box = box.rotate(-angleY * 180 / Math.PI, [0, 0, 0], [0, 1, 0]);
  box = box.translate([midX, ribCenterY, midZ]);
  return meshAndRegister(host.fuse(box) as MeshedShape, tessellation);
}

/**
 * Mirror as a real B-rep: fuse the host solid with its reflection across a
 * principal plane (0=YZ flip X, 1=XZ flip Y, 2=XY flip Z, through the origin).
 */
export function occtMirror(
  handle: string | null | undefined,
  plane: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const base = getShape(handle) as TransformableSolid | null;
  if (!base || typeof base.fuse !== 'function' || typeof base.mirror !== 'function' || typeof base.clone !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const planeName = plane === 0 ? 'YZ' : plane === 1 ? 'XZ' : 'XY';
  const mirrored = base.clone().mirror(planeName, [0, 0, 0]);
  const fused = base.clone().fuse(mirrored);
  return meshAndRegister(fused, tessellation);
}

/** Face selector handed to replicad's `draft` — only the methods we call. */
interface FaceFinderLike {
  atAngleWith: (direction: [number, number, number], angle?: number) => FaceFinderLike;
}

/** B-rep solid that supports replicad's native draft (OCCT BRepOffsetAPI_DraftAngle). */
interface DraftableSolid extends MeshedShape {
  draft: (
    angle: number,
    faceFinder: (f: FaceFinderLike) => FaceFinderLike,
    neutralPlane?: string,
  ) => MeshedShape;
}

/**
 * Draft as a real B-rep: taper the host solid's side walls by `angleDeg` about a
 * neutral plane, via replicad's native draft (OCCT BRepOffsetAPI_DraftAngle).
 *
 * The legacy mesh path (draft.ts) just shears every vertex relative to Y=0,
 * which is geometrically wrong for anything but the simplest box. Here the side
 * walls — faces whose normal is perpendicular to the +Y pull direction — are the
 * ones tilted, and the XZ neutral plane (Y=0) keeps the cross-section fixed
 * there and tapers away from it. `direction` flips the taper sense (0 vs 1).
 *
 * Returns a null handle when the host can't be drafted (no faces matched, the
 * op fails, …) so the caller falls back to the mesh path.
 */
export function occtDraft(
  handle: string | null | undefined,
  angleDeg: number,
  direction: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const host = getShape(handle) as DraftableSolid | null;
  if (!host || typeof host.draft !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const signed = direction === 0 ? angleDeg : -angleDeg;
  const drafted = host.draft(signed, (f) => f.atAngleWith([0, 1, 0], 90), 'XZ');
  return meshAndRegister(drafted, tessellation);
}

/** B-rep solid that supports replicad's uniform scale. */
interface ScalableSolid extends MeshedShape {
  scale: (factor: number, center?: [number, number, number]) => MeshedShape;
}

/**
 * Scale as a real B-rep so the OCCT chain survives a scale feature (a mesh scale
 * in the middle of the tree drops the handle and forces everything downstream to
 * mesh). replicad exposes UNIFORM scale only (`scale(factor)` about the origin,
 * matching the mesh `makeScale`); a non-uniform (sx≠sy≠sz) scale needs OCCT
 * `GTransform`, which replicad doesn't surface, so we return a null handle and
 * the caller meshes. Uniform is the common, feature-safe case.
 */
export function occtScale(
  handle: string | null | undefined,
  sx: number,
  sy: number,
  sz: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const host = getShape(handle) as ScalableSolid | null;
  if (!host || typeof host.scale !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const eps = 1e-6;
  if (Math.abs(sx - sy) > eps || Math.abs(sy - sz) > eps) {
    // Non-uniform: not expressible via replicad's uniform scale → mesh fallback.
    return { geometry: new BufferGeometry(), handle: null };
  }
  return meshAndRegister(host.scale(sx), tessellation);
}

/** B-rep solid that supports translate + fuse (move / copy). */
interface MovableSolid extends MeshedShape {
  clone: () => MovableSolid;
  translate: (v: [number, number, number]) => MovableSolid;
  fuse: (other: unknown) => MovableSolid;
}

/**
 * Move / copy as a real B-rep (another chain-breaker if left to mesh).
 *   operation 0 (move) → translate the solid in place; one handle.
 *   operation 1 (copy) → fuse the original with a translated copy into one
 *     B-rep (a compound when the two are disjoint), matching the mesh path that
 *     merges original+copy into one geometry.
 * Null handle if the host can't be translated (caller meshes).
 */
export function occtMoveCopy(
  handle: string | null | undefined,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  operation: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const host = getShape(handle) as MovableSolid | null;
  if (!host || typeof host.translate !== 'function' || typeof host.clone !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const offset: [number, number, number] = [offsetX, offsetY, offsetZ];
  if (operation === 0) {
    return meshAndRegister(host.clone().translate(offset), tessellation);
  }
  if (typeof host.fuse !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const moved = host.clone().translate(offset);
  return meshAndRegister(host.clone().fuse(moved), tessellation);
}

/**
 * Build a base PRIMITIVE as a real B-rep solid so the OCCT chain can start from
 * the base (not just from a sketch). Without this, a cylinder/sphere base has
 * no handle, so a downstream fillet falls back to its bounding BOX — wrong for
 * non-box shapes. Box is intentionally omitted: its bbox equals the shape, so
 * the mesh-bbox fallback already gives the correct fillet.
 *
 * Conventions match the THREE primitives: cylinder is +Y, centered at origin;
 * sphere centered at origin. Returns a null handle for unsupported shapes.
 */
interface PrismSolid extends MeshedShape {
  translate: (v: [number, number, number]) => PrismSolid;
  rotate: (deg: number, loc: [number, number, number], dir: [number, number, number]) => PrismSolid;
  cut: (other: unknown) => PrismSolid;
  fuse: (other: unknown) => PrismSolid;
}

export function occtBaseSolid(
  shapeId: string,
  params: Record<string, number>,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const rc = requireReplicad();
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  let solid: MeshedShape | null = null;
  if (shapeId === 'cylinder') {
    const r = num(params.diameter ?? params.outerDiameter, 30) / 2;
    const h = num(params.height ?? params.length, 50);
    if (r > 0 && h > 0) {
      // makeCylinder(radius, height, baseLocation, axisDir) → +Y, centered.
      solid = (rc.makeCylinder as ReplicadLike['makeCylinder'])(r, h, [0, -h / 2, 0], [0, 1, 0]) as MeshedShape;
    }
  } else if (shapeId === 'sphere') {
    const r = num(params.diameter, 30) / 2;
    if (r > 0) solid = (rc.makeSphere as ReplicadLike['makeSphere'])(r) as MeshedShape;
  } else if (shapeId === 'pipe') {
    // Tube = outer cylinder minus a slightly-taller inner cylinder (clean bore).
    // +Y, centered — matches the mesh (LatheGeometry of a rect about Y).
    const oR = num(params.outerDiameter, 60) / 2;
    const iR = num(params.innerDiameter, 40) / 2;
    const h = num(params.length ?? params.height, 100);
    if (oR > 0 && h > 0 && iR > 0 && iR < oR) {
      const mk = rc.makeCylinder as ReplicadLike['makeCylinder'];
      const outer = mk(oR, h, [0, -h / 2, 0], [0, 1, 0]) as CutShape;
      const inner = mk(iR, h + 2, [0, -h / 2 - 1, 0], [0, 1, 0]);
      if (typeof outer.cut === 'function') solid = outer.cut(inner) as MeshedShape;
    }
  } else if (shapeId === 'wedge') {
    // Right-triangle prism, centred on the bbox (matches ExtrudeGeometry+center()).
    const w = num(params.width, 50), h = num(params.height, 40), d = num(params.depth, 30);
    const draw = rc.draw as ((p?: [number, number]) => DrawPen) | undefined;
    if (w > 0 && h > 0 && d > 0 && typeof draw === 'function') {
      const ext = draw([-w / 2, -h / 2]).lineTo([w / 2, -h / 2]).lineTo([w / 2, h / 2])
        .close().sketchOnPlane('XY').extrude(d) as unknown as PrismSolid;
      solid = ext.translate([0, 0, -d / 2]);
    }
  } else if (shapeId === 'lBracket') {
    // L = horizontal slab fused with a left vertical leg (boxes, depth +Z).
    const w = num(params.width, 80), h = num(params.height, 60), t = num(params.thickness, 8), d = num(params.depth, 40);
    const vertH = h - t;
    if (w > 0 && h > 0 && t > 0 && d > 0 && vertH > 0) {
      const mk = rc.makeBaseBox as ReplicadLike['makeBaseBox'];
      // makeBaseBox is centred in X/Y but spans z∈[0,d]; shift −d/2 to centre Z
      // (matching the centred BoxGeometry the lBracket mesh uses).
      const horz = (mk(w, t, d) as unknown as PrismSolid).translate([0, t / 2, -d / 2]);
      const vert = (mk(t, vertH, d) as unknown as PrismSolid).translate([-w / 2 + t / 2, t + vertH / 2, -d / 2]);
      solid = horz.fuse(vert) as MeshedShape;
    }
  } else if (shapeId === 'iBeam') {
    // I-profile extruded length L, centred on Z then rotated +90° about X so the
    // beam runs along Y (matches the iBeam mesh).
    const H = num(params.height, 200), BF = num(params.flangeWidth, 100);
    const tw = num(params.webThick, 8), tf = num(params.flangeThick, 12), L = num(params.length, 1000);
    const draw = rc.draw as ((p?: [number, number]) => DrawPen) | undefined;
    if (H > 0 && BF > 0 && tw > 0 && tf > 0 && L > 0 && tf < H / 2 && tw < BF && typeof draw === 'function') {
      const hw = tw / 2, hbf = BF / 2, hH = H / 2;
      const ext = draw([-hbf, -hH]).lineTo([hbf, -hH]).lineTo([hbf, -hH + tf]).lineTo([hw, -hH + tf])
        .lineTo([hw, hH - tf]).lineTo([hbf, hH - tf]).lineTo([hbf, hH]).lineTo([-hbf, hH])
        .lineTo([-hbf, hH - tf]).lineTo([-hw, hH - tf]).lineTo([-hw, -hH + tf]).lineTo([-hbf, -hH + tf])
        .close().sketchOnPlane('XY').extrude(L) as unknown as PrismSolid;
      const centred = ext.translate([0, 0, -L / 2]);
      solid = typeof centred.rotate === 'function' ? centred.rotate(90, [0, 0, 0], [1, 0, 0]) : centred;
    }
  } else if (shapeId === 'hexNut') {
    // Hex prism with a central bore, centred on Z then rotated +90° about X
    // (thickness along Y) — matches the hexNut mesh.
    const af = num(params.acrossFlats, 17), t = num(params.thickness, 8), hd = num(params.nominalDia, 10) / 2;
    const cr = (af / 2) / Math.cos(Math.PI / 6);
    const draw = rc.draw as ((p?: [number, number]) => DrawPen) | undefined;
    if (af > 0 && t > 0 && hd > 0 && hd < af / 2 && typeof draw === 'function') {
      let pen = draw([cr * Math.cos(Math.PI / 6), cr * Math.sin(Math.PI / 6)]);
      for (let i = 1; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        pen = pen.lineTo([cr * Math.cos(a), cr * Math.sin(a)]);
      }
      const hex = pen.close().sketchOnPlane('XY').extrude(t) as unknown as PrismSolid;
      const bore = (rc.makeCylinder as ReplicadLike['makeCylinder'])(hd, t + 2, [0, 0, -1], [0, 0, 1]);
      const bored = typeof hex.cut === 'function' ? hex.cut(bore) : hex;
      const centred = bored.translate([0, 0, -t / 2]);
      solid = typeof centred.rotate === 'function' ? centred.rotate(90, [0, 0, 0], [1, 0, 0]) : centred;
    }
  } else if (shapeId === 'pulley') {
    // V-belt pulley: revolve the same numeric lathe profile about Y (matches the
    // LatheGeometry mesh exactly — same profile, same axis).
    const outerR = num(params.outerDiameter, 100) / 2;
    const boreR = num(params.boreDiameter, 15) / 2;
    const width = num(params.width, 25);
    const grooveCount = Math.round(num(params.grooveCount, 1));
    const grooveDepth = num(params.grooveDepth, 8);
    const draw = rc.draw as ((p?: [number, number]) => RevolvePen) | undefined;
    if (outerR > boreR && boreR > 0 && width > 0 && typeof draw === 'function') {
      const halfAngle = (38 / 2) * Math.PI / 180;
      const grooveTopWidth = 2 * grooveDepth * Math.tan(halfAngle);
      const grooveSpacing = grooveTopWidth * 1.3;
      const totalGrooveZone = grooveCount > 1 ? (grooveCount - 1) * grooveSpacing + grooveTopWidth : grooveTopWidth;
      const rimWidth = Math.max((width - totalGrooveZone) / 2, 2);
      const halfW = width / 2;
      const pts: [number, number][] = [[boreR, -halfW], [outerR, -halfW]];
      const grooveStartY = -halfW + rimWidth;
      for (let g = 0; g < grooveCount; g++) {
        const gc = grooveStartY + grooveTopWidth / 2 + g * grooveSpacing;
        pts.push([outerR, gc - grooveTopWidth / 2]);
        pts.push([outerR - grooveDepth, gc]);
        pts.push([outerR, gc + grooveTopWidth / 2]);
      }
      pts.push([outerR, halfW], [boreR, halfW], [boreR, -halfW]);
      let pen = draw(pts[0]);
      const last = pts.length - 1;
      for (let i = 1; i < pts.length; i++) {
        if (i === last && Math.abs(pts[i][0] - pts[0][0]) < 1e-6 && Math.abs(pts[i][1] - pts[0][1]) < 1e-6) break;
        pen = pen.lineTo(pts[i]);
      }
      solid = pen.close().sketchOnPlane('XY').revolve([0, 1, 0]);
    }
  } else if (shapeId === 'bolt') {
    // Hex-head bolt: hex head prism fused with a cylindrical shaft below it,
    // both +Y — matches the bolt mesh (head centred on 0, shaft hanging down).
    const r = num(params.shaftDiameter, 10) / 2;
    const sL = num(params.shaftLength, 60);
    const hH = num(params.headHeight, 7);
    const hF = num(params.headFlats, 17);
    const cr = (hF / 2) / Math.cos(Math.PI / 6);
    const draw = rc.draw as ((p?: [number, number]) => DrawPen) | undefined;
    if (r > 0 && sL > 0 && hH > 0 && hF > 0 && typeof draw === 'function') {
      let pen = draw([cr * Math.cos(Math.PI / 6), cr * Math.sin(Math.PI / 6)]);
      for (let i = 1; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        pen = pen.lineTo([cr * Math.cos(a), cr * Math.sin(a)]);
      }
      const headExt = pen.close().sketchOnPlane('XY').extrude(hH) as unknown as PrismSolid;
      const head = headExt.translate([0, 0, -hH / 2]).rotate(90, [0, 0, 0], [1, 0, 0]);
      const shaft = (rc.makeCylinder as ReplicadLike['makeCylinder'])(r, sL, [0, -hH / 2 - sL, 0], [0, 1, 0]);
      solid = (head as PrismSolid).fuse(shaft) as MeshedShape;
    }
  } else if (shapeId === 'tSlot') {
    // Square aluminium extrusion: outer square minus the inner cavity and a
    // T-groove on each of the 4 faces; centred on Z then +90° about X (runs
    // along Y) to match the tSlot mesh.
    const S = num(params.profileSize, 40), L = num(params.length, 200);
    const tw = num(params.wallThick, 3), sw = num(params.slotWidth, 8), sd = num(params.slotDepth, 6);
    const draw = rc.draw as ((p?: [number, number]) => DrawPen) | undefined;
    if (S > 0 && L > 0 && tw > 0 && tw < S / 2 && typeof draw === 'function') {
      const half = S / 2;
      const slotHW = sw / 2, neckHW = (sw * 0.55) / 2;
      const contours: [number, number][][] = [
        [[-half + tw, -half + tw], [half - tw, -half + tw], [half - tw, half - tw], [-half + tw, half - tw]], // inner cavity
        [[-neckHW, -half], [-slotHW, -half + sd], [slotHW, -half + sd], [neckHW, -half]],                     // bottom slot
        [[-neckHW, half], [-slotHW, half - sd], [slotHW, half - sd], [neckHW, half]],                         // top slot
        [[-half, -neckHW], [-half + sd, -slotHW], [-half + sd, slotHW], [-half, neckHW]],                     // left slot
        [[half, -neckHW], [half - sd, -slotHW], [half - sd, slotHW], [half, neckHW]],                         // right slot
      ];
      const drawFn = draw;
      const buildExtrude = (pts: [number, number][], depth: number, zoff: number): PrismSolid => {
        let pen = drawFn(pts[0]);
        for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
        return pen.close().sketchOnPlane('XY', zoff).extrude(depth) as unknown as PrismSolid;
      };
      let body = buildExtrude([[-half, -half], [half, -half], [half, half], [-half, half]], L, 0);
      for (const c of contours) {
        if (typeof body.cut === 'function') body = body.cut(buildExtrude(c, L + 0.2, -0.1));
      }
      const centred = body.translate([0, 0, -L / 2]);
      solid = typeof centred.rotate === 'function' ? centred.rotate(90, [0, 0, 0], [1, 0, 0]) : centred;
    }
  } else if (shapeId === 'washer') {
    // Annular disk = outer cylinder minus inner bore, axis +Z, centred on z —
    // matching the washer mesh (ExtrudeGeometry of a ring along Z, centred).
    const oR = num(params.outerDia, 24) / 2;
    const iR = num(params.innerDia, 11) / 2;
    const t = num(params.thickness, 2.5);
    if (oR > 0 && t > 0 && iR > 0 && iR < oR) {
      const mk = rc.makeCylinder as ReplicadLike['makeCylinder'];
      const outer = mk(oR, t, [0, 0, -t / 2], [0, 0, 1]) as CutShape;
      const inner = mk(iR, t + 2, [0, 0, -t / 2 - 1], [0, 0, 1]);
      if (typeof outer.cut === 'function') solid = outer.cut(inner) as MeshedShape;
    }
  } else if (shapeId === 'torus') {
    // Revolve the minor circle (centered at x=R, radius r) about Y, then rotate
    // +90° about X so the torus axis is +Z — matching THREE.TorusGeometry.
    const R = num(params.majorDiameter, 80) / 2;
    const r = num(params.tubeDiameter, 20) / 2;
    const draw = rc.draw as ((p: [number, number]) => RevolvePen) | undefined;
    if (R > r && r > 0 && typeof draw === 'function') {
      const N = 32;
      let pen = draw([R + r, 0]);
      for (let i = 1; i < N; i++) {
        const t = (i / N) * Math.PI * 2;
        pen = pen.lineTo([R + r * Math.cos(t), r * Math.sin(t)]);
      }
      const yTorus = pen.close().sketchOnPlane('XY').revolve([0, 1, 0]) as
        MeshedShape & { rotate?: (deg: number, loc: [number, number, number], dir: [number, number, number]) => MeshedShape };
      solid = typeof yTorus.rotate === 'function'
        ? yTorus.rotate(90, [0, 0, 0], [1, 0, 0])
        : yTorus;
    }
  } else if (shapeId === 'disk') {
    // Disk = thin cylinder (+Y, centered); with innerDia>0 it's an annular ring
    // (outer cylinder minus a taller inner bore) — matches the LatheGeometry mesh.
    const oR = num(params.diameter, 80) / 2;
    const iR = num(params.innerDia, 0) / 2;
    const h = num(params.thickness, 8);
    if (oR > 0 && h > 0) {
      const mk = rc.makeCylinder as ReplicadLike['makeCylinder'];
      if (iR > 0 && iR < oR) {
        const outer = mk(oR, h, [0, -h / 2, 0], [0, 1, 0]) as CutShape;
        const inner = mk(iR, h + 2, [0, -h / 2 - 1, 0], [0, 1, 0]);
        if (typeof outer.cut === 'function') solid = outer.cut(inner) as MeshedShape;
      } else {
        solid = mk(oR, h, [0, -h / 2, 0], [0, 1, 0]) as MeshedShape;
      }
    }
  } else if (shapeId === 'cone') {
    // Revolve a trapezoid (frustum) or triangle (apex, top Ø0) profile about Y,
    // centered at the origin — matching THREE.CylinderGeometry(rTop, rBot, h).
    const r1 = num(params.bottomDiameter, 50) / 2;
    const r2 = num(params.topDiameter, 0) / 2;
    const h = num(params.height, 80);
    const draw = rc.draw as ((p: [number, number]) => RevolvePen) | undefined;
    if (r1 > 0 && h > 0 && typeof draw === 'function') {
      let pen = draw([0, -h / 2]).lineTo([r1, -h / 2]);
      if (r2 > 0) pen = pen.lineTo([r2, h / 2]);
      pen = pen.lineTo([0, h / 2]);
      solid = pen.close().sketchOnPlane('XY').revolve([0, 1, 0]) as MeshedShape;
    }
  }
  if (!solid || typeof solid.mesh !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const mesh = solid.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(solid) };
}

/**
 * Round every edge of a box primitive with `radius`. Phase 2c scope —
 * chained inputs fall back to the legacy mesh-based approximator because
 * we don't yet plumb B-rep through the pipeline.
 */
export function occtFilletBox(
  hostBox: { w: number; h: number; d: number; cx: number; cy: number; cz: number },
  radius: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  hostHandle?: string | null,
  edgeFinder?: ReplicadEdgeFinder,
): OcctBooleanResult {
  const rc = requireReplicad();
  const chained = getShape(hostHandle) as FilletChamferShape | null;
  const source: FilletChamferShape = chained ?? (() => {
    const base = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w, hostBox.h, hostBox.d) as FilletChamferShape;
    return base.translate([hostBox.cx, hostBox.cy, hostBox.cz - hostBox.d / 2]);
  })();
  // replicad's fillet(radius, filter) calls filter(new EdgeFinder()) and uses
  // the returned finder, so a pre-built EdgeFinder must be handed back via a
  // wrapper fn (not passed directly). No finder → fillet every edge.
  const filleted = edgeFinder !== undefined ? source.fillet(radius, () => edgeFinder) : source.fillet(radius);
  const mesh = filleted.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(filleted) };
}

/**
 * Variable-radius fillet: round the selected edge with a radius that varies
 * linearly from `startRadius` (edge start) to `endRadius` (edge end). replicad's
 * fillet accepts a `[r1, r2]` radius (FilletRadius) for exactly this — a real
 * B-rep variable fillet, not the mesh-offset approximation.
 *
 * Variable radius is only meaningful along a SINGLE edge, so an `edgeFinder`
 * (re-resolved from the stored selection by signature, like occtFilletBox)
 * should restrict it to the picked edge. With no finder it applies to every
 * edge, which replicad may reject for some solids → the caller's try/catch
 * falls back to the mesh path.
 */
export function occtVariableFillet(
  hostBox: { w: number; h: number; d: number; cx: number; cy: number; cz: number },
  startRadius: number,
  endRadius: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  hostHandle?: string | null,
  edgeFinder?: ReplicadEdgeFinder,
): OcctBooleanResult {
  const rc = requireReplicad();
  const chained = getShape(hostHandle) as FilletChamferShape | null;
  const source: FilletChamferShape = chained ?? (() => {
    const base = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w, hostBox.h, hostBox.d) as FilletChamferShape;
    return base.translate([hostBox.cx, hostBox.cy, hostBox.cz - hostBox.d / 2]);
  })();
  const r: [number, number] = [startRadius, endRadius];
  const filleted = edgeFinder !== undefined ? source.fillet(r, () => edgeFinder) : source.fillet(r);
  const mesh = filleted.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(filleted) };
}

/**
 * Chamfer every edge of a box primitive with `distance`. Same scope caveat
 * as occtFilletBox.
 */
export function occtChamferBox(
  hostBox: { w: number; h: number; d: number; cx: number; cy: number; cz: number },
  distance: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  hostHandle?: string | null,
  edgeFinder?: ReplicadEdgeFinder,
): OcctBooleanResult {
  const rc = requireReplicad();
  const chained = getShape(hostHandle) as FilletChamferShape | null;
  const source: FilletChamferShape = chained ?? (() => {
    const base = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w, hostBox.h, hostBox.d) as FilletChamferShape;
    return base.translate([hostBox.cx, hostBox.cy, hostBox.cz - hostBox.d / 2]);
  })();
  const chamfered = edgeFinder !== undefined ? source.chamfer(distance, () => edgeFinder) : source.chamfer(distance);
  const mesh = chamfered.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(chamfered) };
}

/**
 * Shell a B-Rep shape.
 */
export function occtShellBox(
  hostBox: { w: number; h: number; d: number; cx: number; cy: number; cz: number },
  thickness: number,
  openFace: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
  hostHandle?: string | null,
  faceFinder?: unknown,
): OcctBooleanResult {
  const rc = requireReplicad();
  const chained = getShape(hostHandle) as ShellableShape | null;
  const source: ShellableShape = chained ?? (() => {
    const base = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w, hostBox.h, hostBox.d) as ShellableShape;
    return base.translate([hostBox.cx, hostBox.cy, hostBox.cz - hostBox.d / 2]);
  })();

  // With a face finder, remove the user-selected face the proper B-rep way:
  // replicad's shell(thickness, finderFn) opens exactly those faces. Otherwise
  // fall back to the closed shell + openFace boolean-cut heuristic.
  if (faceFinder !== undefined) {
    // Sign convention, MEASURED 260808 on the replicad-opencascadejs build of
    // record (probe: 100×60×30, wall 2, top finder): POSITIVE thickness
    // hollows INWARD keeping the outer surface (vol 29472 = closed form,
    // bbox unchanged); NEGATIVE adds the wall OUTWARD (vol 32599, bbox grows
    // by t on every axis) — that outward shell was REF-PART 1's "+10.6%
    // uneven wall" finding. Wire orientation and source kind (extrude vs
    // makeBaseBox) do not affect this. Because the convention is empirical,
    // verify inwardness via the bounding box and retry the opposite sign if
    // a future replicad upgrade flips it again.
    const shellInward = (sign: 1 | -1) => source.shell(sign * thickness, () => faceFinder);
    const grewOutward = (shape: ShellableShape): boolean => {
      const src = source.boundingBox?.bounds;
      const out = shape.boundingBox?.bounds;
      if (!src || !out) return false; // bounds unavailable → trust the measured default
      const tol = Math.max(1e-3, thickness * 0.5);
      for (let axis = 0; axis < 3; axis++) {
        if (out[0][axis]! < src[0][axis]! - tol || out[1][axis]! > src[1][axis]! + tol) return true;
      }
      return false;
    };
    let shelledF = shellInward(1);
    if (grewOutward(shelledF)) {
      reportWarning('csg', new Error('shell(+t, finder) grew outward — replicad sign convention changed; retrying -t'), {
        phase: 'occt_shell_sign_flip', thickness,
      });
      shelledF = shellInward(-1);
      if (grewOutward(shelledF)) {
        throw new Error('SHELL_OUTWARD: both shell sign conventions grew the body outward — refusing to emit a wrong-walled solid');
      }
    }
    const meshF = shelledF.mesh({
      tolerance: tessellation.tolerance ?? 0.1,
      angularTolerance: tessellation.angularTolerance ?? 0.2,
    });
    return { geometry: meshToBufferGeometry(meshF), handle: registerShape(shelledF) };
  }

  // Replicad shell uses a negative thickness for inward.
  // Note: we just use .shell(-thickness) for a closed hollow shell,
  // and cut the open face via boolean subtraction to ensure reliability.
  let shelled = source.shell(-thickness);

  if (openFace > 0) {
    const cutHeight = thickness * 4;
    const cutBox = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w * 3, cutHeight, hostBox.d * 3) as ShellableShape;
    
    // hostBox.cy is the center.
    // bounding box max Y is hostBox.cy + hostBox.h / 2
    let cy = hostBox.cy;
    if (openFace === 1) { // top
      cy = hostBox.cy + hostBox.h / 2 + cutHeight / 2 - thickness;
    } else { // bottom
      cy = hostBox.cy - hostBox.h / 2 - cutHeight / 2 + thickness;
    }
    
    const cutTranslated = cutBox.translate([hostBox.cx, cy, hostBox.cz - hostBox.d / 2]);
    shelled = shelled.cut(cutTranslated);
  }

  const mesh = shelled.mesh({
    tolerance: tessellation.tolerance ?? 0.1,
    angularTolerance: tessellation.angularTolerance ?? 0.2,
  });
  return { geometry: meshToBufferGeometry(mesh), handle: registerShape(shelled) };
}

// ─── Direct editing (Phase 1 — Delete Face / Offset Face) ──────────────────
//
// Binding survey (2026-06-10, replicad-opencascadejs WASM):
//   - BRepAlgoAPI_Defeaturing / BRepTools_RemoveFeatures are NOT bound in the
//     shipped WASM, so the classic one-call OCCT Delete Face is unavailable.
//   - What IS available (replicad level): Face.outerWire()/innerWires(),
//     makeFace(wire, holes) (BRepBuilderAPI_MakeFace + ShapeFix_Face),
//     weldShellsAndFaces (BRepBuilderAPI_Sewing), makeSolid (ShapeFix_Solid),
//     Shape.simplify() (ShapeUpgrade_UnifySameDomain), basicFaceExtrusion
//     (face prism), measureVolume, and shared-TShape identity via isSame().
//
// Delete Face therefore ships as sew-and-cap defeaturing: remove the selected
// face set, find the interior loops it leaves on the remaining faces, cap each
// loop with a planar face, re-sew, re-solidify. This covers the boss / pocket /
// hole removal cases (the STEP-defeaturing use case) and HONESTLY REFUSES face
// sets whose opening is not an interior loop (e.g. deleting one side of a box)
// or whose healing cap would be non-planar — those need true OCCT defeaturing.
//
// Offset Face ships as a planar prism rebuild (push/pull semantics): the face
// is extruded along its normal and fused (outward) or cut (inward). For the
// dominant case — planar face with perpendicular neighbour walls — this is
// identical to SolidWorks Move Face (Offset). Non-planar faces are refused.

export interface FaceOpSelection {
  /** Click point on the face (mm, world). */
  position: [number, number, number];
  /** Outward normal at the click point (unit, world). */
  normal: [number, number, number];
}

interface DirectEditEdgeLike {
  hashCode: number;
  isSame: (other: unknown) => boolean;
}

interface DirectEditWireLike {
  edges: DirectEditEdgeLike[];
  isSame: (other: unknown) => boolean;
}

interface DirectEditFaceLike extends MeshedShape {
  geomType?: string;
  center: OcctVertexPoint;
  normalAt: (loc?: unknown) => OcctVertexPoint;
  outerWire: () => DirectEditWireLike;
  innerWires: () => DirectEditWireLike[];
  edges: DirectEditEdgeLike[];
  clone: () => DirectEditFaceLike;
  translate: (v: [number, number, number]) => DirectEditFaceLike;
  isSame: (other: unknown) => boolean;
}

interface DirectEditSolidLike extends MeshedShape {
  faces: DirectEditFaceLike[];
  fuse: (other: unknown) => DirectEditSolidLike;
  cut: (other: unknown) => DirectEditSolidLike;
  simplify?: () => DirectEditSolidLike;
}

interface FaceFinderCtorLike {
  new (): {
    withinDistance: (distance: number, point: [number, number, number]) => { find: (shape: unknown) => DirectEditFaceLike[] };
  };
}

function unit3(v: [number, number, number]): [number, number, number] | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Resolve ONE stored face selection to the actual B-rep face on the current
 * solid. Primary path: replicad's FaceFinder.withinDistance anchored at the
 * click point (BRepExtrema — works for curved faces where a center/normal
 * signature does not), tie-broken by the surface normal AT THE CLICK POINT vs
 * the recorded selection normal. Fallback: center/normal signature matching
 * (same matcher shell-face removal uses). Returns null when nothing matches.
 */
function resolveFaceForSelection(
  rc: Record<string, unknown>,
  solid: DirectEditSolidLike,
  sel: FaceOpSelection,
  allFaces: DirectEditFaceLike[],
): DirectEditFaceLike | null {
  const FF = rc.FaceFinder as FaceFinderCtorLike | undefined;
  const alignmentAtClick = (face: DirectEditFaceLike): number => {
    try {
      const n = face.normalAt(sel.position);
      const u = unit3([n.x, n.y, n.z]);
      n.delete?.();
      if (!u) return -Infinity;
      return u[0] * sel.normal[0] + u[1] * sel.normal[1] + u[2] * sel.normal[2];
    } catch {
      return -Infinity;
    }
  };

  if (FF) {
    for (const tol of [0.5, 2.0]) {
      let candidates: DirectEditFaceLike[] = [];
      try {
        candidates = new FF().withinDistance(tol, sel.position).find(solid);
      } catch {
        candidates = [];
      }
      if (candidates.length === 1) return candidates[0]!;
      if (candidates.length > 1) {
        let best: DirectEditFaceLike | null = null;
        let bestAlign = -Infinity;
        for (const c of candidates) {
          const a = alignmentAtClick(c);
          if (a > bestAlign) { bestAlign = a; best = c; }
        }
        if (best) return best;
      }
    }
  }

  // Signature fallback (good for planar faces; what shell-removal already uses).
  const sigs: FaceSig[] = [];
  const sigFace: DirectEditFaceLike[] = [];
  for (const f of allFaces) {
    try {
      const c = f.center;
      const n = f.normalAt();
      sigs.push({ center: [c.x, c.y, c.z], normal: [n.x, n.y, n.z], geomType: typeof f.geomType === 'string' ? f.geomType : undefined });
      sigFace.push(f);
      c.delete?.(); n.delete?.();
    } catch { /* skip unreadable face */ }
  }
  // Local import avoided (edgeCorrespondence is type-only above); inline the
  // same scoring: signed normal alignment − 0.5 × center distance.
  const tn = unit3(sel.normal);
  if (!tn) return null;
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < sigs.length; i++) {
    const cn = unit3(sigs[i]!.normal);
    if (!cn) continue;
    const align = tn[0] * cn[0] + tn[1] * cn[1] + tn[2] * cn[2];
    if (align < 0.95) continue;
    const dx = sel.position[0] - sigs[i]!.center[0];
    const dy = sel.position[1] - sigs[i]!.center[1];
    const dz = sel.position[2] - sigs[i]!.center[2];
    const score = align - 0.5 * Math.hypot(dx, dy, dz);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx >= 0 ? sigFace[bestIdx]! : null;
}

/**
 * DELETE FACE (sew-and-cap defeaturing, replicad/OCCT).
 *
 * Removes the faces matched by `selections` from the registered solid, caps
 * every interior loop the removal leaves on the remaining faces with a planar
 * face (makeFace), sews everything back (BRepBuilderAPI_Sewing) and rebuilds a
 * solid (ShapeFix_Solid), then merges coplanar faces (UnifySameDomain).
 *
 * Supported face sets — complete boss / pocket / through-hole / blind-hole
 * features whose opening is an INTERIOR wire on remaining faces. Anything else
 * throws a structured Error explaining the boundary:
 *   - a removed face sharing an edge with a remaining face's OUTER wire
 *     (e.g. deleting a box side) cannot be healed without surface extension
 *     (OCCT BRepAlgoAPI_Defeaturing — not bound in the shipped WASM);
 *   - a non-planar opening cannot be capped by a planar face.
 *
 * Throws on scope violations; returns a null handle only when the input handle
 * is unknown. Same registry contract as the other B-rep builders.
 */
export function occtDeleteFaces(
  handle: string | null | undefined,
  selections: FaceOpSelection[],
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const rc = requireReplicad();
  const solid = getShape(handle) as DirectEditSolidLike | null;
  if (!solid || selections.length === 0) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const allFaces = solid.faces;

  // Resolve selections → faces (deduped via shared-TShape identity).
  const removed: DirectEditFaceLike[] = [];
  for (const sel of selections) {
    const f = resolveFaceForSelection(rc as Record<string, unknown>, solid, sel, allFaces);
    if (!f) {
      throw new Error('Delete Face: a selected face was not found on the current solid (the body may have been rebuilt since the selection)');
    }
    if (!removed.some(r => r.isSame(f))) removed.push(f);
  }
  if (removed.length >= allFaces.length) {
    throw new Error('Delete Face: cannot remove every face of the body');
  }

  // Pool of edges owned by the removed face set (TShape-shared with neighbours).
  const removedEdges: DirectEditEdgeLike[] = [];
  for (const f of removed) {
    for (const e of f.edges) removedEdges.push(e);
  }
  const inRemoved = (e: DirectEditEdgeLike): boolean =>
    removedEdges.some(r => r.hashCode === e.hashCode && r.isSame(e));

  const kept = allFaces.filter(f => !removed.some(r => r.isSame(f)));

  // Interior loops the removal opens up — each becomes a planar healing cap.
  const capWires: DirectEditWireLike[] = [];
  const capWiresByFace = new Map<DirectEditFaceLike, DirectEditWireLike[]>();
  for (const f of kept) {
    let inner: DirectEditWireLike[];
    // ⚠️ replicad convention: outerWire()/innerWires() CONSUME the receiver
    // (this.delete()) — always call them on a clone so `f` survives the sew.
    try { inner = f.clone().innerWires(); } catch { inner = []; }
    const drops = inner.filter(w => {
      const es = w.edges;
      return es.length > 0 && es.every(inRemoved);
    });
    if (drops.length > 0) {
      capWires.push(...drops);
      capWiresByFace.set(f, drops);
    }
  }

  // Scope validation: every removed-face edge still referenced by a remaining
  // face must lie on a cap wire. A removed edge on a kept face's outer wire
  // (or a non-cap inner wire) means the opening is NOT an interior loop —
  // healing would require extending the neighbour surfaces (true defeaturing).
  for (const f of kept) {
    const dropsForFace = capWiresByFace.get(f) ?? [];
    let wires: DirectEditWireLike[];
    // Clone before outerWire()/innerWires() — both consume the receiver.
    try { wires = [f.clone().outerWire(), ...f.clone().innerWires().filter(w => !dropsForFace.some(d => d.isSame(w)))]; } catch { wires = []; }
    for (const w of wires) {
      for (const e of w.edges) {
        if (inRemoved(e)) {
          throw new Error(
            'Delete Face: the selected faces share an open boundary with the remaining body. '
            + 'Only complete boss / pocket / hole face sets (bounded by an interior loop on a remaining face) '
            + 'can be removed and healed — select the full feature face set. '
            + '(Surface-extension defeaturing requires OCCT BRepAlgoAPI_Defeaturing, which is not bound in this build.)',
          );
        }
      }
    }
  }
  if (capWires.length === 0) {
    throw new Error('Delete Face: the selected face set leaves no interior loop to heal — select the complete face set of a boss, pocket, or hole.');
  }

  // Cap each loop with a planar face. makeFace throws on a non-planar wire —
  // surface that as the honest planar-cap boundary.
  const makeFaceFn = rc.makeFace as ((w: unknown, holes?: unknown[]) => unknown) | undefined;
  const weld = rc.weldShellsAndFaces as ((fs: unknown[], ignore?: boolean) => unknown) | undefined;
  const mkSolid = rc.makeSolid as ((fs: unknown[]) => unknown) | undefined;
  const measureVolume = rc.measureVolume as ((s: unknown) => number) | undefined;
  if (typeof makeFaceFn !== 'function' || typeof weld !== 'function' || typeof mkSolid !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const caps: unknown[] = [];
  for (const w of capWires) {
    try {
      caps.push(makeFaceFn(w));
    } catch {
      throw new Error('Delete Face: the opening left by the removed faces is non-planar — only planar healing caps are supported in this build.');
    }
  }

  let healed: DirectEditSolidLike;
  try {
    const shell = weld([...kept, ...caps], true);
    healed = mkSolid([shell]) as DirectEditSolidLike;
  } catch (err) {
    throw new Error(`Delete Face: re-sewing the healed shell failed (${err instanceof Error ? err.message : String(err)})`);
  }
  // Merge the coplanar cap into its host face (UnifySameDomain) — best-effort.
  try {
    if (typeof healed.simplify === 'function') healed = healed.simplify();
  } catch { /* keep the unsimplified (still valid) solid */ }

  if (typeof measureVolume === 'function') {
    const vol = measureVolume(healed);
    if (!Number.isFinite(vol) || vol <= 1e-9) {
      throw new Error('Delete Face: healing produced an invalid (empty) solid');
    }
  }
  return meshAndRegister(healed, tessellation);
}

/**
 * OFFSET FACE (Move Face along its normal — planar prism rebuild).
 *
 * The selected PLANAR face is extruded along its outward normal by |distance|
 * (basicFaceExtrusion) and the prism is fused onto the solid (distance > 0) or
 * cut out of it (distance < 0). Push/pull semantics: the prism's side walls run
 * along the face normal, so for the common case — adjacent walls perpendicular
 * to the offset face — the result is exactly SolidWorks Move Face (Offset).
 * Adjacent faces that are NOT perpendicular gain a prism side wall instead of
 * being extended (documented param-note boundary).
 *
 * Non-planar faces throw (general Move Face needs per-face offset surface
 * rebuilding — OCCT BRepOffset_MakeOffset on a face subset is not exposed by
 * replicad). Volume identity: ΔV = ±(face area × |distance|) for prismatic
 * neighbourhoods, which the closed-form tests assert.
 */
export function occtOffsetFace(
  handle: string | null | undefined,
  selection: FaceOpSelection,
  distance: number,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctExtrudeResult {
  const rc = requireReplicad();
  const solid = getShape(handle) as DirectEditSolidLike | null;
  if (!solid || !Number.isFinite(distance)) {
    return { geometry: new BufferGeometry(), handle: null };
  }
  const allFaces = solid.faces;
  const face = resolveFaceForSelection(rc as Record<string, unknown>, solid, selection, allFaces);
  if (!face) {
    throw new Error('Offset Face: the selected face was not found on the current solid');
  }
  let geomType: string | undefined;
  try { geomType = typeof face.geomType === 'string' ? face.geomType : undefined; } catch { geomType = undefined; }
  if (geomType !== 'PLANE') {
    throw new Error(`Offset Face: only planar faces are supported (selected face is ${geomType ?? 'of unknown type'}) — curved-face offsets need OCCT face-subset offsetting, not exposed in this build`);
  }
  if (Math.abs(distance) < 1e-6) {
    return meshAndRegister(solid, tessellation);
  }

  const nRaw = face.normalAt();
  const n = unit3([nRaw.x, nRaw.y, nRaw.z]);
  nRaw.delete?.();
  if (!n) throw new Error('Offset Face: the selected face has a degenerate normal');

  const VecCtor = rc.Vector as (new (v?: [number, number, number]) => unknown) | undefined;
  const extrudeFace = rc.basicFaceExtrusion as ((f: unknown, v: unknown) => unknown) | undefined;
  const measureVolume = rc.measureVolume as ((s: unknown) => number) | undefined;
  if (typeof VecCtor !== 'function' || typeof extrudeFace !== 'function') {
    return { geometry: new BufferGeometry(), handle: null };
  }

  let result: DirectEditSolidLike;
  if (distance > 0) {
    const prism = extrudeFace(face, new VecCtor([n[0] * distance, n[1] * distance, n[2] * distance]));
    result = solid.fuse(prism);
  } else {
    // Inward: start the cutting prism a touch OUTSIDE the face plane so the
    // boolean has no coplanar cap (the inner cap at -|d| stays exact).
    const depth = -distance;
    const pad = Math.min(1, depth);
    const shifted = face.clone().translate([n[0] * pad, n[1] * pad, n[2] * pad]);
    const prism = extrudeFace(shifted, new VecCtor([-n[0] * (depth + pad), -n[1] * (depth + pad), -n[2] * (depth + pad)]));
    result = solid.cut(prism);
  }

  if (typeof measureVolume === 'function') {
    const vol = measureVolume(result);
    if (!Number.isFinite(vol) || vol <= 1e-9) {
      throw new Error('Offset Face: the inward offset consumed the entire body — reduce the distance');
    }
  }
  return meshAndRegister(result, tessellation);
}

/**
 * Mesh → simplified B-rep bridge for direct editing on IMPORTED bodies (STEP/
 * STL imports arrive in the pipeline as tessellated meshes with no occtHandle).
 * Imports the mesh as a triangulated B-rep (importSTL) then merges coplanar
 * facets into real faces (Shape.simplify → ShapeUpgrade_UnifySameDomain), so a
 * prismatic import gets genuine planar face topology that Delete Face / Offset
 * Face can operate on. Curved regions stay faceted — operations on them will
 * fail their planar checks honestly. Null when the import/registration fails.
 */
export async function meshToSimplifiedBrepHandle(
  geometry: import('three').BufferGeometry,
): Promise<string | null> {
  const handle = await meshToOcctShapeHandle(geometry);
  if (!handle) return null;
  const shape = getShape(handle) as { simplify?: () => unknown } | null;
  if (shape && typeof shape.simplify === 'function') {
    try {
      return registerShape(shape.simplify());
    } catch {
      return handle; // unsimplified is still a valid B-rep
    }
  }
  return handle;
}

// Shared helper: derive box host params from an upstream BufferGeometry's
// bounding box. Used by OCCT-routed fillet/chamfer/boolean until phase 2d
// plumbs real B-rep through the pipeline.
//
// ⚠️ FAITHFULNESS CONTRACT: the box this describes is only a valid OCCT host
// when the mesh actually IS its own bounding box (a true axis-aligned box).
// Callers must obtain the host handle via resolveBrepHostHandle /
// resolveBrepHostHandleAsync below — never feed a non-box mesh through the
// box-host path, or the part gets silently replaced by its bounding box.
export function hostBoxFromGeometry(
  geometry: BufferGeometry,
): { w: number; h: number; d: number; cx: number; cy: number; cz: number } {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) throw new Error('Geometry has no bounding box');
  return {
    w: bb.max.x - bb.min.x,
    h: bb.max.y - bb.min.y,
    d: bb.max.z - bb.min.z,
    cx: (bb.min.x + bb.max.x) / 2,
    cy: (bb.min.y + bb.max.y) / 2,
    cz: (bb.min.z + bb.max.z) / 2,
  };
}

// ─── FAIL-CLEAN B-rep host contract ─────────────────────────────────────────
//
// Historic bug (silently-wrong-geometry class): when a body reached an OCCT
// feature without a live `userData.occtHandle`, occtFilletBox / occtChamferBox
// / occtShellBox / occtBoxBooleanWithPrimitive rebuilt the host as
// makeBaseBox(bbox) and shipped the result as SUCCESS — an L-bracket got
// silently replaced by its filleted bounding box (measured 95 880 vs 29 440
// mm³ on the reference L-bracket). The contract below makes that impossible:
//
//   resolveBrepHostHandle(geometry)
//     → registered handle      : use the real upstream B-rep solid
//     → null                   : ONLY when the mesh verifiably IS its own
//                                axis-aligned bounding box (a true box —
//                                the box host is then exactly faithful)
//     → throws BrepHostUnavailableError otherwise (incl. a stale handle the
//       registry no longer knows). The caller's try/catch records a
//       per-feature error / falls to its mesh fallback — never a bbox stand-in.
//
//   resolveBrepHostHandleAsync additionally tries the mesh→B-rep bridge
//   (meshToSimplifiedBrepHandle: importSTL + UnifySameDomain) before throwing,
//   so async feature paths recover a faithful host from the displayed mesh.

export class BrepHostUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `OCCT host unavailable: ${detail}. ` +
      'Refusing to substitute a bounding-box host (it would silently replace the part with its bbox).',
    );
    this.name = 'BrepHostUnavailableError';
  }
}

/** Signed tetra-sum mesh volume (mm³, absolute). Indexed or soup. */
function meshVolumeOf(geometry: BufferGeometry): number {
  const pos = geometry.attributes.position;
  if (!pos) return 0;
  const idx = geometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    vol += ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by);
  }
  return Math.abs(vol / 6);
}

/** Total triangle surface area (mm²). */
function meshAreaOf(geometry: BufferGeometry): number {
  const pos = geometry.attributes.position;
  if (!pos) return 0;
  const idx = geometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let area = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ux = pos.getX(i1) - pos.getX(i0), uy = pos.getY(i1) - pos.getY(i0), uz = pos.getZ(i1) - pos.getZ(i0);
    const vx = pos.getX(i2) - pos.getX(i0), vy = pos.getY(i2) - pos.getY(i0), vz = pos.getZ(i2) - pos.getZ(i0);
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += Math.hypot(cx, cy, cz) / 2;
  }
  return area;
}

/**
 * Is this mesh (within `relTol`, default 0.01%) exactly its own axis-aligned
 * bounding box — i.e. a true box, for which the makeBaseBox(bbox) host is
 * FAITHFUL? Strict on purpose: a box with even a small chamfer/fillet/hole
 * must NOT pass (the box host would silently erase that feature). Volume and
 * surface area are both compared against the bbox closed forms.
 */
export function isBboxFaithfulBox(geometry: BufferGeometry, relTol = 1e-4): boolean {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return false;
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z;
  const boxVol = w * h * d;
  if (!(boxVol > 1e-9) || !Number.isFinite(boxVol)) return false;
  const vol = meshVolumeOf(geometry);
  if (Math.abs(vol - boxVol) / boxVol > relTol) return false;
  const boxArea = 2 * (w * h + h * d + w * d);
  const area = meshAreaOf(geometry);
  return Math.abs(area - boxArea) / boxArea <= relTol;
}

/**
 * Resolve the OCCT host handle for `geometry` under the fail-clean contract
 * (see block comment above). Returns the registered handle, or null when a
 * bbox box host is verifiably faithful; throws BrepHostUnavailableError in
 * every other case.
 */
export function resolveBrepHostHandle(geometry: BufferGeometry): string | null {
  const raw = geometry.userData?.occtHandle as string | undefined;
  if (raw) {
    if (getShape(raw)) return raw;
    // A handle the registry no longer knows (cleared between pipeline runs,
    // or carried over a worker boundary) is NOT a usable host.
    if (isBboxFaithfulBox(geometry)) return null;
    throw new BrepHostUnavailableError(
      `stale B-rep handle '${raw}' is not in the shape registry and the mesh is not a plain box`,
    );
  }
  if (isBboxFaithfulBox(geometry)) return null;
  throw new BrepHostUnavailableError(
    'the body has no B-rep handle and its mesh is not a plain box',
  );
}

/**
 * Async variant: same contract, but before failing it attempts the
 * mesh→B-rep bridge (meshToSimplifiedBrepHandle) so the OCCT op can run on a
 * faithful import of the displayed mesh instead of erroring out.
 */
export async function resolveBrepHostHandleAsync(geometry: BufferGeometry): Promise<string | null> {
  try {
    return resolveBrepHostHandle(geometry);
  } catch (err) {
    if (!(err instanceof BrepHostUnavailableError)) throw err;
    const bridged = await meshToSimplifiedBrepHandle(geometry);
    if (bridged) return bridged;
    throw err;
  }
}
