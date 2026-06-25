/**
 * assemblyBalance — centre of mass + static stability for a multi-part
 * assembly (catalog OR imported parts).
 *
 * For each PlacedPart we resolve its geometry (buildShapeResult — which now
 * also resolves imported meshes), take its volume and local centroid, weight
 * by material density to get mass, transform the centroid to world space, then
 * combine. The whole-assembly centre of mass is the mass-weighted mean.
 *
 * Stability (does it tip over under gravity, +Y up): project the combined CoM
 * straight down onto the ground plane (the assembly's lowest point) and test
 * whether it lands inside the SUPPORT FOOTPRINT — the XZ extent of the parts
 * actually resting on the ground. CoM inside → stable; outside → it topples.
 *
 * Pure + headless-testable. This is the "balance" the user asked for: change a
 * part (size / material / position) and the CoM + stability update.
 */
import * as THREE from 'three';
import type { PlacedPart } from './PartPlacementPanel';
import { buildShapeResult } from '../shapes';
import { meshCentroid } from '../shapes/importedRegistry';
import { findMaterial } from '../materials/materialDb';

/** Fallback density (kg/m³) when a part has no material — mild steel. */
const DEFAULT_DENSITY = 7850;

export interface PartBalance {
  id: string;
  massG: number;
  /** World-space centre of mass (mm). */
  com: [number, number, number];
}

export interface AssemblyBalance {
  totalMassG: number;
  /** Mass-weighted centre of mass of the whole assembly (mm). */
  centerOfMass: [number, number, number];
  /** Ground plane Y (assembly's lowest point, mm). */
  groundY: number;
  /** Support footprint (XZ rect of ground-contacting parts, mm). */
  support: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  /** Is the assembly statically stable (CoM over the support)? */
  stable: boolean;
  /** Signed clearance of the grounded CoM from the support edge (mm).
   *  Positive = inside by this margin; negative = outside (tips). */
  marginMm: number;
  perPart: PartBalance[];
}

export interface BalanceOptions {
  /** Override density per material id (kg/m³). */
  densityById?: Record<string, number>;
  /** Density (kg/m³) for parts with no material. */
  defaultDensity?: number;
  /** Tolerance (mm) for "resting on the ground". */
  groundTolMm?: number;
}

function densityFor(part: PlacedPart, opts: BalanceOptions): number {
  if (part.materialId && opts.densityById?.[part.materialId] != null) return opts.densityById[part.materialId]!;
  if (part.materialId) {
    const m = findMaterial(part.materialId);
    if (m?.density) return m.density;
  }
  return opts.defaultDensity ?? DEFAULT_DENSITY;
}

/** Compose a part's world transform from position (mm) + rotation (deg). */
export function partWorldMatrix(part: PlacedPart): THREE.Matrix4 {
  const e = part.rotation;
  const euler = new THREE.Euler(
    (e[0] * Math.PI) / 180,
    (e[1] * Math.PI) / 180,
    (e[2] * Math.PI) / 180,
  );
  const q = new THREE.Quaternion().setFromEuler(euler);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(part.position[0], part.position[1], part.position[2]),
    q,
    new THREE.Vector3(1, 1, 1),
  );
}

export function computeAssemblyBalance(
  parts: PlacedPart[],
  opts: BalanceOptions = {},
): AssemblyBalance {
  const groundTol = opts.groundTolMm ?? 0.5;
  const perPart: PartBalance[] = [];
  let totalMass = 0;
  const weighted = new THREE.Vector3();
  let groundY = Infinity;
  // Per-part world bbox-min-Y + XZ rect, kept for the support footprint.
  const partFootprints: { minY: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];

  for (const part of parts) {
    const res = buildShapeResult(part.shapeId, part.params);
    if (!res) continue;
    const qty = Math.max(1, part.qty || 1);
    const density = densityFor(part, opts); // kg/m³
    // mass(g) = volume(cm³) × density(kg/m³) / 1000.  (steel 7850 → ×7.85)
    const massG = res.volume_cm3 * (density / 1000) * qty;

    const mat = partWorldMatrix(part);
    const localCom = meshCentroid(res.geometry);
    const worldCom = localCom.clone().applyMatrix4(mat);

    totalMass += massG;
    weighted.add(worldCom.clone().multiplyScalar(massG));
    perPart.push({ id: part.id, massG, com: [worldCom.x, worldCom.y, worldCom.z] });

    // World bbox for the footprint / ground level.
    const bb = res.geometry.boundingBox ?? (res.geometry.computeBoundingBox(), res.geometry.boundingBox!);
    const wbb = bb.clone().applyMatrix4(mat);
    groundY = Math.min(groundY, wbb.min.y);
    partFootprints.push({ minY: wbb.min.y, minX: wbb.min.x, maxX: wbb.max.x, minZ: wbb.min.z, maxZ: wbb.max.z });
  }

  const center: [number, number, number] = totalMass > 0
    ? [weighted.x / totalMass, weighted.y / totalMass, weighted.z / totalMass]
    : [0, 0, 0];

  // Support footprint = XZ union of parts resting on the ground.
  let support: AssemblyBalance['support'] = null;
  for (const f of partFootprints) {
    if (f.minY > groundY + groundTol) continue; // not on the ground
    if (!support) support = { minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ };
    else {
      support.minX = Math.min(support.minX, f.minX);
      support.maxX = Math.max(support.maxX, f.maxX);
      support.minZ = Math.min(support.minZ, f.minZ);
      support.maxZ = Math.max(support.maxZ, f.maxZ);
    }
  }

  // Stability: grounded CoM (x,z) vs support rect. marginMm = distance inside
  // the nearest edge (negative when the CoM falls outside → it tips).
  let stable = true;
  let marginMm = 0;
  if (support && totalMass > 0) {
    const dx = Math.min(center[0] - support.minX, support.maxX - center[0]);
    const dz = Math.min(center[2] - support.minZ, support.maxZ - center[2]);
    marginMm = Math.min(dx, dz);
    stable = marginMm >= 0;
  } else {
    stable = false; // nothing to rest on
  }

  return {
    totalMassG: totalMass,
    centerOfMass: center,
    groundY: Number.isFinite(groundY) ? groundY : 0,
    support,
    stable,
    marginMm,
    perPart,
  };
}
