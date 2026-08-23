/**
 * occt/wasmWorkerStub — in-process "fake Worker" for the WASM bridge.
 *
 * Phase 4 of NexyFab Pro own-CAD (ADR-013). Provides a synchronous Worker-API
 * shim used by `wasmBridge` when the runtime has no `window.Worker` (Node,
 * jsdom). Implements the same op-code message protocol the real OCCT
 * Emscripten worker will speak, but delegates the actual geometry work to
 * `createStubBridge()` so we exercise the message-channel/reqId/handle-table
 * plumbing without an OCCT binary.
 *
 * INTENT
 * ------
 * The bridge does NOT care whether it talks to a real `Worker` or this stub —
 * it sees only `WorkerLike` (postMessage + onmessage + terminate). When the
 * real Emscripten worker lands, `wasmBridge` keeps its plumbing; only the
 * worker spawning swaps from `new Worker(url)` to `createWasmWorkerStub()`
 * under Node and back. See `WORKER WIRE PROTOCOL` below for the contract the
 * real worker must satisfy.
 *
 * WORKER WIRE PROTOCOL
 * --------------------
 * The bridge posts `{ op, reqId, args }` envelopes; the worker replies with
 * `{ reqId, ok, ... }` envelopes. `reqId` is a monotonic integer assigned by
 * the bridge; the worker MUST echo it on the response so the bridge can
 * resolve the right pending promise. Ops:
 *
 *   init                                  → { ok: true }
 *   buildFromExtrude(feature)             → { ok: true, handle, kind, bbox, ... } | { ok: false, error }
 *   buildFromRevolve(feature)             → ditto
 *   booleanUnion(handleA, handleB)        → { ok, handle, ... }
 *   booleanSubtract(handleA, handleB)     → { ok, handle, ... }
 *   booleanIntersect(handleA, handleB)    → { ok, handle, ... }
 *   fillet(handle, edgeIds, radius)       → { ok, handle, ... }
 *   chamfer(handle, edgeIds, distance)    → { ok, handle, ... }
 *   exportSTEP(handle)                    → { ok: true, step } | { ok: false, error }
 *   importSTEP(source)                    → { ok, handle, ..., warnings }
 *   release(handle)                       → { ok: true }
 *
 * HANDLES
 * -------
 * The wire-level handle is a plain integer (1..N) that the worker maps to a
 * native `TopoDS_Shape*`. The bridge wraps it into `OcctShape.id = "occt_<n>"`.
 * That string is what the consumer sees; the integer never crosses the JS
 * boundary except in the wire envelope.
 *
 * NOTE
 * ----
 * This stub is INTENTIONALLY synchronous — `postMessage` invokes the
 * onmessage listener directly via `queueMicrotask` so the bridge's
 * `await new Promise(...)` resolves on the next microtask. That keeps the
 * test surface deterministic; the real Worker is async over the structured
 * clone boundary but the bridge does not depend on that distinction.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import { createStubBridge, type OcctBridge } from './bridge';
import type { OcctShape, OcctShapeKind, OcctTessellation, Vec3 } from './types';

// ─── shared wire types ────────────────────────────────────────────────────

export interface WorkerLike {
  postMessage(msg: unknown): void;
  addEventListener(event: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(event: 'error', listener: (ev: unknown) => void): void;
  removeEventListener(event: 'message', listener: (ev: { data: unknown }) => void): void;
  removeEventListener(event: 'error', listener: (ev: unknown) => void): void;
  terminate(): void;
}

export type WireOp =
  | 'init'
  | 'buildFromExtrude'
  | 'buildFromRevolve'
  | 'buildPrismAt'
  | 'buildCylinderAt'
  | 'buildConeAt'
  | 'buildThreadHelixCutter'
  | 'booleanUnion'
  | 'booleanSubtract'
  | 'booleanIntersect'
  | 'fillet'
  | 'variableFillet'
  | 'lawFillet'
  | 'chamfer'
  | 'buildPlanarFace'
  | 'thicken'
  | 'surfaceTrim'
  | 'exportSTEP'
  | 'importSTEP'
  | 'tessellate'
  | 'release';

export interface WireRequest {
  op: WireOp;
  reqId: number;
  args?: Record<string, unknown>;
}

export interface WireShapePayload {
  handle: number;
  kind: OcctShapeKind;
  bbox?: { min: Vec3; max: Vec3 };
  volume?: number;
  area?: number;
  centerOfMass?: Vec3;
  /** K7-S2 — 생성-이력 에지 이름 테이블(real 워커; 스텁은 미탑재 가능). */
  edgeNames?: Array<{ name: string; mid: Vec3 }>;
  edgeNamesTruncated?: boolean;
}

export interface WireOkResponse {
  reqId: number;
  ok: true;
  shape?: WireShapePayload;
  step?: string;
  /** tessellate payload (plain arrays — postMessage-safe). */
  mesh?: OcctTessellation;
  warnings?: string[];
}

export interface WireErrResponse {
  reqId: number;
  ok: false;
  error: string;
  warnings?: string[];
}

export type WireResponse = WireOkResponse | WireErrResponse;

// ─── stub worker implementation ───────────────────────────────────────────

type MessageListener = (ev: { data: unknown }) => void;
type ErrorListener = (ev: unknown) => void;

interface CreateStubOpts {
  /** Inject a custom inner bridge — useful for forcing kernel errors in tests. */
  inner?: OcctBridge;
}

/**
 * Build a synchronous in-process `WorkerLike` that speaks the OCCT wire
 * protocol. Delegates geometry to `createStubBridge()` (or `opts.inner`).
 */
export function createWasmWorkerStub(opts: CreateStubOpts = {}): WorkerLike {
  const inner = opts.inner ?? createStubBridge();

  // Handle table: integer wire-handle → OcctShape (the inner-bridge result).
  const handles = new Map<number, OcctShape>();
  let nextHandle = 1;
  const allocHandle = (shape: OcctShape): number => {
    const h = nextHandle++;
    handles.set(h, shape);
    return h;
  };
  const resolveHandle = (h: unknown): OcctShape | undefined => {
    if (typeof h !== 'number') return undefined;
    return handles.get(h);
  };

  const messageListeners = new Set<MessageListener>();
  const errorListeners = new Set<ErrorListener>();
  let terminated = false;

  const reply = (resp: WireResponse): void => {
    if (terminated) return;
    // Mirror Worker semantics — onmessage fires asynchronously on a
    // microtask, so the calling code's `await` is always required.
    queueMicrotask(() => {
      for (const l of messageListeners) l({ data: resp });
    });
  };

  const shapeToWire = (s: OcctShape): WireShapePayload => ({
    handle: allocHandle(s),
    kind: s.kind,
    bbox: s.bbox,
    volume: s.volume,
    area: s.area,
    centerOfMass: s.centerOfMass,
  });

  const handle = async (req: WireRequest): Promise<void> => {
    const { op, reqId, args = {} } = req;
    try {
      switch (op) {
        case 'init':
          reply({ reqId, ok: true });
          return;

        case 'buildFromExtrude': {
          const r = await inner.buildFromExtrude(args.feature as ExtrudeFeature);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? 'buildFromExtrude failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'buildFromRevolve': {
          const r = await inner.buildFromRevolve(args.feature as RevolveFeature);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? 'buildFromRevolve failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'buildPrismAt': {
          if (!inner.buildPrismAt) { reply({ reqId, ok: false, error: 'buildPrismAt: not supported' }); return; }
          const r = await inner.buildPrismAt(
            Array.isArray(args.loop) ? args.loop as Array<{ x: number; y: number }> : [],
            Number(args.z0), Number(args.heightMm),
          );
          if (!r.ok || !r.shape) { reply({ reqId, ok: false, error: r.error ?? 'buildPrismAt failed', warnings: r.warnings }); return; }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'buildCylinderAt': {
          if (!inner.buildCylinderAt) { reply({ reqId, ok: false, error: 'buildCylinderAt: not supported' }); return; }
          const r = await inner.buildCylinderAt(
            args.center as [number, number, number], args.axis as [number, number, number],
            Number(args.radiusMm), Number(args.depthMm),
          );
          if (!r.ok || !r.shape) { reply({ reqId, ok: false, error: r.error ?? 'buildCylinderAt failed', warnings: r.warnings }); return; }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'buildConeAt': {
          if (!inner.buildConeAt) { reply({ reqId, ok: false, error: 'buildConeAt: not supported' }); return; }
          const r = await inner.buildConeAt(
            args.center as { x: number; y: number }, Number(args.z0), Number(args.heightMm),
            Number(args.radius0), Number(args.radius1),
          );
          if (!r.ok || !r.shape) { reply({ reqId, ok: false, error: r.error ?? 'buildConeAt failed', warnings: r.warnings }); return; }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'buildThreadHelixCutter': {
          if (!inner.buildThreadHelixCutter) { reply({ reqId, ok: false, error: 'buildThreadHelixCutter: not supported' }); return; }
          const r = await inner.buildThreadHelixCutter(args.opts as Parameters<NonNullable<OcctBridge['buildThreadHelixCutter']>>[0]);
          if (!r.ok || !r.shape) { reply({ reqId, ok: false, error: r.error ?? 'buildThreadHelixCutter failed', warnings: r.warnings }); return; }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'booleanUnion':
        case 'booleanSubtract':
        case 'booleanIntersect': {
          const a = resolveHandle(args.handleA);
          const b = resolveHandle(args.handleB);
          if (!a || !b) {
            reply({ reqId, ok: false, error: `${op}: unknown handle (a=${args.handleA}, b=${args.handleB})` });
            return;
          }
          const r = op === 'booleanUnion'
            ? await inner.boolean.union(a, b)
            : op === 'booleanSubtract'
              ? await inner.boolean.subtract(a, b)
              : await inner.boolean.intersect(a, b);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? `${op} failed`, warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'fillet':
        case 'chamfer': {
          const s = resolveHandle(args.handle);
          if (!s) {
            reply({ reqId, ok: false, error: `${op}: unknown handle (${String(args.handle)})` });
            return;
          }
          const edgeIds = Array.isArray(args.edgeIds) ? (args.edgeIds as string[]) : [];
          const dim = typeof args.dim === 'number' ? args.dim : NaN;
          const r = op === 'fillet'
            ? await inner.fillet(s, edgeIds, dim)
            : await inner.chamfer(s, edgeIds, dim);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? `${op} failed`, warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'variableFillet': {
          const s = resolveHandle(args.handle);
          if (!s) {
            reply({ reqId, ok: false, error: `variableFillet: unknown handle (${String(args.handle)})` });
            return;
          }
          if (!inner.variableFillet) {
            reply({ reqId, ok: false, error: 'variableFillet: not supported by this kernel' });
            return;
          }
          const edges = Array.isArray(args.edges)
            ? args.edges as Array<{ edgeId: string; radius: number }>
            : [];
          const r = await inner.variableFillet(s, edges);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? 'variableFillet failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'lawFillet': {
          const s = resolveHandle(args.handle);
          if (!s) {
            reply({ reqId, ok: false, error: `lawFillet: unknown handle (${String(args.handle)})` });
            return;
          }
          if (!inner.lawFillet) {
            reply({ reqId, ok: false, error: 'lawFillet: not supported by this kernel' });
            return;
          }
          const edges = Array.isArray(args.edges)
            ? args.edges as Array<{ edgeId: string; startRadius: number; endRadius: number }>
            : [];
          const options = args.options as { continuity?: 'G1' | 'G2'; angularTolerance?: number } | undefined;
          const r = await inner.lawFillet(s, edges, options);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? 'lawFillet failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'buildPlanarFace': {
          if (!inner.buildPlanarFace) {
            reply({ reqId, ok: false, error: 'buildPlanarFace: not supported by this kernel' });
            return;
          }
          const loop = Array.isArray(args.loop) ? (args.loop as Array<{ x: number; y: number }>) : [];
          const z = typeof args.z === 'number' ? args.z : 0;
          const r = await inner.buildPlanarFace(loop, z);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? 'buildPlanarFace failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'thicken': {
          const s = resolveHandle(args.handle);
          if (!s) {
            reply({ reqId, ok: false, error: `thicken: unknown handle (${String(args.handle)})` });
            return;
          }
          if (!inner.thicken) {
            reply({ reqId, ok: false, error: 'thicken: not supported by this kernel' });
            return;
          }
          const thickness = typeof args.dim === 'number' ? args.dim : NaN;
          const r = await inner.thicken(s, thickness);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? 'thicken failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'surfaceTrim': {
          const a = resolveHandle(args.handleA);
          const b = resolveHandle(args.handleB);
          if (!a || !b) {
            reply({ reqId, ok: false, error: `surfaceTrim: unknown handle (a=${String(args.handleA)}, b=${String(args.handleB)})` });
            return;
          }
          if (!inner.surfaceTrim) {
            reply({ reqId, ok: false, error: 'surfaceTrim: not supported by this kernel' });
            return;
          }
          const r = await inner.surfaceTrim(a, b);
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? 'surfaceTrim failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'exportSTEP': {
          const s = resolveHandle(args.handle);
          if (!s) {
            reply({ reqId, ok: false, error: `exportSTEP: unknown handle (${String(args.handle)})` });
            return;
          }
          const step = await inner.exportSTEP(s);
          reply({ reqId, ok: true, step });
          return;
        }

        case 'importSTEP': {
          const r = await inner.importSTEP(String(args.source ?? ''));
          if (!r.ok || !r.shape) {
            reply({ reqId, ok: false, error: r.error ?? 'importSTEP failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, shape: shapeToWire(r.shape), warnings: r.warnings });
          return;
        }

        case 'tessellate': {
          const s = resolveHandle(args.handle);
          if (!s) {
            reply({ reqId, ok: false, error: `tessellate: unknown handle (${String(args.handle)})` });
            return;
          }
          const deflection = typeof args.deflection === 'number' ? args.deflection : undefined;
          const r = await inner.tessellate(s, deflection);
          if (!r.ok || !r.mesh) {
            reply({ reqId, ok: false, error: r.error ?? 'tessellate failed', warnings: r.warnings });
            return;
          }
          reply({ reqId, ok: true, mesh: r.mesh, warnings: r.warnings });
          return;
        }

        case 'release': {
          const h = typeof args.handle === 'number' ? args.handle : -1;
          const s = handles.get(h);
          if (s) {
            inner.release(s);
            handles.delete(h);
          }
          reply({ reqId, ok: true });
          return;
        }

        default: {
          // Unknown op — surface as an error so the bridge can reject.
          reply({ reqId, ok: false, error: `unknown op: ${String(op)}` });
          return;
        }
      }
    } catch (err) {
      reply({ reqId, ok: false, error: (err as Error).message });
    }
  };

  return {
    postMessage(msg: unknown): void {
      if (terminated) return;
      const req = msg as WireRequest;
      // Queue on microtask to mirror real-Worker async dispatch.
      queueMicrotask(() => { void handle(req); });
    },
    addEventListener(event: 'message' | 'error', listener: MessageListener | ErrorListener): void {
      if (event === 'message') messageListeners.add(listener as MessageListener);
      else errorListeners.add(listener as ErrorListener);
    },
    removeEventListener(event: 'message' | 'error', listener: MessageListener | ErrorListener): void {
      if (event === 'message') messageListeners.delete(listener as MessageListener);
      else errorListeners.delete(listener as ErrorListener);
    },
    terminate(): void {
      terminated = true;
      messageListeners.clear();
      errorListeners.clear();
      handles.clear();
    },
  };
}
