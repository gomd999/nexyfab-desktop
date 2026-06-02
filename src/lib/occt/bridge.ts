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
import type { OcctOperationResult, OcctShape, Vec3 } from './types';

// ─── public bridge interface ──────────────────────────────────────────────

export interface OcctBooleanOps {
  union(a: OcctShape, b: OcctShape): Promise<OcctOperationResult>;
  subtract(a: OcctShape, b: OcctShape): Promise<OcctOperationResult>;
  intersect(a: OcctShape, b: OcctShape): Promise<OcctOperationResult>;
}

export interface OcctBridge {
  buildFromExtrude(feature: ExtrudeFeature): Promise<OcctOperationResult>;
  buildFromRevolve(feature: RevolveFeature): Promise<OcctOperationResult>;
  readonly boolean: OcctBooleanOps;
  fillet(shape: OcctShape, edgeIds: string[], radius: number): Promise<OcctOperationResult>;
  chamfer(shape: OcctShape, edgeIds: string[], distance: number): Promise<OcctOperationResult>;
  exportSTEP(shape: OcctShape): Promise<string>;
  importSTEP(source: string): Promise<OcctOperationResult>;
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
    chamfer,
    exportSTEP,
    importSTEP,
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
