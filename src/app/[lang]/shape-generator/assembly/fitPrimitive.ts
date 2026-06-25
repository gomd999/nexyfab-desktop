/**
 * fitPrimitive — approximate an imported mesh shell with the nearest catalog
 * primitive (box / cylinder / sphere) so it becomes an EDITABLE parametric
 * part instead of an opaque mesh.
 *
 * This is the honest version of "mesh → parametric": not feature recognition
 * (the SGS-1 hard problem — recovering fillets/holes/sketch history from a
 * B-rep, which produces dirty topology), but primitive fitting. A scanned or
 * STL part collapses to box(w,h,d) / cylinder(d,h) / sphere(d) whose
 * dimensions are then slider-adjustable, balanceable, and simulatable through
 * the same catalog pipeline as any other part.
 *
 * Discriminator = the BBOX FILL RATIO (mesh volume ÷ bbox volume):
 *   ~1.00 (filling its box)      → box
 *   ~0.785 (π/4, round section)  → cylinder   (needs 2 ≈-equal bbox axes)
 *   ~0.524 (π/6)                 → sphere      (needs 3 ≈-equal bbox axes)
 *
 * Pure + headless-testable.
 */
import * as THREE from 'three';
import { meshVolumeMm3 } from '../shapes/importedRegistry';
import type { PlacedPart } from './PartPlacementPanel';

export interface PrimitiveFit {
  shapeId: 'box' | 'cylinder' | 'sphere';
  params: Record<string, number>;
  /** Cylinder axis in world frame (the odd bbox axis); null for box/sphere. */
  axis: 'x' | 'y' | 'z' | null;
  /** Relative volume error of the fit (0 = perfect). */
  fitError: number;
  /** World bbox centre (mm) — the part's placement. */
  center: [number, number, number];
}

const PI = Math.PI;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-9);

export function fitPrimitive(geo: THREE.BufferGeometry): PrimitiveFit {
  geo.computeBoundingBox();
  const bb = geo.boundingBox ?? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const size = new THREE.Vector3(); bb.getSize(size);
  const ctr = new THREE.Vector3(); bb.getCenter(ctr);
  const dx = Math.max(size.x, 1e-6), dy = Math.max(size.y, 1e-6), dz = Math.max(size.z, 1e-6);
  const boxVol = dx * dy * dz;
  const V = Math.max(meshVolumeMm3(geo), 0);
  const fill = V / boxVol;
  const center: [number, number, number] = [ctr.x, ctr.y, ctr.z];

  const allEqual = near(dx, dy, 0.2) && near(dy, dz, 0.2) && near(dx, dz, 0.2);

  // sphere — cubic bbox + low fill.
  if (allEqual && fill < 0.62) {
    const d = (dx + dy + dz) / 3;
    const modelVol = (PI / 6) * d ** 3;
    return { shapeId: 'sphere', params: { diameter: round(d) }, axis: null, fitError: relErr(V, modelVol), center };
  }

  // cylinder — exactly two ≈-equal axes (the diameter), odd axis = height.
  if (fill >= 0.6 && fill < 0.92) {
    const pairs: Array<['x' | 'y' | 'z', number, number, number]> = [
      ['y', dy, dx, dz], // height=y, diameter from x&z
      ['x', dx, dy, dz],
      ['z', dz, dx, dy],
    ];
    for (const [axis, h, d1, d2] of pairs) {
      if (near(d1, d2, 0.22)) {
        const D = (d1 + d2) / 2;
        const modelVol = (PI / 4) * D ** 2 * h;
        return { shapeId: 'cylinder', params: { diameter: round(D), height: round(h) }, axis, fitError: relErr(V, modelVol), center };
      }
    }
  }

  // box — default.
  return {
    shapeId: 'box',
    params: { width: round(dx), height: round(dy), depth: round(dz) },
    axis: null,
    fitError: relErr(V, boxVol),
    center,
  };
}

function relErr(v: number, model: number): number {
  if (model <= 0) return 1;
  return Math.abs(v - model) / model;
}
function round(v: number): number { return Math.round(v * 100) / 100; }

/** Euler rotation (deg) that orients a catalog cylinder (axis = +Y) onto the
 *  fitted axis. */
export function cylinderRotationFor(axis: 'x' | 'y' | 'z' | null): [number, number, number] {
  if (axis === 'x') return [0, 0, 90]; // Y → X
  if (axis === 'z') return [90, 0, 0]; // Y → Z
  return [0, 0, 0];
}

/**
 * Fit each shell to a catalog primitive and return EDITABLE PlacedParts
 * (shapeId box/cylinder/sphere + tunable params), placed at the shell's bbox
 * centre. Unlike importedGeometriesToPlaced (which keeps the raw mesh), these
 * parts have real parameters → intent sliders, balance, and simulation all
 * work on them.
 */
export function fittedPartsFromGeometries(geometries: THREE.BufferGeometry[], baseName = 'part'): PlacedPart[] {
  return geometries.map((geo, i) => {
    const fit = fitPrimitive(geo);
    return {
      id: `fit_${i}_${fit.shapeId}`,
      name: `${baseName} ${i + 1} (${fit.shapeId})`,
      shapeId: fit.shapeId,
      params: fit.params,
      qty: 1,
      position: fit.center,
      rotation: cylinderRotationFor(fit.axis),
    };
  });
}
