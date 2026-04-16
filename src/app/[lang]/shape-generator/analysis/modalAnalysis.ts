// ─── Modal Analysis — Natural Frequency & Mode Shape Calculation ─────────────
// Simplified eigenvalue solver for vibration analysis on voxel grids.

import * as THREE from 'three';

export interface ModalMaterial {
  name: string;
  density: number;          // kg/m³
  youngsModulus: number;     // Pa
  poissonsRatio: number;
}

export const MODAL_MATERIALS: Record<string, ModalMaterial> = {
  steel: { name: 'Steel', density: 7850, youngsModulus: 200e9, poissonsRatio: 0.3 },
  aluminum: { name: 'Aluminum', density: 2700, youngsModulus: 69e9, poissonsRatio: 0.33 },
  titanium: { name: 'Titanium', density: 4500, youngsModulus: 116e9, poissonsRatio: 0.34 },
  copper: { name: 'Copper', density: 8960, youngsModulus: 130e9, poissonsRatio: 0.34 },
  abs: { name: 'ABS Plastic', density: 1050, youngsModulus: 2.3e9, poissonsRatio: 0.35 },
  pla: { name: 'PLA', density: 1240, youngsModulus: 3.5e9, poissonsRatio: 0.36 },
};

export interface ModalResult {
  frequencies: number[];               // Hz for each mode
  modeShapes: Float32Array[];          // displacement field per mode (flattened xyz)
  participationFactors: number[];       // mass participation factor per mode
  totalMass: number;
  gridSize: number;
}

export interface ModalConfig {
  material: string;
  numModes: number;       // how many modes to compute
  gridSize: number;       // voxel resolution (e.g. 6 = 6x6x6)
  fixedFaces: string[];   // 'bottom', 'top', 'left', 'right', 'front', 'back'
  dimensions: { x: number; y: number; z: number }; // mm
}

/* ── Power iteration for approximate eigenvalues ── */

function powerIteration(
  K: Float64Array, // stiffness (diagonal approx)
  M: Float64Array, // mass (diagonal)
  n: number,
  numModes: number,
  maxIter: number = 100,
): { eigenvalues: number[]; eigenvectors: Float32Array[] } {
  const eigenvalues: number[] = [];
  const eigenvectors: Float32Array[] = [];
  const deflation = new Float64Array(n); // accumulated deflation

  for (let mode = 0; mode < numModes; mode++) {
    // Random initial guess
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.random() - 0.5;

    // Orthogonalize against previous modes
    for (let prev = 0; prev < mode; prev++) {
      const prevVec = eigenvectors[prev];
      let dot = 0;
      for (let i = 0; i < n; i++) dot += v[i] * prevVec[i] * M[i];
      for (let i = 0; i < n; i++) v[i] -= dot * prevVec[i];
    }

    let lambda = 0;
    for (let iter = 0; iter < maxIter; iter++) {
      // w = K^(-1) * M * v (inverse power iteration for smallest eigenvalues)
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const ki = K[i] + deflation[i];
        w[i] = ki > 1e-20 ? (M[i] * v[i]) / ki : 0;
      }

      // Orthogonalize
      for (let prev = 0; prev < mode; prev++) {
        const prevVec = eigenvectors[prev];
        let dot = 0;
        for (let i = 0; i < n; i++) dot += w[i] * prevVec[i] * M[i];
        for (let i = 0; i < n; i++) w[i] -= dot * prevVec[i];
      }

      // Rayleigh quotient: λ = (v^T K v) / (v^T M v)
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += w[i] * K[i] * w[i];
        den += w[i] * M[i] * w[i];
      }
      lambda = den > 1e-20 ? num / den : 0;

      // Normalize
      let norm = 0;
      for (let i = 0; i < n; i++) norm += w[i] * w[i] * M[i];
      norm = Math.sqrt(norm);
      if (norm > 1e-20) {
        for (let i = 0; i < n; i++) v[i] = w[i] / norm;
      }
    }

    eigenvalues.push(lambda);
    const modeShape = new Float32Array(n);
    for (let i = 0; i < n; i++) modeShape[i] = v[i];
    eigenvectors.push(modeShape);

    // Deflation: shift stiffness to avoid re-finding same mode
    for (let i = 0; i < n; i++) {
      deflation[i] += lambda * M[i] * v[i] * v[i] * 1000;
    }
  }

  return { eigenvalues, eigenvectors };
}

/* ── Run Modal Analysis ── */

export async function runModalAnalysis(
  config: ModalConfig,
  onProgress?: (pct: number) => void,
): Promise<ModalResult> {
  const mat = MODAL_MATERIALS[config.material] || MODAL_MATERIALS.steel;
  const gs = config.gridSize;
  const n = gs * gs * gs * 3; // 3 DOF per node (x,y,z displacement)

  const dx = config.dimensions.x / gs / 1000; // convert mm to m
  const dy = config.dimensions.y / gs / 1000;
  const dz = config.dimensions.z / gs / 1000;
  const elemVol = dx * dy * dz;

  // Build diagonal stiffness and mass matrices
  const K = new Float64Array(n);
  const M = new Float64Array(n);
  const faceIndices = new Set<number>();

  // Mark fixed DOFs
  for (let iz = 0; iz < gs; iz++) {
    for (let iy = 0; iy < gs; iy++) {
      for (let ix = 0; ix < gs; ix++) {
        const nodeIdx = (iz * gs * gs + iy * gs + ix) * 3;
        const elemMass = mat.density * elemVol / 8; // lumped mass

        for (let d = 0; d < 3; d++) {
          M[nodeIdx + d] = elemMass;
        }

        // Approximate stiffness from element connectivity
        const kLocal = mat.youngsModulus * elemVol / (dx * dx) * 0.5;
        for (let d = 0; d < 3; d++) {
          K[nodeIdx + d] = kLocal;

          // Add stiffness from neighbors
          if (ix > 0) K[nodeIdx + d] += kLocal * 0.3;
          if (ix < gs - 1) K[nodeIdx + d] += kLocal * 0.3;
          if (iy > 0) K[nodeIdx + d] += kLocal * 0.3;
          if (iy < gs - 1) K[nodeIdx + d] += kLocal * 0.3;
          if (iz > 0) K[nodeIdx + d] += kLocal * 0.3;
          if (iz < gs - 1) K[nodeIdx + d] += kLocal * 0.3;
        }

        // Fix boundary DOFs (very high stiffness)
        let fixed = false;
        if (config.fixedFaces.includes('bottom') && iy === 0) fixed = true;
        if (config.fixedFaces.includes('top') && iy === gs - 1) fixed = true;
        if (config.fixedFaces.includes('left') && ix === 0) fixed = true;
        if (config.fixedFaces.includes('right') && ix === gs - 1) fixed = true;
        if (config.fixedFaces.includes('front') && iz === 0) fixed = true;
        if (config.fixedFaces.includes('back') && iz === gs - 1) fixed = true;

        if (fixed) {
          for (let d = 0; d < 3; d++) {
            K[nodeIdx + d] *= 1e10; // pin this DOF
            faceIndices.add(nodeIdx + d);
          }
        }
      }
    }
  }

  if (onProgress) onProgress(30);
  await new Promise(r => setTimeout(r, 0));

  // Solve for eigenvalues
  const { eigenvalues, eigenvectors } = powerIteration(K, M, n, config.numModes, 80);

  if (onProgress) onProgress(80);
  await new Promise(r => setTimeout(r, 0));

  // Convert eigenvalues to frequencies (Hz): f = sqrt(λ) / (2π)
  const frequencies = eigenvalues.map(lam => {
    const omega = Math.sqrt(Math.abs(lam));
    return omega / (2 * Math.PI);
  }).sort((a, b) => a - b);

  // Mass participation factors
  const totalMass = mat.density * config.dimensions.x * config.dimensions.y * config.dimensions.z * 1e-9; // mm³ to m³
  const participationFactors = eigenvectors.map(v => {
    let sumMx = 0, sumM = 0;
    for (let i = 0; i < n; i += 3) {
      sumMx += M[i] * v[i]; // x-direction participation
      sumM += M[i];
    }
    return sumM > 0 ? Math.abs(sumMx / sumM) : 0;
  });

  if (onProgress) onProgress(100);

  return {
    frequencies,
    modeShapes: eigenvectors,
    participationFactors,
    totalMass,
    gridSize: gs,
  };
}

/* ── Apply mode shape as per-vertex color ── */

export function applyModeShapeColor(
  geometry: THREE.BufferGeometry,
  modeShape: Float32Array,
  gridSize: number,
  scale: number = 1,
): void {
  const pos = geometry.getAttribute('position');
  if (!pos) return;
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  // Find bounding box
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bbox.getSize(size);

  let maxDisp = 0;
  for (let i = 0; i < modeShape.length; i++) {
    maxDisp = Math.max(maxDisp, Math.abs(modeShape[i]));
  }
  if (maxDisp < 1e-20) maxDisp = 1;

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Map vertex to grid
    const gx = Math.min(gridSize - 1, Math.max(0, Math.floor(((x - bbox.min.x) / size.x) * gridSize)));
    const gy = Math.min(gridSize - 1, Math.max(0, Math.floor(((y - bbox.min.y) / size.y) * gridSize)));
    const gz = Math.min(gridSize - 1, Math.max(0, Math.floor(((z - bbox.min.z) / size.z) * gridSize)));

    const idx = (gz * gridSize * gridSize + gy * gridSize + gx) * 3;
    const dx = modeShape[idx] ?? 0;
    const dy = modeShape[idx + 1] ?? 0;
    const dz = modeShape[idx + 2] ?? 0;
    const mag = Math.sqrt(dx * dx + dy * dy + dz * dz) / maxDisp;

    // Blue → Cyan → Green → Yellow → Red
    const v = Math.min(1, mag * scale);
    if (v < 0.25) {
      colors[i * 3] = 0; colors[i * 3 + 1] = v * 4; colors[i * 3 + 2] = 1;
    } else if (v < 0.5) {
      colors[i * 3] = 0; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1 - (v - 0.25) * 4;
    } else if (v < 0.75) {
      colors[i * 3] = (v - 0.5) * 4; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 0;
    } else {
      colors[i * 3] = 1; colors[i * 3 + 1] = 1 - (v - 0.75) * 4; colors[i * 3 + 2] = 0;
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
