/**
 * topologyExtract — G3: density field → WATERTIGHT printable solid. Verifies the
 * voxel-boundary extraction is a closed 2-manifold (the same bar mesh rounding
 * must meet), that Taubin smoothing keeps it watertight without collapsing it,
 * and that the realised solid volume tracks the requested fraction.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TopologyGrid, optimizeTopology3D, cantileverBC } from './topology3D';
import { extractSolidSurface, taubinSmooth, thresholdForFraction, type ExtractedMesh } from './topologyExtract';
import { analyzeTopology } from '../features/meshTopology';

function toGeo(m: ExtractedMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}
function bboxSize(m: ExtractedMesh): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let d = 0; d < 3; d++) {
    lo[d] = Math.min(lo[d], m.positions[i + d]); hi[d] = Math.max(hi[d], m.positions[i + d]);
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}
const allFinite = (m: ExtractedMesh) => m.positions.every((v) => Number.isFinite(v));

describe('topologyExtract — density → watertight solid (Track G / G3)', () => {
  it('extracts a clean solid block as a closed manifold', () => {
    // a 6×4×4 solid region inside an 8×6×6 grid → its boundary is a closed box.
    const grid = new TopologyGrid(8, 6, 6);
    const dens = new Float32Array(grid.nElems);
    for (let ez = 1; ez < 5; ez++) for (let ey = 1; ey < 5; ey++) for (let ex = 1; ex < 7; ex++) {
      dens[(ez * 6 + ey) * 8 + ex] = 1;
    }
    const mesh = extractSolidSurface(dens, grid, 0.5);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(allFinite(mesh)).toBe(true);
    const topo = analyzeTopology(toGeo(mesh));
    expect(topo.isClosedManifold).toBe(true);
    expect(topo.boundaryEdgeCount).toBe(0);
    expect(bboxSize(mesh)).toEqual([6, 4, 4]); // exactly the solid block
  });

  it('extracts the optimised cantilever as a WATERTIGHT solid at the target volume', () => {
    const grid = new TopologyGrid(16, 8, 4);
    const res = optimizeTopology3D({ nx: 16, ny: 8, nz: 4, volfrac: 0.4, penal: 3, rmin: 1.6, maxIter: 30 }, cantileverBC(grid, -1));
    const thr = thresholdForFraction(res.density, 0.4);
    const mesh = extractSolidSurface(res.density, grid, thr);

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(allFinite(mesh)).toBe(true);
    const topo = analyzeTopology(toGeo(mesh));
    expect(topo.boundaryEdgeCount, `${topo.boundaryEdgeCount} open edges`).toBe(0);
    expect(topo.isClosedManifold).toBe(true);

    // realised solid volume ≈ 40% of the grid (each solid voxel is a unit cube).
    const solidVoxels = res.density.reduce((n, d) => n + (d > thr ? 1 : 0), 0);
    expect(solidVoxels / grid.nElems).toBeGreaterThan(0.3);
    expect(solidVoxels / grid.nElems).toBeLessThan(0.5);
  });

  it('Taubin smoothing keeps it watertight and does not collapse the body', () => {
    const grid = new TopologyGrid(8, 6, 6);
    const dens = new Float32Array(grid.nElems);
    for (let ez = 1; ez < 5; ez++) for (let ey = 1; ey < 5; ey++) for (let ex = 1; ex < 7; ex++) {
      dens[(ez * 6 + ey) * 8 + ex] = 1;
    }
    const raw = extractSolidSurface(dens, grid, 0.5);
    const smooth = taubinSmooth(raw, 12);

    expect(allFinite(smooth)).toBe(true);
    expect(smooth.indices).toEqual(raw.indices); // connectivity unchanged
    const topo = analyzeTopology(toGeo(smooth));
    expect(topo.isClosedManifold).toBe(true);

    // Taubin must NOT shrink the body to nothing (plain Laplacian would); its
    // anti-shrink μ pass may modestly expand convex corners — both are bounded.
    const r = bboxSize(raw), s = bboxSize(smooth);
    for (let d = 0; d < 3; d++) {
      expect(s[d]).toBeGreaterThan(r[d] * 0.6);
      expect(s[d]).toBeLessThan(r[d] * 1.25);
    }
  });
});
