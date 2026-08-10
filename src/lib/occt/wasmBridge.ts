/**
 * occt/wasmBridge — WASM-backed `OcctBridge` (Phase 4 infrastructure).
 *
 * NexyFab Pro own-CAD (ADR-013). Wires the `OcctBridge` interface to a real
 * (browser) `Worker` running OCCT-Emscripten, OR — in Node/jsdom where there
 * is no `Worker` global — to `createWasmWorkerStub()` which speaks the same
 * wire protocol but delegates to `createStubBridge()` for the actual
 * geometry. The bridge code is identical in both cases; only the worker
 * spawning differs.
 *
 * WHY A SEPARATE FILE
 * -------------------
 * `bridge.ts` (Agent-MMM) keeps its `createWasmBridge` stub that throws
 * `Not implemented` — preserved so existing call sites that probe for the
 * WASM bridge availability still fail loudly. THIS module exports a
 * differently-named constructor (`createWasmBridge` from this file is meant
 * to be imported with a namespace alias) and adds the dispose / handle-table
 * / reqId infrastructure the throwing stub deliberately omits. When the
 * actual OCCT WASM binary ships in `occt-worker/`, this module is what
 * drives it — `bridge.ts`'s throwing stub gets retired in a follow-up.
 *
 * SHAPE BUDGET POLICY
 * -------------------
 * The bridge tracks live handles in a Map. Each kernel op that returns a
 * shape adds an entry; `release` removes one. When `liveCount >= shapeBudget`
 * (default 256) the bridge invokes `opts.onLowMemory` with the current count.
 * The callback is advisory — the bridge does NOT block further ops. UIs can
 * use the signal to prompt the user to flush a project or auto-release
 * cached intermediates. The 256 default comes from OCCT's typical Emscripten
 * heap (~256MB at default config) divided by a 1MB conservative average
 * BREP — well above what any reasonable feature tree creates.
 *
 * INIT TIMEOUT
 * ------------
 * `createWasmBridge` returns synchronously, but the worker init handshake
 * runs lazily on the first kernel call. If the worker fails to ACK within
 * `initTimeoutMs` (default 30s), THAT first call rejects with a timeout
 * error. Subsequent calls retry the handshake — there is no permanent
 * failure state; the bridge is "trying" until a successful init lands.
 *
 * REAL OCCT WISHLIST (Phase 5 — see occt-worker/)
 * -----------------------------------------------
 *  - OCCT 7.8 + custom Emscripten bindings (extrude / revolve / boolean /
 *    fillet / chamfer / STEP read/write). Upstream `occt-import-js` covers
 *    STEP I/O but not modelling ops.
 *  - Worker bundle served at `/occt-worker/occt-worker.js` (built by
 *    `occt-worker/` package, copied into `public/occt-worker/` at build).
 *  - Module init must postMessage `{ reqId, ok: true }` after the WASM is
 *    instantiated (NOT before — we want to discriminate "worker thread
 *    started" from "OCCT ready").
 *  - Handle integers SHOULD be heap-allocated indices into a `TopoDS_Shape*`
 *    table inside the worker; release calls `Shape.delete()` to free the
 *    OCCT-side memory. Garbage collection of orphaned handles is the worker's
 *    job — the bridge is not authoritative.
 *  - Cancellation: not in scope for Phase 4. Phase 5 should add an
 *    `AbortSignal` arg that posts `{ op: 'cancel', reqId }` which the worker
 *    honours at safe breakpoints. Until then, a long fillet blocks the
 *    queue.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { OcctBooleanOps, OcctBridge } from './bridge';
import type { OcctOperationResult, OcctShape, OcctTessellationResult } from './types';
import {
  createWasmWorkerStub,
  type WireRequest,
  type WireResponse,
  type WireShapePayload,
  type WorkerLike,
} from './wasmWorkerStub';

// ─── public types ─────────────────────────────────────────────────────────

export interface CreateWasmBridgeOptions {
  /** Worker bundle URL — default `/occt-worker/occt-worker.js`. */
  workerUrl?: string;
  /** Live-handle cap that triggers `onLowMemory`. Default 256. */
  shapeBudget?: number;
  /** Worker-init handshake timeout in ms. Default 30000. */
  initTimeoutMs?: number;
  /** Maximum time for an individual worker request. Default 120000. */
  operationTimeoutMs?: number;
  /** Fires when `liveShapes >= shapeBudget`. Advisory; bridge does not throttle. */
  onLowMemory?: (liveShapes: number) => void;
  /**
   * Factory override — primarily for tests that want to inject a custom
   * worker (e.g. one that always errors). Default behaviour:
   *   - `window.Worker` present → `new Worker(workerUrl)`.
   *   - otherwise → `createWasmWorkerStub()`.
   */
  workerFactory?: () => WorkerLike;
}

/** Extra ops the WASM bridge exposes beyond `OcctBridge`. */
export interface OcctWasmExtras {
  /** Terminate the worker; subsequent calls reject. Safe to call twice. */
  dispose(): void;
  /** Replace an unhealthy worker and invalidate all old native handles. */
  restart(): void;
  /** Live shape handle count (for tests + UI memory indicator). */
  readonly liveShapeCount: number;
  /** Last reqId issued (for tests verifying reqId monotonicity). */
  readonly lastReqId: number;
  /** True once the init handshake has resolved. */
  readonly ready: boolean;
}

export type WasmOcctBridge = OcctBridge & OcctWasmExtras;

// ─── implementation ───────────────────────────────────────────────────────

interface Pending {
  resolve: (resp: WireResponse) => void;
  reject: (err: Error) => void;
  /** Op label for error messages. */
  op: string;
  timer?: ReturnType<typeof setTimeout>;
}

/** Phase-4 stub dispatcher — the safe default (no WASM, no CSP requirements). */
const DEFAULT_WORKER_URL = '/occt-worker/occt-worker.js';

/**
 * Phase-5 activation URL. Point the bridge here (`workerUrl: LAUNCHER_WORKER_URL`)
 * to feature-detect the real OCCT kernel: the launcher tries opencascade.js +
 * occt-worker-real.js and falls back to the stub on any failure (404 / MIME /
 * CSP / WASM-instantiation), so flipping is safe even before CSP is updated —
 * worst case it behaves exactly like the stub. Both files are served by
 * scripts/copy-occt.js. Activation is gated on the CSP change
 * (`script-src 'wasm-unsafe-eval'`, `worker-src 'self' blob:`) + a Playwright
 * burn-in against the real binary (see occt-worker/PHASE_5_INTEGRATION.md).
 */
export const LAUNCHER_WORKER_URL = '/occt-worker/occt-worker-launcher.js';
/** Production/commercial URL: real OCCT only; it never imports the bbox stub. */
export const COMMERCIAL_WORKER_URL = '/occt-worker/occt-worker-commercial.js';

/**
 * Build a WASM-backed `OcctBridge`. The bridge spawns a worker (real `Worker`
 * in browsers, in-process stub elsewhere), runs an init handshake on the
 * first call, and routes every kernel op as a `reqId`-keyed postMessage with
 * a Promise on the JS side.
 */
export function createWasmBridge(opts: CreateWasmBridgeOptions = {}): WasmOcctBridge {
  const workerUrl = opts.workerUrl ?? DEFAULT_WORKER_URL;
  const shapeBudget = opts.shapeBudget ?? 256;
  const initTimeoutMs = opts.initTimeoutMs ?? 30_000;
  const operationTimeoutMs = opts.operationTimeoutMs ?? 120_000;
  const onLowMemory = opts.onLowMemory;

  // Pick a worker factory.
  const factory: () => WorkerLike = opts.workerFactory ?? (() => {
    if (typeof globalThis !== 'undefined' && typeof (globalThis as { Worker?: unknown }).Worker === 'function') {
      const W = (globalThis as { Worker: new (url: string) => WorkerLike }).Worker;
      return new W(workerUrl);
    }
    return createWasmWorkerStub();
  });

  let worker = factory();

  // ─── reqId-keyed pending table ─────────────────────────────────────────
  const pending = new Map<number, Pending>();
  let nextReqId = 1;
  let lastReqId = 0;
  let disposed = false;
  let initPromise: Promise<void> | null = null;
  let ready = false;

  const onMessage = (ev: { data: unknown }): void => {
    const resp = ev.data as WireResponse | undefined;
    if (!resp || typeof resp.reqId !== 'number') return;
    const p = pending.get(resp.reqId);
    if (!p) return;
    pending.delete(resp.reqId);
    if (p.timer) clearTimeout(p.timer);
    p.resolve(resp);
  };

  const onError = (ev: unknown): void => {
    const msg = ev instanceof Error ? ev.message : 'occt-wasm: worker error';
    for (const [reqId, p] of pending) {
      pending.delete(reqId);
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(`${p.op}: ${msg}`));
    }
  };

  const attachWorker = (): void => {
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  };
  const detachWorker = (): void => {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
  };
  attachWorker();

  const sendRequest = (op: string, args?: Record<string, unknown>): Promise<WireResponse> => {
    if (disposed) {
      return Promise.reject(new Error(`${op}: bridge disposed`));
    }
    const reqId = nextReqId++;
    lastReqId = reqId;
    const req: WireRequest = { op: op as WireRequest['op'], reqId, args };
    return new Promise<WireResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const request = pending.get(reqId);
        if (!request) return;
        pending.delete(reqId);
        request.reject(new Error(`occt-wasm: ${op} timed out after ${operationTimeoutMs}ms`));
        // A native kernel call cannot be safely interrupted in-place. Replace
        // the Worker so a wedged WASM instance and its native heap do not
        // poison subsequent requests. All old handles become intentionally stale.
        restart();
      }, operationTimeoutMs);
      pending.set(reqId, { resolve, reject, op, timer });
      try {
        worker.postMessage(req);
      } catch (err) {
        pending.delete(reqId);
        clearTimeout(timer);
        reject(new Error(`${op}: postMessage failed: ${(err as Error).message}`));
      }
    });
  };

  // ─── init handshake (lazy, retried on failure) ─────────────────────────
  const ensureReady = (): Promise<void> => {
    if (ready) return Promise.resolve();
    if (initPromise) return initPromise;
    const start = sendRequest('init');
    initPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Drop the pending entry so the late ACK doesn't double-resolve.
        const reqId = lastReqId;
        pending.delete(reqId);
        initPromise = null;
        reject(new Error(`occt-wasm: init handshake timed out after ${initTimeoutMs}ms`));
      }, initTimeoutMs);
      start.then(
        (resp) => {
          clearTimeout(timer);
          if (!resp.ok) {
            initPromise = null;
            reject(new Error(`occt-wasm: init failed: ${resp.error}`));
            return;
          }
          ready = true;
          resolve();
        },
        (err: Error) => {
          clearTimeout(timer);
          initPromise = null;
          reject(err);
        },
      );
    });
    return initPromise;
  };

  // ─── shape handle table ────────────────────────────────────────────────
  /**
   * The wire layer hands us an integer handle. We wrap it in an `OcctShape`
   * whose `id = "occt_<handle>"`. The reverse map is used by every op that
   * takes shape arguments — we need the integer to send across.
   */
  const idToHandle = new Map<string, number>();
  let liveCount = 0;
  let lowMemoryNotified = false;

  const wireToShape = (w: WireShapePayload): OcctShape => {
    const id = `occt_${w.handle}`;
    idToHandle.set(id, w.handle);
    liveCount++;
    if (!lowMemoryNotified && liveCount >= shapeBudget && onLowMemory) {
      lowMemoryNotified = true;
      try {
        onLowMemory(liveCount);
      } catch {
        /* user callback failed — swallow; their concern, not ours */
      }
    } else if (liveCount < shapeBudget) {
      // Allow re-notification after dropping back under budget.
      lowMemoryNotified = false;
    }
    return {
      id,
      kind: w.kind,
      bbox: w.bbox,
      volume: w.volume,
      area: w.area,
      centerOfMass: w.centerOfMass,
      // K7-S2 — 생성-이력 이름 테이블(있을 때만): S3 피처 이중화의 원료.
      ...(w.edgeNames ? { edgeNames: w.edgeNames, edgeNamesTruncated: w.edgeNamesTruncated === true } : {}),
    };
  };

  const wireHandleOf = (shape: OcctShape, where: string): number => {
    const h = idToHandle.get(shape.id);
    if (h === undefined) {
      throw new Error(`occt-wasm: ${where}: unknown shape id '${shape.id}' (already released?)`);
    }
    return h;
  };

  // ─── response mappers ──────────────────────────────────────────────────
  const toOperationResult = (resp: WireResponse): OcctOperationResult => {
    if (!resp.ok) {
      return { ok: false, error: resp.error, warnings: resp.warnings ?? [] };
    }
    if (!resp.shape) {
      // Op returned ok with no shape — protocol violation for the ops we
      // route through here. Surface as error rather than fabricate a shape.
      return { ok: false, error: 'occt-wasm: missing shape in response', warnings: resp.warnings ?? [] };
    }
    return { ok: true, shape: wireToShape(resp.shape), warnings: resp.warnings ?? [] };
  };

  // ─── bridge methods ────────────────────────────────────────────────────
  const buildFromExtrude = async (feature: ExtrudeFeature): Promise<OcctOperationResult> => {
    await ensureReady();
    const resp = await sendRequest('buildFromExtrude', { feature });
    return toOperationResult(resp);
  };

  const buildFromRevolve = async (feature: RevolveFeature): Promise<OcctOperationResult> => {
    await ensureReady();
    const resp = await sendRequest('buildFromRevolve', { feature });
    return toOperationResult(resp);
  };

  const buildPrismAt = async (
    loop: ReadonlyArray<{ x: number; y: number }>, z0: number, heightMm: number,
  ): Promise<OcctOperationResult> => {
    await ensureReady();
    return toOperationResult(await sendRequest('buildPrismAt', { loop: [...loop], z0, heightMm }));
  };

  const buildConeAt = async (
    center: { x: number; y: number }, z0: number, heightMm: number, radius0: number, radius1: number,
  ): Promise<OcctOperationResult> => {
    await ensureReady();
    return toOperationResult(await sendRequest('buildConeAt', { center, z0, heightMm, radius0, radius1 }));
  };

  const buildThreadHelixCutter: NonNullable<OcctBridge['buildThreadHelixCutter']> = async (opts) => {
    await ensureReady();
    return toOperationResult(await sendRequest('buildThreadHelixCutter', { opts }));
  };

  // K7-S2(260808) — BooleanOperandIds 를 워커까지 운반한다. 종전엔 시그니처만
  // 받고 버려서(위치 접두사 유지) 스파이크 R0-1 수정이 브라우저 경로에 닿지 않았다.
  const boolean: OcctBooleanOps = {
    async union(a, b, ids) {
      await ensureReady();
      const handleA = wireHandleOf(a, 'union');
      const handleB = wireHandleOf(b, 'union');
      const resp = await sendRequest('booleanUnion', { handleA, handleB, ids });
      return toOperationResult(resp);
    },
    async subtract(a, b, ids) {
      await ensureReady();
      const handleA = wireHandleOf(a, 'subtract');
      const handleB = wireHandleOf(b, 'subtract');
      const resp = await sendRequest('booleanSubtract', { handleA, handleB, ids });
      return toOperationResult(resp);
    },
    async intersect(a, b, ids) {
      await ensureReady();
      const handleA = wireHandleOf(a, 'intersect');
      const handleB = wireHandleOf(b, 'intersect');
      const resp = await sendRequest('booleanIntersect', { handleA, handleB, ids });
      return toOperationResult(resp);
    },
  };

  const fillet = async (shape: OcctShape, edgeIds: string[], radius: number): Promise<OcctOperationResult> => {
    await ensureReady();
    const handle = wireHandleOf(shape, 'fillet');
    const resp = await sendRequest('fillet', { handle, edgeIds, dim: radius });
    return toOperationResult(resp);
  };

  const chamfer = async (shape: OcctShape, edgeIds: string[], distance: number): Promise<OcctOperationResult> => {
    await ensureReady();
    const handle = wireHandleOf(shape, 'chamfer');
    const resp = await sendRequest('chamfer', { handle, edgeIds, dim: distance });
    return toOperationResult(resp);
  };

  const variableFillet = async (
    shape: OcctShape,
    edges: ReadonlyArray<{ edgeId: string; radius: number }>,
  ): Promise<OcctOperationResult> => {
    await ensureReady();
    const handle = wireHandleOf(shape, 'variableFillet');
    const resp = await sendRequest('variableFillet', { handle, edges: [...edges] });
    return toOperationResult(resp);
  };

  const lawFillet = async (
    shape: OcctShape,
    edges: ReadonlyArray<{ edgeId: string; startRadius: number; endRadius: number }>,
    options?: { continuity?: 'G1' | 'G2'; angularTolerance?: number },
  ): Promise<OcctOperationResult> => {
    await ensureReady();
    const handle = wireHandleOf(shape, 'lawFillet');
    const resp = await sendRequest('lawFillet', { handle, edges: [...edges], options });
    return toOperationResult(resp);
  };

  const buildPlanarFace = async (loop: ReadonlyArray<{ x: number; y: number }>, z = 0): Promise<OcctOperationResult> => {
    await ensureReady();
    const resp = await sendRequest('buildPlanarFace', { loop, z });
    return toOperationResult(resp);
  };

  const thicken = async (shape: OcctShape, thickness: number): Promise<OcctOperationResult> => {
    await ensureReady();
    const handle = wireHandleOf(shape, 'thicken');
    const resp = await sendRequest('thicken', { handle, dim: thickness });
    return toOperationResult(resp);
  };

  const surfaceTrim = async (a: OcctShape, b: OcctShape): Promise<OcctOperationResult> => {
    await ensureReady();
    const handleA = wireHandleOf(a, 'surfaceTrim');
    const handleB = wireHandleOf(b, 'surfaceTrim');
    const resp = await sendRequest('surfaceTrim', { handleA, handleB });
    return toOperationResult(resp);
  };

  const exportSTEP = async (shape: OcctShape): Promise<string> => {
    await ensureReady();
    const handle = wireHandleOf(shape, 'exportSTEP');
    const resp = await sendRequest('exportSTEP', { handle });
    if (!resp.ok) {
      throw new Error(`occt-wasm: exportSTEP failed: ${resp.error}`);
    }
    if (typeof resp.step !== 'string') {
      throw new Error('occt-wasm: exportSTEP returned no string payload');
    }
    return resp.step;
  };

  const importSTEP = async (source: string): Promise<OcctOperationResult> => {
    await ensureReady();
    const resp = await sendRequest('importSTEP', { source });
    return toOperationResult(resp);
  };

  const tessellate = async (shape: OcctShape, deflection = 0.1): Promise<OcctTessellationResult> => {
    await ensureReady();
    const handle = wireHandleOf(shape, 'tessellate');
    const resp = await sendRequest('tessellate', { handle, deflection });
    if (!resp.ok) {
      return { ok: false, error: resp.error, warnings: resp.warnings ?? [] };
    }
    if (!resp.mesh) {
      return { ok: false, error: 'occt-wasm: tessellate returned no mesh payload', warnings: resp.warnings ?? [] };
    }
    return { ok: true, mesh: resp.mesh, warnings: resp.warnings ?? [] };
  };

  const release = (shape: OcctShape): void => {
    const h = idToHandle.get(shape.id);
    if (h === undefined) return; // idempotent
    idToHandle.delete(shape.id);
    liveCount = Math.max(0, liveCount - 1);
    if (liveCount < shapeBudget) lowMemoryNotified = false;
    // Fire-and-forget — the worker frees its memory, we don't await.
    void sendRequest('release', { handle: h }).catch(() => {
      /* worker died mid-release; nothing to do */
    });
  };

  const restart = (): void => {
    if (disposed) throw new Error('occt-wasm: cannot restart a disposed bridge');
    detachWorker();
    for (const [reqId, p] of pending) {
      pending.delete(reqId);
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(`${p.op}: worker restarted`));
    }
    worker.terminate();
    idToHandle.clear();
    liveCount = 0;
    lowMemoryNotified = false;
    ready = false;
    initPromise = null;
    worker = factory();
    attachWorker();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    detachWorker();
    // Reject any in-flight requests so callers don't hang.
    for (const [reqId, p] of pending) {
      pending.delete(reqId);
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(`${p.op}: bridge disposed`));
    }
    idToHandle.clear();
    liveCount = 0;
    worker.terminate();
  };

  const bridge: WasmOcctBridge = {
    buildFromExtrude,
    buildFromRevolve,
    buildPrismAt,
    buildConeAt,
    buildThreadHelixCutter,
    boolean,
    fillet,
    variableFillet,
    lawFillet,
    chamfer,
    buildPlanarFace,
    thicken,
    surfaceTrim,
    exportSTEP,
    importSTEP,
    tessellate,
    release,
    restart,
    dispose,
    get liveShapeCount() { return liveCount; },
    get lastReqId() { return lastReqId; },
    get ready() { return ready; },
  };
  return bridge;
}
