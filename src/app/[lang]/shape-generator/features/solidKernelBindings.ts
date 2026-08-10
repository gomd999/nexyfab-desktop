/**
 * solidKernelBindings — wires the live engines into the `SolidKernel` facade
 * (OCCT_W3_DESIGN.md). This is the glue the pipeline calls; the only remaining
 * browser-gated step is swapping a call site from `occtExtrudeProfile(...)` to
 * `selectSolidKernel(useWorker).extrude(...)`.
 *
 *   - `replicadDeps()` — injects the in-process `occtEngine` ops into
 *     `ReplicadKernelDeps` (handle == OcctShape.id; volume/bbox from the mesh).
 *   - `selectSolidKernel(useWorker)` — the `?occtWorker=1` switch: the K-series
 *     worker bridge when on, the in-process replicad kernel by default.
 *
 * The replicad ops + `createWasmBridge` are browser-runtime; the binding logic
 * (id threading, mesh-volume, bbox) is type-checked here and the mesh helpers
 * (`meshVolume`/`boundsOf`) are headless-verified in the test.
 */

import * as THREE from 'three';
import { createWasmBridge, COMMERCIAL_WORKER_URL, LAUNCHER_WORKER_URL } from '@/lib/occt/wasmBridge';
import { meshVolume } from './roundingGuard';
import {
  occtExtrudeProfile,
  occtRevolveProfile,
  occtBooleanSolids,
  exportOcctStep,
} from './occtEngine';
import {
  createKSeriesKernel,
  createReplicadKernel,
  type SolidKernel,
  type ReplicadKernelDeps,
  type KernelBBox,
} from './solidKernel';

/** Axis-aligned bounds of a BufferGeometry as a KernelBBox (undefined if empty). */
export function boundsOf(geometry: unknown): KernelBBox | undefined {
  const geo = geometry as THREE.BufferGeometry;
  if (!geo || typeof geo.computeBoundingBox !== 'function') return undefined;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb || !Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) return undefined;
  return {
    min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
    max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
  };
}

/** Inject the in-process occtEngine (replicad) ops into the facade deps. */
export function replicadDeps(): ReplicadKernelDeps {
  return {
    extrudeProfile: (points, depth) => occtExtrudeProfile([...points], depth),
    revolveProfile: (points) => occtRevolveProfile([...points]),
    booleanSolids: (op, a, b) => occtBooleanSolids(op, a, b),
    exportStep: (handle) => exportOcctStep(handle),
    meshVolume: (geometry) => meshVolume(geometry as THREE.BufferGeometry),
    boundsOf,
  };
}

export function selectOcctWorkerUrl(environment: { nodeEnv?: string; cadIndependentMode?: string } = {
  nodeEnv: process.env.NODE_ENV,
  cadIndependentMode: process.env.NEXT_PUBLIC_NEXYFAB_CAD_INDEPENDENT_MODE,
}): string {
  return environment.nodeEnv === 'production' || environment.cadIndependentMode === '1'
    ? COMMERCIAL_WORKER_URL
    : LAUNCHER_WORKER_URL;
}

/**
 * The kernel-of-record selector. `?occtWorker=1` (or the equivalent flag) routes
 * solid ops to the K-series worker bridge (real `opencascade.js`, persistent
 * naming + the ceiling ops); the default stays the in-process replicad kernel.
 * Reversible per call — the parity gate compares the two.
 */
export function selectSolidKernel(useWorker: boolean): SolidKernel {
  if (useWorker) {
    // Point at the LAUNCHER, not the default stub worker — the launcher
    // feature-detects the real opencascade.js kernel (importScripts the WASM)
    // and only falls back to the stub if it can't load. Without this the
    // "K-series worker" silently routed every op to the synthetic stub, so the
    // kernel-ceiling ops (thicken/surfaceTrim) never reached real OCCT.
    return createKSeriesKernel(createWasmBridge({ workerUrl: selectOcctWorkerUrl() }));
  }
  return createReplicadKernel(replicadDeps());
}
