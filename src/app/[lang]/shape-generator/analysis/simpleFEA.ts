import * as THREE from 'three';
import { runFEM } from './femSolver';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface FEABoundaryCondition {
  type: 'fixed' | 'force' | 'pressure';
  faceIndices: number[];
  value?: [number, number, number]; // force vector (N) or pressure normal (Pa)
}

export interface FEAResult {
  vonMisesStress: Float32Array;      // per-vertex stress values (MPa)
  displacement: Float32Array;        // per-vertex displacement magnitude (mm)
  displacementVectors: Float32Array; // per-vertex displacement vector (x,y,z)
  maxStress: number;
  maxDisplacement: number;
  minStress: number;
  safetyFactor: number;              // yield strength / max stress
  /** Which solver produced this result */
  method: 'linear-fem-tet' | 'beam-theory';
  /** Number of tetrahedral elements (0 for beam-theory) */
  elementCount: number;
  /** Number of degrees of freedom solved (0 for beam-theory) */
  dofCount: number;
  /** Whether the iterative solver converged (always true for beam-theory) */
  converged: boolean;
}

export interface FEAMaterial {
  youngsModulus: number;   // GPa
  poissonRatio: number;
  yieldStrength: number;   // MPa
  density: number;         // g/cm³
}

export interface FEAOptions {
  material: FEAMaterial;
  conditions: FEABoundaryCondition[];
}

/* ─── Voxel grid helpers ─────────────────────────────────────────────────── */

const GRID_RES = 10; // 10x10x10 voxel grid

interface VoxelGrid {
  occupied: boolean[];
  stressValues: Float32Array;
  displacementValues: Float32Array;
  displacementVec: Float32Array; // 3-component per voxel
  min: THREE.Vector3;
  max: THREE.Vector3;
  cellSize: THREE.Vector3;
}

function voxelIndex(ix: number, iy: number, iz: number): number {
  return ix + iy * GRID_RES + iz * GRID_RES * GRID_RES;
}

function worldToVoxel(
  point: THREE.Vector3,
  gridMin: THREE.Vector3,
  cellSize: THREE.Vector3,
): [number, number, number] {
  const ix = Math.min(GRID_RES - 1, Math.max(0, Math.floor((point.x - gridMin.x) / cellSize.x)));
  const iy = Math.min(GRID_RES - 1, Math.max(0, Math.floor((point.y - gridMin.y) / cellSize.y)));
  const iz = Math.min(GRID_RES - 1, Math.max(0, Math.floor((point.z - gridMin.z) / cellSize.z)));
  return [ix, iy, iz];
}

function voxelCenter(
  ix: number, iy: number, iz: number,
  gridMin: THREE.Vector3, cellSize: THREE.Vector3,
): THREE.Vector3 {
  return new THREE.Vector3(
    gridMin.x + (ix + 0.5) * cellSize.x,
    gridMin.y + (iy + 0.5) * cellSize.y,
    gridMin.z + (iz + 0.5) * cellSize.z,
  );
}

/* ─── Beam-theory fallback (original voxel implementation) ──────────────── */

function runBeamTheoryFallback(
  geometry: THREE.BufferGeometry,
  options: FEAOptions,
): FEAResult {
  const { material, conditions } = options;

  // Young's modulus in MPa (input is GPa)
  const E = material.youngsModulus * 1000;
  const yieldStr = material.yieldStrength;

  // Work with non-indexed geometry
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = nonIndexed.attributes.position;
  const vertCount = pos.count;
  const triCount = Math.floor(vertCount / 3);

  // Compute bounding box
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return { vonMisesStress: new Float32Array(0), displacement: new Float32Array(0), displacementVectors: new Float32Array(0), maxStress: 0, maxDisplacement: 0, minStress: 0, safetyFactor: 1, method: 'beam-theory' as const, elementCount: 0, dofCount: 0, converged: false };
  const bbMin = bb.min.clone();
  const bbMax = bb.max.clone();
  const bbSize = new THREE.Vector3().subVectors(bbMax, bbMin);
  // Pad slightly to avoid edge issues
  const pad = bbSize.clone().multiplyScalar(0.01);
  bbMin.sub(pad);
  bbMax.add(pad);
  bbSize.addVectors(pad, pad).add(bbSize);

  const cellSize = new THREE.Vector3(
    bbSize.x / GRID_RES,
    bbSize.y / GRID_RES,
    bbSize.z / GRID_RES,
  );

  // ── Build voxel grid: mark occupied voxels ──
  const totalVoxels = GRID_RES * GRID_RES * GRID_RES;
  const occupied = new Array<boolean>(totalVoxels).fill(false);
  const stressValues = new Float32Array(totalVoxels);
  const displacementValues = new Float32Array(totalVoxels);
  const displacementVec = new Float32Array(totalVoxels * 3);

  const v = new THREE.Vector3();
  for (let i = 0; i < vertCount; i++) {
    v.fromBufferAttribute(pos, i);
    const [ix, iy, iz] = worldToVoxel(v, bbMin, cellSize);
    occupied[voxelIndex(ix, iy, iz)] = true;
  }

  // ── Identify fixed voxels and force voxels from boundary conditions ──
  const fixedVoxels = new Set<number>();
  const forceVoxels = new Map<number, THREE.Vector3>(); // voxelIdx -> force vector

  // Collect face centroids for face-based conditions
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  for (const cond of conditions) {
    for (const fi of cond.faceIndices) {
      if (fi * 3 + 2 >= vertCount) continue;
      v0.fromBufferAttribute(pos, fi * 3);
      v1.fromBufferAttribute(pos, fi * 3 + 1);
      v2.fromBufferAttribute(pos, fi * 3 + 2);
      const centroid = new THREE.Vector3().add(v0).add(v1).add(v2).divideScalar(3);
      const [ix, iy, iz] = worldToVoxel(centroid, bbMin, cellSize);
      const vi = voxelIndex(ix, iy, iz);

      if (cond.type === 'fixed') {
        fixedVoxels.add(vi);
      } else if (cond.type === 'force' && cond.value) {
        const existing = forceVoxels.get(vi) || new THREE.Vector3();
        existing.add(new THREE.Vector3(cond.value[0], cond.value[1], cond.value[2]));
        forceVoxels.set(vi, existing);
      } else if (cond.type === 'pressure' && cond.value) {
        // Pressure: compute face normal and apply as distributed force
        const ab = new THREE.Vector3().subVectors(v1, v0);
        const ac = new THREE.Vector3().subVectors(v2, v0);
        const normal = ab.cross(ac).normalize();
        const pressureMag = new THREE.Vector3(cond.value[0], cond.value[1], cond.value[2]).length();
        const existing = forceVoxels.get(vi) || new THREE.Vector3();
        existing.addScaledVector(normal, pressureMag);
        forceVoxels.set(vi, existing);
      }
    }
  }

  // ── Simplified stress computation using beam-bending approximation ──
  // For each occupied voxel, estimate stress based on:
  //  - Distance from fixed supports
  //  - Moment arm from applied forces
  //  - sigma = M * y / I  (beam bending formula)
  // where I ~ (characteristic_length^4) / 12

  const charLength = Math.max(bbSize.x, bbSize.y, bbSize.z);
  // Approximate second moment of area (I) for the overall cross-section
  const crossDim = Math.min(bbSize.x, bbSize.y, bbSize.z);
  const I_approx = (crossDim * crossDim * crossDim * crossDim) / 12;

  // Gather fixed positions and force positions
  const fixedPositions: THREE.Vector3[] = [];
  fixedVoxels.forEach(vi => {
    const iz = Math.floor(vi / (GRID_RES * GRID_RES));
    const rem = vi - iz * GRID_RES * GRID_RES;
    const iy = Math.floor(rem / GRID_RES);
    const ix = rem % GRID_RES;
    fixedPositions.push(voxelCenter(ix, iy, iz, bbMin, cellSize));
  });

  const forceEntries: { pos: THREE.Vector3; force: THREE.Vector3 }[] = [];
  forceVoxels.forEach((force, vi) => {
    const iz = Math.floor(vi / (GRID_RES * GRID_RES));
    const rem = vi - iz * GRID_RES * GRID_RES;
    const iy = Math.floor(rem / GRID_RES);
    const ix = rem % GRID_RES;
    forceEntries.push({ pos: voxelCenter(ix, iy, iz, bbMin, cellSize), force });
  });

  // Total applied force magnitude
  const totalForce = new THREE.Vector3();
  for (const entry of forceEntries) {
    totalForce.add(entry.force);
  }
  const totalForceMag = totalForce.length() || 1;

  // For each occupied voxel, compute stress and displacement
  for (let iz = 0; iz < GRID_RES; iz++) {
    for (let iy = 0; iy < GRID_RES; iy++) {
      for (let ix = 0; ix < GRID_RES; ix++) {
        const vi = voxelIndex(ix, iy, iz);
        if (!occupied[vi]) continue;

        const center = voxelCenter(ix, iy, iz, bbMin, cellSize);

        if (fixedVoxels.has(vi)) {
          // Fixed voxels: zero displacement, reaction stress
          stressValues[vi] = totalForceMag * 0.1 / Math.max(crossDim * crossDim, 1);
          displacementValues[vi] = 0;
          continue;
        }

        // Find minimum distance to a fixed support
        let minFixedDist = charLength;
        for (const fp of fixedPositions) {
          const d = center.distanceTo(fp);
          if (d < minFixedDist) minFixedDist = d;
        }

        // Compute stress contribution from each force
        let sigmaTotal = 0;
        const dispVec = new THREE.Vector3();

        for (const entry of forceEntries) {
          const forceMag = entry.force.length();
          const forceDir = entry.force.clone().normalize();
          const distToForce = center.distanceTo(entry.pos);

          // Moment arm: distance from fixed support * distance from neutral axis
          // Simplified: longer distance from support = higher moment
          const momentArm = minFixedDist;
          const M = forceMag * momentArm; // Bending moment (N*mm)

          // Distance from neutral axis (approximate as distance from center of BBox)
          const bbCenter = new THREE.Vector3().addVectors(bbMin, bbMax).multiplyScalar(0.5);
          const y = Math.abs(center.y - bbCenter.y) + Math.abs(center.x - bbCenter.x) * 0.3;

          // Bending stress: sigma = M * y / I
          const sigma = I_approx > 0 ? (M * Math.max(y, 1)) / I_approx : 0;

          // Distance attenuation: stress decreases far from force application
          const attenuationForce = 1 / (1 + distToForce / charLength);
          // Distance from support amplification: more stress near supports
          const supportFactor = 1 + (1 - minFixedDist / charLength) * 0.5;

          sigmaTotal += sigma * attenuationForce * supportFactor;

          // Displacement: F/k where k = E*A/L (axial stiffness approximation)
          const A = crossDim * crossDim; // cross-section area
          const L = Math.max(minFixedDist, 1); // distance from support
          const k = (E * A) / L; // stiffness (N/mm)
          const delta = forceMag / Math.max(k, 1e-6);

          // Displacement direction: force direction attenuated by distance from force
          dispVec.addScaledVector(forceDir, delta * attenuationForce * (minFixedDist / Math.max(charLength, 1)));
        }

        stressValues[vi] = Math.abs(sigmaTotal);
        displacementValues[vi] = dispVec.length();
        displacementVec[vi * 3] = dispVec.x;
        displacementVec[vi * 3 + 1] = dispVec.y;
        displacementVec[vi * 3 + 2] = dispVec.z;
      }
    }
  }

  // ── Interpolate voxel values to mesh vertices ──
  const vertStress = new Float32Array(vertCount);
  const vertDisp = new Float32Array(vertCount);
  const vertDispVec = new Float32Array(vertCount * 3);

  for (let i = 0; i < vertCount; i++) {
    v.fromBufferAttribute(pos, i);
    const [ix, iy, iz] = worldToVoxel(v, bbMin, cellSize);

    // Trilinear interpolation from 8 neighboring voxels
    const lx = ((v.x - bbMin.x) / cellSize.x) - ix - 0.5;
    const ly = ((v.y - bbMin.y) / cellSize.y) - iy - 0.5;
    const lz = ((v.z - bbMin.z) / cellSize.z) - iz - 0.5;

    let sSum = 0, dSum = 0, wSum = 0;
    const dvSum = new THREE.Vector3();

    for (let dz = 0; dz <= 1; dz++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const nx = Math.min(GRID_RES - 1, Math.max(0, ix + (lx > 0 ? dx : dx - 1)));
          const ny = Math.min(GRID_RES - 1, Math.max(0, iy + (ly > 0 ? dy : dy - 1)));
          const nz = Math.min(GRID_RES - 1, Math.max(0, iz + (lz > 0 ? dz : dz - 1)));
          const nvi = voxelIndex(nx, ny, nz);

          const wx = dx === 0 ? (1 - Math.abs(lx)) : Math.abs(lx);
          const wy = dy === 0 ? (1 - Math.abs(ly)) : Math.abs(ly);
          const wz = dz === 0 ? (1 - Math.abs(lz)) : Math.abs(lz);
          const w = wx * wy * wz;

          sSum += stressValues[nvi] * w;
          dSum += displacementValues[nvi] * w;
          dvSum.x += displacementVec[nvi * 3] * w;
          dvSum.y += displacementVec[nvi * 3 + 1] * w;
          dvSum.z += displacementVec[nvi * 3 + 2] * w;
          wSum += w;
        }
      }
    }

    if (wSum > 0) {
      vertStress[i] = sSum / wSum;
      vertDisp[i] = dSum / wSum;
      vertDispVec[i * 3] = dvSum.x / wSum;
      vertDispVec[i * 3 + 1] = dvSum.y / wSum;
      vertDispVec[i * 3 + 2] = dvSum.z / wSum;
    }
  }

  // ── Compute result summary ──
  let maxStress = 0, minStress = Infinity, maxDisp = 0;
  for (let i = 0; i < vertCount; i++) {
    if (vertStress[i] > maxStress) maxStress = vertStress[i];
    if (vertStress[i] < minStress && vertStress[i] > 0) minStress = vertStress[i];
    if (vertDisp[i] > maxDisp) maxDisp = vertDisp[i];
  }
  if (minStress === Infinity) minStress = 0;

  const safetyFactor = maxStress > 0 ? yieldStr / maxStress : 99;

  return {
    vonMisesStress: vertStress,
    displacement: vertDisp,
    displacementVectors: vertDispVec,
    maxStress,
    maxDisplacement: maxDisp,
    minStress,
    safetyFactor: Math.min(safetyFactor, 99),
    method: 'beam-theory',
    elementCount: 0,
    dofCount: 0,
    converged: true,
  };
}

/* ─── Public runSimpleFEA — delegates to linear FEM with beam-theory fallback */

export function runSimpleFEA(
  geometry: THREE.BufferGeometry,
  options: FEAOptions,
): FEAResult {
  try {
    return { ...runFEM(geometry, options.material, options.conditions, 1200), method: 'linear-fem-tet' as const };
  } catch (e) {
    console.warn('[FEA] Linear FEM failed, falling back to beam theory:', e);
    return runBeamTheoryFallback(geometry, options);
  }
}
