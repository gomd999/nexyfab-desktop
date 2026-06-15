/**
 * topologyManifold — strictly-watertight extraction for diagonal / AM designs
 * (Track G3 follow-up). Edge-touching ("checkerboard") voxels make four boundary
 * faces meet at one edge — non-manifold, which slicers and STEP importers reject.
 * fillDiagonalGaps face-connects the voxel set so the extracted surface is a clean
 * 2-manifold. Verified against an explicit diagonal case and overhang-constrained
 * optimiser output (which produces 45° diagonal steps).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TopologyGrid, optimizeTopology3D, cantileverBC } from './topology3D';
import { extractSolidSurface, extractManifoldSurface, fillDiagonalGaps, thresholdForFraction } from './topologyExtract';
import { analyzeTopology } from '../features/meshTopology';

function toGeo(m: { positions: Float32Array; indices: Uint32Array }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

describe('topologyManifold — strictly-watertight extraction (Track G3)', () => {
  it('repairs an explicit edge-touching (checkerboard) pair into a closed manifold', () => {
    const grid = new TopologyGrid(3, 3, 2);
    const d = new Float32Array(grid.nElems);
    // two columns touching ONLY along the central vertical edge.
    d[grid.eIdx(0, 0, 0)] = 1; d[grid.eIdx(0, 0, 1)] = 1;
    d[grid.eIdx(1, 1, 0)] = 1; d[grid.eIdx(1, 1, 1)] = 1;

    const raw = analyzeTopology(toGeo(extractSolidSurface(d, grid, 0.5)));
    expect(raw.isClosedManifold).toBe(false);              // raw extraction is non-manifold
    expect(raw.nonManifoldEdgeCount).toBeGreaterThan(0);

    const fixed = analyzeTopology(toGeo(extractManifoldSurface(d, grid, 0.5)));
    expect(fixed.isClosedManifold).toBe(true);             // repaired
    expect(fixed.nonManifoldEdgeCount).toBe(0);
    expect(fixed.boundaryEdgeCount).toBe(0);
  });

  it('only ADDS material (the fill never removes a solid voxel)', () => {
    const grid = new TopologyGrid(8, 8, 4);
    const d = new Float32Array(grid.nElems).map((_, i) => ((i * 2654435761) % 100) / 100);
    const filled = fillDiagonalGaps(d, grid, 0.5);
    for (let e = 0; e < d.length; e++) if (d[e] > 0.5) expect(filled[e]).toBeGreaterThan(0.5);
  });

  it('makes overhang-constrained (45° diagonal) optimiser output strictly manifold', () => {
    const nx = 18, ny = 10, nz = 4;
    const grid = new TopologyGrid(nx, ny, nz);
    const am = optimizeTopology3D({ nx, ny, nz, volfrac: 0.4, maxIter: 30, overhang: 'X' }, cantileverBC(grid, -1));
    const thr = thresholdForFraction(am.density, am.volumeFraction);

    const fixed = analyzeTopology(toGeo(extractManifoldSurface(am.density, grid, thr)));
    expect(fixed.isClosedManifold).toBe(true);
    expect(fixed.nonManifoldEdgeCount).toBe(0);
    expect(fixed.boundaryEdgeCount).toBe(0);
  });

  it('is idempotent on an already-manifold solid block', () => {
    const grid = new TopologyGrid(6, 6, 6);
    const d = new Float32Array(grid.nElems);
    for (let z = 1; z < 5; z++) for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) d[(z * 6 + y) * 6 + x] = 1;
    const m = analyzeTopology(toGeo(extractManifoldSurface(d, grid, 0.5)));
    expect(m.isClosedManifold).toBe(true);
  });
});
