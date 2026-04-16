import type { Face } from './types';

/**
 * Node local coordinates for an 8-node hex element in (xi, eta, zeta) space.
 * Order: (-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)
 */
const NODE_COORDS: [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

const GP = 1.0 / Math.sqrt(3.0);

const GAUSS_POINTS: [number, number, number][] = [
  [-GP, -GP, -GP],
  [GP, -GP, -GP],
  [GP, GP, -GP],
  [-GP, GP, -GP],
  [-GP, -GP, GP],
  [GP, -GP, GP],
  [GP, GP, GP],
  [-GP, GP, GP],
];

/**
 * Build the 6x6 isotropic elasticity matrix D.
 */
function buildD(E: number, nu: number): Float64Array {
  const D = new Float64Array(36);
  const c = E / ((1 + nu) * (1 - 2 * nu));
  const d0 = c * (1 - nu);
  const d1 = c * nu;
  const d3 = c * (1 - 2 * nu) / 2;

  // Row 0
  D[0 * 6 + 0] = d0;
  D[0 * 6 + 1] = d1;
  D[0 * 6 + 2] = d1;
  // Row 1
  D[1 * 6 + 0] = d1;
  D[1 * 6 + 1] = d0;
  D[1 * 6 + 2] = d1;
  // Row 2
  D[2 * 6 + 0] = d1;
  D[2 * 6 + 1] = d1;
  D[2 * 6 + 2] = d0;
  // Row 3-5 (shear)
  D[3 * 6 + 3] = d3;
  D[4 * 6 + 4] = d3;
  D[5 * 6 + 5] = d3;

  return D;
}

/**
 * Compute the 24x24 element stiffness matrix for a rectangular hex8 element.
 * a, b, c are half-dimensions in x, y, z.
 */
export function computeKe0(
  a: number,
  b: number,
  c: number,
  E: number,
  nu: number
): Float64Array {
  const Ke = new Float64Array(24 * 24);
  const D = buildD(E, nu);

  // For each Gauss point
  for (let gp = 0; gp < 8; gp++) {
    const xi = GAUSS_POINTS[gp][0];
    const eta = GAUSS_POINTS[gp][1];
    const zeta = GAUSS_POINTS[gp][2];

    // Shape function derivatives w.r.t. natural coords (dN/dxi, dN/deta, dN/dzeta)
    const dNdxi = new Float64Array(8);
    const dNdeta = new Float64Array(8);
    const dNdzeta = new Float64Array(8);

    for (let i = 0; i < 8; i++) {
      const xi_i = NODE_COORDS[i][0];
      const eta_i = NODE_COORDS[i][1];
      const zeta_i = NODE_COORDS[i][2];
      dNdxi[i] = (1 / 8) * xi_i * (1 + eta_i * eta) * (1 + zeta_i * zeta);
      dNdeta[i] = (1 / 8) * (1 + xi_i * xi) * eta_i * (1 + zeta_i * zeta);
      dNdzeta[i] = (1 / 8) * (1 + xi_i * xi) * (1 + eta_i * eta) * zeta_i;
    }

    // For a rectangular element aligned with axes, J is diagonal:
    // J = diag(a, b, c)
    // dN/dx = dN/dxi / a, etc.
    // detJ = a * b * c
    const detJ = a * b * c;

    // Build B matrix (6 x 24)
    const B = new Float64Array(6 * 24);
    for (let i = 0; i < 8; i++) {
      const dNdx = dNdxi[i] / a;
      const dNdy = dNdeta[i] / b;
      const dNdz = dNdzeta[i] / c;
      const col = i * 3;

      // eps_xx = du/dx
      B[0 * 24 + col + 0] = dNdx;
      // eps_yy = dv/dy
      B[1 * 24 + col + 1] = dNdy;
      // eps_zz = dw/dz
      B[2 * 24 + col + 2] = dNdz;
      // gamma_yz = dv/dz + dw/dy
      B[3 * 24 + col + 1] = dNdz;
      B[3 * 24 + col + 2] = dNdy;
      // gamma_xz = du/dz + dw/dx
      B[4 * 24 + col + 0] = dNdz;
      B[4 * 24 + col + 2] = dNdx;
      // gamma_xy = du/dy + dv/dx
      B[5 * 24 + col + 0] = dNdy;
      B[5 * 24 + col + 1] = dNdx;
    }

    // Ke += B^T * D * B * detJ * weight (weight=1 for each GP)
    // First compute DB = D * B (6x24)
    const DB = new Float64Array(6 * 24);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 24; j++) {
        let sum = 0;
        for (let k = 0; k < 6; k++) {
          sum += D[i * 6 + k] * B[k * 24 + j];
        }
        DB[i * 24 + j] = sum;
      }
    }

    // Ke += B^T * DB * detJ
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        let sum = 0;
        for (let k = 0; k < 6; k++) {
          sum += B[k * 24 + i] * DB[k * 24 + j];
        }
        Ke[i * 24 + j] += sum * detJ;
      }
    }
  }

  return Ke;
}

/**
 * Get the 24 global DOF indices for element (ex, ey, ez).
 */
export function getElementDofs(
  ex: number,
  ey: number,
  ez: number,
  nx: number,
  ny: number,
  nz: number
): number[] {
  const nxn = nx + 1;
  const nyn = ny + 1;

  // 8 node indices in the same order as NODE_COORDS
  const nodes = [
    ex + ey * nxn + ez * nxn * nyn,             // (-1,-1,-1)
    (ex + 1) + ey * nxn + ez * nxn * nyn,       // ( 1,-1,-1)
    (ex + 1) + (ey + 1) * nxn + ez * nxn * nyn, // ( 1, 1,-1)
    ex + (ey + 1) * nxn + ez * nxn * nyn,       // (-1, 1,-1)
    ex + ey * nxn + (ez + 1) * nxn * nyn,       // (-1,-1, 1)
    (ex + 1) + ey * nxn + (ez + 1) * nxn * nyn, // ( 1,-1, 1)
    (ex + 1) + (ey + 1) * nxn + (ez + 1) * nxn * nyn, // ( 1, 1, 1)
    ex + (ey + 1) * nxn + (ez + 1) * nxn * nyn, // (-1, 1, 1)
  ];

  const dofs: number[] = new Array(24);
  for (let i = 0; i < 8; i++) {
    dofs[i * 3 + 0] = nodes[i] * 3 + 0;
    dofs[i * 3 + 1] = nodes[i] * 3 + 1;
    dofs[i * 3 + 2] = nodes[i] * 3 + 2;
  }
  return dofs;
}

/**
 * Assemble diagonal of global stiffness matrix (for Jacobi preconditioner).
 */
export function assembleDiagonal(
  Ke0: Float64Array,
  densities: Float64Array,
  penal: number,
  nx: number,
  ny: number,
  nz: number
): Float64Array {
  const nNodes = (nx + 1) * (ny + 1) * (nz + 1);
  const ndof = nNodes * 3;
  const diag = new Float64Array(ndof);

  let eIdx = 0;
  for (let ez = 0; ez < nz; ez++) {
    for (let ey = 0; ey < ny; ey++) {
      for (let ex = 0; ex < nx; ex++) {
        const xp = Math.pow(densities[eIdx], penal);
        const dofs = getElementDofs(ex, ey, ez, nx, ny, nz);
        for (let i = 0; i < 24; i++) {
          diag[dofs[i]] += xp * Ke0[i * 24 + i];
        }
        eIdx++;
      }
    }
  }

  return diag;
}

/**
 * Matrix-free global K*v product.
 */
export function matVecProduct(
  Ke0: Float64Array,
  densities: Float64Array,
  penal: number,
  v: Float64Array,
  nx: number,
  ny: number,
  nz: number
): Float64Array {
  const nNodes = (nx + 1) * (ny + 1) * (nz + 1);
  const ndof = nNodes * 3;
  const result = new Float64Array(ndof);

  let eIdx = 0;
  for (let ez = 0; ez < nz; ez++) {
    for (let ey = 0; ey < ny; ey++) {
      for (let ex = 0; ex < nx; ex++) {
        const xp = Math.pow(densities[eIdx], penal);
        const dofs = getElementDofs(ex, ey, ez, nx, ny, nz);

        // Extract local displacement vector
        const ve = new Float64Array(24);
        for (let i = 0; i < 24; i++) {
          ve[i] = v[dofs[i]];
        }

        // Multiply by Ke0 and scatter
        for (let i = 0; i < 24; i++) {
          let sum = 0;
          for (let j = 0; j < 24; j++) {
            sum += Ke0[i * 24 + j] * ve[j];
          }
          result[dofs[i]] += xp * sum;
        }

        eIdx++;
      }
    }
  }

  return result;
}

/**
 * Preconditioned Conjugate Gradient solver.
 */
export function solvePCG(
  Ke0: Float64Array,
  densities: Float64Array,
  penal: number,
  f: Float64Array,
  fixedDofs: Set<number>,
  nx: number,
  ny: number,
  nz: number,
  tol: number = 1e-6,
  maxIter: number = 5000
): Float64Array {
  const nNodes = (nx + 1) * (ny + 1) * (nz + 1);
  const ndof = nNodes * 3;

  const u = new Float64Array(ndof);
  const r = new Float64Array(ndof);
  const z = new Float64Array(ndof);
  const p = new Float64Array(ndof);

  // Diagonal preconditioner
  const diag = assembleDiagonal(Ke0, densities, penal, nx, ny, nz);

  // Clamp small diag values to avoid division by zero
  for (let i = 0; i < ndof; i++) {
    if (diag[i] < 1e-30) diag[i] = 1e-30;
  }

  // Initial residual: r = f - K*u (u=0 initially, so r = f)
  for (let i = 0; i < ndof; i++) {
    r[i] = f[i];
  }

  // Zero out fixed DOFs
  for (const dof of fixedDofs) {
    r[dof] = 0;
    u[dof] = 0;
  }

  // z = M^{-1} r
  for (let i = 0; i < ndof; i++) {
    z[i] = r[i] / diag[i];
  }
  for (const dof of fixedDofs) {
    z[dof] = 0;
  }

  // p = z
  for (let i = 0; i < ndof; i++) {
    p[i] = z[i];
  }

  let rz = 0;
  for (let i = 0; i < ndof; i++) {
    rz += r[i] * z[i];
  }

  const bnorm = Math.sqrt(
    f.reduce((s, v) => s + v * v, 0)
  );
  if (bnorm < 1e-30) return u;

  for (let iter = 0; iter < maxIter; iter++) {
    // Ap = K * p
    const Ap = matVecProduct(Ke0, densities, penal, p, nx, ny, nz);

    // Zero fixed DOFs in Ap
    for (const dof of fixedDofs) {
      Ap[dof] = 0;
    }

    // alpha = rz / (p^T Ap)
    let pAp = 0;
    for (let i = 0; i < ndof; i++) {
      pAp += p[i] * Ap[i];
    }
    if (Math.abs(pAp) < 1e-30) break;

    const alpha = rz / pAp;

    // u = u + alpha * p
    // r = r - alpha * Ap
    for (let i = 0; i < ndof; i++) {
      u[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }

    // Check convergence
    let rnorm = 0;
    for (let i = 0; i < ndof; i++) {
      rnorm += r[i] * r[i];
    }
    rnorm = Math.sqrt(rnorm);
    if (rnorm / bnorm < tol) break;

    // z = M^{-1} r
    for (let i = 0; i < ndof; i++) {
      z[i] = r[i] / diag[i];
    }
    for (const dof of fixedDofs) {
      z[dof] = 0;
    }

    let rz_new = 0;
    for (let i = 0; i < ndof; i++) {
      rz_new += r[i] * z[i];
    }

    const beta = rz_new / rz;
    rz = rz_new;

    // p = z + beta * p
    for (let i = 0; i < ndof; i++) {
      p[i] = z[i] + beta * p[i];
    }

    for (const dof of fixedDofs) {
      p[dof] = 0;
    }
  }

  return u;
}

/**
 * Get fixed DOFs from explicit node indices.
 * Each node has 3 DOFs (x,y,z), so node i -> DOFs [i*3, i*3+1, i*3+2].
 */
export function getFixedDofsFromNodes(nodeIndices: number[]): Set<number> {
  const fixed = new Set<number>();
  for (const node of nodeIndices) {
    fixed.add(node * 3 + 0);
    fixed.add(node * 3 + 1);
    fixed.add(node * 3 + 2);
  }
  return fixed;
}

/**
 * Create load vector from explicit node entries.
 * Distributes force evenly among specified nodes.
 */
export function getLoadVectorFromNodes(
  loadEntries: Array<{ nodeIndices: number[]; force: [number, number, number] }>,
  nDof: number
): Float64Array {
  const f = new Float64Array(nDof);
  for (const entry of loadEntries) {
    const { nodeIndices, force } = entry;
    const nNodes = nodeIndices.length;
    if (nNodes === 0) continue;
    for (const node of nodeIndices) {
      f[node * 3 + 0] += force[0] / nNodes;
      f[node * 3 + 1] += force[1] / nNodes;
      f[node * 3 + 2] += force[2] / nNodes;
    }
  }
  return f;
}

/**
 * Find surface nodes of a voxelized domain.
 * A node is on the surface if it belongs to at least one active element
 * and at least one inactive element (or is on the grid boundary).
 * Returns array of node indices.
 */
export function getSurfaceNodes(
  mask: Uint8Array,
  nx: number,
  ny: number,
  nz: number
): number[] {
  const nxn = nx + 1;
  const nyn = ny + 1;
  const nzn = nz + 1;

  // Track which nodes belong to active elements and which to inactive
  const nodeHasActive = new Uint8Array(nxn * nyn * nzn);
  const nodeHasInactive = new Uint8Array(nxn * nyn * nzn);

  for (let ez = 0; ez < nz; ez++) {
    for (let ey = 0; ey < ny; ey++) {
      for (let ex = 0; ex < nx; ex++) {
        const eIdx = ex + ey * nx + ez * nx * ny;
        const isActive = mask[eIdx] === 1;

        // 8 nodes of this element
        const nodes = [
          ex + ey * nxn + ez * nxn * nyn,
          (ex + 1) + ey * nxn + ez * nxn * nyn,
          (ex + 1) + (ey + 1) * nxn + ez * nxn * nyn,
          ex + (ey + 1) * nxn + ez * nxn * nyn,
          ex + ey * nxn + (ez + 1) * nxn * nyn,
          (ex + 1) + ey * nxn + (ez + 1) * nxn * nyn,
          (ex + 1) + (ey + 1) * nxn + (ez + 1) * nxn * nyn,
          ex + (ey + 1) * nxn + (ez + 1) * nxn * nyn,
        ];

        for (const n of nodes) {
          if (isActive) {
            nodeHasActive[n] = 1;
          } else {
            nodeHasInactive[n] = 1;
          }
        }
      }
    }
  }

  // Also mark boundary nodes as having "inactive" neighbor (outside domain)
  for (let iz = 0; iz < nzn; iz++) {
    for (let iy = 0; iy < nyn; iy++) {
      for (let ix = 0; ix < nxn; ix++) {
        if (ix === 0 || ix === nx || iy === 0 || iy === ny || iz === 0 || iz === nz) {
          nodeHasInactive[ix + iy * nxn + iz * nxn * nyn] = 1;
        }
      }
    }
  }

  const surfaceNodes: number[] = [];
  const totalNodes = nxn * nyn * nzn;
  for (let i = 0; i < totalNodes; i++) {
    if (nodeHasActive[i] === 1 && nodeHasInactive[i] === 1) {
      surfaceNodes.push(i);
    }
  }

  return surfaceNodes;
}

/**
 * Get nodes on a specific face of the bounding box that are also inside the domain.
 * This allows using face-based selection even with custom domains.
 * A node is "inside" if it belongs to at least one active element.
 */
export function getActiveFaceNodes(
  mask: Uint8Array,
  face: Face,
  nx: number,
  ny: number,
  nz: number
): number[] {
  const nxn = nx + 1;
  const nyn = ny + 1;
  const nzn = nz + 1;

  // Build set of nodes that belong to at least one active element
  const nodeActive = new Uint8Array(nxn * nyn * nzn);
  for (let ez = 0; ez < nz; ez++) {
    for (let ey = 0; ey < ny; ey++) {
      for (let ex = 0; ex < nx; ex++) {
        const eIdx = ex + ey * nx + ez * nx * ny;
        if (mask[eIdx] !== 1) continue;
        const nodes = [
          ex + ey * nxn + ez * nxn * nyn,
          (ex + 1) + ey * nxn + ez * nxn * nyn,
          (ex + 1) + (ey + 1) * nxn + ez * nxn * nyn,
          ex + (ey + 1) * nxn + ez * nxn * nyn,
          ex + ey * nxn + (ez + 1) * nxn * nyn,
          (ex + 1) + ey * nxn + (ez + 1) * nxn * nyn,
          (ex + 1) + (ey + 1) * nxn + (ez + 1) * nxn * nyn,
          ex + (ey + 1) * nxn + (ez + 1) * nxn * nyn,
        ];
        for (const n of nodes) {
          nodeActive[n] = 1;
        }
      }
    }
  }

  // Collect face nodes that are also active
  const result: number[] = [];

  switch (face) {
    case '-x':
      for (let iz = 0; iz < nzn; iz++)
        for (let iy = 0; iy < nyn; iy++) {
          const n = 0 + iy * nxn + iz * nxn * nyn;
          if (nodeActive[n]) result.push(n);
        }
      break;
    case '+x':
      for (let iz = 0; iz < nzn; iz++)
        for (let iy = 0; iy < nyn; iy++) {
          const n = nx + iy * nxn + iz * nxn * nyn;
          if (nodeActive[n]) result.push(n);
        }
      break;
    case '-y':
      for (let iz = 0; iz < nzn; iz++)
        for (let ix = 0; ix < nxn; ix++) {
          const n = ix + 0 * nxn + iz * nxn * nyn;
          if (nodeActive[n]) result.push(n);
        }
      break;
    case '+y':
      for (let iz = 0; iz < nzn; iz++)
        for (let ix = 0; ix < nxn; ix++) {
          const n = ix + ny * nxn + iz * nxn * nyn;
          if (nodeActive[n]) result.push(n);
        }
      break;
    case '-z':
      for (let iy = 0; iy < nyn; iy++)
        for (let ix = 0; ix < nxn; ix++) {
          const n = ix + iy * nxn + 0 * nxn * nyn;
          if (nodeActive[n]) result.push(n);
        }
      break;
    case '+z':
      for (let iy = 0; iy < nyn; iy++)
        for (let ix = 0; ix < nxn; ix++) {
          const n = ix + iy * nxn + nz * nxn * nyn;
          if (nodeActive[n]) result.push(n);
        }
      break;
  }

  return result;
}

/**
 * Get the set of fixed DOFs from face names.
 */
export function getFixedDofs(
  fixedFaces: Face[],
  nx: number,
  ny: number,
  nz: number
): Set<number> {
  const fixed = new Set<number>();
  const nxn = nx + 1;
  const nyn = ny + 1;
  const nzn = nz + 1;

  for (const face of fixedFaces) {
    switch (face) {
      case '-x':
        for (let iz = 0; iz < nzn; iz++) {
          for (let iy = 0; iy < nyn; iy++) {
            const nodeIdx = 0 + iy * nxn + iz * nxn * nyn;
            fixed.add(nodeIdx * 3 + 0);
            fixed.add(nodeIdx * 3 + 1);
            fixed.add(nodeIdx * 3 + 2);
          }
        }
        break;
      case '+x':
        for (let iz = 0; iz < nzn; iz++) {
          for (let iy = 0; iy < nyn; iy++) {
            const nodeIdx = nx + iy * nxn + iz * nxn * nyn;
            fixed.add(nodeIdx * 3 + 0);
            fixed.add(nodeIdx * 3 + 1);
            fixed.add(nodeIdx * 3 + 2);
          }
        }
        break;
      case '-y':
        for (let iz = 0; iz < nzn; iz++) {
          for (let ix = 0; ix < nxn; ix++) {
            const nodeIdx = ix + 0 * nxn + iz * nxn * nyn;
            fixed.add(nodeIdx * 3 + 0);
            fixed.add(nodeIdx * 3 + 1);
            fixed.add(nodeIdx * 3 + 2);
          }
        }
        break;
      case '+y':
        for (let iz = 0; iz < nzn; iz++) {
          for (let ix = 0; ix < nxn; ix++) {
            const nodeIdx = ix + ny * nxn + iz * nxn * nyn;
            fixed.add(nodeIdx * 3 + 0);
            fixed.add(nodeIdx * 3 + 1);
            fixed.add(nodeIdx * 3 + 2);
          }
        }
        break;
      case '-z':
        for (let iy = 0; iy < nyn; iy++) {
          for (let ix = 0; ix < nxn; ix++) {
            const nodeIdx = ix + iy * nxn + 0 * nxn * nyn;
            fixed.add(nodeIdx * 3 + 0);
            fixed.add(nodeIdx * 3 + 1);
            fixed.add(nodeIdx * 3 + 2);
          }
        }
        break;
      case '+z':
        for (let iy = 0; iy < nyn; iy++) {
          for (let ix = 0; ix < nxn; ix++) {
            const nodeIdx = ix + iy * nxn + nz * nxn * nyn;
            fixed.add(nodeIdx * 3 + 0);
            fixed.add(nodeIdx * 3 + 1);
            fixed.add(nodeIdx * 3 + 2);
          }
        }
        break;
    }
  }

  return fixed;
}

/**
 * Build the global load vector from face loads.
 */
export function getLoadVector(
  loads: Array<{ face: Face; force: [number, number, number] }>,
  nx: number,
  ny: number,
  nz: number,
  dimX: number,
  dimY: number,
  dimZ: number
): Float64Array {
  const nNodes = (nx + 1) * (ny + 1) * (nz + 1);
  const ndof = nNodes * 3;
  const f = new Float64Array(ndof);
  const nxn = nx + 1;
  const nyn = ny + 1;
  const nzn = nz + 1;

  for (const load of loads) {
    const { face, force } = load;
    const faceNodes: number[] = [];

    switch (face) {
      case '-x':
        for (let iz = 0; iz < nzn; iz++)
          for (let iy = 0; iy < nyn; iy++)
            faceNodes.push(0 + iy * nxn + iz * nxn * nyn);
        break;
      case '+x':
        for (let iz = 0; iz < nzn; iz++)
          for (let iy = 0; iy < nyn; iy++)
            faceNodes.push(nx + iy * nxn + iz * nxn * nyn);
        break;
      case '-y':
        for (let iz = 0; iz < nzn; iz++)
          for (let ix = 0; ix < nxn; ix++)
            faceNodes.push(ix + 0 * nxn + iz * nxn * nyn);
        break;
      case '+y':
        for (let iz = 0; iz < nzn; iz++)
          for (let ix = 0; ix < nxn; ix++)
            faceNodes.push(ix + ny * nxn + iz * nxn * nyn);
        break;
      case '-z':
        for (let iy = 0; iy < nyn; iy++)
          for (let ix = 0; ix < nxn; ix++)
            faceNodes.push(ix + iy * nxn + 0 * nxn * nyn);
        break;
      case '+z':
        for (let iy = 0; iy < nyn; iy++)
          for (let ix = 0; ix < nxn; ix++)
            faceNodes.push(ix + iy * nxn + nz * nxn * nyn);
        break;
    }

    const nFaceNodes = faceNodes.length;
    for (const nodeIdx of faceNodes) {
      f[nodeIdx * 3 + 0] += force[0] / nFaceNodes;
      f[nodeIdx * 3 + 1] += force[1] / nFaceNodes;
      f[nodeIdx * 3 + 2] += force[2] / nFaceNodes;
    }
  }

  return f;
}
