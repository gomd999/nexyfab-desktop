/**
 * solidKernel — W3a facade over a solid-modelling kernel (OCCT_W3_DESIGN.md).
 *
 * The pipeline shouldn't care whether a solid op runs on the in-process replicad
 * kernel or the K-series (real `opencascade.js`, persistent naming + ceiling
 * ops). This facade is that seam: ONE async interface keyed by STRING ids (the
 * same id model `occtEngine` already threads on `userData.occtHandle` ==
 * `OcctShape.id`), so migrating an op is a matter of swapping the kernel
 * implementation behind it.
 *
 * `createKSeriesKernel(bridge)` wraps any `OcctBridge` — `createNodeOcctBridge`
 * in Node (headless-verifiable, what the tests use) or `createWasmBridge` in the
 * browser pipeline worker (W3 wiring). The replicad side (`createReplicadKernel`,
 * wrapping the synchronous `occtEngine`) is the browser-only half and lands with
 * the pipeline routing; this module ships the K-series side + the parity harness,
 * both of which run headless.
 *
 * NOTHING here touches the production pipeline yet — it is a standalone,
 * test-covered foundation. Routing `occtExtrudeProfile` through it behind
 * `?occtWorker=1` is the (browser-gated) follow-up.
 */

import type { OcctBridge } from '@/lib/occt/bridge';
import type { OcctShape, OcctShapeKind, OcctTessellation, Vec3 } from '@/lib/occt/types';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';

export interface KernelBBox { min: Vec3; max: Vec3 }

/** A solid the facade tracks by opaque id (== `OcctShape.id`). */
export interface KernelShape {
  id: string;
  kind: OcctShapeKind;
  volume?: number;
  bbox?: KernelBBox;
}

export type BooleanKind = 'union' | 'subtract' | 'intersect';

export interface SolidKernel {
  extrude(loop: ReadonlyArray<{ x: number; y: number }>, depth: number, direction?: ExtrudeFeature['direction']): Promise<KernelShape | null>;
  revolve(loop: ReadonlyArray<{ x: number; y: number }>, angleDegrees: number): Promise<KernelShape | null>;
  boolean(op: BooleanKind, a: string, b: string): Promise<KernelShape | null>;
  fillet(id: string, edgeIds: string[], radius: number): Promise<KernelShape | null>;
  chamfer(id: string, edgeIds: string[], distance: number): Promise<KernelShape | null>;
  variableFillet(id: string, edges: ReadonlyArray<{ edgeId: string; radius: number }>): Promise<KernelShape | null>;
  draft(id: string, opts: { angleDeg: number; pullDir?: [number, number, number]; neutralZ?: number }): Promise<KernelShape | null>;
  buildPlanarFace(loop: ReadonlyArray<{ x: number; y: number }>, z?: number): Promise<KernelShape | null>;
  thicken(id: string, thickness: number): Promise<KernelShape | null>;
  surfaceTrim(a: string, b: string): Promise<KernelShape | null>;
  exportStep(id: string): Promise<string | null>;
  importStep(source: string): Promise<KernelShape | null>;
  tessellate(id: string, deflection?: number): Promise<OcctTessellation | null>;
  release(id: string): void;
}

// ─── K-series kernel (wraps an OcctBridge) ──────────────────────────────────

/**
 * Build a `SolidKernel` over any `OcctBridge`. The facade owns the id→OcctShape
 * registry so callers thread only string ids (matching the existing
 * `userData.occtHandle` contract).
 */
export function createKSeriesKernel(bridge: OcctBridge): SolidKernel {
  const registry = new Map<string, OcctShape>();
  const record = (shape: OcctShape): KernelShape => {
    registry.set(shape.id, shape);
    return { id: shape.id, kind: shape.kind, volume: shape.volume, bbox: shape.bbox };
  };
  const resolve = (id: string, where: string): OcctShape => {
    const s = registry.get(id);
    if (!s) throw new Error(`solidKernel: ${where}: unknown id '${id}' (released?)`);
    return s;
  };

  return {
    async extrude(loop, depth, direction = 'one_sided') {
      const feature: ExtrudeFeature = { kind: 'extrude', loop: [...loop], depth, direction, mode: 'add' };
      const r = await bridge.buildFromExtrude(feature);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async revolve(loop, angleDegrees) {
      const feature: RevolveFeature = { kind: 'revolve', loop: [...loop], angleDegrees, mode: 'add' };
      const r = await bridge.buildFromRevolve(feature);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async boolean(op, a, b) {
      const sa = resolve(a, `boolean.${op}`);
      const sb = resolve(b, `boolean.${op}`);
      const r = await bridge.boolean[op](sa, sb);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async fillet(id, edgeIds, radius) {
      const r = await bridge.fillet(resolve(id, 'fillet'), edgeIds, radius);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async chamfer(id, edgeIds, distance) {
      const r = await bridge.chamfer(resolve(id, 'chamfer'), edgeIds, distance);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async variableFillet(id, edges) {
      if (!bridge.variableFillet) return null;
      const r = await bridge.variableFillet(resolve(id, 'variableFillet'), edges);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async draft(id, opts) {
      if (!bridge.draft) return null;
      const r = await bridge.draft(resolve(id, 'draft'), opts);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async buildPlanarFace(loop, z = 0) {
      if (!bridge.buildPlanarFace) return null;
      const r = await bridge.buildPlanarFace(loop, z);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async thicken(id, thickness) {
      if (!bridge.thicken) return null;
      const r = await bridge.thicken(resolve(id, 'thicken'), thickness);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async surfaceTrim(a, b) {
      if (!bridge.surfaceTrim) return null;
      const r = await bridge.surfaceTrim(resolve(a, 'surfaceTrim'), resolve(b, 'surfaceTrim'));
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async exportStep(id) {
      return bridge.exportSTEP(resolve(id, 'exportStep'));
    },
    async importStep(source) {
      const r = await bridge.importSTEP(source);
      return r.ok && r.shape ? record(r.shape) : null;
    },
    async tessellate(id, deflection) {
      const r = await bridge.tessellate(resolve(id, 'tessellate'), deflection);
      return r.ok && r.mesh ? r.mesh : null;
    },
    release(id) {
      const s = registry.get(id);
      if (!s) return;
      bridge.release(s);
      registry.delete(id);
    },
  };
}

// ─── replicad kernel (wraps the in-process occtEngine) ──────────────────────

/**
 * Build a `SolidKernel` over the in-process replicad path (`occtEngine`) — the
 * browser-side half of the parity gate. occtEngine's string handle IS the
 * facade id, so ids thread 1:1; volume/bbox come from the returned mesh
 * (occtEngine doesn't surface them uniformly).
 *
 * Only the W3 first-consumer ops (extrude/revolve/boolean) + STEP export are
 * wired. The kernel-CEILING ops (`thicken`/`surfaceTrim`/`buildPlanarFace`) are
 * `null` BY DESIGN — replicad's high-level API cannot express them, which is the
 * entire reason for the K-series migration. The parity gate only compares ops
 * both kernels support.
 *
 * Browser-only (replicad WASM); not headless-runnable here. Unconsumed by the
 * pipeline until W3 routing lands — this is the adapter the routing will use.
 */
export function createReplicadKernel(deps: ReplicadKernelDeps): SolidKernel {
  const { extrudeProfile, revolveProfile, booleanSolids, exportStep, meshVolume, boundsOf } = deps;
  const shapeOf = (geometry: unknown, handle: string | null): KernelShape | null => {
    if (!handle) return null;
    return { id: handle, kind: 'solid', volume: Math.abs(meshVolume(geometry)), bbox: boundsOf(geometry) };
  };
  const unsupported = async (): Promise<KernelShape | null> => null;
  return {
    async extrude(loop, depth) { const r = extrudeProfile([...loop], depth); return shapeOf(r.geometry, r.handle); },
    async revolve(loop) { const r = revolveProfile([...loop]); return shapeOf(r.geometry, r.handle); }, // 360° only
    async boolean(op, a, b) { const r = booleanSolids(op, a, b); return shapeOf(r.geometry, r.handle); },
    fillet: unsupported,
    chamfer: unsupported,
    variableFillet: unsupported,
    draft: unsupported,
    buildPlanarFace: unsupported,
    thicken: unsupported,     // replicad ceiling — null by design
    surfaceTrim: unsupported, // replicad ceiling — null by design
    async exportStep(id) { return exportStep(id); },
    async importStep() { return null; },
    async tessellate() { return null; }, // geometry comes back from each op
    release() { /* occtEngine clears its own registry per pipeline run */ },
  };
}

/**
 * Injected occtEngine surface for {@link createReplicadKernel}. Passed in (not
 * imported) so this module stays free of the browser-only occtEngine + THREE at
 * type-check time; the pipeline supplies the real bindings.
 */
export interface ReplicadKernelDeps {
  extrudeProfile: (points: Array<{ x: number; y: number }>, depth: number) => { geometry: unknown; handle: string | null };
  revolveProfile: (points: Array<{ x: number; y: number }>) => { geometry: unknown; handle: string | null };
  booleanSolids: (op: BooleanKind, a: string, b: string) => { geometry: unknown; handle: string | null };
  exportStep: (handle: string) => Promise<string | null>;
  meshVolume: (geometry: unknown) => number;
  boundsOf: (geometry: unknown) => KernelBBox | undefined;
}

// ─── parity harness (replicad vs K-series) ──────────────────────────────────

export interface ParityVerdict {
  ok: boolean;
  /** |volA − volB| / max(|volA|, ε). */
  volRelErr: number;
  /** Max corner distance between the two bboxes (mm). */
  bboxErr: number;
  note?: string;
}

export interface ParityTolerance {
  /** Max allowed relative volume error. Default 0.005 (0.5%). */
  volRelTol?: number;
  /** Max allowed bbox corner distance (mm). Default 0.01. */
  bboxTol?: number;
}

function cornerDist(a?: KernelBBox, b?: KernelBBox): number {
  if (!a || !b) return Infinity;
  const d = (p: Vec3, q: Vec3): number => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  return Math.max(d(a.min, b.min), d(a.max, b.max));
}

/**
 * Compare two kernel results (same op, same input) and return a pass/fail verdict
 * on volume + bbox. This is the W3 safety net: a divergence is a caught bug, not
 * a silent geometry change. Pure — feed it two `KernelShape`s from the two
 * kernels (the cross-kernel run needs both loaded; the K-side numbers alone are
 * unit-testable via `createNodeOcctBridge`).
 */
export function kernelParity(a: KernelShape, b: KernelShape, tol: ParityTolerance = {}): ParityVerdict {
  const volRelTol = tol.volRelTol ?? 0.005;
  const bboxTol = tol.bboxTol ?? 0.01;
  const va = a.volume ?? NaN;
  const vb = b.volume ?? NaN;
  const volRelErr = Number.isFinite(va) && Number.isFinite(vb)
    ? Math.abs(va - vb) / Math.max(Math.abs(va), 1e-9)
    : Infinity;
  const bboxErr = cornerDist(a.bbox, b.bbox);
  const ok = volRelErr <= volRelTol && bboxErr <= bboxTol;
  return {
    ok,
    volRelErr,
    bboxErr,
    note: ok ? undefined : `parity FAIL: volRelErr=${volRelErr.toExponential(2)} (tol ${volRelTol}), bboxErr=${bboxErr.toFixed(4)} (tol ${bboxTol})`,
  };
}
