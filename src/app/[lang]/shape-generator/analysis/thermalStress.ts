import * as THREE from 'three';
import { runFEM, type FEMResult, type ThermalLoad, type Tet } from './femSolver';
import type { FEAMaterial, FEABoundaryCondition } from './simpleFEA';
import type { ThermalResult } from './thermalFEA';

/**
 * runThermalStress - the one-way (thermal -> structural) thermo-elastic entry point.
 *
 * It resolves a temperature load into a ThermalLoad { alpha, deltaTAt } and runs the
 * ordinary TET10 static solve (runFEM) with that body load, so the existing Ku=F solve
 * and stress recovery yield THERMAL stress:  sigma = D*(B*u - eps_th),  eps_th =
 * alpha*dT*[1,1,1,0,0,0]. For a fully constrained bar (u = 0) this returns the exact
 * sigma = -E*alpha*dT (compression), NOT zero - the strain SUBTRACTION in recovery is
 * what makes that true.
 *
 * Three ways to supply the temperature (in priority order):
 *   1. deltaTAt(x,y,z)         - an arbitrary analytic dT field (already T - T_ref).
 *   2. uniformDeltaT           - a single dT applied everywhere.
 *   3. temperatureField + tRef - a solved conduction field from runThermalFEA; the FE
 *                                nodes are sampled from its FV grid (dT = T - tRef).
 * With none of them the load is zero and the result is a pure static solve.
 */

/** CTE fallback (steel-like) when a material carries no alpha. */
export const DEFAULT_ALPHA = 12e-6; // 1/K

export interface ThermalStressInput {
  /** Override the coefficient of thermal expansion; else material.alpha; else DEFAULT_ALPHA. */
  alpha?: number;
  /** Uniform temperature change dT = T - T_ref (K), applied over the whole part. */
  uniformDeltaT?: number;
  /** Arbitrary dT(x,y,z) field in the part's mm coordinate space (already T - T_ref). */
  deltaTAt?: (x: number, y: number, z: number) => number;
  /** A solved steady-state conduction field from runThermalFEA (one-way coupling). */
  temperatureField?: ThermalResult;
  /** Stress-free reference temperature (degC), paired with temperatureField/uniform absolute. */
  tRef?: number;
}

export interface ThermalStressResult extends FEMResult {
  /** The alpha (1/K) actually used. */
  alphaUsed: number;
  /** Most-compressive signed normal stress over the tet nodes (MPa, typically negative). */
  minSignedStress: number;
  /** Most-tensile signed normal stress over the tet nodes (MPa). */
  maxSignedStress: number;
  /** Mean signed stress tensor (sxx,syy,szz MPa) over tet nodes within `tol` mm of a
   *  point - the signed readout the analytical thermal-stress cases compare against.
   *  Returns undefined when no node lies within tol. */
  sampleTensorNear: (x: number, y: number, z: number, tol: number) =>
    { sxx: number; syy: number; szz: number; count: number } | undefined;
  /** Mean sigma_xx (MPa) over tet nodes lying within `tol` mm of the plane x = xPlane -
   *  the constrained-bar axial-stress readout. Undefined if no node is on the plane. */
  sampleAxialAtX: (xPlane: number, tol?: number) => number | undefined;
}

export function runThermalStress(
  geometry: THREE.BufferGeometry,
  material: FEAMaterial,
  conditions: FEABoundaryCondition[],
  input: ThermalStressInput,
  opts: { maxNodes?: number; refine?: 'auto' | 'on' | 'off'; prebuiltMesh?: { nodes: Float32Array; tets: Tet[] } } = {},
): ThermalStressResult {
  const alpha = input.alpha ?? material.alpha ?? DEFAULT_ALPHA;

  let deltaTAt: (x: number, y: number, z: number) => number;
  if (input.deltaTAt) {
    deltaTAt = input.deltaTAt;
  } else if (input.uniformDeltaT !== undefined) {
    const d = input.uniformDeltaT;
    deltaTAt = () => d;
  } else if (input.temperatureField) {
    const field = input.temperatureField;
    const tRef = input.tRef ?? 0;
    deltaTAt = (x, y, z) => field.sampleTemperature(x, y, z) - tRef;
  } else {
    deltaTAt = () => 0;
  }

  const thermal: ThermalLoad = { alpha, deltaTAt };
  const fem = runFEM(geometry, material, conditions, opts.maxNodes ?? 4800, {
    refine: opts.refine ?? 'off',
    prebuiltMesh: opts.prebuiltMesh,
    thermal,
  });

  const sxxA = fem.nodalSxx, syyA = fem.nodalSyy, szzA = fem.nodalSzz, coords = fem.nodeCoordsMM;

  let minSignedStress = 0, maxSignedStress = 0;
  if (sxxA && syyA && szzA) {
    minSignedStress = Infinity; maxSignedStress = -Infinity;
    for (let n = 0; n < sxxA.length; n++) {
      const a = sxxA[n], b = syyA[n], c = szzA[n];
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
      if (lo < minSignedStress) minSignedStress = lo;
      if (hi > maxSignedStress) maxSignedStress = hi;
    }
    if (!Number.isFinite(minSignedStress)) minSignedStress = 0;
    if (!Number.isFinite(maxSignedStress)) maxSignedStress = 0;
  }

  const sampleTensorNear = (x: number, y: number, z: number, tol: number) => {
    if (!sxxA || !syyA || !szzA || !coords) return undefined;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    const t2 = tol * tol;
    for (let n = 0; n < sxxA.length; n++) {
      const dx = coords[n*3] - x, dy = coords[n*3+1] - y, dz = coords[n*3+2] - z;
      if (dx*dx + dy*dy + dz*dz <= t2) { sx += sxxA[n]; sy += syyA[n]; sz += szzA[n]; cnt++; }
    }
    if (cnt === 0) return undefined;
    return { sxx: sx / cnt, syy: sy / cnt, szz: sz / cnt, count: cnt };
  };

  const sampleAxialAtX = (xPlane: number, tol = 1.0) => {
    if (!sxxA || !coords) return undefined;
    let sum = 0, cnt = 0;
    for (let n = 0; n < sxxA.length; n++) {
      if (Math.abs(coords[n*3] - xPlane) <= tol) { sum += sxxA[n]; cnt++; }
    }
    return cnt === 0 ? undefined : sum / cnt;
  };

  return { ...fem, alphaUsed: alpha, minSignedStress, maxSignedStress, sampleTensorNear, sampleAxialAtX };
}
