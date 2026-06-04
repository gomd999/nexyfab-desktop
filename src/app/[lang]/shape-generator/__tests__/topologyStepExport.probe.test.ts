/**
 * topologyStepExport.probe — Track G/G3 → STEP, verified on the REAL kernel.
 *
 * Closes the generative loop end-to-end: a 3D SIMP density field → watertight
 * extracted solid → a real B-rep STEP file. The mesh rides the existing
 * exportToStepAsync Route A (binary STL → replicad.importSTL → OCCT B-rep →
 * blobSTEP), so the output is a genuine kernel STEP (ADVANCED_FACE / CLOSED_SHELL
 * / MANIFOLD_SOLID_BREP), not the legacy box-only tessellated emitter — i.e. it
 * round-trips through occt-import-js / other CAD.
 *
 * Gated by RUN_OCCT_FEASIBILITY=1 (10 MB WASM); runs in the occt-burnin job.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { ensureOcctReady } from '../features/occtEngine';
import { exportToStepAsync } from '../io/stepExporter';
import { TopologyGrid, optimizeTopology3D, cantileverBC } from '../analysis/topology3D';
import { extractSolidSurface, thresholdForFraction, type ExtractedMesh } from '../analysis/topologyExtract';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

function toGeo(m: ExtractedMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  return g;
}

/** A real kernel STEP: ISO header + DATA section + B-rep (not just triangles). */
function assertRealBrepStep(step: string): void {
  expect(step.startsWith('ISO-10303-21;')).toBe(true);
  expect(step).toContain('DATA;');
  expect(step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  expect(step).toMatch(/CLOSED_SHELL|MANIFOLD_SOLID_BREP|ADVANCED_FACE/);
  expect(step.length).toBeGreaterThan(2000);
}

describeMaybe('topology → STEP export (Track G3)', () => {
  beforeAll(async () => { await ensureOcctReady(); }, 60_000);

  it('exports a clean extracted solid block as a real B-rep STEP', () => {
    const grid = new TopologyGrid(8, 6, 6);
    const dens = new Float32Array(grid.nElems);
    for (let ez = 1; ez < 5; ez++) for (let ey = 1; ey < 5; ey++) for (let ex = 1; ex < 7; ex++) {
      dens[(ez * 6 + ey) * 8 + ex] = 1;
    }
    return (async () => {
      const step = await exportToStepAsync(toGeo(extractSolidSurface(dens, grid, 0.5, 5)), 'NexyFab_Topo_Block');
      assertRealBrepStep(step);
    })();
  }, 60_000);

  it('exports the OPTIMISED cantilever solid → STEP (full generative loop)', async () => {
    const grid = new TopologyGrid(12, 6, 4);
    const res = optimizeTopology3D({ nx: 12, ny: 6, nz: 4, volfrac: 0.45, penal: 3, rmin: 1.6, maxIter: 25 }, cantileverBC(grid, -1));
    const thr = thresholdForFraction(res.density, 0.45);
    const mesh = extractSolidSurface(res.density, grid, thr, 5);
    expect(mesh.indices.length).toBeGreaterThan(0);

    const step = await exportToStepAsync(toGeo(mesh), 'NexyFab_Generative_Cantilever');
    assertRealBrepStep(step);
  }, 90_000);
});
