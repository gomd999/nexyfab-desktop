import type { OptConfig, OptProgress, OptResult } from './types';
import {
  computeKe0,
  getElementDofs,
  getFixedDofs,
  getFixedDofsFromNodes,
  getLoadVector,
  getLoadVectorFromNodes,
  getActiveFaceNodes,
  solvePCG,
} from './fem3d';

/**
 * Pre-compute filter neighbor lists.
 * Returns for each element: arrays of neighbor indices and corresponding weights.
 */
function buildFilterNeighbors(
  nx: number,
  ny: number,
  nz: number,
  rmin: number,
  mask?: Uint8Array
): { indices: Int32Array[]; weights: Float64Array[] } {
  const nElem = nx * ny * nz;
  const indices: Int32Array[] = new Array(nElem);
  const weights: Float64Array[] = new Array(nElem);

  const rminCeil = Math.ceil(rmin);

  for (let ez = 0; ez < nz; ez++) {
    for (let ey = 0; ey < ny; ey++) {
      for (let ex = 0; ex < nx; ex++) {
        const eIdx = ex + ey * nx + ez * nx * ny;
        const cx = ex + 0.5;
        const cy = ey + 0.5;
        const cz = ez + 0.5;

        const tempIdx: number[] = [];
        const tempW: number[] = [];

        const izMin = Math.max(0, ez - rminCeil);
        const izMax = Math.min(nz - 1, ez + rminCeil);
        const iyMin = Math.max(0, ey - rminCeil);
        const iyMax = Math.min(ny - 1, ey + rminCeil);
        const ixMin = Math.max(0, ex - rminCeil);
        const ixMax = Math.min(nx - 1, ex + rminCeil);

        for (let iz = izMin; iz <= izMax; iz++) {
          for (let iy = iyMin; iy <= iyMax; iy++) {
            for (let ix = ixMin; ix <= ixMax; ix++) {
              const dist = Math.sqrt(
                (ix + 0.5 - cx) ** 2 +
                (iy + 0.5 - cy) ** 2 +
                (iz + 0.5 - cz) ** 2
              );
              const w = Math.max(0, rmin - dist);
              if (w > 0) {
                const nbrIdx = ix + iy * nx + iz * nx * ny;
                // Skip inactive elements when mask is provided
                if (mask && mask[nbrIdx] === 0) continue;
                tempIdx.push(nbrIdx);
                tempW.push(w);
              }
            }
          }
        }

        indices[eIdx] = new Int32Array(tempIdx);
        weights[eIdx] = new Float64Array(tempW);
      }
    }
  }

  return { indices, weights };
}

/**
 * Run 3D SIMP topology optimization.
 */
export async function runSIMP(
  config: OptConfig,
  onProgress: (progress: OptProgress) => void
): Promise<OptResult> {
  const {
    dimX, dimY, dimZ,
    nx, ny, nz,
    volfrac, penal, rmin, maxIter,
    material,
    boundary,
  } = config;

  const nElem = nx * ny * nz;
  const xmin = 0.001;
  const move = 0.2;

  // Domain mask support
  const mask = config.domainMask;
  let nActive = nElem;
  if (mask) {
    nActive = 0;
    for (let e = 0; e < nElem; e++) {
      if (mask[e] === 1) nActive++;
    }
  }

  // Initialize densities
  const x = new Float64Array(nElem);
  if (mask) {
    for (let e = 0; e < nElem; e++) {
      x[e] = mask[e] === 1 ? volfrac : xmin;
    }
  } else {
    x.fill(volfrac);
  }

  // Element half-dimensions (mm)
  const a = dimX / (2 * nx);
  const b = dimY / (2 * ny);
  const c = dimZ / (2 * nz);

  // Pre-compute element stiffness matrix
  const Ke0 = computeKe0(a, b, c, material.E, material.nu);

  // Boundary conditions
  const nNodes = (nx + 1) * (ny + 1) * (nz + 1);
  const nDof = nNodes * 3;

  let fixedDofs: Set<number>;
  if (boundary.fixedNodeIndices) {
    // Custom domain: explicit node indices
    fixedDofs = getFixedDofsFromNodes(boundary.fixedNodeIndices);
  } else if (mask && boundary.fixedFaces.length > 0) {
    // Hybrid mode: face-based selection filtered by mask
    fixedDofs = new Set<number>();
    for (const face of boundary.fixedFaces) {
      const nodes = getActiveFaceNodes(mask, face, nx, ny, nz);
      for (const node of nodes) {
        fixedDofs.add(node * 3 + 0);
        fixedDofs.add(node * 3 + 1);
        fixedDofs.add(node * 3 + 2);
      }
    }
  } else {
    fixedDofs = getFixedDofs(boundary.fixedFaces, nx, ny, nz);
  }

  let f: Float64Array;
  if (boundary.loadNodeEntries) {
    // Custom domain: explicit node load entries
    f = getLoadVectorFromNodes(boundary.loadNodeEntries, nDof);
  } else if (mask && boundary.loads.length > 0) {
    // Hybrid mode: face-based loads filtered by mask
    f = new Float64Array(nDof);
    for (const load of boundary.loads) {
      const nodes = getActiveFaceNodes(mask, load.face, nx, ny, nz);
      const nFaceNodes = nodes.length;
      if (nFaceNodes === 0) continue;
      for (const node of nodes) {
        f[node * 3 + 0] += load.force[0] / nFaceNodes;
        f[node * 3 + 1] += load.force[1] / nFaceNodes;
        f[node * 3 + 2] += load.force[2] / nFaceNodes;
      }
    }
  } else {
    f = getLoadVector(boundary.loads, nx, ny, nz, dimX, dimY, dimZ);
  }

  // Pre-compute filter neighbors
  const filter = buildFilterNeighbors(nx, ny, nz, rmin, mask);

  const convergenceHistory: number[] = [];

  let iteration = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iteration = iter + 1;

    // Solve FEA: Ku = f
    const u = solvePCG(Ke0, x, penal, f, fixedDofs, nx, ny, nz);

    // Compute element compliances and sensitivities
    const ce = new Float64Array(nElem);
    const dc = new Float64Array(nElem);

    let eIdx = 0;
    for (let ez = 0; ez < nz; ez++) {
      for (let ey = 0; ey < ny; ey++) {
        for (let ex = 0; ex < nx; ex++) {
          const dofs = getElementDofs(ex, ey, ez, nx, ny, nz);

          // Extract element displacements
          const ue = new Float64Array(24);
          for (let i = 0; i < 24; i++) {
            ue[i] = u[dofs[i]];
          }

          // ce = ue^T * Ke0 * ue
          let ceVal = 0;
          for (let i = 0; i < 24; i++) {
            let row = 0;
            for (let j = 0; j < 24; j++) {
              row += Ke0[i * 24 + j] * ue[j];
            }
            ceVal += ue[i] * row;
          }
          ce[eIdx] = ceVal;

          // Sensitivity: dc = -penal * x^(penal-1) * ce
          dc[eIdx] = -penal * Math.pow(x[eIdx], penal - 1) * ceVal;

          eIdx++;
        }
      }
    }

    // Apply density filter to sensitivities
    const dcFiltered = new Float64Array(nElem);
    for (let e = 0; e < nElem; e++) {
      const nbrIdx = filter.indices[e];
      const nbrW = filter.weights[e];
      let sumW = 0;
      let sumWX = 0;
      for (let n = 0; n < nbrIdx.length; n++) {
        const i = nbrIdx[n];
        sumW += nbrW[n];
        sumWX += nbrW[n] * x[i] * dc[i];
      }
      dcFiltered[e] = sumWX / (x[e] * sumW);
    }

    // Optimality Criteria (OC) update with bisection
    const xOld = new Float64Array(x);

    let l1 = 1e-10;
    let l2 = 1e10;

    while (l2 - l1 > 1e-10 * (l1 + l2)) {
      const lmid = 0.5 * (l1 + l2);
      let volSum = 0;

      for (let e = 0; e < nElem; e++) {
        // Skip void elements in custom domain
        if (mask && mask[e] === 0) {
          x[e] = xmin;
          continue;
        }
        // dv = 1.0 for all elements
        const xNew = x[e] * Math.sqrt(-dcFiltered[e] / lmid);
        const clamped = Math.max(
          Math.max(xmin, xOld[e] - move),
          Math.min(Math.min(1.0, xOld[e] + move), xNew)
        );
        x[e] = clamped;
        volSum += clamped;
      }

      if (volSum > volfrac * nActive) {
        l1 = lmid;
      } else {
        l2 = lmid;
      }
    }

    // Compute total compliance (only active elements contribute meaningfully)
    let compliance = 0;
    for (let e = 0; e < nElem; e++) {
      if (mask && mask[e] === 0) continue;
      compliance += Math.pow(x[e], penal) * ce[e];
    }

    // Compute change
    let change = 0;
    for (let e = 0; e < nElem; e++) {
      const diff = Math.abs(x[e] - xOld[e]);
      if (diff > change) change = diff;
    }

    // Current volume fraction (relative to active elements only)
    let volFracCurrent = 0;
    for (let e = 0; e < nElem; e++) {
      if (mask && mask[e] === 0) continue;
      volFracCurrent += x[e];
    }
    volFracCurrent /= nActive;

    convergenceHistory.push(compliance);

    // Report progress
    onProgress({
      iteration,
      maxIteration: maxIter,
      compliance,
      volumeFraction: volFracCurrent,
      change,
      densities: new Float64Array(x),
    });

    // Yield to UI thread
    await new Promise<void>((r) => setTimeout(r, 0));

    // Check convergence
    if (change < 0.01) break;
  }

  // Final volume fraction (relative to active elements only)
  let finalVol = 0;
  for (let e = 0; e < nElem; e++) {
    if (mask && mask[e] === 0) continue;
    finalVol += x[e];
  }
  finalVol /= nActive;

  return {
    densities: new Float64Array(x),
    nx,
    ny,
    nz,
    dimX,
    dimY,
    dimZ,
    finalCompliance: convergenceHistory[convergenceHistory.length - 1] ?? 0,
    finalVolumeFraction: finalVol,
    iterations: iteration,
    convergenceHistory,
  };
}
