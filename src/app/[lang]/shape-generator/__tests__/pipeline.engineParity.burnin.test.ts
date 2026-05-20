/**
 * Engine-parity burn-in (Q1 gap fill).
 *
 * The existing OCCT burn-in only exercises engine=1 (the B-rep path). But in
 * production, when the OCCT WASM fails to init or an op throws, features fall
 * back to the mesh-CSG engine (engine=0). Nothing measured whether the two
 * engines produce *comparable* geometry for the same input — a silent fallback
 * that returns a wildly different part is the classic "toy vs pro" failure.
 *
 * This burn-in runs identical feature inputs through BOTH engines and asserts
 * the fallback stays within a bounded volume/envelope divergence of the B-rep
 * result. It also guarantees the fallback never silently returns empty.
 *
 * Skipped unless RUN_OCCT_FEASIBILITY=1 (needs the OCCT WASM).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { booleanFeature } from '../features/boolean';
import { filletFeature } from '../features/fillet';
import { chamferFeature } from '../features/chamfer';
import { ensureOcctReady, isOcctReady, setOcctGlobalMode, resetShapeRegistry } from '../features/occtEngine';
import { computeSignature, type GeometrySignature } from './geometrySignature';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

function makeBox(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.computeVertexNormals();
  return geo;
}

function defaultParams(def: { params: Array<{ key: string; default: number }> }): Record<string, number> {
  const p: Record<string, number> = {};
  for (const sp of def.params) p[sp.key] = sp.default;
  return p;
}

interface ParityFeature {
  apply: (geo: THREE.BufferGeometry, params: Record<string, number>) => THREE.BufferGeometry;
  params: Array<{ key: string; default: number }>;
}

/** Run a feature through OCCT (engine=1) and mesh (engine=0); report divergence. */
function parity(feature: ParityFeature, params: Record<string, number>): {
  occt: GeometrySignature; mesh: GeometrySignature;
  volDivergencePct: number; bboxSpanDivergencePct: number;
} {
  resetShapeRegistry();
  const occt = computeSignature(feature.apply(makeBox(), { ...params, engine: 1 }));
  resetShapeRegistry();
  const mesh = computeSignature(feature.apply(makeBox(), { ...params, engine: 0 }));

  const volDivergencePct = occt.volume_mm3 > 0
    ? Math.abs(occt.volume_mm3 - mesh.volume_mm3) / occt.volume_mm3 * 100
    : Infinity;

  // Bounding-box diagonal span divergence — catches scale/envelope drift even
  // when volumes happen to coincide.
  const span = (s: GeometrySignature) => Math.hypot(
    s.bbox.max[0] - s.bbox.min[0], s.bbox.max[1] - s.bbox.min[1], s.bbox.max[2] - s.bbox.min[2],
  );
  const so = span(occt), sm = span(mesh);
  const bboxSpanDivergencePct = so > 0 ? Math.abs(so - sm) / so * 100 : Infinity;

  return { occt, mesh, volDivergencePct, bboxSpanDivergencePct };
}

describeMaybe('Engine-parity burn-in (Q1)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
    setOcctGlobalMode(false);
  }, 60_000);

  it('OCCT is available (otherwise parity is meaningless)', () => {
    expect(isOcctReady()).toBe(true);
  });

  // ─── Boolean: cut a cylinder, both engines remove comparable material ─────
  it('boolean subtract — fallback volume within 5% of B-rep across sizes', () => {
    const sizes = [5, 10, 15, 18];
    for (const r of sizes) {
      const params = defaultParams(booleanFeature);
      params.operation = 1; params.toolShape = 1; params.toolWidth = r * 2; params.toolHeight = 80;
      const p = parity(booleanFeature, params);

      // Fallback must never be silently empty.
      expect(p.mesh.triangleCount).toBeGreaterThan(0);
      expect(p.mesh.volume_mm3).toBeGreaterThan(0);

      // eslint-disable-next-line no-console
      console.info(`[parity] boolean r=${r}: vol Δ=${p.volDivergencePct.toFixed(2)}% ` +
        `(occt=${p.occt.volume_mm3.toFixed(0)} mesh=${p.mesh.volume_mm3.toFixed(0)}) span Δ=${p.bboxSpanDivergencePct.toFixed(2)}%`);

      expect(p.volDivergencePct).toBeLessThan(5);
      expect(p.bboxSpanDivergencePct).toBeLessThan(2);
    }
  }, 180_000);

  // ─── Fillet / chamfer: both engines round; bounded parity ─────────────────
  //
  // The mesh path now produces REAL rounding for box-like solids (meshRounding:
  // RoundedBoxGeometry for fillet, CSG half-space cuts for chamfer). Both
  // engines therefore remove material at the edges and the mesh result tracks
  // the B-rep volume within a few percent. (Previously the mesh path was a
  // silent no-op — fixed 2026-05-20.)
  const BOX_VOLUME = 60 * 40 * 30; // 72000 mm³

  it('fillet — mesh rounding tracks B-rep volume within 3%', () => {
    for (const r of [1, 2, 4, 7]) {
      const params = defaultParams(filletFeature);
      params.radius = r;
      const p = parity(filletFeature, params);

      // eslint-disable-next-line no-console
      console.info(`[parity] fillet r=${r}: occt=${p.occt.volume_mm3.toFixed(0)} ` +
        `mesh=${p.mesh.volume_mm3.toFixed(0)} meshTris=${p.mesh.triangleCount} volΔ=${p.volDivergencePct.toFixed(2)}%`);

      // Both engines round convex edges → volume strictly below the box.
      expect(p.occt.volume_mm3).toBeLessThan(BOX_VOLUME);
      expect(p.mesh.volume_mm3).toBeLessThan(BOX_VOLUME);
      expect(p.mesh.volume_mm3).toBeGreaterThan(BOX_VOLUME * 0.9);
      // Mesh is real geometry now, not a 12-tri box.
      expect(p.mesh.triangleCount).toBeGreaterThan(50);
      expect(p.volDivergencePct).toBeLessThan(3);
    }
  }, 180_000);

  it('chamfer — mesh bevel tracks B-rep volume within 3%', () => {
    for (const d of [1, 2, 3, 5]) {
      const params = defaultParams(chamferFeature);
      params.distance = d;
      const p = parity(chamferFeature, params);

      // eslint-disable-next-line no-console
      console.info(`[parity] chamfer d=${d}: occt=${p.occt.volume_mm3.toFixed(0)} ` +
        `mesh=${p.mesh.volume_mm3.toFixed(0)} meshTris=${p.mesh.triangleCount} volΔ=${p.volDivergencePct.toFixed(2)}%`);

      expect(p.occt.volume_mm3).toBeLessThan(BOX_VOLUME);
      expect(p.mesh.volume_mm3).toBeLessThan(BOX_VOLUME);
      expect(p.mesh.triangleCount).toBeGreaterThan(20);
      expect(p.volDivergencePct).toBeLessThan(3);
    }
  }, 180_000);
});
