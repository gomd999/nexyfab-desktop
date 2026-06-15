/**
 * thickenKSeries — feature core for the "Thicken surface → solid" action, the
 * first UI consumer of the K-series kernel-CEILING op (replicad can't thicken).
 *
 * `thickenSurfaceKSeries()` is what a "Thicken" toolbar/panel button calls: it
 * drives the real opencascade.js worker through the `SolidKernel` facade
 * (buildPlanarFace → thicken → tessellate) and returns a scene-ready
 * `ShapeResult`. The pure packing step (`tessellationToShapeResult`) is split
 * out so it's unit-testable without a worker.
 *
 * The async worker boot + the thicken op itself are verified by
 * `e2e/occt/wasm-real.spec.ts` (browser) and
 * `solidKernelCeiling.kseries.test.ts` (facade, headless). This module adds the
 * tessellation → THREE geometry packing that turns a kernel result into
 * something the viewport can render.
 */
import * as THREE from 'three';
import type { OcctTessellation } from '@/lib/occt/types';
import type { KernelBBox } from './solidKernel';
import { selectSolidKernel } from './solidKernelBindings';
import type { ShapeResult } from '../shapes';

export interface ThickenInput {
  /** Planar profile (≥3 points) to thicken into a solid slab. */
  loop: ReadonlyArray<{ x: number; y: number }>;
  /** Wall thickness in mm (> 0). */
  thickness: number;
  /** Tessellation deflection (mm); smaller = finer mesh. */
  deflection?: number;
}

export type ThickenOutcome =
  | { ok: true; result: ShapeResult; warnings: string[] }
  | { ok: false; error: string };

/**
 * PURE: pack a flat-shaded `OcctTessellation` (+ optional kernel metrics) into a
 * `ShapeResult` the viewport can render. `positions`/`normals` are flat XYZ
 * (9 floats per triangle); `edges` are flat XYZ line-segment pairs. No worker
 * involved → headless-testable.
 */
export function tessellationToShapeResult(
  tess: OcctTessellation,
  opts: { volumeMm3?: number; bbox?: KernelBBox } = {},
): ShapeResult {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(tess.positions), 3));
  if (tess.normals.length === tess.positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(tess.normals), 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();

  // Kernel-provided edges (sharp/silhouette line segments), already flat XYZ.
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(tess.edges), 3));

  // Bounds: prefer the kernel bbox (exact, mm); fall back to the tessellation's.
  let w: number, h: number, d: number;
  if (opts.bbox) {
    w = opts.bbox.max.x - opts.bbox.min.x;
    h = opts.bbox.max.y - opts.bbox.min.y;
    d = opts.bbox.max.z - opts.bbox.min.z;
  } else {
    [w, h, d] = tess.bounds.size;
  }

  return {
    geometry,
    edgeGeometry,
    volume_cm3: (opts.volumeMm3 ?? 0) / 1000, // mm³ → cm³
    surface_area_cm2: 0, // not surfaced by the thicken op; left 0
    bbox: { w, h, d },
  };
}

/**
 * Run the K-series thicken op end-to-end: build a planar face from `loop`,
 * thicken it into a solid, tessellate, and pack into a `ShapeResult`. Uses the
 * real opencascade.js worker (LAUNCHER worker via `selectSolidKernel(true)`).
 * Browser-only (spawns a Web Worker). Never throws — returns a tagged outcome.
 */
export async function thickenSurfaceKSeries(input: ThickenInput): Promise<ThickenOutcome> {
  if (!input.loop || input.loop.length < 3) {
    return { ok: false, error: 'thicken: profile needs at least 3 points' };
  }
  if (!(input.thickness > 0) || !Number.isFinite(input.thickness)) {
    return { ok: false, error: `thicken: thickness must be positive finite, got ${input.thickness}` };
  }
  const kernel = selectSolidKernel(true);
  let faceId: string | null = null;
  let solidId: string | null = null;
  try {
    const face = await kernel.buildPlanarFace(input.loop, 0);
    if (!face) return { ok: false, error: 'buildPlanarFace returned no shape' };
    faceId = face.id;
    const solid = await kernel.thicken(face.id, input.thickness);
    if (!solid) return { ok: false, error: 'thicken returned no solid (degenerate surface?)' };
    solidId = solid.id;
    const tess = await kernel.tessellate(solid.id, input.deflection ?? 0.1);
    if (!tess) return { ok: false, error: 'tessellate returned no mesh' };
    return { ok: true, result: tessellationToShapeResult(tess, { volumeMm3: solid.volume, bbox: solid.bbox }), warnings: [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (faceId) kernel.release(faceId);
    if (solidId) kernel.release(solidId);
  }
}
