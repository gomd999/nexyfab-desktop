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
  const shape = getShape(handle) as any;
  if (!shape) return null;
  if (typeof shape.blobSTEP !== 'function') return null;
  
  const blob = shape.blobSTEP() as Blob;
  return await blob.text();
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

interface FilletChamferShape extends MeshedShape {
  fillet: (radius: number) => FilletChamferShape;
  chamfer: (distance: number) => FilletChamferShape;
  translate: (v: [number, number, number]) => FilletChamferShape;
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
): OcctBooleanResult {
  const rc = requireReplicad();
  const chained = getShape(hostHandle) as FilletChamferShape | null;
  const source: FilletChamferShape = chained ?? (() => {
    const base = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w, hostBox.h, hostBox.d) as FilletChamferShape;
    return base.translate([hostBox.cx, hostBox.cy, hostBox.cz - hostBox.d / 2]);
  })();
  const filleted = source.fillet(radius);
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
): OcctBooleanResult {
  const rc = requireReplicad();
  const chained = getShape(hostHandle) as FilletChamferShape | null;
  const source: FilletChamferShape = chained ?? (() => {
    const base = (rc.makeBaseBox as ReplicadLike['makeBaseBox'])(hostBox.w, hostBox.h, hostBox.d) as FilletChamferShape;
    return base.translate([hostBox.cx, hostBox.cy, hostBox.cz - hostBox.d / 2]);
  })();
  const chamfered = source.chamfer(distance);
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
  const chained = getShape(hostHandle) as any;
  const source: any = chained ?? (() => {
    const base = (rc.makeBaseBox as any)(hostBox.w, hostBox.h, hostBox.d);
    return base.translate([hostBox.cx, hostBox.cy, hostBox.cz - hostBox.d / 2]);
  })();

  // Replicad shell uses a negative thickness for inward.
  // Note: we just use .shell(-thickness) for a closed hollow shell, 
  // and cut the open face via boolean subtraction to ensure reliability.
  let shelled = source.shell(-thickness);
  
  if (openFace > 0) {
    const cutHeight = thickness * 4;
    const cutBox = (rc.makeBaseBox as any)(hostBox.w * 3, cutHeight, hostBox.d * 3);
    
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
