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
  tool: { shape: 'box' | 'cylinder' | 'sphere'; w: number; h: number; d: number; cx: number; cy: number; cz: number; rx: number; ry: number; rz: number },
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
  fillet: (radius: number, predicate?: (f: ReplicadEdgeFinder) => ReplicadEdgeFinder) => FilletChamferShape;
  chamfer: (distance: number, predicate?: (f: ReplicadEdgeFinder) => ReplicadEdgeFinder) => FilletChamferShape;
  translate: (v: [number, number, number]) => FilletChamferShape;
}

/** B-rep shape supporting shell + boolean cut (open-face trimming). */
interface ShellableShape extends MeshedShape {
  shell: (thickness: number) => ShellableShape;
  cut: (other: unknown) => ShellableShape;
  translate: (v: [number, number, number]) => ShellableShape;
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

interface ExtrudedSolid extends MeshedShape {
  translate: (v: [number, number, number]) => ExtrudedSolid;
}
interface CircleDraw {
  sketchOnPlane: (plane: string, origin?: number) => { extrude: (dist: number) => ExtrudedSolid };
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
): OcctBooleanResult {
  const rc = requireReplicad();
  const chained = getShape(hostHandle) as ShellableShape | null;
  const source: ShellableShape = chained ?? (() => {
    const base = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w, hostBox.h, hostBox.d) as ShellableShape;
    return base.translate([hostBox.cx, hostBox.cy, hostBox.cz - hostBox.d / 2]);
  })();

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

// Shared helper: derive box host params from an upstream BufferGeometry's
// bounding box. Used by OCCT-routed fillet/chamfer/boolean until phase 2d
// plumbs real B-rep through the pipeline.
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
